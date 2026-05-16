//! Desktop notification dispatch with a 3-level policy and per-day cap.
//!
//! - `Policy::Off` — never notify.
//! - `Policy::Standard` — only the milestones the user actually wants to know
//!   about: rare+ planet discoveries, achievements, first 100 stars of the
//!   day, daily cap reached.
//! - `Policy::Verbose` — everything above plus common-rarity planet
//!   discoveries.
//!
//! A daily cap of [`DAILY_CAP`] silences further notifications once tripped so
//! the user is never flooded.

use std::sync::Mutex;

use chrono::{Local, NaiveDate};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::engine::types::{GalaxyType, Rarity};

pub const DAILY_CAP: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    #[allow(dead_code)]
    Off,
    Standard,
    #[allow(dead_code)]
    Verbose,
}

pub struct Notifier {
    state: Mutex<State>,
}

#[derive(Debug)]
struct State {
    policy: Policy,
    sent_today: u32,
    /// The local-date for which `sent_today` is valid; rolls over at midnight.
    counter_date: NaiveDate,
}

impl Notifier {
    pub fn new(policy: Policy) -> Self {
        Self {
            state: Mutex::new(State {
                policy,
                sent_today: 0,
                counter_date: Local::now().date_naive(),
            }),
        }
    }

    pub fn planet_discovered(&self, app: &AppHandle, planet_name: &str, rarity: Rarity) {
        let visible_at_standard = !matches!(rarity, Rarity::Common);
        if !self.allowed(visible_at_standard) {
            return;
        }
        let title = match rarity {
            Rarity::Mythic => "신화 행성 발견!",
            Rarity::Legendary => "전설 행성 발견!",
            Rarity::Epic => "에픽 행성 발견",
            Rarity::Rare => "희귀 행성 발견",
            Rarity::Common => "행성 발견",
        };
        self.send(app, title, planet_name);
    }

    pub fn achievement_earned(&self, app: &AppHandle, display_name: &str) {
        if !self.allowed(true) {
            return;
        }
        self.send(app, "업적 달성", display_name);
    }

    /// Fires when the live universe crosses the 100-star "은하 등급" boundary.
    pub fn universe_milestone(&self, app: &AppHandle, star_count: u32) {
        if !self.allowed(true) {
            return;
        }
        self.send(
            app,
            "오늘의 우주",
            &format!("별 {star_count}개 — 은하 형성"),
        );
    }

    pub fn universe_finalized(&self, app: &AppHandle, galaxy: GalaxyType) {
        if !self.allowed(true) {
            return;
        }
        let body = match galaxy {
            GalaxyType::BlackHole => "블랙홀의 날",
            GalaxyType::Nebula => "성운으로 마감",
            GalaxyType::Cluster => "별무리로 마감",
            GalaxyType::Galaxy => "은하로 마감",
            GalaxyType::MegaGalaxy => "거대 은하 달성",
            GalaxyType::SuperCluster => "초은하단 — 최고 등급!",
        };
        self.send(app, "오늘의 우주 마감", body);
    }

    fn allowed(&self, standard_visible: bool) -> bool {
        let mut state = self.state.lock().expect("notifier poisoned");
        self.refresh_counter(&mut state);

        let policy = state.policy;
        match policy {
            Policy::Off => return false,
            Policy::Standard => {
                if !standard_visible {
                    return false;
                }
            }
            Policy::Verbose => {}
        }

        if state.sent_today >= DAILY_CAP {
            return false;
        }
        state.sent_today += 1;
        true
    }

    fn refresh_counter(&self, state: &mut State) {
        let today = Local::now().date_naive();
        if today != state.counter_date {
            state.counter_date = today;
            state.sent_today = 0;
        }
    }

    fn send(&self, app: &AppHandle, title: &str, body: &str) {
        let result = app.notification().builder().title(title).body(body).show();
        if let Err(e) = result {
            eprintln!("[notifier] failed to show notification: {e:#}");
        }
    }

    /// Allow Phase E settings UI to flip the policy at runtime. Currently
    /// unused but kept for future wiring.
    #[allow(dead_code)]
    pub fn set_policy(&self, policy: Policy) {
        self.state.lock().expect("notifier poisoned").policy = policy;
    }
}
