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

pub const FIRST_STAR: &str = "first_star";
pub const FIRST_PLANET: &str = "first_planet";
pub const FIRST_BLACK_HOLE: &str = "first_black_hole";
pub const FIRST_MEGA_GALAXY: &str = "first_mega_galaxy";
pub const FIRST_RARE_PLANET: &str = "first_rare_planet";

pub const STARTER_KEYS: &[&str] = &[
    FIRST_STAR,
    FIRST_PLANET,
    FIRST_BLACK_HOLE,
    FIRST_MEGA_GALAXY,
    FIRST_RARE_PLANET,
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
        FIRST_BLACK_HOLE => "첫 블랙홀의 날",
        FIRST_MEGA_GALAXY => "거대 은하 달성",
        FIRST_RARE_PLANET => "첫 희귀 행성",
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
