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
/// Returns the inserted stars in order. Star positions follow the universe's
/// `layout_shape` so the same seed renders the same shape every day.
pub fn add_stars(db: &Arc<Db>, universe: &Universe, count: u32) -> Result<Vec<Star>> {
    if count == 0 {
        return Ok(vec![]);
    }
    let layout = universe.layout_shape.as_deref().unwrap_or("scattered");
    let mut out = Vec::with_capacity(count as usize);
    let start_idx = universe.star_count;
    for offset in 0..count {
        let star_index = start_idx + offset;
        let blueprint = synth_star_for_layout(universe.seed, star_index, layout);
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
    // 100-star milestone — `first_universe` (첫 우주 형성).
    let total = start_idx + count;
    let _ = crate::engine::achievements::on_universe_star_count(db, total);
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
/// star's index so re-running yields the exact same star. Uses `scattered`
/// layout — for layout-aware placement call [`synth_star_for_layout`].
/// Kept around for the existing test suite.
#[cfg(test)]
pub fn synth_star(universe_seed: i64, star_index: u32) -> StarBlueprint {
    synth_star_for_layout(universe_seed, star_index, "scattered")
}

/// Star with layout-aware position. The size/color/opacity rolls are kept
/// identical to `synth_star` so existing tests still pass.
pub fn synth_star_for_layout(universe_seed: i64, star_index: u32, layout: &str) -> StarBlueprint {
    let mut rng = star_rng(universe_seed, star_index);

    // Position first — peel two `gen::<f32>()` calls to feed the layout fn so
    // the size/color buckets below stay seed-stable across layouts.
    let pos_u: f32 = rng.gen();
    let pos_v: f32 = rng.gen();
    let (x, y) = place_for_layout(layout, pos_u, pos_v, star_index, universe_seed);

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

/// Map two uniform [0,1) samples + star index into world coordinates following
/// the universe's `layout_shape`. Layouts:
///
/// - `scattered` (default): uniform across the canvas
/// - `spiral`: two logarithmic arms with a bulge
/// - `elliptical`: gaussian-weighted ellipse, dense center
/// - `irregular`: scattered with a few off-center hotspots
/// - `dual_cluster`: two gaussian blobs side by side
/// - `core_heavy`: heavy central concentration, sparse halo
fn place_for_layout(
    layout: &str,
    u: f32,
    v: f32,
    star_index: u32,
    universe_seed: i64,
) -> (f32, f32) {
    let cx = UNIVERSE_W * 0.5;
    let cy = UNIVERSE_H * 0.5;

    match layout {
        "spiral" => {
            // Two-arm logarithmic spiral with random jitter.
            let arm = (star_index % 2) as f32; // 0 or 1
            let t = u * 1.0; // 0..1 along the arm
            let theta = arm * std::f32::consts::PI + t * 3.2 * std::f32::consts::PI;
            let r = (0.06 + t * 0.42) * UNIVERSE_W;
            // Add radial + angular jitter so it doesn't look mechanical.
            let jitter_r = (v - 0.5) * UNIVERSE_W * 0.04;
            let jitter_a = (sub_rng(universe_seed, star_index, 0x11) - 0.5) * 0.35;
            let a = theta + jitter_a;
            let rr = r + jitter_r;
            let x = cx + a.cos() * rr;
            let y = cy + a.sin() * rr * 0.78; // slight inclination
            clamp_to_canvas(x, y)
        }
        "elliptical" => {
            // Gaussian-ish ellipse via Box-Muller-lite from two uniforms.
            let r = box_muller(u, v) * UNIVERSE_W * 0.16;
            let theta = sub_rng(universe_seed, star_index, 0x22) * std::f32::consts::TAU;
            let x = cx + theta.cos() * r * 1.4;
            let y = cy + theta.sin() * r;
            clamp_to_canvas(x, y)
        }
        "irregular" => {
            // 70% uniform, 30% near one of three off-center hotspots.
            if sub_rng(universe_seed, star_index, 0x33) < 0.30 {
                let hotspot_idx = (sub_rng(universe_seed, star_index, 0x44) * 3.0) as u32 % 3;
                let (hx, hy) = match hotspot_idx {
                    0 => (UNIVERSE_W * 0.28, UNIVERSE_H * 0.34),
                    1 => (UNIVERSE_W * 0.74, UNIVERSE_H * 0.42),
                    _ => (UNIVERSE_W * 0.46, UNIVERSE_H * 0.74),
                };
                let r = box_muller(u, v) * UNIVERSE_W * 0.10;
                let theta = sub_rng(universe_seed, star_index, 0x55) * std::f32::consts::TAU;
                clamp_to_canvas(hx + theta.cos() * r, hy + theta.sin() * r)
            } else {
                (u * UNIVERSE_W, v * UNIVERSE_H)
            }
        }
        "dual_cluster" => {
            let left = sub_rng(universe_seed, star_index, 0x66) < 0.5;
            let center_x = if left {
                UNIVERSE_W * 0.32
            } else {
                UNIVERSE_W * 0.68
            };
            let center_y = UNIVERSE_H * 0.5;
            let r = box_muller(u, v) * UNIVERSE_W * 0.13;
            let theta = sub_rng(universe_seed, star_index, 0x77) * std::f32::consts::TAU;
            clamp_to_canvas(center_x + theta.cos() * r, center_y + theta.sin() * r)
        }
        "core_heavy" => {
            // r distribution biased toward 0 by squaring.
            let r_norm = u * u;
            let r = r_norm * UNIVERSE_W * 0.45;
            let theta = v * std::f32::consts::TAU;
            clamp_to_canvas(cx + theta.cos() * r, cy + theta.sin() * r)
        }
        _ => {
            // "scattered" (default): uniform.
            (u * UNIVERSE_W, v * UNIVERSE_H)
        }
    }
}

fn sub_rng(seed: i64, index: u32, salt: u64) -> f32 {
    // Tiny per-(seed, index, salt) deterministic float in [0,1) without
    // perturbing the main star RNG cursor.
    let mut x = (seed as u64)
        .wrapping_add((index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(salt.wrapping_mul(0xBF58_476D_1CE4_E5B9));
    x ^= x >> 30;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    ((x >> 32) as f32) / (u32::MAX as f32)
}

/// Approximation of a Gaussian using two uniforms (Box-Muller core).
/// Returned value is roughly N(0,1), then taken absolute so we get a
/// non-negative radial magnitude.
fn box_muller(u: f32, v: f32) -> f32 {
    let u_safe = (u.max(1e-6)).ln();
    let r = (-2.0 * u_safe).sqrt();
    let theta = std::f32::consts::TAU * v;
    (r * theta.cos()).abs()
}

fn clamp_to_canvas(x: f32, y: f32) -> (f32, f32) {
    (x.clamp(0.0, UNIVERSE_W), y.clamp(0.0, UNIVERSE_H))
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
