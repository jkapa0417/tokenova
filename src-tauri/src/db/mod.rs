use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::engine::nebula::NebulaBlueprint;
use crate::engine::stars::StarBlueprint;
use crate::engine::types::{
    CodexEntry, Constellation, GalaxyType, Nebula, Planet, Rarity, Star, Universe,
};

const SCHEMA_SQL: &str = include_str!("schema.sql");
const SCHEMA_VERSION: i64 = 2;

/// Sentinel `watch_state.file_path` used to mark the one-time "skip
/// historical tokens" baseline as done. The leading `__` keeps it sorted
/// away from real file paths.
const BOOTSTRAP_SENTINEL: &str = "__tokenova_bootstrap_v1__";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenEvent {
    pub id: Option<i64>,
    pub provider: String,
    pub model: Option<String>,
    pub message_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub timestamp: DateTime<Utc>,
    pub session_id: Option<i64>,
    pub source_file: Option<String>,
}

impl TokenEvent {
    pub fn total(&self) -> u64 {
        self.input_tokens + self.output_tokens + self.cache_read + self.cache_write
    }
}

/// Internal intermediate — `list_constellation_codex` returns the public
/// `ConstellationCodexEntry` instead.
struct ConstellationCodexRow {
    id: i64,
    universe_id: i64,
    name: String,
    color: String,
    star_ids: Vec<i64>,
    created_at: DateTime<Utc>,
    universe_date: String,
    cluster_name: Option<String>,
    seed: i64,
}

