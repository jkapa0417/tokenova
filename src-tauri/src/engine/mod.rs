pub mod achievements;
pub mod catalog;
pub mod codex;
pub mod nebula;
pub mod planets;
pub mod stars;
pub mod types;
pub mod universe;

use std::sync::Arc;

use anyhow::Result;
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex};
use tokio::time::{sleep, Duration};

use crate::db::{Db, TokenEvent};
use crate::engine::types::{Star, Universe, UniversePayload};
use crate::notifier::Notifier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosedSession {
    pub session_id: i64,
    pub total_tokens: u64,
}

/// Engine state shared across event loops. Wrapped in `Arc<Mutex<...>>` so the
/// token-event handler and the session-closed handler can update it safely.
struct State {
    universe: Universe,
    /// Leftover tokens accumulated today but not yet enough for a star.
    /// Persisted only implicitly through the star count — on restart this
    /// resets to 0 (we treat them as already-spent for the day).
    leftover_tokens: u64,
    /// Sum of all tokens recorded today. Useful for the UI even before stars accumulate.
    today_tokens: u64,
    today_date: NaiveDate,
}

pub struct Engine {
    db: Arc<Db>,
    state: Mutex<State>,
    app: AppHandle,
    notifier: Arc<Notifier>,
}

impl Engine {
    pub fn bootstrap(db: Arc<Db>, app: AppHandle, notifier: Arc<Notifier>) -> Result<Arc<Self>> {
        let universe = universe::get_or_create_today(&db)?;
        let today_date = universe.date;
        // On startup, recompute today's tokens so the UI shows the truth even
        // before any new events arrive.
        let today_tokens = sum_today_tokens(&db, today_date)?;
        Ok(Arc::new(Self {
            db,
            state: Mutex::new(State {
                universe,
                leftover_tokens: 0,
                today_tokens,
                today_date,
            }),
            app,
            notifier,
        }))
    }

    fn notify_achievements(&self, earned: &achievements::EarnedAchievements) {
        for key in &earned.0 {
            // Pass the achievement key directly; notifier looks up the
            // localised display name based on the current `locale` setting.
            self.notifier.achievement_earned(&self.app, key);
            let _ = self.app.emit("achievement_earned", key);
        }
    }

    pub fn spawn(
        self: Arc<Self>,
        token_events: broadcast::Receiver<TokenEvent>,
        session_closed: broadcast::Receiver<ClosedSession>,
    ) {
        let token_consumer = self.clone();
        tauri::async_runtime::spawn(token_consumer.run_token_loop(token_events));

        let session_consumer = self.clone();
        tauri::async_runtime::spawn(session_consumer.run_session_loop(session_closed));

        let midnight_consumer = self.clone();
        tauri::async_runtime::spawn(midnight_consumer.run_midnight_loop());
    }

