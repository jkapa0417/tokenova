//! Shared engine domain types. Kept separate so db, engine submodules, and Tauri
//! commands can depend on the same shapes without circular imports.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Logical canvas size in world units. Matches the reference simulation
/// (480×400 display × 2x DPR = 960×800 internal).
pub const UNIVERSE_W: f32 = 960.0;
pub const UNIVERSE_H: f32 = 800.0;

/// 1 별 = 1,000 토큰. (design modification #4)
pub const TOKENS_PER_STAR: u64 = 1_000;
/// 일일 별 캡. (design modification #4)
pub const DAILY_STAR_CAP: u32 = 1_000;
/// 일일 행성 캡. mythic 제외 모든 등급 합산. (design modification #6)
pub const DAILY_PLANET_CAP: u32 = 10;
/// 행성 트리거 임계값 (세션 토큰).
pub const PLANET_SESSION_THRESHOLD: u64 = 5_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GalaxyType {
    BlackHole,    // 0
    Nebula,       // 1-30
    Cluster,      // 31-100
    Galaxy,       // 101-300
    MegaGalaxy,   // 301-999
    SuperCluster, // 1000 (cap)
}

impl GalaxyType {
    pub fn classify(star_count: u32) -> Self {
        match star_count {
            0 => Self::BlackHole,
            1..=30 => Self::Nebula,
            31..=100 => Self::Cluster,
            101..=300 => Self::Galaxy,
            301..=999 => Self::MegaGalaxy,
            _ => Self::SuperCluster,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::BlackHole => "black_hole",
            Self::Nebula => "nebula",
            Self::Cluster => "cluster",
            Self::Galaxy => "galaxy",
            Self::MegaGalaxy => "mega_galaxy",
            Self::SuperCluster => "super_cluster",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "black_hole" => Self::BlackHole,
            "nebula" => Self::Nebula,
            "cluster" => Self::Cluster,
            "galaxy" => Self::Galaxy,
            "mega_galaxy" => Self::MegaGalaxy,
            "super_cluster" => Self::SuperCluster,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Rarity {
    Common,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

impl Rarity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Common => "common",
            Self::Rare => "rare",
            Self::Epic => "epic",
            Self::Legendary => "legendary",
            Self::Mythic => "mythic",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "common" => Self::Common,
            "rare" => Self::Rare,
            "epic" => Self::Epic,
            "legendary" => Self::Legendary,
            "mythic" => Self::Mythic,
            _ => return None,
        })
    }

    #[allow(dead_code)]
    pub fn counts_toward_daily_cap(self) -> bool {
        !matches!(self, Self::Mythic)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Universe {
    pub id: i64,
    pub date: NaiveDate,
    pub star_count: u32,
    pub galaxy_type: Option<GalaxyType>,
    pub seed: i64,
    pub layout_shape: Option<String>,
    pub palette: Option<String>,
    pub created_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Star {
    pub id: i64,
    pub universe_id: i64,
    pub position_x: f32,
    pub position_y: f32,
    pub radius: f32,
    pub color_r: u8,
    pub color_g: u8,
    pub color_b: u8,
    pub opacity: f32,
    pub is_big: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Planet {
    pub id: i64,
    pub universe_id: i64,
    pub planet_type: String,
    pub rarity: Rarity,
    pub seed: i64,
    pub discovered_at: DateTime<Utc>,
    pub triggering_session_id: Option<i64>,
    pub position_x: f32,
    pub position_y: f32,
    pub user_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nebula {
    pub id: i64,
    pub universe_id: i64,
    pub position_x: f32,
    pub position_y: f32,
    pub radius: f32,
    pub color: String,
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constellation {
    pub id: i64,
    pub universe_id: i64,
    pub name: String,
    pub color: String,
    pub star_ids: Vec<i64>,
    pub preset_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexEntry {
    pub planet_type: String,
    pub rarity: Rarity,
    pub discovery_count: u32,
    pub first_discovered_at: Option<DateTime<Utc>>,
    pub last_discovered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UniversePayload {
    pub universe: Universe,
    pub stars: Vec<Star>,
    pub planets: Vec<Planet>,
    pub nebulae: Vec<Nebula>,
    pub constellations: Vec<Constellation>,
    /// Today's locally accumulated tokens that haven't yet become a full star.
    pub leftover_tokens: u64,
    pub today_tokens: u64,
}

/// Compact summary of a past universe for the Gallery grid view.
#[derive(Debug, Clone, Serialize)]
pub struct UniverseSummary {
    pub id: i64,
    pub date: NaiveDate,
    pub star_count: u32,
    pub planet_count: u32,
    pub galaxy_type: Option<GalaxyType>,
    pub seed: i64,
    pub finalized: bool,
}
