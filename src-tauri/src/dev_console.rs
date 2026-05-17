// Tokenova dev console — local HTTP server that lets a sibling static web
// app drive the running app for E2E testing.
//
// Strictly debug-only:
//  * The module is `#[cfg(debug_assertions)]`-gated, so release builds
//    (the DMG / EXE you ship) don't include this code at all.
//  * Even in debug builds the listener stays dormant unless the env var
//    `TOKENOVA_DEV_CONSOLE` is set, so a casual `npm run tauri dev` run
//    isn't sitting on a port unprompted.
//
// Run:
//   TOKENOVA_DEV_CONSOLE=1 npm run tauri dev   # exposes 127.0.0.1:7777
//   cd dev-console && python3 -m http.server 8000
//   open http://127.0.0.1:8000
//
// Endpoints (all return JSON; permissive CORS):
//   GET  /state          — { today_total, session, universe, planet_count }
//   POST /token-event    — inject a synthetic TokenEvent (drives stars/planets)
//   POST /trigger-planet — force a planet discovery in today's universe
//   POST /clear-today    — wipe today's planets/stars/codex for repeat tests
//   POST /reset-bootstrap— clear the first-run sentinel so the next launch
//                          re-baselines the watchers

#![cfg(debug_assertions)]

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use chrono::{Duration as ChronoDuration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;

use crate::db::{Db, TokenEvent};
use crate::engine::types::{Planet, Rarity};
use crate::engine::{catalog as catalog_engine, planets as planets_engine, Engine};

const BIND_ADDR: &str = "127.0.0.1:7777";
const MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct Ctx {
    db: Arc<Db>,
    engine: Arc<Engine>,
    events_tx: broadcast::Sender<TokenEvent>,
}

pub fn maybe_start(
    db: Arc<Db>,
    engine: Arc<Engine>,
    events_tx: broadcast::Sender<TokenEvent>,
) {
    if std::env::var("TOKENOVA_DEV_CONSOLE").is_err() {
        return;
    }
    let ctx = Ctx { db, engine, events_tx };
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(ctx).await {
            eprintln!("[dev-console] server crashed: {e:#}");
        }
    });
}

async fn serve(ctx: Ctx) -> Result<()> {
    let addr: SocketAddr = BIND_ADDR.parse()?;
    let listener = TcpListener::bind(addr).await?;
    eprintln!("[dev-console] listening on http://{addr}");
    loop {
        let (stream, _) = listener.accept().await?;
        let ctx = ctx.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle(stream, ctx).await {
                eprintln!("[dev-console] request error: {e:#}");
            }
        });
    }
}

struct Req {
    method: String,
    path: String,
    body: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream) -> Result<Req> {
    // Read until we have headers fully (CRLF CRLF). Buffer a bit, then split.
    let mut buf = vec![0u8; 8 * 1024];
    let mut filled = 0;
    let header_end;
    loop {
        let n = stream.read(&mut buf[filled..]).await?;
        if n == 0 {
            return Err(anyhow::anyhow!("client closed before headers"));
        }
        filled += n;
        if let Some(pos) = find_double_crlf(&buf[..filled]) {
            header_end = pos;
            break;
        }
        if filled == buf.len() {
            buf.resize(buf.len() * 2, 0);
        }
        if filled > 32 * 1024 {
            return Err(anyhow::anyhow!("headers too large"));
        }
    }
    let header_bytes = &buf[..header_end];
    let header_str = std::str::from_utf8(header_bytes)?;
    let mut lines = header_str.split("\r\n");
    let first = lines.next().ok_or_else(|| anyhow::anyhow!("empty request"))?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();

    let mut content_length: usize = 0;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err(anyhow::anyhow!("body too large"));
    }

    let mut body = Vec::with_capacity(content_length);
    let body_start = header_end + 4;
    if body_start < filled {
        body.extend_from_slice(&buf[body_start..filled]);
    }
    while body.len() < content_length {
        let need = content_length - body.len();
        let mut chunk = vec![0u8; need];
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }

    Ok(Req { method, path, body })
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn handle(mut stream: TcpStream, ctx: Ctx) -> Result<()> {
    let req = match read_request(&mut stream).await {
        Ok(r) => r,
        Err(e) => {
            write_response(&mut stream, 400, &error_body(&e.to_string())).await?;
            return Ok(());
        }
    };

    // CORS preflight.
    if req.method == "OPTIONS" {
        return write_response(&mut stream, 204, b"").await;
    }

    let (status, body) = match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/state") => match get_state(&ctx).await {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        ("POST", "/token-event") => match post_token_event(&ctx, &req.body) {
            Ok(json) => (200, json),
            Err(e) => (400, error_body(&e.to_string())),
        },
        ("POST", "/trigger-planet") => match post_trigger_planet(&ctx, &req.body).await {
            Ok(json) => (200, json),
            Err(e) => (400, error_body(&e.to_string())),
        },
        ("POST", "/trigger-mythic") => match post_trigger_mythic(&ctx).await {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        ("POST", "/discover-all") => match post_discover_all(&ctx).await {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        ("POST", "/clear-tokens") => match post_clear_tokens(&ctx).await {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        ("POST", "/clear-today") => match post_clear_today(&ctx).await {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        ("POST", "/reset-bootstrap") => match post_reset_bootstrap(&ctx) {
            Ok(json) => (200, json),
            Err(e) => (500, error_body(&e.to_string())),
        },
        _ => (404, error_body("not found")),
    };
    write_response(&mut stream, status, &body).await
}

async fn write_response(stream: &mut TcpStream, status: u16, body: &[u8]) -> Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {len}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\r\n",
        len = body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await?;
    Ok(())
}

fn error_body(msg: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "error": msg })).unwrap_or_default()
}

