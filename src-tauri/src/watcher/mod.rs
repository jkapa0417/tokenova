//! Filesystem watcher for JSONL conversation logs.
//!
//! Provider-agnostic: each `spawn_provider_watcher` call takes a parser
//! function that turns a single JSONL line into an optional `TokenEvent`.
//! Currently used for Claude Code (`~/.claude/projects/`) and Codex CLI
//! (`~/.codex/sessions/`). OpenCode uses a SQLite DB instead and lives in
//! [`opencode`].

pub mod opencode;
pub use opencode::spawn_opencode_watcher;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{broadcast, mpsc};

use crate::db::{Db, TokenEvent};
use crate::parser::{claude_code, codex_cli};

/// Function signature used by all JSONL-based providers.
pub type LineParser = fn(&str, &str) -> Option<TokenEvent>;

/// Owning handle that keeps the notify watcher alive. Drop it to stop watching.
pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _name: &'static str,
}

pub fn claude_projects_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home directory"))?;
    Ok(home.join(".claude").join("projects"))
}

pub fn codex_sessions_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home directory"))?;
    Ok(home.join(".codex").join("sessions"))
}

/// Convenience: launch the Claude Code watcher. `override_dir` swaps in a
/// user-configured path (Settings → Provider path); when `None`, falls back
/// to the conventional `~/.claude/projects`.
pub fn spawn_claude_code_watcher(
    db: Arc<Db>,
    events_tx: broadcast::Sender<TokenEvent>,
    first_run: bool,
    override_dir: Option<PathBuf>,
) -> Result<WatcherHandle> {
    let dir = match override_dir {
        Some(p) => p,
        None => claude_projects_dir()?,
    };
    spawn_provider_watcher(
        "claude_code",
        dir,
        claude_code::parse_line,
        db,
        events_tx,
        first_run,
    )
}

/// Convenience: launch the Codex CLI watcher.
pub fn spawn_codex_cli_watcher(
    db: Arc<Db>,
    events_tx: broadcast::Sender<TokenEvent>,
    first_run: bool,
    override_dir: Option<PathBuf>,
) -> Result<WatcherHandle> {
    let dir = match override_dir {
        Some(p) => p,
        None => codex_sessions_dir()?,
    };
    spawn_provider_watcher(
        "codex_cli",
        dir,
        codex_cli::parse_line,
        db,
        events_tx,
        first_run,
    )
}

pub fn spawn_provider_watcher(
    name: &'static str,
    dir: PathBuf,
    parser: LineParser,
    db: Arc<Db>,
    events_tx: broadcast::Sender<TokenEvent>,
    first_run: bool,
) -> Result<WatcherHandle> {
    std::fs::create_dir_all(&dir).with_context(|| format!("[{name}] failed to ensure {dir:?}"))?;

    let (fs_tx, mut fs_rx) = mpsc::unbounded_channel::<notify::Result<notify::Event>>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |res| {
        let _ = fs_tx.send(res);
    })?;
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .with_context(|| format!("[{name}] failed to watch {dir:?}"))?;

    // Bootstrap.
    // - First run ever: skip the entire existing history. We record each
    //   existing JSONL's current size as its watch offset so only lines
    //   written *after* the user installed Tokenova ever produce events.
    //   This is what makes a fresh install start at 0 tokens instead of
    //   ingesting the user's whole prior Claude / Codex history.
    // - Subsequent runs: resume from saved offsets like before.
    let initial_files = enumerate_jsonl(&dir);
    let db_init = db.clone();
    let tx_init = events_tx.clone();
    tauri::async_runtime::spawn(async move {
        for path in initial_files {
            if first_run {
                if let Err(e) = baseline_file_to_end(&db_init, &path) {
                    eprintln!("[{name}] baseline {path:?} failed: {e:#}");
                }
                continue;
            }
            if let Err(e) = process_file(&db_init, &tx_init, &path, parser).await {
                eprintln!("[{name}] bootstrap {path:?} failed: {e:#}");
            }
        }
    });

    // Event loop.
    tauri::async_runtime::spawn(async move {
        while let Some(result) = fs_rx.recv().await {
            let event = match result {
                Ok(ev) => ev,
                Err(e) => {
                    eprintln!("[{name}] notify error: {e:#}");
                    continue;
                }
            };
            if !is_interesting(&event.kind) {
                continue;
            }
            for path in event.paths {
                if !is_jsonl(&path) {
                    continue;
                }
                if let Err(e) = process_file(&db, &events_tx, &path, parser).await {
                    eprintln!("[{name}] processing {path:?} failed: {e:#}");
                }
            }
        }
    });

    Ok(WatcherHandle {
        _watcher: watcher,
        _name: name,
    })
}

fn is_interesting(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any
    )
}

fn is_jsonl(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false)
}

async fn process_file(
    db: &Db,
    tx: &broadcast::Sender<TokenEvent>,
    path: &Path,
    parser: LineParser,
) -> Result<()> {
    let path_str = path.to_string_lossy().to_string();
    let saved_offset = db.get_watch_offset(&path_str)?;

    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()), // file was deleted between event and read
    };
    if !metadata.is_file() {
        return Ok(());
    }
    let size = metadata.len();

    // File rotated or truncated → restart from the beginning.
    let from = if size < saved_offset { 0 } else { saved_offset };
    if from >= size {
        return Ok(());
    }

    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::with_capacity((size - from) as usize);
    file.read_to_end(&mut buf)?;

    // Only consume up to the last newline so a partially-written line is left for the next event.
    let Some(last_newline) = buf.iter().rposition(|&b| b == b'\n') else {
        return Ok(());
    };
    let consumed = last_newline + 1;
    let text = std::str::from_utf8(&buf[..consumed]).unwrap_or("");

    for line in text.split_inclusive('\n') {
        let line = line.trim_end_matches(['\n', '\r']);
        let Some(mut event) = parser(line, &path_str) else {
            continue;
        };
        match db.insert_token_event(&event) {
            Ok(Some(row_id)) => {
                event.id = Some(row_id);
                let _ = tx.send(event);
            }
            Ok(None) => {
                // duplicate message_id (Claude Code) — already recorded.
            }
            Err(e) => {
                eprintln!("[watcher] insert event failed: {e:#}");
            }
        }
    }

    db.set_watch_offset(&path_str, from + consumed as u64)?;
    Ok(())
}

/// First-run helper: record this file's current size as its watch offset so
/// the existing history is treated as already-consumed. No parsing, no events.
fn baseline_file_to_end(db: &Db, path: &Path) -> Result<()> {
    let path_str = path.to_string_lossy().to_string();
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if !metadata.is_file() {
        return Ok(());
    }
    db.set_watch_offset(&path_str, metadata.len())?;
    Ok(())
}

fn enumerate_jsonl(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out);
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if is_jsonl(&path) {
            out.push(path);
        }
    }
}