    async fn run_token_loop(self: Arc<Self>, mut rx: broadcast::Receiver<TokenEvent>) {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Err(e) = self.on_token_event(event).await {
                        eprintln!("[engine] on_token_event: {e:#}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("[engine] token broadcast lagged, skipped {skipped}");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    async fn run_session_loop(self: Arc<Self>, mut rx: broadcast::Receiver<ClosedSession>) {
        loop {
            match rx.recv().await {
                Ok(closed) => {
                    if let Err(e) = self.on_session_closed(closed).await {
                        eprintln!("[engine] on_session_closed: {e:#}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("[engine] session broadcast lagged, skipped {skipped}");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    async fn run_midnight_loop(self: Arc<Self>) {
        loop {
            let secs = universe::seconds_until_local_midnight(Local::now());
            sleep(Duration::from_secs(secs as u64)).await;
            if let Err(e) = self.rollover_at_midnight().await {
                eprintln!("[engine] midnight rollover: {e:#}");
                // Brief pause to avoid a tight error loop.
                sleep(Duration::from_secs(60)).await;
            }
        }
    }

    async fn on_token_event(&self, event: TokenEvent) -> Result<()> {
        let total = event.total();
        if total == 0 {
            return Ok(());
        }

        let mut state = self.state.lock().await;
        self.refresh_date_if_needed(&mut state).await?;

        let universe = state.universe.clone();
        let outcome = stars::plan_star_additions(state.leftover_tokens, total, universe.star_count);

        if outcome.stars_added > 0 {
            let inserted = stars::add_stars(&self.db, &universe, outcome.stars_added)?;
            // Mark first-star achievement if this is our first star ever.
            if universe.star_count == 0 && !inserted.is_empty() {
                let earned = achievements::on_first_star(&self.db)?;
                self.notify_achievements(&earned);
            }
            let before = universe.star_count;
            let after = before + outcome.stars_added;
            state.universe.star_count = after;
            self.db
                .bump_universe_star_count(state.universe.id, outcome.stars_added)?;
            // First time crossing the "은하 형성" boundary (100 stars) today.
            if before < 100 && after >= 100 {
                self.notifier.universe_milestone(&self.app, after);
            }
            // Push the freshly inserted stars to the frontend so the canvas
            // updates without waiting for the next poll.
            let _ = self.app.emit("stars_added", &inserted);
        }
        state.leftover_tokens = outcome.leftover_tokens;
        state.today_tokens = state.today_tokens.saturating_add(total);

        Ok(())
    }

    async fn on_session_closed(&self, closed: ClosedSession) -> Result<()> {
        if closed.total_tokens < types::PLANET_SESSION_THRESHOLD {
            return Ok(());
        }
        let mut state = self.state.lock().await;
        self.refresh_date_if_needed(&mut state).await?;
        let universe = state.universe.clone();
        drop(state); // release lock before DB work that doesn't touch state

        let outcome = planets::discover_for_session(
            &self.db,
            &universe,
            closed.session_id,
            closed.total_tokens,
        )?;
        if let planets::PlanetTriggerOutcome::Discovered(planet) = &outcome {
            let earned = achievements::on_planet_discovered(&self.db, planet.rarity)?;
            self.notify_achievements(&earned);

            let ko_default = catalog::lookup(&planet.planet_type)
                .map(|s| s.display_name)
                .unwrap_or(planet.planet_type.as_str());
            let locale = crate::i18n::current_locale(&self.db);
            let display =
                crate::i18n::planet_display_name(locale, &planet.planet_type, ko_default);
            self.notifier
                .planet_discovered(&self.app, display, planet.rarity);
            // Push to frontend so the discovery overlay can open immediately
            // (only while the popover is actually showing — listen is no-op when closed).
            let _ = self.app.emit("planet_discovered", planet);
        }
        Ok(())
    }

    async fn rollover_at_midnight(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        let prev_universe = state.universe.clone();
        let galaxy = universe::finalize(&self.db, &prev_universe)?;
        self.notifier.universe_finalized(&self.app, galaxy);
        let earned = achievements::on_universe_finalized(&self.db, galaxy)?;
        self.notify_achievements(&earned);

        // Open a fresh universe for today.
        let new_universe = universe::get_or_create_today(&self.db)?;
        state.universe = new_universe;
        state.leftover_tokens = 0;
        state.today_tokens = 0;
        state.today_date = state.universe.date;
        Ok(())
    }

    /// Detect a missed midnight (e.g. laptop slept across the boundary) and
    /// finalize the previous universe lazily.
    async fn refresh_date_if_needed(&self, state: &mut State) -> Result<()> {
        let today = universe::today_date_local();
        if today == state.today_date {
            return Ok(());
        }
        let prev = state.universe.clone();
        let galaxy = universe::finalize(&self.db, &prev)?;
        self.notifier.universe_finalized(&self.app, galaxy);
        let earned = achievements::on_universe_finalized(&self.db, galaxy)?;
        self.notify_achievements(&earned);
        let next = universe::get_or_create_today(&self.db)?;
        state.universe = next;
        state.today_date = today;
        state.leftover_tokens = 0;
        state.today_tokens = sum_today_tokens(&self.db, today)?;
        Ok(())
    }

    pub async fn current_universe_id(&self) -> Result<i64> {
        Ok(self.state.lock().await.universe.id)
    }

    /// Rename today's universe. Empty input falls back to the auto-generated
    /// name derived from the universe seed. Updates both the DB row and the
    /// engine's cached `state.universe.cluster_name` so the next payload poll
    /// reflects the change immediately (otherwise the cached copy clobbers
    /// the rename a few seconds later).
    pub async fn rename_current_universe(&self, raw: &str) -> Result<String> {
        let trimmed = raw.trim();
        let mut state = self.state.lock().await;
        let final_name = if trimmed.is_empty() {
            universe::generate_cluster_name(state.universe.seed)
        } else {
            trimmed.to_string()
        };
        self.db.rename_universe(state.universe.id, &final_name)?;
        state.universe.cluster_name = Some(final_name.clone());
        Ok(final_name)
    }

    /// Debug-only: refresh the in-memory today_tokens / leftover counters
    /// from the database. Used by the dev console after a token wipe so the
    /// HUD shows the new total instead of the cached engine value.
    #[cfg(debug_assertions)]
    pub async fn dev_reload_today_tokens(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        let today = universe::today_date_local();
        state.today_tokens = sum_today_tokens(&self.db, today)?;
        state.leftover_tokens = 0;
        Ok(())
    }

    /// Debug-only: re-fetch today's universe row from the DB. Picks up
    /// changes made by dev_console wipes (e.g. star_count was reset to 0).
    #[cfg(debug_assertions)]
    pub async fn dev_reload_universe(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        let today = universe::today_date_local();
        if let Some(u) = self.db.find_universe_by_date(today)? {
            state.universe = u;
        }
        Ok(())
    }

    pub async fn current_universe_payload(&self) -> Result<UniversePayload> {
        let mut state = self.state.lock().await;
        // The dedicated midnight timer is the primary rollover path, but
        // tokio sleeps that span OS suspend (laptop closed across midnight)
        // can lag by a few seconds on wake. The frontend polls this method
        // every 3 s, so a lazy refresh here guarantees the HUD never shows
        // yesterday's totals — independent of whether any token event has
        // arrived yet on the new day.
        self.refresh_date_if_needed(&mut state).await?;
        let universe = state.universe.clone();
        let leftover = state.leftover_tokens;
        let today_tokens = state.today_tokens;
        drop(state);

        let stars: Vec<Star> = self.db.list_stars(universe.id)?;
        let planets = self.db.list_planets(universe.id)?;
        let nebulae = self.db.list_nebulae(universe.id)?;
        let constellations = self.db.list_constellations(universe.id)?;
        Ok(UniversePayload {
            universe,
            stars,
            planets,
            nebulae,
            constellations,
            leftover_tokens: leftover,
            today_tokens,
        })
    }
}

fn sum_today_tokens(db: &Arc<Db>, date: NaiveDate) -> Result<u64> {
    let start_local = date
        .and_hms_opt(0, 0, 0)
        .expect("midnight")
        .and_local_timezone(Local)
        .single()
        .expect("local midnight unambiguous");
    let end_local = start_local + chrono::Duration::days(1);
    db.token_total_in_range(
        start_local.with_timezone(&chrono::Utc),
        end_local.with_timezone(&chrono::Utc),
    )
}
