//! Achievement tracker. Phase C ships with 5 starter keys; Phase E expands
//! this catalog and adds progression metadata.
//!
//! Each key is recorded only once via `Db::achievement_record`. Trigger sites
//! are split across the engine: stars.rs / planets.rs / universe.rs call
//! `mark` with the relevant key whenever a milestone is reached.

use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use serde::Serialize;

use crate::db::Db;
use crate::engine::types::{GalaxyType, Rarity};

// Start
pub const FIRST_STAR: &str = "first_star";
pub const FIRST_PLANET: &str = "first_planet";
pub const FIRST_UNIVERSE: &str = "first_universe";        // hit 100 stars in a day
pub const FIRST_CONSTELLATION: &str = "first_constellation";

// Collect
pub const CODEX_QUARTER: &str = "codex_quarter";          // 8 / 30
pub const CODEX_HALF: &str = "codex_half";                // 15 / 30
pub const CODEX_COMPLETE: &str = "codex_complete";        // 30 / 30
pub const FIRST_RARE_PLANET: &str = "first_rare_planet";
pub const FIRST_LEGENDARY_PLANET: &str = "first_legendary_planet";
pub const FIRST_MYTHIC_PLANET: &str = "first_mythic_planet";

// Time
pub const FIRST_BLACK_HOLE: &str = "first_black_hole";    // zero-activity day (잠든 우주)
pub const FIRST_MEGA_GALAXY: &str = "first_mega_galaxy";  // hit the 1000-star daily cap

// Rhythm — purely time-of-day buckets, awarded by future engine hooks.
pub const NIGHT_OWL: &str = "night_owl";
pub const EARLY_BIRD: &str = "early_bird";

// Memorial — consecutive-day streaks.
pub const STREAK_7: &str = "streak_7";
pub const STREAK_30: &str = "streak_30";
pub const STREAK_100: &str = "streak_100";
pub const STREAK_365: &str = "streak_365";

pub const STARTER_KEYS: &[&str] = &[
    FIRST_STAR,
    FIRST_PLANET,
    FIRST_UNIVERSE,
    FIRST_CONSTELLATION,
    CODEX_QUARTER,
    CODEX_HALF,
    CODEX_COMPLETE,
    FIRST_RARE_PLANET,
    FIRST_LEGENDARY_PLANET,
    FIRST_MYTHIC_PLANET,
    FIRST_BLACK_HOLE,
    FIRST_MEGA_GALAXY,
    NIGHT_OWL,
    EARLY_BIRD,
    STREAK_7,
    STREAK_30,
    STREAK_100,
    STREAK_365,
];

#[derive(Debug, Clone, Serialize)]
pub struct AchievementCard {
    pub key: &'static str,
    pub display_name: &'static str,
    pub achieved: bool,
    pub achieved_at: Option<chrono::DateTime<Utc>>,
}

pub fn display_name(key: &str) -> &'static str {
    match key {
        FIRST_STAR => "첫 별",
        FIRST_PLANET => "첫 행성",
        FIRST_UNIVERSE => "첫 우주 형성",
        FIRST_CONSTELLATION => "첫 별자리",
        CODEX_QUARTER => "도감 25%",
        CODEX_HALF => "도감 절반",
        CODEX_COMPLETE => "도감 완성",
        FIRST_RARE_PLANET => "첫 희귀 행성",
        FIRST_LEGENDARY_PLANET => "전설의 손길",
        FIRST_MYTHIC_PLANET => "신화의 부재",
        FIRST_BLACK_HOLE => "잠든 우주의 날",
        FIRST_MEGA_GALAXY => "거대 은하",
        NIGHT_OWL => "Night Owl",
        EARLY_BIRD => "Early Bird",
        STREAK_7 => "7일 연속",
        STREAK_30 => "30일 연속",
        STREAK_100 => "100일 연속",
        STREAK_365 => "1년 연속",
        _ => "??",
    }
}

/// Idempotent. Returns `true` if this call was the first time the
/// achievement was recorded.
pub fn mark(db: &Arc<Db>, key: &str) -> Result<bool> {
    db.achievement_record(key, Utc::now())
}