// ─────────── handlers ───────────

#[derive(Serialize)]
struct StateOut {
    today_total: u64,
    session: Option<SessionOut>,
    universe_id: Option<i64>,
    star_count: u32,
    planet_count: u32,
}

#[derive(Serialize)]
struct SessionOut {
    id: i64,
    total_tokens: u64,
    started_at: String,
}

async fn get_state(ctx: &Ctx) -> Result<Vec<u8>> {
    let today_total = {
        let now_local = chrono::Local::now();
        let start_local = now_local
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| anyhow::anyhow!("midnight"))?
            .and_local_timezone(chrono::Local)
            .single()
            .ok_or_else(|| anyhow::anyhow!("ambiguous midnight"))?;
        let from = start_local.with_timezone(&chrono::Utc);
        let to = from + ChronoDuration::days(1);
        ctx.db.token_total_in_range(from, to)?
    };
    let session = ctx.db.get_open_session()?;
    let payload = ctx.engine.current_universe_payload().await.ok();
    let (uid, stars, planets) = match payload {
        Some(p) => (
            Some(p.universe.id),
            p.universe.star_count,
            p.planets.len() as u32,
        ),
        None => (None, 0, 0),
    };
    let out = StateOut {
        today_total,
        session: session.map(|s| SessionOut {
            id: s.id,
            total_tokens: s.total_tokens,
            started_at: s.started_at.to_rfc3339(),
        }),
        universe_id: uid,
        star_count: stars,
        planet_count: planets,
    };
    Ok(serde_json::to_vec(&out)?)
}

#[derive(Deserialize)]
struct TokenEventIn {
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read: u64,
    #[serde(default)]
    cache_write: u64,
}

fn default_provider() -> String { "dev_console".to_string() }

fn post_token_event(ctx: &Ctx, body: &[u8]) -> Result<Vec<u8>> {
    let req: TokenEventIn = serde_json::from_slice(body)?;
    let mut event = TokenEvent {
        id: None,
        provider: req.provider,
        model: req.model,
        message_id: Some(format!("dev-{}", uuid_lite())),
        input_tokens: req.input_tokens,
        output_tokens: req.output_tokens,
        cache_read: req.cache_read,
        cache_write: req.cache_write,
        timestamp: Utc::now(),
        session_id: None,
        source_file: Some("dev_console".to_string()),
    };
    let row_id = ctx.db.insert_token_event(&event)?;
    if let Some(id) = row_id {
        event.id = Some(id);
        let _ = ctx.events_tx.send(event);
    }
    Ok(serde_json::to_vec(&serde_json::json!({
        "inserted": row_id.is_some(),
        "id": row_id,
    }))?)
}

