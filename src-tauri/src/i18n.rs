//! Backend-side i18n.
//!
//! Notifications are dispatched from Rust (the engine + watchers run on this
//! side) but their bodies are user-visible, so they need to track the same
//! `locale` setting the frontend exposes. The dictionary here is intentionally
//! tiny — only the strings the backend itself prints. Everything else is
//! localised by the frontend i18n module.
//!
//! The current locale is read from the `settings` table on each emit. The
//! query is a single indexed `WHERE key = 'locale'` lookup; notifications are
//! infrequent (capped at 5/day) so we don't bother caching.
//!
//! Adding a new string: extend `Strings` and add a branch for it in both
//! `KO` and `EN`.

use std::sync::Arc;

use crate::db::Db;
use crate::engine::types::{GalaxyType, Rarity};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Ko,
    En,
}

impl Locale {
    pub fn from_str(s: &str) -> Self {
        match s {
            "en" => Self::En,
            _ => Self::Ko,
        }
    }
}

/// Resolve the persisted locale, defaulting to Korean when the setting is
/// missing or unreadable.
pub fn current_locale(db: &Arc<Db>) -> Locale {
    match db.get_setting("locale") {
        Ok(Some(v)) => Locale::from_str(&v),
        _ => Locale::Ko,
    }
}

pub fn planet_rarity_title(locale: Locale, rarity: Rarity) -> &'static str {
    match (locale, rarity) {
        (Locale::Ko, Rarity::Mythic) => "신화 행성 발견!",
        (Locale::Ko, Rarity::Legendary) => "전설 행성 발견!",
        (Locale::Ko, Rarity::Epic) => "에픽 행성 발견",
        (Locale::Ko, Rarity::Rare) => "희귀 행성 발견",
        (Locale::Ko, Rarity::Common) => "행성 발견",
        (Locale::En, Rarity::Mythic) => "Mythic planet discovered!",
        (Locale::En, Rarity::Legendary) => "Legendary planet discovered!",
        (Locale::En, Rarity::Epic) => "Epic planet discovered",
        (Locale::En, Rarity::Rare) => "Rare planet discovered",
        (Locale::En, Rarity::Common) => "Planet discovered",
    }
}

pub fn achievement_earned_title(locale: Locale) -> &'static str {
    match locale {
        Locale::Ko => "업적 달성",
        Locale::En => "Achievement unlocked",
    }
}

pub fn todays_universe_title(locale: Locale) -> &'static str {
    match locale {
        Locale::Ko => "오늘의 우주",
        Locale::En => "Today's universe",
    }
}

/// Body text for the 100-star "galaxy formed" notification. Formats the
/// running count inline because the wording differs between locales.
pub fn galaxy_formed_body(locale: Locale, star_count: u32) -> String {
    match locale {
        Locale::Ko => format!("별 {star_count}개 — 은하 형성"),
        Locale::En => format!("{star_count} stars — galaxy formed"),
    }
}

pub fn universe_finalized_title(locale: Locale) -> &'static str {
    match locale {
        Locale::Ko => "오늘의 우주 마감",
        Locale::En => "Today's universe closed",
    }
}

pub fn galaxy_type_finalize_body(locale: Locale, galaxy: GalaxyType) -> &'static str {
    match (locale, galaxy) {
        (Locale::Ko, GalaxyType::BlackHole) => "블랙홀의 날",
        (Locale::Ko, GalaxyType::Nebula) => "성운으로 마감",
        (Locale::Ko, GalaxyType::Cluster) => "별무리로 마감",
        (Locale::Ko, GalaxyType::Galaxy) => "은하로 마감",
        (Locale::Ko, GalaxyType::MegaGalaxy) => "거대 은하 달성",
        (Locale::Ko, GalaxyType::SuperCluster) => "초은하단 — 최고 등급!",
        (Locale::En, GalaxyType::BlackHole) => "Sleeping universe",
        (Locale::En, GalaxyType::Nebula) => "Closed as a nebula",
        (Locale::En, GalaxyType::Cluster) => "Closed as a cluster",
        (Locale::En, GalaxyType::Galaxy) => "Closed as a galaxy",
        (Locale::En, GalaxyType::MegaGalaxy) => "Mega galaxy reached",
        (Locale::En, GalaxyType::SuperCluster) => "Supercluster — top tier!",
    }
}