/// Newly-earned achievement keys, in display order. Used by the engine to
/// fan out user-visible notifications.
#[derive(Debug, Clone, Default)]
pub struct EarnedAchievements(pub Vec<&'static str>);

/// Convenience hooks called from elsewhere in the engine.
pub fn on_first_star(db: &Arc<Db>) -> Result<EarnedAchievements> {
    let mut earned = EarnedAchievements::default();
    if mark(db, FIRST_STAR)? {
        earned.0.push(FIRST_STAR);
    }
    Ok(earned)
}

pub fn on_planet_discovered(db: &Arc<Db>, rarity: Rarity) -> Result<EarnedAchievements> {
    let mut earned = EarnedAchievements::default();
    if mark(db, FIRST_PLANET)? {
        earned.0.push(FIRST_PLANET);
    }
    if matches!(
        rarity,
        Rarity::Rare | Rarity::Epic | Rarity::Legendary | Rarity::Mythic
    ) && mark(db, FIRST_RARE_PLANET)?
    {
        earned.0.push(FIRST_RARE_PLANET);
    }
    if matches!(rarity, Rarity::Legendary | Rarity::Mythic) && mark(db, FIRST_LEGENDARY_PLANET)? {
        earned.0.push(FIRST_LEGENDARY_PLANET);
    }
    if matches!(rarity, Rarity::Mythic) && mark(db, FIRST_MYTHIC_PLANET)? {
        earned.0.push(FIRST_MYTHIC_PLANET);
    }
    // Codex completion tiers — count distinct discovered planet types after
    // recording this discovery. Cheap query, idempotent because mark() is
    // a one-shot.
    let discovered_types = db.count_codex_discovered_types().unwrap_or(0);
    if discovered_types >= 8 && mark(db, CODEX_QUARTER)? {
        earned.0.push(CODEX_QUARTER);
    }
    if discovered_types >= 15 && mark(db, CODEX_HALF)? {
        earned.0.push(CODEX_HALF);
    }
    if discovered_types >= 30 && mark(db, CODEX_COMPLETE)? {
        earned.0.push(CODEX_COMPLETE);
    }
    Ok(earned)
}

/// Called once when the user registers their first constellation in Today.
pub fn on_constellation_saved(db: &Arc<Db>) -> Result<EarnedAchievements> {
    let mut earned = EarnedAchievements::default();
    if mark(db, FIRST_CONSTELLATION)? {
        earned.0.push(FIRST_CONSTELLATION);
    }
    Ok(earned)
}

/// Called after a star is inserted. Awards `first_universe` once the day's
/// star count crosses 100.
pub fn on_universe_star_count(db: &Arc<Db>, star_count: u32) -> Result<EarnedAchievements> {
    let mut earned = EarnedAchievements::default();
    if star_count >= 100 && mark(db, FIRST_UNIVERSE)? {
        earned.0.push(FIRST_UNIVERSE);
    }
    Ok(earned)
}

pub fn on_universe_finalized(db: &Arc<Db>, galaxy: GalaxyType) -> Result<EarnedAchievements> {
    let mut earned = EarnedAchievements::default();
    let maybe_key = match galaxy {
        GalaxyType::BlackHole => Some(FIRST_BLACK_HOLE),
        GalaxyType::MegaGalaxy | GalaxyType::SuperCluster => Some(FIRST_MEGA_GALAXY),
        _ => None,
    };
    if let Some(key) = maybe_key {
        if mark(db, key)? {
            earned.0.push(key);
        }
    }
    Ok(earned)
}

pub fn build_payload(db: &Arc<Db>) -> Result<Vec<AchievementCard>> {
    let earned = db.list_achievements()?;
    Ok(STARTER_KEYS
        .iter()
        .map(|&key| {
            let earned = earned.iter().find(|a| a.key == key);
            AchievementCard {
                key,
                display_name: display_name(key),
                achieved: earned.is_some(),
                achieved_at: earned.and_then(|a| a.achieved_at),
            }
        })
        .collect())
}
