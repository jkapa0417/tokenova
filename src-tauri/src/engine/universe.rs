//! Daily universe lifecycle.
//!
//! - Each local-time day maps 1:1 to a row in `universes` keyed by date.
//! - `get_or_create_today` returns the active row, generating its seed,
//!   layout shape, palette, and nebulae on first creation.
//! - `finalize` is called at local midnight to lock the previous universe
//!   (set `galaxy_type` and `finalized_at`) and the next call to
//!   `get_or_create_today` opens a fresh one for the new date.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};

use crate::db::Db;
use crate::engine::nebula;
use crate::engine::types::{GalaxyType, Universe};

/// Six possible large-scale layout shapes. Picked deterministically per universe.
pub const LAYOUT_SHAPES: &[&str] = &[
    "spiral",
    "elliptical",
    "irregular",
    "dual_cluster",
    "scattered",
    "core_heavy",
];

/// High-level palette tags. Used for tinting choices in Phase D rendering.
pub const PALETTES: &[&str] = &[
    "violet_dawn",
    "cyan_deep",
    "rose_dust",
    "emerald_pool",
    "amber_warm",
];

/// Korean adjective + constellation pool used to derive a deterministic
/// per-universe cluster name. Examples:
/// - "고요한 안드로메다"
/// - "북쪽의 카시오페아"
/// - "에리다누스의 새벽"
const CLUSTER_ADJECTIVES: &[&str] = &[
    "빛나는",
    "잠든",
    "고요한",
    "춤추는",
    "북쪽의",
    "남쪽의",
    "깨어난",
    "어린",
    "늙은",
    "새벽의",
    "황혼의",
    "외로운",
    "별빛",
    "은빛",
    "황금빛",
    "어두운",
    "푸른",
    "붉은",
];

const CLUSTER_NOUNS: &[&str] = &[
    "안드로메다",
    "카시오페아",
    "에리다누스",
    "오리온",
    "헤라클레스",
    "백조",
    "큰곰",
    "사자",
    "용",
    "독수리",
    "전갈",
    "거문고",
    "사냥개",
    "고래",
    "페가수스",
    "센타우루스",
    "처녀",
    "물고기",
];

const CLUSTER_SUFFIXES: &[&str] = &["성단", "별자리", "은하", "성운", "회랑"];

pub fn today_date_local() -> NaiveDate {
    Local::now().date_naive()
}

/// Seconds until the next local-time midnight (always strictly positive).
pub fn seconds_until_local_midnight(now: DateTime<Local>) -> i64 {
    let tomorrow = now.date_naive().succ_opt().expect("date overflow");
    let next_midnight = tomorrow
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid")
        .and_local_timezone(Local)
        .earliest()
        .expect("local midnight is unambiguous outside DST forward jumps");
    let diff = next_midnight - now;
    diff.num_seconds().max(1)
}

/// Compute a deterministic seed from a calendar date *and* a per-install
/// random secret. Stable per install — re-rendering a past day on the
/// same machine produces the same universe — but two different installs
/// on the same day generate different seeds. Without the `user_seed`
/// argument every fresh install would land on the exact same universe
/// for any given date.
fn seed_from_date(date: NaiveDate, user_seed: u64) -> i64 {
    // Mix year/month/day with a couple of large primes — plenty for our scale.
    let y = date.year() as i64;
    let m = date.month() as i64;
    let d = date.day() as i64;
    let date_mix = y.wrapping_mul(1_000_003)
        ^ m.wrapping_mul(2_654_435_761)
        ^ d.wrapping_mul(2_246_822_519)
        ^ 0x9E37_79B9_7F4A_7C15u64 as i64;
    // Splitmix the user secret in so a tiny change in `user_seed`
    // diffuses across every bit of the resulting seed.
    let mut x = user_seed;
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    date_mix ^ (x as i64)
}

fn pick_for_seed<T: Copy>(seed: i64, options: &[T]) -> T {
    // Splitmix-style mixing then modulo. Stable across runs.
    let mut x = seed as u64;
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    options[(x as usize) % options.len()]
}

