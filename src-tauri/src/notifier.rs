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

use std::sync::{Arc, Mutex};

use chrono::{Local, NaiveDate};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::db::Db;
use crate::engine::types::{GalaxyType, Rarity};
use crate::i18n;

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
    /// DB handle used to look up the current `locale` setting on each emit so
    /// notification text stays in sync with the UI language without needing
    /// any extra channel between front and back.
    db: Arc<Db>,
}

#[derive(Debug)]
struct State {
    policy: Policy,
    sent_today: u32,
    /// The local-date for which `sent_today` is valid; rolls over at midnight.
    counter_date: NaiveDate,
}

impl Notifier {
    pub fn new(db: Arc<Db>, policy: Policy) -> Self {
        Self {
            db,
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
        let locale = i18n::current_locale(&self.db);
        self.send(app, i18n::planet_rarity_title(locale, rarity), planet_name);
    }

    pub fn achievement_earned(&self, app: &AppHandle, key_or_display: &str) {
        if !self.allowed(true) {
            return;
        }
        let locale = i18n::current_locale(&self.db);
        // The engine currently passes the engine's display_name (Korean) here;
        // re-translate from the key when we can recognise it, otherwise just
        // emit whatever string was handed in.
        let body = i18n::achievement_display_name(locale, key_or_display);
        let body_str: &str = if body == "??" { key_or_display } else { body };
        self.send(app, i18n::achievement_earned_title(locale), body_str);
    }

    /// Fires when the live universe crosses the 100-star "은하 등급" boundary.
    pub fn universe_milestone(&self, app: &AppHandle, star_count: u32) {
        if !self.allowed(true) {
            return;
        }
        let locale = i18n::current_locale(&self.db);
        self.send(
            app,
            i18n::todays_universe_title(locale),
            &i18n::galaxy_formed_body(locale, star_count),
        );
    }

    pub fn universe_finalized(&self, app: &AppHandle, galaxy: GalaxyType) {
        if !self.allowed(true) {
            return;
        }
        let locale = i18n::current_locale(&self.db);
        self.send(
            app,
            i18n::universe_finalized_title(locale),
            i18n::galaxy_type_finalize_body(locale, galaxy),
        );
    }

    fn allowed(&self, standard_visible: bool) -> bool {
        // Settings → "알림 받기" toggle. The user can flip this from the UI
        // at any time; checking on each emit means we never have to invalidate
        // a cached value. DB hit is microseconds vs the OS notification dispatch.
        if !self.db.notification_enabled().unwrap_or(true) {
            return false;
        }

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
