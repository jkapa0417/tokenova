//! Planet discovery.
//!
//! Triggered when a session closes with ≥ [`PLANET_SESSION_THRESHOLD`] tokens.
//! Steps:
//! 1. Check daily cap (mythic excluded).
//! 2. Roll rarity using weighted distribution (70/20/8/1.9/0.1).
//! 3. Pick a planet within that rarity uniformly.
//! 4. Find an empty world-space position (≥ `MIN_SPACING` from any star or
//!    existing planet). Falls back to the best candidate after `MAX_ATTEMPTS`.
//! 5. Persist + record codex entry.

use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use rand::Rng;
use rand_pcg::Pcg32;

use crate::db::Db;
use crate::engine::catalog;
use crate::engine::types::{Planet, Rarity, Universe, DAILY_PLANET_CAP, UNIVERSE_H, UNIVERSE_W};

// Used by Phase D rendering — radius bounds for procedural planet generation.
#[allow(dead_code)]
const PLANET_RADIUS_MIN: f32 = 12.0;
#[allow(dead_code)]
const PLANET_RADIUS_MAX: f32 = 30.0;
const MIN_SPACING_FROM_STAR: f32 = 18.0;
// At zoom 1 the pin sprite (planet + halo) is roughly 38 CSS px in diameter,
// which is ~76 world units (SCALE = 0.5). Spacing under that lets pins
// visually overlap. 90 keeps a comfortable gap between any two discs.
const MIN_SPACING_FROM_PLANET: f32 = 90.0;
// World-space margin so the DOM pin sprite (planet + halo + NEW badge) stays
// fully visible after the canvas is letterboxed/stretched to fit the wrap.
// Pin sprite is ~38 CSS px at zoom 1; on a 280 px wrap that's ~13 % of width,
// i.e. ~125 world units. 120 keeps a small safety buffer.
const EDGE_MARGIN: f32 = 120.0;
// Today's HUD covers the bottom ~30 % of the universe-wrap. Keeping a
// larger bottom inset means new planets never land where the HUD readout
// will obscure them — the client-side cull catches stragglers from old
// saved data but new placements stay readable.
const BOTTOM_MARGIN: f32 = 260.0;
const MAX_ATTEMPTS: usize = 200;

#[derive(Debug, Clone)]
pub enum PlanetTriggerOutcome {
    Discovered(Planet),
    /// Eligible by tokens but rejected because daily cap is exhausted.
    CapReached,
    /// Roll landed on a planet whose rarity slot is full (rare for mythic).
    Skipped {
        #[allow(dead_code)]
        rarity: Rarity,
    },
}

pub fn discover_for_session(
    db: &Arc<Db>,
    universe: &Universe,
    session_id: i64,
    session_total_tokens: u64,
) -> Result<PlanetTriggerOutcome> {
    let today_discoveries = db.count_today_planets(universe.id)?;
    if today_discoveries >= DAILY_PLANET_CAP {
        return Ok(PlanetTriggerOutcome::CapReached);
    }

    // Seed mixes universe seed + session id + total tokens — same trigger,
    // same outcome, but different sessions produce different planets.
    let seed = mix_seed(universe.seed, session_id, session_total_tokens);
    let mut rng = Pcg32::new(seed as u64, 0xF00D_FACE_BABE_CAFE);

    let rarity = roll_rarity(&mut rng);
    let pool = catalog::planets_of(rarity);
    if pool.is_empty() {
        return Ok(PlanetTriggerOutcome::Skipped { rarity });
    }
    let spec = pool[rng.gen_range(0..pool.len())];

    let stars = db.list_stars(universe.id)?;
    let existing_planets = db.list_planets(universe.id)?;

    let (px, py) = find_empty_position(&mut rng, &stars, &existing_planets);

    let planet = Planet {
        id: 0,
        universe_id: universe.id,
        planet_type: spec.key.to_string(),
        rarity,
        seed,
        discovered_at: Utc::now(),
        triggering_session_id: Some(session_id),
        position_x: px,
        position_y: py,
        user_note: None,
        acknowledged_at: None,
    };
    let inserted_id = db.insert_planet(&planet)?;
    db.codex_record_discovery(spec.key, rarity, Utc::now())?;

    let mut stored = planet;
    stored.id = inserted_id;
    Ok(PlanetTriggerOutcome::Discovered(stored))
}

