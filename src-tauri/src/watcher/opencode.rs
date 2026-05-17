//! OpenCode token watcher.
//!
//! OpenCode stores its history in a Drizzle-managed SQLite database at
//! `~/.local/share/opencode/opencode.db`. Each `message` row has a `data`
//! JSON blob with `role`, `tokens.{input,output,reasoning,cache.{read,write}}`,
//! `modelID`, and `time.created`.
//!
//! Strategy:
//! 1. Open the DB read-only (WAL mode allows concurrent reads while OpenCode is running).
//! 2. Poll every [`POLL_INTERVAL_SECS`] for rows with `time_updated > last_seen`.
//! 3. Parse `data`, build a [`TokenEvent`], dedup via the message UUID.
//! 4. Persist the high-water mark in `watch_state` under [`STATE_KEY`].

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};

use crate::db::{Db, TokenEvent};

pub const PROVIDER: &str = "opencode";
const POLL_INTERVAL_SECS: u64 = 5;
const STATE_KEY: &str = "opencode:last_time_updated";

pub fn opencode_db_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home directory"))?;
    Ok(home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("opencode.db"))
}

pub fn spawn_opencode_watcher(
    db: Arc<Db>,
    events_tx: broadcast::Sender<TokenEvent>,
    first_run: bool,
    override_path: Option<PathBuf>,
) -> Result<()> {
    let opencode_path = match override_path {
        Some(p) => p,
        None => opencode_db_path()?,
    };
    if !opencode_path.exists() {
        eprintln!(
            "[opencode] db not found at {:?}, watcher will not start",
            opencode_path
        );
        return Ok(());
    }

    // Bootstrap.
    // - First run ever: jump the high-water mark to the latest existing
    //   row's time_updated so prior OpenCode conversations are treated as
    //   already-consumed. No events are emitted from the historical data.
    // - Subsequent runs: scan_once as usual.
    let db_init = db.clone();
    let tx_init = events_tx.clone();
    let path_init = opencode_path.clone();
    tauri::async_runtime::spawn(async move {
        if first_run {
            if let Err(e) = baseline_to_latest(&path_init, &db_init).await {
                eprintln!("[opencode] baseline failed: {e:#}");
            }
        } else if let Err(e) = scan_once(&path_init, &db_init, &tx_init).await {
            eprintln!("[opencode] bootstrap failed: {e:#}");
        }
    });

    // Steady-state poll loop.
    let path_loop = opencode_path;
    tauri::async_runtime::spawn(async move {
        let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));
        loop {
            tick.tick().await;
            if let Err(e) = scan_once(&path_loop, &db, &events_tx).await {
                eprintln!("[opencode] poll error: {e:#}");
            }
        }
    });

    Ok(())
}

/// First-run helper: record the most recent `time_updated` in OpenCode's DB
/// as our high-water mark so historical messages stay outside our totals.
async fn baseline_to_latest(opencode_path: &Path, db: &Db) -> Result<()> {
    let path = opencode_path.to_path_buf();
    let latest = tokio::task::spawn_blocking(move || query_latest_time_updated(&path))
        .await
        .map_err(|e| anyhow!("opencode baseline task: {e}"))??;
    if latest > 0 {
        db.set_watch_offset(STATE_KEY, latest as u64)?;
    }
    Ok(())
}

