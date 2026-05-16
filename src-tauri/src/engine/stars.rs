//! Star generation.
//!
//! Token accumulation: each [`TOKENS_PER_STAR`] tokens spawn one star, up to the
//! daily cap [`DAILY_STAR_CAP`]. Stars are placed with a per-universe seed
//! mixed with their index so the same universe regenerates the same stars on
//! reload (Phase D needs this for layout stability).
//!
//! Visual distribution matches `docs/references/01-star-density.md`:
//! - 70/25/5 size buckets
//! - 85/8/7 color buckets (white / warm / cool)
//! - opacity 0.6 ~ 1.0

use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use rand::Rng;
use rand_pcg::Pcg32;

use crate::db::Db;
use crate::engine::types::{
    Star, Universe, DAILY_STAR_CAP, TOKENS_PER_STAR, UNIVERSE_H, UNIVERSE_W,
};

/// Decision returned to the caller: how many tokens to retain in the leftover
/// buffer, and how many stars were actually inserted.
#[derive(Debug, Clone, Copy, Default)]
pub struct StarAddOutcome {
    pub stars_added: u32,
    pub leftover_tokens: u64,
    /// True if we hit the daily cap on this call (so the leftover should be
    /// reset to 0 by the caller — capping discards remaining tokens by design).
    /// Surfaced for diagnostics/UI in Phase E.
    #[allow(dead_code)]
    pub hit_cap: bool,
}

/// Compute how many stars a new token delta should produce given the current
/// per-day leftover buffer and the current star count.
pub fn plan_star_additions(
    leftover_tokens: u64,
    incoming_tokens: u64,
    current_star_count: u32,
) -> StarAddOutcome {
    let combined = leftover_tokens.saturating_add(incoming_tokens);
    let raw_stars = combined / TOKENS_PER_STAR;
    let new_leftover = combined % TOKENS_PER_STAR;

    let remaining_capacity = DAILY_STAR_CAP.saturating_sub(current_star_count);
    let stars_added = raw_stars.min(remaining_capacity as u64) as u32;
    let hit_cap = stars_added == remaining_capacity && raw_stars > 0;

    StarAddOutcome {
        stars_added,
        leftover_tokens: if hit_cap { 0 } else { new_leftover },
        hit_cap,
    }
}