#[derive(Deserialize)]
struct TriggerPlanetIn {
    #[serde(default = "default_tokens")]
    session_total_tokens: u64,
}

fn default_tokens() -> u64 { 6_000 }

async fn post_trigger_planet(ctx: &Ctx, body: &[u8]) -> Result<Vec<u8>> {
    let req: TriggerPlanetIn = serde_json::from_slice(body).unwrap_or(TriggerPlanetIn {
        session_total_tokens: default_tokens(),
    });
    // Resolve the active universe so the discovery attaches to today.
    let payload = ctx.engine.current_universe_payload().await?;
    let universe = payload.universe;
    // planets.triggering_session_id has a FK to sessions(id), so we can't
    // pass a synthetic timestamp. Create a real synthetic session row that
    // the planet can reference. It stays "open" with 0 tokens — purely a
    // bookkeeping anchor for dev test discoveries.
    let synthetic_session_id = ctx.db.create_session(Utc::now())?;
    let outcome = planets_engine::discover_for_session(
        &ctx.db,
        &universe,
        synthetic_session_id,
        req.session_total_tokens,
    )?;
    Ok(serde_json::to_vec(&serde_json::json!({
        "outcome": format!("{:?}", outcome),
        "session_id": synthetic_session_id,
    }))?)
}

async fn post_clear_today(ctx: &Ctx) -> Result<Vec<u8>> {
    let payload = ctx.engine.current_universe_payload().await?;
    let universe_id = payload.universe.id;
    let db = ctx.db.clone();
    let (planets, stars, constellations, codex) =
        tokio::task::spawn_blocking(move || -> Result<(usize, usize, usize, usize)> {
            let p = db.dev_delete_planets_for_universe(universe_id)?;
            let s = db.dev_delete_stars_for_universe(universe_id)?;
            let c = db.dev_delete_constellations_for_universe(universe_id)?;
            let cx = db.dev_clear_codex()?;
            Ok((p, s, c, cx))
        })
        .await??;
    Ok(serde_json::to_vec(&serde_json::json!({
        "planets_deleted": planets,
        "stars_deleted": stars,
        "constellations_deleted": constellations,
        "codex_deleted": codex,
    }))?)
}

fn post_reset_bootstrap(ctx: &Ctx) -> Result<Vec<u8>> {
    ctx.db.dev_clear_bootstrap_sentinel()?;
    Ok(serde_json::to_vec(&serde_json::json!({ "reset": true }))?)
}

// Free position chosen by the engine's own spacing-aware sampler so
// dev-inserted planets don't pile up on each other (especially on
// /discover-all which drops 31 entries at once).
fn place_planet<R: Rng>(
    rng: &mut R,
    stars: &[crate::engine::types::Star],
    planets: &[Planet],
) -> (f32, f32) {
    planets_engine::find_empty_position(rng, stars, planets)
}

/// Forces a mythic planet (random pick from MYTHIC_PLANETS) into today's
/// universe, bypassing the daily cap and the rarity-roll table.
async fn post_trigger_mythic(ctx: &Ctx) -> Result<Vec<u8>> {
    let payload = ctx.engine.current_universe_payload().await?;
    let universe = payload.universe;
    let pool = catalog_engine::planets_of(Rarity::Mythic);
    if pool.is_empty() {
        return Err(anyhow::anyhow!("no mythic planets in catalog"));
    }
    let session_id = ctx.db.create_session(Utc::now())?;
    let mut rng = rand::thread_rng();
    let spec = pool[rng.gen_range(0..pool.len())];
    let stars = ctx.db.list_stars(universe.id)?;
    let existing = ctx.db.list_planets(universe.id)?;
    let (px, py) = place_planet(&mut rng, &stars, &existing);
    let now = Utc::now();
    let planet = Planet {
        id: 0,
        universe_id: universe.id,
        planet_type: spec.key.to_string(),
        rarity: Rarity::Mythic,
        seed: now.timestamp_nanos_opt().unwrap_or(0),
        discovered_at: now,
        triggering_session_id: Some(session_id),
        position_x: px,
        position_y: py,
        user_note: None,
        acknowledged_at: None,
    };
    let inserted_id = ctx.db.insert_planet(&planet)?;
    ctx.db
        .codex_record_discovery(spec.key, Rarity::Mythic, now)?;
    Ok(serde_json::to_vec(&serde_json::json!({
        "inserted": inserted_id,
        "planet_type": spec.key,
    }))?)
}

