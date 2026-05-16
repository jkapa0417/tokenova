//! Nebula generation.
//!
//! Called once when a universe is created. 2~4 nebulae are placed with a
//! per-universe seed so the same universe always shows the same background
//! mood, but every new day looks different.

use std::sync::Arc;

use anyhow::Result;
use rand::Rng;
use rand_pcg::Pcg32;

use crate::db::Db;
use crate::engine::types::{Nebula, Universe, UNIVERSE_H, UNIVERSE_W};

/// Hex/rgba color stems (closing alpha is appended per-nebula at render time).
pub const NEBULA_PALETTE: &[&str] = &[
    "rgba(120, 80, 180,",
    "rgba(80, 120, 200,",
    "rgba(200, 100, 140,",
    "rgba(80, 180, 160,",
];

const NEBULA_MIN: u32 = 2;
const NEBULA_MAX: u32 = 4;

/// Generate and persist nebulae for a freshly-created universe.
pub fn populate_for_universe(db: &Arc<Db>, universe: &Universe) -> Result<Vec<Nebula>> {
    let blueprints = synth_nebulae(universe.seed);
    let mut out = Vec::with_capacity(blueprints.len());
    for nb in blueprints {
        let id = db.insert_nebula(universe.id, &nb)?;
        out.push(Nebula {
            id,
            universe_id: universe.id,
            position_x: nb.position_x,
            position_y: nb.position_y,
            radius: nb.radius,
            color: nb.color.to_string(),
            opacity: nb.opacity,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy)]
pub struct NebulaBlueprint {
    pub position_x: f32,
    pub position_y: f32,
    pub radius: f32,
    pub color: &'static str,
    pub opacity: f32,
}

pub fn synth_nebulae(universe_seed: i64) -> Vec<NebulaBlueprint> {
    // Use a distinct stream from the star RNG (`stream=0`) so nebula generation
    // doesn't shift star positions if either algorithm changes.
    let mut rng = Pcg32::new(universe_seed as u64, 0xCAFE_BABE_DEAD_BEEF);
    let count = rng.gen_range(NEBULA_MIN..=NEBULA_MAX);
    (0..count)
        .map(|_| NebulaBlueprint {
            position_x: rng.gen::<f32>() * UNIVERSE_W,
            position_y: rng.gen::<f32>() * UNIVERSE_H,
            radius: 100.0 + rng.gen::<f32>() * 250.0,
            color: NEBULA_PALETTE[rng.gen_range(0..NEBULA_PALETTE.len())],
            opacity: 0.05 + rng.gen::<f32>() * 0.01,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_is_between_two_and_four() {
        for seed in 0..200i64 {
            let n = synth_nebulae(seed).len();
            assert!((NEBULA_MIN as usize..=NEBULA_MAX as usize).contains(&n));
        }
    }

    #[test]
    fn deterministic_per_seed() {
        let a = synth_nebulae(12345);
        let b = synth_nebulae(12345);
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert!((x.position_x - y.position_x).abs() < 1e-6);
            assert!((x.radius - y.radius).abs() < 1e-6);
            assert_eq!(x.color, y.color);
        }
    }

    #[test]
    fn opacity_within_spec() {
        for seed in 0..50i64 {
            for nb in synth_nebulae(seed) {
                assert!(nb.opacity >= 0.05 && nb.opacity <= 0.06 + 1e-6);
                assert!(nb.radius >= 100.0 && nb.radius <= 350.0);
            }
        }
    }
}
