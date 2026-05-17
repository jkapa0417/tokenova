//! Tauri commands exposed to the frontend.

use std::sync::Arc;

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{ConstellationCodexEntry, Db, Session, TokenEvent};
use crate::engine::achievements::{self as ach, AchievementCard};
use crate::engine::codex::{self as codex_view, CodexPayload};
use crate::engine::types::{
    Constellation, GalaxyType, Nebula, Planet, Star, Universe, UniversePayload, UniverseSummary,
};
use crate::engine::Engine;

#[tauri::command]
pub async fn get_pending_discoveries(db: State<'_, Arc<Db>>) -> Result<Vec<Planet>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.list_unacknowledged_planets().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn acknowledge_planets(
    app: tauri::AppHandle,
    db: State<'_, Arc<Db>>,
    planet_ids: Vec<i64>,
) -> Result<usize, String> {
    let db_for_ack = db.inner().clone();
    let acked = tokio::task::spawn_blocking(move || {
        db_for_ack
            .acknowledge_planets(&planet_ids, Utc::now())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    // If the unread queue is empty after this ack, clear the gold-dot tray
    // indicator so the icon goes back to its idle state.
    let db_for_check = db.inner().clone();
    let remaining = tokio::task::spawn_blocking(move || {
        db_for_check
            .list_unacknowledged_planets()
            .map(|v| v.len())
            .unwrap_or(0)
    })
    .await
    .unwrap_or(0);
    if remaining == 0 {
        let _ = crate::set_tray_discovery(&app, false);
    }

    Ok(acked)
}

#[tauri::command]
pub async fn get_today_total(db: State<'_, Arc<Db>>) -> Result<u64, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let (from, to) = today_range_in_utc();
        db.token_total_in_range(from, to).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_recent_token_events(
    db: State<'_, Arc<Db>>,
    limit: usize,
) -> Result<Vec<TokenEvent>, String> {
    let limit = limit.clamp(1, 200);
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.fetch_recent_events(limit).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_current_session(db: State<'_, Arc<Db>>) -> Result<Option<Session>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_open_session().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_session_by_id(
    db: State<'_, Arc<Db>>,
    session_id: i64,
) -> Result<Option<Session>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_session_by_id(session_id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_discovery_ordinal(
    db: State<'_, Arc<Db>>,
    planet_id: i64,
) -> Result<i64, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.discovery_ordinal(planet_id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_current_universe(
    engine: State<'_, Arc<Engine>>,
) -> Result<UniversePayload, String> {
    engine
        .current_universe_payload()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_codex(db: State<'_, Arc<Db>>) -> Result<CodexPayload, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || codex_view::build_payload(&db).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_achievements(db: State<'_, Arc<Db>>) -> Result<Vec<AchievementCard>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || ach::build_payload(&db).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_constellation_codex(
    db: State<'_, Arc<Db>>,
) -> Result<Vec<ConstellationCodexEntry>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.list_constellation_codex().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_constellation(
    db: State<'_, Arc<Db>>,
    constellation_id: i64,
) -> Result<usize, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        db.delete_constellation(constellation_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_constellation(
    engine: State<'_, Arc<crate::engine::Engine>>,
    db: State<'_, Arc<Db>>,
    name: String,
    color: String,
    star_ids: Vec<i64>,
    preset_id: Option<String>,
) -> Result<i64, String> {
    if star_ids.len() < 2 {
        return Err("constellation needs at least 2 stars".to_string());
    }
    let universe_id = engine
        .current_universe_id()
        .await
        .map_err(|e| e.to_string())?;
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let row_id = db
            .insert_constellation(universe_id, &name, &color, &star_ids, preset_id.as_deref())
            .map_err(|e| e.to_string())?;
        // Award the "첫 별자리" achievement once. Idempotent — `mark` is a
        // one-shot insert.
        let _ = crate::engine::achievements::on_constellation_saved(&db);
        Ok(row_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_current_galaxy(
    engine: State<'_, Arc<crate::engine::Engine>>,
    name: String,
) -> Result<String, String> {
    if name.trim().chars().count() > 40 {
        return Err("최대 40자".to_string());
    }
    engine
        .rename_current_universe(&name)
        .await
        .map_err(|e| e.to_string())
}

/// Read-only payload (no leftover/today_tokens) for the Gallery view.
#[derive(serde::Serialize)]
pub struct ReadOnlyUniverse {
    pub universe: Universe,
    pub stars: Vec<Star>,
    pub planets: Vec<Planet>,
    pub nebulae: Vec<Nebula>,
    pub constellations: Vec<Constellation>,
}

#[tauri::command]
pub async fn get_universe_by_id(
    db: State<'_, Arc<Db>>,
    universe_id: i64,
) -> Result<Option<ReadOnlyUniverse>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<Option<ReadOnlyUniverse>, String> {
        let Some(universe) = db
            .find_universe_by_id(universe_id)
            .map_err(|e| e.to_string())?
        else {
            return Ok(None);
        };
        let stars = db.list_stars(universe_id).map_err(|e| e.to_string())?;
        let planets = db.list_planets(universe_id).map_err(|e| e.to_string())?;
        let nebulae = db.list_nebulae(universe_id).map_err(|e| e.to_string())?;
        let constellations = db
            .list_constellations(universe_id)
            .map_err(|e| e.to_string())?;
        Ok(Some(ReadOnlyUniverse {
            universe,
            stars,
            planets,
            nebulae,
            constellations,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_gallery(
    db: State<'_, Arc<Db>>,
    range: String,
) -> Result<Vec<UniverseSummary>, String> {
    let today = Local::now().date_naive();
    let from = match range.as_str() {
        "week" => Some(today - Duration::days(6)),
        "month" => Some(today - Duration::days(29)),
        "all" => None,
        _ => return Err(format!("unknown range: {range}")),
    };
    let to: Option<NaiveDate> = Some(today + Duration::days(1)); // include today

    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<UniverseSummary>, String> {
        let universes = db.list_universes(from, to).map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(universes.len());
        for u in universes {
            let planet_count = db.count_all_planets(u.id).map_err(|e| e.to_string())?;
            out.push(UniverseSummary {
                id: u.id,
                date: u.date,
                star_count: u.star_count,
                planet_count,
                galaxy_type: u.galaxy_type,
                seed: u.seed,
                finalized: u.finalized_at.is_some(),
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─────────────────────── Settings / Provider Health ───────────────────────

/// Provider id strings used as the source-of-truth keys for settings.
const PROVIDER_CLAUDE: &str = "claude_code";
const PROVIDER_CODEX: &str = "codex_cli";
const PROVIDER_OPENCODE: &str = "opencode";

fn settings_key_for_path(provider_id: &str) -> String {
    format!("provider.{}.path", provider_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub id: String,
    pub name: String,
    pub default_path: String,
    pub custom_path: Option<String>,
    pub effective_path: String,
    /// File or directory exists at the effective path.
    pub exists: bool,
    /// True when the kind of node at the path matches what the watcher needs
    /// (directory for JSONL providers, file for OpenCode's SQLite DB).
    pub kind_ok: bool,
    pub last_event_at: Option<DateTime<Utc>>,
    pub events_today: u64,
}

fn default_path_for(provider_id: &str) -> String {
    match provider_id {
        PROVIDER_CLAUDE => crate::watcher::claude_projects_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        PROVIDER_CODEX => crate::watcher::codex_sessions_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        PROVIDER_OPENCODE => crate::watcher::opencode::opencode_db_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn display_name_for(provider_id: &str) -> &'static str {
    match provider_id {
        PROVIDER_CLAUDE => "Claude Code",
        PROVIDER_CODEX => "Codex CLI",
        PROVIDER_OPENCODE => "OpenCode",
        _ => "?",
    }
}

fn build_provider_health(db: &Arc<Db>, provider_id: &str) -> Result<ProviderHealth, String> {
    let key = settings_key_for_path(provider_id);
    let custom = db.get_setting(&key).map_err(|e| e.to_string())?;
    let default_path = default_path_for(provider_id);
    let effective = custom.clone().unwrap_or_else(|| default_path.clone());

    let path = std::path::Path::new(&effective);
    let exists = path.exists();
    // JSONL providers expect a directory; OpenCode expects a file.
    let kind_ok = match provider_id {
        PROVIDER_CLAUDE | PROVIDER_CODEX => path.is_dir(),
        PROVIDER_OPENCODE => path.is_file(),
        _ => exists,
    };

    let (from, to) = today_range_in_utc();
    let (last_at, events_today) = db
        .provider_stats(provider_id, from, to)
        .map_err(|e| e.to_string())?;

    Ok(ProviderHealth {
        id: provider_id.to_string(),
        name: display_name_for(provider_id).to_string(),
        default_path,
        custom_path: custom,
        effective_path: effective,
        exists,
        kind_ok,
        last_event_at: last_at,
        events_today,
    })
}

#[tauri::command]
pub async fn get_providers_health(
    db: State<'_, Arc<Db>>,
) -> Result<Vec<ProviderHealth>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<ProviderHealth>, String> {
        let mut out = Vec::with_capacity(3);
        for id in [PROVIDER_CLAUDE, PROVIDER_CODEX, PROVIDER_OPENCODE] {
            out.push(build_provider_health(&db, id)?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_provider_path(
    db: State<'_, Arc<Db>>,
    provider_id: String,
    path: String,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty path — use clear_provider_path instead".to_string());
    }
    let db = db.inner().clone();
    let key = settings_key_for_path(&provider_id);
    let value = path.trim().to_string();
    tokio::task::spawn_blocking(move || db.set_setting(&key, &value).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_provider_path(
    db: State<'_, Arc<Db>>,
    provider_id: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    let key = settings_key_for_path(&provider_id);
    tokio::task::spawn_blocking(move || db.clear_setting(&key).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

// ─────────────────────── Generic settings KV (for UI preferences) ───────────────────────

#[tauri::command]
pub async fn get_setting(
    db: State<'_, Arc<Db>>,
    key: String,
) -> Result<Option<String>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_setting(&key).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Persist the UI locale. Validated to one of the supported values so a
/// malformed write can't poison the column.
#[tauri::command]
pub async fn set_locale(db: State<'_, Arc<Db>>, value: String) -> Result<(), String> {
    if value != "ko" && value != "en" {
        return Err(format!("unsupported locale: {value}"));
    }
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        db.set_setting("locale", &value).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[allow(dead_code)]
fn _types_used(_: GalaxyType) {} // keep import alive for serde-derived structs

/// Today's range expressed as UTC half-open interval (using the local-time day boundary).
fn today_range_in_utc() -> (DateTime<Utc>, DateTime<Utc>) {
    let now_local = Local::now();
    let start_local = now_local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("midnight is a valid time")
        .and_local_timezone(Local)
        .single()
        .expect("local midnight is unambiguous outside DST forward jumps");
    let start_utc = start_local.with_timezone(&Utc);
    let end_utc = start_utc + Duration::days(1);
    (start_utc, end_utc)
}