/// Inserts one planet of each catalog entry into today's universe — useful
/// for visual QA of every renderer at once. Bypasses the daily cap.
async fn post_discover_all(ctx: &Ctx) -> Result<Vec<u8>> {
    let payload = ctx.engine.current_universe_payload().await?;
    let universe = payload.universe;
    let session_id = ctx.db.create_session(Utc::now())?;
    let mut rng = rand::thread_rng();
    let mut inserted = Vec::new();
    let stars = ctx.db.list_stars(universe.id)?;
    // Re-read existing planets after each insert so the spacing check sees
    // the ones we just added in this loop — otherwise 31 placements would
    // all be unaware of each other.
    let mut placed: Vec<Planet> = ctx.db.list_planets(universe.id)?;
    for spec in catalog_engine::all_planets() {
        let (px, py) = place_planet(&mut rng, &stars, &placed);
        let now = Utc::now();
        let planet = Planet {
            id: 0,
            universe_id: universe.id,
            planet_type: spec.key.to_string(),
            rarity: spec.rarity,
            seed: now.timestamp_nanos_opt().unwrap_or(0)
                ^ (spec.key.len() as i64 * 0x9E37_79B9_7F4A_7C15_u64 as i64),
            discovered_at: now,
            triggering_session_id: Some(session_id),
            position_x: px,
            position_y: py,
            user_note: None,
            acknowledged_at: None,
        };
        let row_id = ctx.db.insert_planet(&planet)?;
        ctx.db
            .codex_record_discovery(spec.key, spec.rarity, now)?;
        // Track the just-inserted planet so subsequent picks avoid it.
        let mut stored = planet;
        stored.id = row_id;
        placed.push(stored);
        inserted.push(serde_json::json!({
            "id": row_id,
            "planet_type": spec.key,
        }));
    }
    Ok(serde_json::to_vec(&serde_json::json!({
        "inserted_count": inserted.len(),
        "planets": inserted,
    }))?)
}

/// Wipes today's token-derived state: token_events, the stars those tokens
/// minted, and today's open sessions. Planets / codex / constellations are
/// preserved — pair with /clear-today for a deeper reset.
async fn post_clear_tokens(ctx: &Ctx) -> Result<Vec<u8>> {
    let (from, to) = today_range_utc()?;
    let removed = ctx.db.dev_delete_token_events_in_range(from, to)?;
    let closed = ctx.db.dev_close_all_open_sessions()?;

    // Stars are derived from tokens — leaving them around after a wipe is
    // confusing (HUD says "0 tokens · 1000 stars"). Reset the active
    // universe so the user sees a clean slate.
    let payload = ctx.engine.current_universe_payload().await?;
    let universe_id = payload.universe.id;
    let db = ctx.db.clone();
    let stars_deleted = tokio::task::spawn_blocking(move || {
        db.dev_delete_stars_for_universe(universe_id)
    })
    .await??;

    // Engine caches today_tokens / leftover_tokens + universe.star_count in
    // memory — force it to re-read from the DB or the HUD keeps showing
    // the old total.
    ctx.engine.dev_reload_today_tokens().await?;
    ctx.engine.dev_reload_universe().await?;

    Ok(serde_json::to_vec(&serde_json::json!({
        "token_events_deleted": removed,
        "sessions_closed": closed,
        "stars_deleted": stars_deleted,
    }))?)
}

fn today_range_utc() -> Result<(chrono::DateTime<Utc>, chrono::DateTime<Utc>)> {
    let now_local = chrono::Local::now();
    let start_local = now_local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| anyhow::anyhow!("midnight"))?
        .and_local_timezone(chrono::Local)
        .single()
        .ok_or_else(|| anyhow::anyhow!("ambiguous midnight"))?;
    let from = start_local.with_timezone(&Utc);
    let to = from + ChronoDuration::days(1);
    Ok((from, to))
}

// Cheap, debug-only random id — avoids pulling in the uuid crate.
fn uuid_lite() -> String {
    let now = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    format!("{now:x}-{:x}", std::process::id())
}
