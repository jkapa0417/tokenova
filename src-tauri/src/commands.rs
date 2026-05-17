//! Tauri commands exposed to the frontend.

use std::sync::Arc;

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
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
    db: State<'_, Arc<Db>>,
    planet_ids: Vec<i64>,
) -> Result<usize, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        db.acknowledge_planets(&planet_ids, Utc::now())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
        db.insert_constellation(universe_id, &name, &color, &star_ids, preset_id.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