/// Constellation codex row sent to the frontend. World-space `stars` are
/// normalized client-side to fit the thumbnail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstellationCodexEntry {
    pub id: i64,
    pub universe_id: i64,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
    pub universe_date: String,
    pub cluster_name: Option<String>,
    pub seed: i64,
    pub stars: Vec<(f32, f32)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub total_tokens: u64,
    pub triggered_planet: bool,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create db dir {parent:?}"))?;
        }
        let conn = Connection::open(path).with_context(|| format!("failed to open db {path:?}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute_batch(SCHEMA_SQL)?;

        let current: Option<i64> = conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
                row.get(0)
            })
            .optional()?;
        let from_version = current.unwrap_or(0);

        // v1 → v2: add `cluster_name` to universes, `acknowledged_at` to planets.
        // SQLite has no `ADD COLUMN IF NOT EXISTS`, so check pragma first.
        if from_version < 2 {
            if !column_exists(&conn, "universes", "cluster_name")? {
                conn.execute_batch("ALTER TABLE universes ADD COLUMN cluster_name TEXT;")?;
            }
            if !column_exists(&conn, "planets", "acknowledged_at")? {
                conn.execute_batch("ALTER TABLE planets ADD COLUMN acknowledged_at TEXT;")?;
            }
        }

        if current.is_none() {
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                params![SCHEMA_VERSION],
            )?;
        } else if from_version < SCHEMA_VERSION {
            conn.execute(
                "UPDATE schema_version SET version = ?1",
                params![SCHEMA_VERSION],
            )?;
        }
        Ok(())
    }

    /// Insert a token event. Dedup by message_id when present. Returns the row id or None if skipped.
    pub fn insert_token_event(&self, event: &TokenEvent) -> Result<Option<i64>> {
        let conn = self.conn.lock().expect("db poisoned");
        let changes = conn.execute(
            "INSERT OR IGNORE INTO token_events
                (provider, model, message_id, input_tokens, output_tokens, cache_read, cache_write, timestamp, session_id, source_file)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                event.provider,
                event.model,
                event.message_id,
                event.input_tokens as i64,
                event.output_tokens as i64,
                event.cache_read as i64,
                event.cache_write as i64,
                event.timestamp.to_rfc3339(),
                event.session_id,
                event.source_file,
            ],
        )?;
        Ok(if changes == 0 {
            None
        } else {
            Some(conn.last_insert_rowid())
        })
    }

    /// Update a token event's session_id after the row has been inserted.
    pub fn assign_session(&self, token_event_id: i64, session_id: i64) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "UPDATE token_events SET session_id = ?1 WHERE id = ?2",
            params![session_id, token_event_id],
        )?;
        Ok(())
    }

    pub fn fetch_recent_events(&self, limit: usize) -> Result<Vec<TokenEvent>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, provider, model, message_id, input_tokens, output_tokens,
                    cache_read, cache_write, timestamp, session_id, source_file
             FROM token_events
             ORDER BY timestamp DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], row_to_token_event)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Sum of all token counts (input + output + cache_read + cache_write) for events whose
    /// timestamp falls inside the half-open `[from, to)` UTC range.
    pub fn token_total_in_range(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<u64> {
        let conn = self.conn.lock().expect("db poisoned");
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0)
             FROM token_events
             WHERE timestamp >= ?1 AND timestamp < ?2",
            params![from.to_rfc3339(), to.to_rfc3339()],
            |row| row.get(0),
        )?;
        Ok(total.max(0) as u64)
    }

    pub fn create_session(&self, started_at: DateTime<Utc>) -> Result<i64> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "INSERT INTO sessions (started_at, total_tokens) VALUES (?1, 0)",
            params![started_at.to_rfc3339()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn bump_session_tokens(&self, session_id: i64, delta: u64) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "UPDATE sessions SET total_tokens = total_tokens + ?1 WHERE id = ?2",
            params![delta as i64, session_id],
        )?;
        Ok(())
    }

    pub fn close_session(
        &self,
        session_id: i64,
        ended_at: DateTime<Utc>,
        triggered_planet: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "UPDATE sessions
             SET ended_at = ?1, triggered_planet = ?2
             WHERE id = ?3",
            params![ended_at.to_rfc3339(), triggered_planet as i64, session_id],
        )?;
        Ok(())
    }

    pub fn get_open_session(&self) -> Result<Option<Session>> {
        let conn = self.conn.lock().expect("db poisoned");
        let result = conn
            .query_row(
                "SELECT id, started_at, ended_at, total_tokens, triggered_planet
                 FROM sessions
                 WHERE ended_at IS NULL
                 ORDER BY started_at DESC
                 LIMIT 1",
                [],
                row_to_session,
            )
            .optional()?;
        Ok(result)
    }

    pub fn get_watch_offset(&self, file_path: &str) -> Result<u64> {
        let conn = self.conn.lock().expect("db poisoned");
        let offset: Option<i64> = conn
            .query_row(
                "SELECT byte_offset FROM watch_state WHERE file_path = ?1",
                params![file_path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(offset.unwrap_or(0).max(0) as u64)
    }

    pub fn set_watch_offset(&self, file_path: &str, offset: u64) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO watch_state (file_path, byte_offset, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(file_path) DO UPDATE SET byte_offset = excluded.byte_offset, updated_at = excluded.updated_at",
            params![file_path, offset as i64, now],
        )?;
        Ok(())
    }

    /// Has this install completed the one-time "skip historical tokens" baseline?
    /// Stored as a sentinel row in `watch_state`. Stable across upgrades; only
    /// resets if the user wipes the app's data directory.
    ///
    /// Migration safety: pre-existing installs that predate the sentinel are
    /// treated as bootstrapped if `watch_state` already has any real entries
    /// (i.e. the watcher has run at least once). Their saved offsets are
    /// correct already — we just need to suppress the new skip-to-end path.
    pub fn is_bootstrapped(&self) -> Result<bool> {
        let conn = self.conn.lock().expect("db poisoned");
        let has_sentinel: Option<i64> = conn
            .query_row(
                "SELECT byte_offset FROM watch_state WHERE file_path = ?1",
                params![BOOTSTRAP_SENTINEL],
                |row| row.get(0),
            )
            .optional()?;
        if has_sentinel.is_some() {
            return Ok(true);
        }
        let other_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM watch_state WHERE file_path != ?1",
            params![BOOTSTRAP_SENTINEL],
            |row| row.get(0),
        )?;
        Ok(other_count > 0)
    }

    /// Record that the first-run baseline finished so subsequent launches
    /// resume normal incremental ingestion.
    pub fn mark_bootstrapped(&self) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO watch_state (file_path, byte_offset, updated_at)
             VALUES (?1, 1, ?2)
             ON CONFLICT(file_path) DO NOTHING",
            params![BOOTSTRAP_SENTINEL, now],
        )?;
        Ok(())
    }

    // ---------- Universe ----------

    pub fn find_universe_by_date(&self, date: NaiveDate) -> Result<Option<Universe>> {
        let conn = self.conn.lock().expect("db poisoned");
        let result = conn
            .query_row(
                "SELECT id, date, star_count, galaxy_type, seed, layout_shape, palette,
                        cluster_name, created_at, finalized_at
                 FROM universes WHERE date = ?1",
                params![date.to_string()],
                row_to_universe,
            )
            .optional()?;
        Ok(result)
    }

    pub fn create_universe(
        &self,
        date: NaiveDate,
        seed: i64,
        layout_shape: &str,
        palette: &str,
        cluster_name: &str,
        created_at: DateTime<Utc>,
    ) -> Result<Universe> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "INSERT INTO universes
                (date, star_count, seed, layout_shape, palette, cluster_name, created_at)
             VALUES (?1, 0, ?2, ?3, ?4, ?5, ?6)",
            params![
                date.to_string(),
                seed,
                layout_shape,
                palette,
                cluster_name,
                created_at.to_rfc3339(),
            ],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Universe {
            id,
            date,
            star_count: 0,
            galaxy_type: None,
            seed,
            layout_shape: Some(layout_shape.to_string()),
            palette: Some(palette.to_string()),
            cluster_name: Some(cluster_name.to_string()),
            created_at,
            finalized_at: None,
        })
    }

    pub fn bump_universe_star_count(&self, universe_id: i64, delta: u32) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "UPDATE universes SET star_count = star_count + ?1 WHERE id = ?2",
            params![delta as i64, universe_id],
        )?;
        Ok(())
    }

    pub fn finalize_universe(
        &self,
        universe_id: i64,
        galaxy: GalaxyType,
        finalized_at: DateTime<Utc>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "UPDATE universes SET galaxy_type = ?1, finalized_at = ?2 WHERE id = ?3",
            params![galaxy.as_str(), finalized_at.to_rfc3339(), universe_id],
        )?;
        Ok(())
    }

    pub fn find_universe_by_id(&self, universe_id: i64) -> Result<Option<Universe>> {
        let conn = self.conn.lock().expect("db poisoned");
        let result = conn
            .query_row(
                "SELECT id, date, star_count, galaxy_type, seed, layout_shape, palette,
                        cluster_name, created_at, finalized_at
                 FROM universes WHERE id = ?1",
                params![universe_id],
                row_to_universe,
            )
            .optional()?;
        Ok(result)
    }

    /// List universes whose `date` falls inside `[from_date, to_date)`. Pass
    /// `None` for either bound to leave it open. Ordered newest-first.
    pub fn list_universes(
        &self,
        from_date: Option<NaiveDate>,
        to_date: Option<NaiveDate>,
    ) -> Result<Vec<Universe>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut sql = String::from(
            "SELECT id, date, star_count, galaxy_type, seed, layout_shape, palette,
                    cluster_name, created_at, finalized_at
             FROM universes",
        );
        let mut params_vec: Vec<String> = Vec::new();
        let mut clauses: Vec<&str> = Vec::new();
        if let Some(d) = from_date {
            clauses.push("date >= ?");
            params_vec.push(d.to_string());
        }
        if let Some(d) = to_date {
            clauses.push("date < ?");
            params_vec.push(d.to_string());
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY date DESC");

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        let rows = stmt.query_map(param_refs.as_slice(), row_to_universe)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- Stars ----------

    pub fn insert_star(&self, universe_id: i64, blueprint: &StarBlueprint) -> Result<i64> {
        let conn = self.conn.lock().expect("db poisoned");
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO stars
                (universe_id, position_x, position_y, radius,
                 color_r, color_g, color_b, opacity, is_big, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                universe_id,
                blueprint.position_x as f64,
                blueprint.position_y as f64,
                blueprint.radius as f64,
                blueprint.color_r as i64,
                blueprint.color_g as i64,
                blueprint.color_b as i64,
                blueprint.opacity as f64,
                blueprint.is_big as i64,
                now,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_stars(&self, universe_id: i64) -> Result<Vec<Star>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, position_x, position_y, radius,
                    color_r, color_g, color_b, opacity, is_big, created_at
             FROM stars WHERE universe_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![universe_id], row_to_star)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- Planets ----------

    pub fn insert_planet(&self, planet: &Planet) -> Result<i64> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "INSERT INTO planets
                (universe_id, planet_type, rarity, seed, discovered_at,
                 triggering_session_id, position_x, position_y, user_note, acknowledged_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                planet.universe_id,
                planet.planet_type,
                planet.rarity.as_str(),
                planet.seed,
                planet.discovered_at.to_rfc3339(),
                planet.triggering_session_id,
                planet.position_x as f64,
                planet.position_y as f64,
                planet.user_note,
                planet.acknowledged_at.map(|d| d.to_rfc3339()),
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_planets(&self, universe_id: i64) -> Result<Vec<Planet>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, planet_type, rarity, seed, discovered_at,
                    triggering_session_id, position_x, position_y, user_note, acknowledged_at
             FROM planets WHERE universe_id = ?1 ORDER BY discovered_at",
        )?;
        let rows = stmt.query_map(params![universe_id], row_to_planet)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// All planets across all universes that the user hasn't yet seen in the
    /// discovery overlay. Used to populate the pending queue when the popover opens.
    pub fn list_unacknowledged_planets(&self) -> Result<Vec<Planet>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, planet_type, rarity, seed, discovered_at,
                    triggering_session_id, position_x, position_y, user_note, acknowledged_at
             FROM planets WHERE acknowledged_at IS NULL ORDER BY discovered_at",
        )?;
        let rows = stmt.query_map([], row_to_planet)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn acknowledge_planets(&self, planet_ids: &[i64], at: DateTime<Utc>) -> Result<usize> {
        if planet_ids.is_empty() {
            return Ok(0);
        }
        let conn = self.conn.lock().expect("db poisoned");
        let placeholders = vec!["?"; planet_ids.len()].join(",");
        let sql = format!(
            "UPDATE planets SET acknowledged_at = ?1 WHERE id IN ({placeholders}) AND acknowledged_at IS NULL"
        );
        let at_str = at.to_rfc3339();
        let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(1 + planet_ids.len());
        params_vec.push(&at_str);
        for id in planet_ids {
            params_vec.push(id);
        }
        let changes = conn.execute(&sql, params_vec.as_slice())?;
        Ok(changes)
    }

    /// Count of today's planets that contribute to the daily cap (mythic excluded).
    pub fn count_today_planets(&self, universe_id: i64) -> Result<u32> {
        let conn = self.conn.lock().expect("db poisoned");
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM planets
             WHERE universe_id = ?1 AND rarity != 'mythic'",
            params![universe_id],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as u32)
    }

    pub fn count_all_planets(&self, universe_id: i64) -> Result<u32> {
        let conn = self.conn.lock().expect("db poisoned");
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM planets WHERE universe_id = ?1",
            params![universe_id],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as u32)
    }

    // ---------- Nebulae ----------

    pub fn insert_nebula(&self, universe_id: i64, blueprint: &NebulaBlueprint) -> Result<i64> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "INSERT INTO nebulae
                (universe_id, position_x, position_y, radius, color, opacity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                universe_id,
                blueprint.position_x as f64,
                blueprint.position_y as f64,
                blueprint.radius as f64,
                blueprint.color,
                blueprint.opacity as f64,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_nebulae(&self, universe_id: i64) -> Result<Vec<Nebula>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, position_x, position_y, radius, color, opacity
             FROM nebulae WHERE universe_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![universe_id], row_to_nebula)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- Constellations ----------

    pub fn insert_constellation(
        &self,
        universe_id: i64,
        name: &str,
        color: &str,
        star_ids: &[i64],
        preset_id: Option<&str>,
    ) -> Result<i64> {
        let conn = self.conn.lock().expect("db poisoned");
        let star_ids_json = serde_json::to_string(star_ids)?;
        conn.execute(
            "INSERT INTO constellations
                (universe_id, name, color, star_ids, preset_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                universe_id,
                name,
                color,
                star_ids_json,
                preset_id,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_constellations(&self, universe_id: i64) -> Result<Vec<Constellation>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, name, color, star_ids, preset_id, created_at
             FROM constellations WHERE universe_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![universe_id], row_to_constellation)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Codex roll-up: every registered constellation paired with the
    /// universe metadata + resolved star positions needed to draw the card
    /// thumbnail. Returns newest-first so the most recent shows up on top.
    pub fn list_constellation_codex(&self) -> Result<Vec<ConstellationCodexEntry>> {
        use std::collections::HashMap;
        // 1) Pull every constellation row plus its universe metadata in a
        //    single locked transaction, then drop the connection lock. We
        //    can't keep it held while calling `list_stars` below because
        //    that helper also locks `self.conn` and `std::sync::Mutex` is
        //    not reentrant — locking again on the same thread deadlocks.
        let raw: Vec<ConstellationCodexRow> = {
            let conn = self.conn.lock().expect("db poisoned");
            let mut stmt = conn.prepare(
                "SELECT c.id, c.universe_id, c.name, c.color, c.star_ids, c.created_at,
                        u.date, u.cluster_name, u.seed
                 FROM constellations c
                 JOIN universes u ON u.id = c.universe_id
                 ORDER BY c.created_at DESC, c.id DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                let id: i64 = row.get(0)?;
                let universe_id: i64 = row.get(1)?;
                let name: String = row.get(2)?;
                let color: String = row.get(3)?;
                let star_ids_raw: String = row.get(4)?;
                let star_ids: Vec<i64> = serde_json::from_str(&star_ids_raw).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;
                let created_raw: String = row.get(5)?;
                let created_at = parse_rfc3339(5, &created_raw)?;
                let universe_date: String = row.get(6)?;
                let cluster_name: Option<String> = row.get(7)?;
                let seed: i64 = row.get(8)?;
                Ok(ConstellationCodexRow {
                    id,
                    universe_id,
                    name,
                    color,
                    star_ids,
                    created_at,
                    universe_date,
                    cluster_name,
                    seed,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        // 2) Resolve star ids → world-space (x, y), batched by universe so
        //    each universe's full star list loads at most once.
        let mut by_universe: HashMap<i64, Vec<Star>> = HashMap::new();
        let mut out: Vec<ConstellationCodexEntry> = Vec::with_capacity(raw.len());
        for r in raw {
            let stars_for = by_universe
                .entry(r.universe_id)
                .or_insert_with(|| self.list_stars(r.universe_id).unwrap_or_default());
            let mut pts: Vec<(f32, f32)> = Vec::with_capacity(r.star_ids.len());
            for sid in &r.star_ids {
                if let Some(star) = stars_for.iter().find(|s| s.id == *sid) {
                    pts.push((star.position_x, star.position_y));
                }
            }
            out.push(ConstellationCodexEntry {
                id: r.id,
                universe_id: r.universe_id,
                name: r.name,
                color: r.color,
                created_at: r.created_at,
                universe_date: r.universe_date,
                cluster_name: r.cluster_name,
                seed: r.seed,
                stars: pts,
            });
        }
        Ok(out)
    }

    pub fn delete_constellation(&self, id: i64) -> Result<usize> {
        let conn = self.conn.lock().expect("db poisoned");
        let n = conn.execute("DELETE FROM constellations WHERE id = ?1", params![id])?;
        Ok(n)
    }

    // ---------- Codex ----------

    pub fn codex_record_discovery(
        &self,
        planet_type: &str,
        rarity: Rarity,
        at: DateTime<Utc>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("db poisoned");
        let at_str = at.to_rfc3339();
        conn.execute(
            "INSERT INTO codex (planet_type, rarity, discovery_count, first_discovered_at, last_discovered_at)
             VALUES (?1, ?2, 1, ?3, ?3)
             ON CONFLICT(planet_type) DO UPDATE SET
                 discovery_count = discovery_count + 1,
                 last_discovered_at = excluded.last_discovered_at",
            params![planet_type, rarity.as_str(), at_str],
        )?;
        Ok(())
    }

    pub fn list_codex_entries(&self) -> Result<Vec<CodexEntry>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT planet_type, rarity, discovery_count, first_discovered_at, last_discovered_at
             FROM codex",
        )?;
        let rows = stmt.query_map([], row_to_codex_entry)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- Achievements ----------

    /// Record an achievement key. Returns `true` if newly recorded, `false`
    /// if the key was already present.
    pub fn achievement_record(&self, key: &str, at: DateTime<Utc>) -> Result<bool> {
        let conn = self.conn.lock().expect("db poisoned");
        let changes = conn.execute(
            "INSERT OR IGNORE INTO achievements (achievement_key, achieved_at, progress)
             VALUES (?1, ?2, 100)",
            params![key, at.to_rfc3339()],
        )?;
        Ok(changes > 0)
    }

    pub fn list_achievements(&self) -> Result<Vec<AchievementRow>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt =
            conn.prepare("SELECT achievement_key, achieved_at, progress FROM achievements")?;
        let rows = stmt.query_map([], |row| {
            let achieved_at: Option<String> = row.get(1)?;
            let achieved_at = achieved_at
                .map(|s| {
                    DateTime::parse_from_rfc3339(&s)
                        .map(|d| d.with_timezone(&Utc))
                        .map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                1,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })
                })
                .transpose()?;
            Ok(AchievementRow {
                key: row.get(0)?,
                achieved_at,
                progress: row.get::<_, i64>(2)? as i32,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AchievementRow {
    pub key: String,
    pub achieved_at: Option<DateTime<Utc>>,
    pub progress: i32,
}

fn row_to_token_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<TokenEvent> {
    let timestamp: String = row.get(8)?;
    let timestamp = DateTime::parse_from_rfc3339(&timestamp)
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e))
        })?
        .with_timezone(&Utc);
    Ok(TokenEvent {
        id: row.get(0)?,
        provider: row.get(1)?,
        model: row.get(2)?,
        message_id: row.get(3)?,
        input_tokens: row.get::<_, i64>(4)? as u64,
        output_tokens: row.get::<_, i64>(5)? as u64,
        cache_read: row.get::<_, i64>(6)? as u64,
        cache_write: row.get::<_, i64>(7)? as u64,
        timestamp,
        session_id: row.get(9)?,
        source_file: row.get(10)?,
    })
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Parse a datetime string from SQLite. Accepts:
/// - RFC 3339 (`2026-05-16T20:16:52Z`, `2026-05-16T20:16:52.123+09:00`)
/// - SQLite default (`2026-05-16 20:16:52`, no offset → assumed UTC)
///
/// SQLite's built-in `datetime('now')` returns the second form, so anyone who
/// runs an ad-hoc UPDATE on a timestamp column needs to be readable too.
fn parse_rfc3339(idx: usize, raw: &str) -> rusqlite::Result<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Ok(dt.with_timezone(&Utc));
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        return Ok(naive.and_utc());
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(naive.and_utc());
    }
    Err(rusqlite::Error::FromSqlConversionFailure(
        idx,
        rusqlite::types::Type::Text,
        format!("unrecognized datetime: {raw}").into(),
    ))
}

fn parse_naive_date(idx: usize, raw: &str) -> rusqlite::Result<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn row_to_universe(row: &rusqlite::Row<'_>) -> rusqlite::Result<Universe> {
    let date_raw: String = row.get(1)?;
    let date = parse_naive_date(1, &date_raw)?;
    let galaxy_raw: Option<String> = row.get(3)?;
    let galaxy_type = galaxy_raw.as_deref().and_then(GalaxyType::from_str);
    let created_raw: String = row.get(8)?;
    let created_at = parse_rfc3339(8, &created_raw)?;
    let finalized_raw: Option<String> = row.get(9)?;
    let finalized_at = finalized_raw
        .as_deref()
        .map(|s| parse_rfc3339(9, s))
        .transpose()?;
    Ok(Universe {
        id: row.get(0)?,
        date,
        star_count: row.get::<_, i64>(2)? as u32,
        galaxy_type,
        seed: row.get(4)?,
        layout_shape: row.get(5)?,
        palette: row.get(6)?,
        cluster_name: row.get(7)?,
        created_at,
        finalized_at,
    })
}

fn row_to_star(row: &rusqlite::Row<'_>) -> rusqlite::Result<Star> {
    let created_raw: String = row.get(10)?;
    let created_at = parse_rfc3339(10, &created_raw)?;
    Ok(Star {
        id: row.get(0)?,
        universe_id: row.get(1)?,
        position_x: row.get::<_, f64>(2)? as f32,
        position_y: row.get::<_, f64>(3)? as f32,
        radius: row.get::<_, f64>(4)? as f32,
        color_r: row.get::<_, i64>(5)? as u8,
        color_g: row.get::<_, i64>(6)? as u8,
        color_b: row.get::<_, i64>(7)? as u8,
        opacity: row.get::<_, f64>(8)? as f32,
        is_big: row.get::<_, i64>(9)? != 0,
        created_at,
    })
}

fn row_to_planet(row: &rusqlite::Row<'_>) -> rusqlite::Result<Planet> {
    let rarity_raw: String = row.get(3)?;
    let rarity = Rarity::from_str(&rarity_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            format!("unknown rarity: {rarity_raw}").into(),
        )
    })?;
    let discovered_raw: String = row.get(5)?;
    let discovered_at = parse_rfc3339(5, &discovered_raw)?;
    let ack_raw: Option<String> = row.get(10)?;
    let acknowledged_at = ack_raw
        .as_deref()
        .map(|s| parse_rfc3339(10, s))
        .transpose()?;
    Ok(Planet {
        id: row.get(0)?,
        universe_id: row.get(1)?,
        planet_type: row.get(2)?,
        rarity,
        seed: row.get(4)?,
        discovered_at,
        triggering_session_id: row.get(6)?,
        position_x: row.get::<_, f64>(7)? as f32,
        position_y: row.get::<_, f64>(8)? as f32,
        user_note: row.get(9)?,
        acknowledged_at,
    })
}