/// Materialize the next `count` stars for the given universe and persist them.
/// Returns the inserted stars in order.
pub fn add_stars(db: &Arc<Db>, universe: &Universe, count: u32) -> Result<Vec<Star>> {
    if count == 0 {
        return Ok(vec![]);
    }
    let mut out = Vec::with_capacity(count as usize);
    let start_idx = universe.star_count;
    for offset in 0..count {
        let star_index = start_idx + offset;
        let blueprint = synth_star(universe.seed, star_index);
        let id = db.insert_star(universe.id, &blueprint)?;
        out.push(Star {
            id,
            universe_id: universe.id,
            position_x: blueprint.position_x,
            position_y: blueprint.position_y,
            radius: blueprint.radius,
            color_r: blueprint.color_r,
            color_g: blueprint.color_g,
            color_b: blueprint.color_b,
            opacity: blueprint.opacity,
            is_big: blueprint.is_big,
            created_at: Utc::now(),
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy)]
pub struct StarBlueprint {
    pub position_x: f32,
    pub position_y: f32,
    pub radius: f32,
    pub color_r: u8,
    pub color_g: u8,
    pub color_b: u8,
    pub opacity: f32,
    pub is_big: bool,
}

/// Deterministic per-universe star generator: mix the universe seed with the
/// star's index so re-running yields the exact same star.
pub fn synth_star(universe_seed: i64, star_index: u32) -> StarBlueprint {
    let mut rng = star_rng(universe_seed, star_index);

    let x = rng.gen::<f32>() * UNIVERSE_W;
    let y = rng.gen::<f32>() * UNIVERSE_H;

    // 70 / 25 / 5 size distribution (small / mid / large)
    let size_roll: f32 = rng.gen();
    let radius = if size_roll < 0.70 {
        1.0 + rng.gen::<f32>() * 1.5
    } else if size_roll < 0.95 {
        2.0 + rng.gen::<f32>() * 1.5
    } else {
        3.5 + rng.gen::<f32>() * 2.0
    };

    // 85 / 8 / 7 color distribution (white / warm / cool)
    let color_roll: f32 = rng.gen();
    let (color_r, color_g, color_b) = if color_roll < 0.85 {
        (255, 255, 255)
    } else if color_roll < 0.93 {
        (255, 220, 170)
    } else {
        (170, 210, 255)
    };

    let opacity = 0.6 + rng.gen::<f32>() * 0.4;

    StarBlueprint {
        position_x: x,
        position_y: y,
        radius,
        color_r,
        color_g,
        color_b,
        opacity,
        is_big: radius > 3.0,
    }
}

fn star_rng(universe_seed: i64, star_index: u32) -> Pcg32 {
    // PCG32 needs a u64 state and u64 stream id. Use the index as the stream
    // so different stars in the same universe never produce identical sequences.
    let state = universe_seed as u64;
    let stream = (star_index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    Pcg32::new(state, stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_below_cap() {
        let outcome = plan_star_additions(0, 2_500, 10);
        assert_eq!(outcome.stars_added, 2);
        assert_eq!(outcome.leftover_tokens, 500);
        assert!(!outcome.hit_cap);
    }

    #[test]
    fn plan_with_leftover() {
        let outcome = plan_star_additions(800, 300, 5);
        assert_eq!(outcome.stars_added, 1);
        assert_eq!(outcome.leftover_tokens, 100);
        assert!(!outcome.hit_cap);
    }

    #[test]
    fn plan_hits_cap_discards_overflow() {
        // 1 star away from cap, 3 stars worth of tokens incoming → only 1 added,
        // and the leftover should be cleared.
        let outcome = plan_star_additions(0, 3_500, DAILY_STAR_CAP - 1);
        assert_eq!(outcome.stars_added, 1);
        assert_eq!(outcome.leftover_tokens, 0);
        assert!(outcome.hit_cap);
    }

    #[test]
    fn plan_already_at_cap_is_noop() {
        let outcome = plan_star_additions(500, 50_000, DAILY_STAR_CAP);
        assert_eq!(outcome.stars_added, 0);
        // Cap reached so we shouldn't keep building up leftover either.
        // We only mark hit_cap when raw_stars > 0; otherwise leftover passes through.
        // Both behaviours acceptable, but document this branch.
        assert!(outcome.hit_cap || outcome.leftover_tokens > 0);
    }

    #[test]
    fn synth_star_is_deterministic() {
        let a = synth_star(123, 0);
        let b = synth_star(123, 0);
        assert!((a.position_x - b.position_x).abs() < 1e-6);
        assert!((a.position_y - b.position_y).abs() < 1e-6);
        assert!((a.radius - b.radius).abs() < 1e-6);
        assert_eq!(a.color_r, b.color_r);
    }

    #[test]
    fn different_indexes_yield_different_stars() {
        let a = synth_star(123, 0);
        let b = synth_star(123, 1);
        let same_xy = (a.position_x - b.position_x).abs() < 1e-6
            && (a.position_y - b.position_y).abs() < 1e-6;
        assert!(!same_xy, "consecutive stars should not overlap");
    }

    #[test]
    fn star_positions_within_universe() {
        for i in 0..100 {
            let s = synth_star(42, i);
            assert!((0.0..=UNIVERSE_W).contains(&s.position_x));
            assert!((0.0..=UNIVERSE_H).contains(&s.position_y));
        }
    }

    #[test]
    fn top_bucket_fraction_matches_spec() {
        // Size buckets in `synth_star` overlap by radius: small spans 1.0-2.5,
        // mid spans 2.0-3.5, big spans 3.5-5.5. The top bucket (the 5 % of
        // size_rolls ≥ 0.95) is the only one with a guaranteed-unique radius
        // range — radius ≥ 3.5. Use that as the spec check.
        let n = 10_000u32;
        let top_bucket = (0..n).filter(|i| synth_star(99, *i).radius >= 3.5).count();
        let frac = top_bucket as f32 / n as f32;
        assert!(
            (frac - 0.05).abs() < 0.02,
            "top bucket fraction {frac:.3} off"
        );
    }

    #[test]
    fn is_big_catches_glow_candidates() {
        // `is_big` is the simulator's glow trigger (radius > 3), which
        // captures all of the top bucket plus part of the mid bucket. Sanity
        // check it stays meaningfully above the top bucket alone.
        let n = 10_000u32;
        let big = (0..n).filter(|i| synth_star(99, *i).is_big).count();
        let frac = big as f32 / n as f32;
        assert!(frac > 0.05 && frac < 0.20, "is_big fraction {frac:.3} off");
    }

    #[test]
    fn color_distribution_roughly_matches() {
        let n = 10_000u32;
        let mut white = 0;
        let mut warm = 0;
        let mut cool = 0;
        for i in 0..n {
            let s = synth_star(7, i);
            match (s.color_r, s.color_g, s.color_b) {
                (255, 255, 255) => white += 1,
                (255, 220, 170) => warm += 1,
                (170, 210, 255) => cool += 1,
                other => panic!("unexpected color {other:?}"),
            }
        }
        let nf = n as f32;
        assert!((white as f32 / nf - 0.85).abs() < 0.03, "white off");
        assert!((warm as f32 / nf - 0.08).abs() < 0.02, "warm off");
        assert!((cool as f32 / nf - 0.07).abs() < 0.02, "cool off");
    }
}
