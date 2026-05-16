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
const SCHEMA_VERSION: i64 = 1;

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
        match current {
            None => {
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?1)",
                    params![SCHEMA_VERSION],
                )?;
            }
            Some(v) if v < SCHEMA_VERSION => {
                // Future migrations go here.
                conn.execute(
                    "UPDATE schema_version SET version = ?1",
                    params![SCHEMA_VERSION],
                )?;
            }
            _ => {}
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

    // ---------- Universe ----------

    pub fn find_universe_by_date(&self, date: NaiveDate) -> Result<Option<Universe>> {
        let conn = self.conn.lock().expect("db poisoned");
        let result = conn
            .query_row(
                "SELECT id, date, star_count, galaxy_type, seed, layout_shape, palette,
                        created_at, finalized_at
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
        created_at: DateTime<Utc>,
    ) -> Result<Universe> {
        let conn = self.conn.lock().expect("db poisoned");
        conn.execute(
            "INSERT INTO universes (date, star_count, seed, layout_shape, palette, created_at)
             VALUES (?1, 0, ?2, ?3, ?4, ?5)",
            params![
                date.to_string(),
                seed,
                layout_shape,
                palette,
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
                        created_at, finalized_at
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
                    created_at, finalized_at
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
                 triggering_session_id, position_x, position_y, user_note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_planets(&self, universe_id: i64) -> Result<Vec<Planet>> {
        let conn = self.conn.lock().expect("db poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, universe_id, planet_type, rarity, seed, discovered_at,
                    triggering_session_id, position_x, position_y, user_note
             FROM planets WHERE universe_id = ?1 ORDER BY discovered_at",
        )?;
        let rows = stmt.query_map(params![universe_id], row_to_planet)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
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

fn parse_rfc3339(idx: usize, raw: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e))
        })
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
    let created_raw: String = row.get(7)?;
    let created_at = parse_rfc3339(7, &created_raw)?;
    let finalized_raw: Option<String> = row.get(8)?;
    let finalized_at = finalized_raw
        .as_deref()
        .map(|s| parse_rfc3339(8, s))
        .transpose()?;
    Ok(Universe {
        id: row.get(0)?,
        date,
        star_count: row.get::<_, i64>(2)? as u32,
        galaxy_type,
        seed: row.get(4)?,
        layout_shape: row.get(5)?,
        palette: row.get(6)?,
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
