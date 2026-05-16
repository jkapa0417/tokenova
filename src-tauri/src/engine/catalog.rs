//! Planet catalog — 30 types across 5 rarities.
//!
//! Names match the build plan. Visual details (color palette, surface pattern)
//! are produced procedurally at render time in Phase D, not stored here.

use crate::engine::types::Rarity;

#[derive(Debug, Clone, Copy)]
pub struct PlanetSpec {
    pub key: &'static str,
    pub display_name: &'static str,
    /// Used internally for grouping; round-trippable via [`planets_of`].
    #[allow(dead_code)]
    pub rarity: Rarity,
}

// Rarity weights (sum to 100.0). Mythic intentionally rare. See plan §행성 등급.
const COMMON_WEIGHT: f64 = 70.0;
const RARE_WEIGHT: f64 = 20.0;
const EPIC_WEIGHT: f64 = 8.0;
const LEGENDARY_WEIGHT: f64 = 1.9;
const MYTHIC_WEIGHT: f64 = 0.1;

pub const COMMON_PLANETS: &[PlanetSpec] = &[
    spec("earth_like", "지구형 행성", Rarity::Common),
    spec("gas_giant", "가스 거인", Rarity::Common),
    spec("mars_like", "화성형 행성", Rarity::Common),
    spec("ice_giant", "얼음 거인", Rarity::Common),
    spec("dead_world", "죽은 세계", Rarity::Common),
    spec("lava_world", "용암 세계", Rarity::Common),
    spec("crystal", "수정 행성", Rarity::Common),
    spec("ocean_world", "대양 세계", Rarity::Common),
    spec("desert_world", "사막 세계", Rarity::Common),
    spec("mist_world", "안개 세계", Rarity::Common),
    spec("volcanic", "화산 행성", Rarity::Common),
    spec("jungle", "정글 행성", Rarity::Common),
];

pub const RARE_PLANETS: &[PlanetSpec] = &[
    spec("storm", "폭풍 행성", Rarity::Rare),
    spec("pearl", "진주 행성", Rarity::Rare),
    spec("amethyst", "자수정 행성", Rarity::Rare),
    spec("emerald", "에메랄드 행성", Rarity::Rare),
    spec("mirror", "거울 행성", Rarity::Rare),
    spec("botanical", "식물원 행성", Rarity::Rare),
    spec("mystic", "신비의 행성", Rarity::Rare),
    spec("twilight", "황혼의 행성", Rarity::Rare),
    spec("nocturnal", "야행성 행성", Rarity::Rare),
    spec("multi_ocean", "다중 대양 행성", Rarity::Rare),
];

pub const EPIC_PLANETS: &[PlanetSpec] = &[
    spec("diamond", "다이아몬드 행성", Rarity::Epic),
    spec("rainbow", "무지개 행성", Rarity::Epic),
    spec("mask", "가면 행성", Rarity::Epic),
    spec("golden", "황금 행성", Rarity::Epic),
    spec("grid", "격자 행성", Rarity::Epic),
];

pub const LEGENDARY_PLANETS: &[PlanetSpec] = &[
    spec("eye_world", "눈동자 세계", Rarity::Legendary),
    spec("ancient_civilization", "고대 문명", Rarity::Legendary),
];

pub const MYTHIC_PLANETS: &[PlanetSpec] = &[spec("dyson_sphere", "다이슨 구체", Rarity::Mythic)];

const fn spec(key: &'static str, display_name: &'static str, rarity: Rarity) -> PlanetSpec {
    PlanetSpec {
        key,
        display_name,
        rarity,
    }
}

pub fn rarity_weight(rarity: Rarity) -> f64 {
    match rarity {
        Rarity::Common => COMMON_WEIGHT,
        Rarity::Rare => RARE_WEIGHT,
        Rarity::Epic => EPIC_WEIGHT,
        Rarity::Legendary => LEGENDARY_WEIGHT,
        Rarity::Mythic => MYTHIC_WEIGHT,
    }
}

pub fn planets_of(rarity: Rarity) -> &'static [PlanetSpec] {
    match rarity {
        Rarity::Common => COMMON_PLANETS,
        Rarity::Rare => RARE_PLANETS,
        Rarity::Epic => EPIC_PLANETS,
        Rarity::Legendary => LEGENDARY_PLANETS,
        Rarity::Mythic => MYTHIC_PLANETS,
    }
}

#[allow(dead_code)]
pub fn lookup(key: &str) -> Option<PlanetSpec> {
    COMMON_PLANETS
        .iter()
        .chain(RARE_PLANETS.iter())
        .chain(EPIC_PLANETS.iter())
        .chain(LEGENDARY_PLANETS.iter())
        .chain(MYTHIC_PLANETS.iter())
        .copied()
        .find(|p| p.key == key)
}

#[cfg(test)]
pub fn all() -> impl Iterator<Item = PlanetSpec> {
    COMMON_PLANETS
        .iter()
        .chain(RARE_PLANETS.iter())
        .chain(EPIC_PLANETS.iter())
        .chain(LEGENDARY_PLANETS.iter())
        .chain(MYTHIC_PLANETS.iter())
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_30_planets() {
        let total = COMMON_PLANETS.len()
            + RARE_PLANETS.len()
            + EPIC_PLANETS.len()
            + LEGENDARY_PLANETS.len()
            + MYTHIC_PLANETS.len();
        assert_eq!(total, 30, "catalog must contain exactly 30 planet types");
    }

    #[test]
    fn weights_sum_to_100() {
        let sum = COMMON_WEIGHT + RARE_WEIGHT + EPIC_WEIGHT + LEGENDARY_WEIGHT + MYTHIC_WEIGHT;
        assert!(
            (sum - 100.0).abs() < 1e-9,
            "rarity weights must sum to 100, got {sum}"
        );
    }

    #[test]
    fn all_keys_unique() {
        use std::collections::HashSet;
        let mut seen = HashSet::new();
        for p in all() {
            assert!(seen.insert(p.key), "duplicate planet key: {}", p.key);
        }
        assert_eq!(seen.len(), 30);
    }

    #[test]
    fn lookup_round_trips() {
        for p in all() {
            assert_eq!(lookup(p.key).map(|q| q.key), Some(p.key));
        }
        assert!(lookup("not_a_planet").is_none());
    }
}