fn row_to_nebula(row: &rusqlite::Row<'_>) -> rusqlite::Result<Nebula> {
    Ok(Nebula {
        id: row.get(0)?,
        universe_id: row.get(1)?,
        position_x: row.get::<_, f64>(2)? as f32,
        position_y: row.get::<_, f64>(3)? as f32,
        radius: row.get::<_, f64>(4)? as f32,
        color: row.get(5)?,
        opacity: row.get::<_, f64>(6)? as f32,
    })
}

fn row_to_constellation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Constellation> {
    let star_ids_raw: String = row.get(4)?;
    let star_ids: Vec<i64> = serde_json::from_str(&star_ids_raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let created_raw: String = row.get(6)?;
    let created_at = parse_rfc3339(6, &created_raw)?;
    Ok(Constellation {
        id: row.get(0)?,
        universe_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        star_ids,
        preset_id: row.get(5)?,
        created_at,
    })
}

fn row_to_codex_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<CodexEntry> {
    let rarity_raw: String = row.get(1)?;
    let rarity = Rarity::from_str(&rarity_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            format!("unknown rarity: {rarity_raw}").into(),
        )
    })?;
    let first_raw: Option<String> = row.get(3)?;
    let first_discovered_at = first_raw
        .as_deref()
        .map(|s| parse_rfc3339(3, s))
        .transpose()?;
    let last_raw: Option<String> = row.get(4)?;
    let last_discovered_at = last_raw
        .as_deref()
        .map(|s| parse_rfc3339(4, s))
        .transpose()?;
    Ok(CodexEntry {
        planet_type: row.get(0)?,
        rarity,
        discovery_count: row.get::<_, i64>(2)? as u32,
        first_discovered_at,
        last_discovered_at,
    })
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<Session> {
    let started_at: String = row.get(1)?;
    let started_at = DateTime::parse_from_rfc3339(&started_at)
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
        })?
        .with_timezone(&Utc);
    let ended_at: Option<String> = row.get(2)?;
    let ended_at = ended_at
        .map(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&Utc))
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;
    let triggered_planet: i64 = row.get(4)?;
    Ok(Session {
        id: row.get(0)?,
        started_at,
        ended_at,
        total_tokens: row.get::<_, i64>(3)? as u64,
        triggered_planet: triggered_planet != 0,
    })
}