/// Get today's universe, creating it (and its nebulae) on first call of the day.
pub fn get_or_create_today(db: &Arc<Db>) -> Result<Universe> {
    let date = today_date_local();
    if let Some(existing) = db.find_universe_by_date(date)? {
        return Ok(existing);
    }

    let user_seed = db.user_seed()?;
    let seed = seed_from_date(date, user_seed);
    let layout = pick_for_seed(seed ^ 0xA1B2_C3D4, LAYOUT_SHAPES);
    let palette = pick_for_seed(seed ^ 0xDEAD_BEEF, PALETTES);
    let cluster_name = generate_cluster_name(seed);
    let universe = db.create_universe(date, seed, layout, palette, &cluster_name, Utc::now())?;
    nebula::populate_for_universe(db, &universe)?;
    Ok(universe)
}

/// Generate a deterministic Korean cluster name from a seed.
pub fn generate_cluster_name(seed: i64) -> String {
    let adj = pick_for_seed(seed ^ 0x5A5A_C3C3, CLUSTER_ADJECTIVES);
    let noun = pick_for_seed(seed ^ 0x1357_9BDF, CLUSTER_NOUNS);
    let suffix = pick_for_seed(seed ^ 0x0246_8ACE, CLUSTER_SUFFIXES);
    format!("{adj} {noun} {suffix}")
}

/// Mark a universe as finalized for the day, stamping its galaxy_type.
pub fn finalize(db: &Arc<Db>, universe: &Universe) -> Result<GalaxyType> {
    let galaxy = GalaxyType::classify(universe.star_count);
    db.finalize_universe(universe.id, galaxy, Utc::now())?;
    Ok(galaxy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn seed_is_stable_per_date_and_user() {
        let d = NaiveDate::from_ymd_opt(2026, 5, 17).unwrap();
        assert_eq!(seed_from_date(d, 0xABCD), seed_from_date(d, 0xABCD));
    }

    #[test]
    fn seeds_differ_per_date() {
        let d1 = NaiveDate::from_ymd_opt(2026, 5, 17).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        assert_ne!(seed_from_date(d1, 0xABCD), seed_from_date(d2, 0xABCD));
    }

    #[test]
    fn seeds_differ_per_user_on_same_date() {
        // Same calendar day, two different installs — the bug we just
        // fixed was that this assertion did not hold.
        let d = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        assert_ne!(seed_from_date(d, 1), seed_from_date(d, 2));
        assert_ne!(seed_from_date(d, 0), seed_from_date(d, 0xDEAD_BEEF));
    }

    #[test]
    fn pick_for_seed_is_deterministic() {
        let seed = 12345i64;
        let a = pick_for_seed(seed, LAYOUT_SHAPES);
        let b = pick_for_seed(seed, LAYOUT_SHAPES);
        assert_eq!(a, b);
    }

    #[test]
    fn next_local_midnight_is_positive() {
        let now = Local::now();
        assert!(seconds_until_local_midnight(now) > 0);
        assert!(seconds_until_local_midnight(now) <= 24 * 3600);
    }

    #[test]
    fn galaxy_classification_thresholds() {
        assert_eq!(GalaxyType::classify(0), GalaxyType::BlackHole);
        assert_eq!(GalaxyType::classify(1), GalaxyType::Nebula);
        assert_eq!(GalaxyType::classify(30), GalaxyType::Nebula);
        assert_eq!(GalaxyType::classify(31), GalaxyType::Cluster);
        assert_eq!(GalaxyType::classify(100), GalaxyType::Cluster);
        assert_eq!(GalaxyType::classify(101), GalaxyType::Galaxy);
        assert_eq!(GalaxyType::classify(300), GalaxyType::Galaxy);
        assert_eq!(GalaxyType::classify(301), GalaxyType::MegaGalaxy);
        assert_eq!(GalaxyType::classify(999), GalaxyType::MegaGalaxy);
        assert_eq!(GalaxyType::classify(1000), GalaxyType::SuperCluster);
    }
}