/// Localised display name for a planet `key`. Keys are stable identifiers
/// (e.g. `earth_like`, `dyson_sphere`) shared with the frontend i18n dict
/// `planets.<key>.name`; this table mirrors the English translations for
/// backend-emitted notifications. Korean falls back to the static catalog
/// label.
pub fn planet_display_name<'a>(locale: Locale, key: &str, ko_fallback: &'a str) -> &'a str {
    if matches!(locale, Locale::Ko) {
        return ko_fallback;
    }
    let en: Option<&'static str> = match key {
        "earth_like" => Some("Terrestrial"),
        "gas_giant" => Some("Gas Giant"),
        "mars_like" => Some("Martian"),
        "ice_giant" => Some("Ice Giant"),
        "dead_world" => Some("Dead World"),
        "lava_world" => Some("Lava World"),
        "crystal" => Some("Crystal"),
        "ocean_world" => Some("Ocean World"),
        "desert_world" => Some("Desert World"),
        "mist_world" => Some("Mist World"),
        "volcanic" => Some("Volcanic"),
        "jungle" => Some("Jungle World"),
        "storm" => Some("Storm Planet"),
        "pearl" => Some("Pearl Planet"),
        "amethyst" => Some("Amethyst"),
        "emerald" => Some("Emerald"),
        "mirror" => Some("Mirror Planet"),
        "botanical" => Some("Botanical"),
        "mystic" => Some("Mystic Planet"),
        "twilight" => Some("Twilight Planet"),
        "nocturnal" => Some("Nocturnal"),
        "multi_ocean" => Some("Layered Sea"),
        "diamond" => Some("Diamond"),
        "rainbow" => Some("Rainbow Planet"),
        "mask" => Some("Masked Planet"),
        "golden" => Some("Golden Planet"),
        "grid" => Some("Lattice Planet"),
        "eye_world" => Some("Eye World"),
        "ancient_civilization" => Some("Ancient Civilization"),
        "dyson_sphere" => Some("Dyson Sphere"),
        "black_hole" => Some("Black Hole"),
        _ => None,
    };
    en.unwrap_or(ko_fallback)
}

/// Localised display name for an achievement key — used when the backend
/// needs to surface a name (e.g. notification body). The frontend renders
/// its own achievement strings out of the TypeScript i18n dict.
pub fn achievement_display_name(locale: Locale, key: &str) -> &'static str {
    use crate::engine::achievements::{
        CODEX_COMPLETE, CODEX_HALF, CODEX_QUARTER, EARLY_BIRD, FIRST_BLACK_HOLE,
        FIRST_CONSTELLATION, FIRST_LEGENDARY_PLANET, FIRST_MEGA_GALAXY, FIRST_MYTHIC_PLANET,
        FIRST_PLANET, FIRST_RARE_PLANET, FIRST_STAR, FIRST_UNIVERSE, NIGHT_OWL, STREAK_100,
        STREAK_30, STREAK_365, STREAK_7,
    };
    match (locale, key) {
        (Locale::Ko, FIRST_STAR) => "첫 별",
        (Locale::Ko, FIRST_PLANET) => "첫 행성",
        (Locale::Ko, FIRST_UNIVERSE) => "첫 우주 형성",
        (Locale::Ko, FIRST_CONSTELLATION) => "첫 별자리",
        (Locale::Ko, CODEX_QUARTER) => "도감 25%",
        (Locale::Ko, CODEX_HALF) => "도감 절반",
        (Locale::Ko, CODEX_COMPLETE) => "도감 완성",
        (Locale::Ko, FIRST_RARE_PLANET) => "첫 희귀 행성",
        (Locale::Ko, FIRST_LEGENDARY_PLANET) => "전설의 손길",
        (Locale::Ko, FIRST_MYTHIC_PLANET) => "신화의 부재",
        (Locale::Ko, FIRST_BLACK_HOLE) => "잠든 우주의 날",
        (Locale::Ko, FIRST_MEGA_GALAXY) => "거대 은하",
        (Locale::Ko, NIGHT_OWL) => "올빼미",
        (Locale::Ko, EARLY_BIRD) => "이른 새",
        (Locale::Ko, STREAK_7) => "7일 연속",
        (Locale::Ko, STREAK_30) => "30일 연속",
        (Locale::Ko, STREAK_100) => "100일 연속",
        (Locale::Ko, STREAK_365) => "1년 연속",
        (Locale::En, FIRST_STAR) => "First Star",
        (Locale::En, FIRST_PLANET) => "First Planet",
        (Locale::En, FIRST_UNIVERSE) => "First Universe",
        (Locale::En, FIRST_CONSTELLATION) => "First Constellation",
        (Locale::En, CODEX_QUARTER) => "Codex 25%",
        (Locale::En, CODEX_HALF) => "Codex Half",
        (Locale::En, CODEX_COMPLETE) => "Codex Complete",
        (Locale::En, FIRST_RARE_PLANET) => "First Rare",
        (Locale::En, FIRST_LEGENDARY_PLANET) => "Legendary Touch",
        (Locale::En, FIRST_MYTHIC_PLANET) => "Mythic Sighting",
        (Locale::En, FIRST_BLACK_HOLE) => "Sleeping Universe",
        (Locale::En, FIRST_MEGA_GALAXY) => "Mega Galaxy",
        (Locale::En, NIGHT_OWL) => "Night Owl",
        (Locale::En, EARLY_BIRD) => "Early Bird",
        (Locale::En, STREAK_7) => "7-day Streak",
        (Locale::En, STREAK_30) => "30-day Streak",
        (Locale::En, STREAK_100) => "100-day Streak",
        (Locale::En, STREAK_365) => "365-day Streak",
        _ => "??",
    }
}