fn query_latest_time_updated(opencode_path: &Path) -> Result<i64> {
    let conn = Connection::open_with_flags(opencode_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("opening {opencode_path:?}"))?;
    let latest: Option<i64> = conn
        .query_row(
            "SELECT MAX(time_updated) FROM message",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten();
    Ok(latest.unwrap_or(0))
}

async fn scan_once(
    opencode_path: &Path,
    db: &Db,
    tx: &broadcast::Sender<TokenEvent>,
) -> Result<()> {
    let last_seen = db.get_watch_offset(STATE_KEY)? as i64;

    let path = opencode_path.to_path_buf();
    let rows = tokio::task::spawn_blocking(move || query_messages(&path, last_seen))
        .await
        .map_err(|e| anyhow!("opencode read task: {e}"))??;

    let mut new_high_water = last_seen;
    for row in rows {
        if row.time_updated > new_high_water {
            new_high_water = row.time_updated;
        }
        if let Some(mut event) = row_to_event(&row) {
            match db.insert_token_event(&event) {
                Ok(Some(row_id)) => {
                    event.id = Some(row_id);
                    let _ = tx.send(event);
                }
                Ok(None) => {
                    // duplicate message_id — already recorded
                }
                Err(e) => {
                    eprintln!("[opencode] insert failed: {e:#}");
                }
            }
        }
    }

    if new_high_water > last_seen {
        db.set_watch_offset(STATE_KEY, new_high_water as u64)?;
    }
    Ok(())
}

struct OpenCodeRow {
    id: String,
    time_created: i64,
    time_updated: i64,
    data_json: String,
}

fn query_messages(opencode_path: &Path, last_seen: i64) -> Result<Vec<OpenCodeRow>> {
    let conn = Connection::open_with_flags(opencode_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("opening {opencode_path:?}"))?;

    let mut stmt = conn.prepare(
        "SELECT id, time_created, time_updated, data
         FROM message
         WHERE time_updated > ?1
         ORDER BY time_updated ASC
         LIMIT 5000",
    )?;
    let rows = stmt.query_map([last_seen], |row| {
        Ok(OpenCodeRow {
            id: row.get(0)?,
            time_created: row.get(1)?,
            time_updated: row.get(2)?,
            data_json: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn row_to_event(row: &OpenCodeRow) -> Option<TokenEvent> {
    let msg: OpenCodeMessage = serde_json::from_str(&row.data_json).ok()?;
    if msg.role.as_deref() != Some("assistant") {
        return None;
    }
    let tokens = msg.tokens?;
    let cache_read = tokens.cache.as_ref().map(|c| c.read).unwrap_or(0);
    let cache_write = tokens.cache.as_ref().map(|c| c.write).unwrap_or(0);

    let total = tokens.input + tokens.output + tokens.reasoning + cache_read + cache_write;
    if total == 0 {
        return None;
    }

    let timestamp =
        DateTime::<Utc>::from_timestamp_millis(row.time_created).unwrap_or_else(Utc::now);

    Some(TokenEvent {
        id: None,
        provider: PROVIDER.to_string(),
        model: msg.model_id,
        message_id: Some(row.id.clone()),
        input_tokens: tokens.input,
        output_tokens: tokens.output + tokens.reasoning,
        cache_read,
        cache_write,
        timestamp,
        session_id: None,
        source_file: Some(format!("opencode.db:{}", row.id)),
    })
}

#[derive(Debug, Deserialize)]
struct OpenCodeMessage {
    role: Option<String>,
    #[serde(rename = "modelID")]
    model_id: Option<String>,
    tokens: Option<OpenCodeTokens>,
}

#[derive(Debug, Deserialize)]
struct OpenCodeTokens {
    #[serde(default)]
    input: u64,
    #[serde(default)]
    output: u64,
    #[serde(default)]
    reasoning: u64,
    cache: Option<OpenCodeCache>,
}

#[derive(Debug, Deserialize)]
struct OpenCodeCache {
    #[serde(default)]
    read: u64,
    #[serde(default)]
    write: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_row(data: &str) -> OpenCodeRow {
        OpenCodeRow {
            id: "msg_abc".to_string(),
            time_created: 1_778_955_586_422,
            time_updated: 1_778_955_586_422,
            data_json: data.to_string(),
        }
    }

    #[test]
    fn parses_assistant_with_tokens() {
        let data = r#"{
            "role": "assistant",
            "modelID": "claude-3-5-sonnet",
            "tokens": {
                "input": 100,
                "output": 50,
                "reasoning": 5,
                "cache": {"read": 1000, "write": 200}
            }
        }"#;
        let ev = row_to_event(&make_row(data)).expect("should parse");
        assert_eq!(ev.provider, PROVIDER);
        assert_eq!(ev.input_tokens, 100);
        assert_eq!(ev.output_tokens, 55); // 50 + 5 reasoning
        assert_eq!(ev.cache_read, 1000);
        assert_eq!(ev.cache_write, 200);
        assert_eq!(ev.model.as_deref(), Some("claude-3-5-sonnet"));
        assert_eq!(ev.message_id.as_deref(), Some("msg_abc"));
    }

    #[test]
    fn skips_user_messages() {
        let data = r#"{"role":"user","tokens":{"input":5}}"#;
        assert!(row_to_event(&make_row(data)).is_none());
    }

    #[test]
    fn skips_zero_token_messages() {
        let data = r#"{"role":"assistant","tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}"#;
        assert!(row_to_event(&make_row(data)).is_none());
    }

    #[test]
    fn handles_missing_cache() {
        let data = r#"{"role":"assistant","tokens":{"input":42,"output":3}}"#;
        let ev = row_to_event(&make_row(data)).expect("should parse");
        assert_eq!(ev.cache_read, 0);
        assert_eq!(ev.cache_write, 0);
    }

    #[test]
    fn skips_malformed_data() {
        assert!(row_to_event(&make_row("not json")).is_none());
        assert!(row_to_event(&make_row("{")).is_none());
    }
}