fn mix_seed(universe_seed: i64, session_id: i64, total_tokens: u64) -> i64 {
    let mut x = universe_seed as u64;
    x ^= (session_id as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= total_tokens;
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (x ^ (x >> 31)) as i64
}

pub fn roll_rarity<R: Rng>(rng: &mut R) -> Rarity {
    let roll: f64 = rng.gen::<f64>() * 100.0;
    let mut acc = 0.0;
    for r in [
        Rarity::Common,
        Rarity::Rare,
        Rarity::Epic,
        Rarity::Legendary,
        Rarity::Mythic,
    ] {
        acc += catalog::rarity_weight(r);
        if roll < acc {
            return r;
        }
    }
    Rarity::Common // numerical edge case fallback
}

/// Find a position with enough breathing room. Stars near a candidate cost
/// less than another planet, so common-rarity planets can still squeeze into
/// dense universes while planets never overlap each other.
pub(crate) fn find_empty_position<R: Rng>(
    rng: &mut R,
    stars: &[crate::engine::types::Star],
    planets: &[Planet],
) -> (f32, f32) {
    // Best candidate that already meets MIN_SPACING_FROM_PLANET — used when
    // no candidate also clears the star-spacing bar.
    let mut best_with_gap: Option<(f32, f32, f32)> = None;
    // Roomiest candidate by planet-distance regardless of any threshold —
    // saves a tightly-packed universe from the random-overlap fallback.
    let mut roomiest: Option<(f32, f32, f32)> = None;

    for _ in 0..MAX_ATTEMPTS {
        let x = EDGE_MARGIN + rng.gen::<f32>() * (UNIVERSE_W - 2.0 * EDGE_MARGIN);
        let y = EDGE_MARGIN + rng.gen::<f32>() * (UNIVERSE_H - EDGE_MARGIN - BOTTOM_MARGIN);

        let nearest_planet = planets
            .iter()
            .map(|p| ((p.position_x - x).powi(2) + (p.position_y - y).powi(2)).sqrt())
            .fold(f32::INFINITY, f32::min);

        // Always track the roomiest by planet distance so the fallback is
        // never a literal random splat that lands on top of another disc.
        match roomiest {
            Some((_, _, rd)) if rd >= nearest_planet => {}
            _ => roomiest = Some((x, y, nearest_planet)),
        }

        if nearest_planet < MIN_SPACING_FROM_PLANET {
            continue;
        }

        let nearest_star = stars
            .iter()
            .map(|s| ((s.position_x - x).powi(2) + (s.position_y - y).powi(2)).sqrt())
            .fold(f32::INFINITY, f32::min);

        if nearest_star >= MIN_SPACING_FROM_STAR {
            return (x, y);
        }

        match best_with_gap {
            Some((_, _, bs)) if bs >= nearest_star => {}
            _ => best_with_gap = Some((x, y, nearest_star)),
        }
    }

    if let Some((x, y, _)) = best_with_gap {
        return (x, y);
    }
    if let Some((x, y, _)) = roomiest {
        return (x, y);
    }
    // Empty universe (no planets yet, no roomiest tracked) — any in-bounds
    // point is safe.
    (
        EDGE_MARGIN + rng.gen::<f32>() * (UNIVERSE_W - 2.0 * EDGE_MARGIN),
        EDGE_MARGIN + rng.gen::<f32>() * (UNIVERSE_H - EDGE_MARGIN - BOTTOM_MARGIN),
    )
}

/// Procedural radius helper (used by Phase D render, kept here so tests can
/// confirm the bounds). Returns a per-planet radius derived from its seed.
#[allow(dead_code)]
pub fn planet_radius(seed: i64) -> f32 {
    let mut rng = Pcg32::new(seed as u64, 0xBADC_0FFE);
    PLANET_RADIUS_MIN + rng.gen::<f32>() * (PLANET_RADIUS_MAX - PLANET_RADIUS_MIN)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_rng(seed: u64) -> Pcg32 {
        Pcg32::new(seed, 0xC0FFEE)
    }

    #[test]
    fn rarity_distribution_within_tolerance() {
        let mut rng = seeded_rng(7);
        let mut counts = [0u64; 5];
        let n = 100_000;
        for _ in 0..n {
            match roll_rarity(&mut rng) {
                Rarity::Common => counts[0] += 1,
                Rarity::Rare => counts[1] += 1,
                Rarity::Epic => counts[2] += 1,
                Rarity::Legendary => counts[3] += 1,
                Rarity::Mythic => counts[4] += 1,
            }
        }
        let nf = n as f64;
        assert!((counts[0] as f64 / nf - 0.70).abs() < 0.01);
        assert!((counts[1] as f64 / nf - 0.20).abs() < 0.01);
        assert!((counts[2] as f64 / nf - 0.08).abs() < 0.01);
        // Legendary 1.9 % — wider tolerance
        assert!((counts[3] as f64 / nf - 0.019).abs() < 0.005);
        // Mythic 0.1 % — at 100k samples ±0.001 tolerance
        assert!((counts[4] as f64 / nf - 0.001).abs() < 0.001);
    }

    #[test]
    fn empty_position_respects_planet_spacing() {
        let mut rng = seeded_rng(13);
        let stars: Vec<crate::engine::types::Star> = vec![];
        let mut planets: Vec<Planet> = vec![];
        for i in 0..6 {
            let (x, y) = find_empty_position(&mut rng, &stars, &planets);
            for prev in &planets {
                let d = ((prev.position_x - x).powi(2) + (prev.position_y - y).powi(2)).sqrt();
                assert!(
                    d >= MIN_SPACING_FROM_PLANET - 0.5,
                    "planet {i} too close: {d:.2}"
                );
            }
            planets.push(Planet {
                id: i as i64,
                universe_id: 1,
                planet_type: "x".into(),
                rarity: Rarity::Common,
                seed: i,
                discovered_at: Utc::now(),
                triggering_session_id: None,
                position_x: x,
                position_y: y,
                user_note: None,
                acknowledged_at: None,
            });
        }
    }

    #[test]
    fn mix_seed_changes_with_inputs() {
        assert_ne!(mix_seed(1, 1, 5_000), mix_seed(1, 2, 5_000));
        assert_ne!(mix_seed(1, 1, 5_000), mix_seed(2, 1, 5_000));
        assert_ne!(mix_seed(1, 1, 5_000), mix_seed(1, 1, 6_000));
    }
}
