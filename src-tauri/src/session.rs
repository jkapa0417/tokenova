//! 5-minute idle session window.
//!
//! - A "session" is a contiguous burst of token activity.
//! - When the gap between two events exceeds [`IDLE_TIMEOUT_SECS`] the previous
//!   session is closed and a new one begins on the next event.
//! - A closed session whose total exceeds [`PLANET_THRESHOLD_TOKENS`] is marked
//!   as a planet trigger so Phase C can later resolve it into a planet discovery.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use tokio::sync::{broadcast, Mutex};
use tokio::time::{interval, Duration};

use crate::db::{Db, TokenEvent};
use crate::engine::ClosedSession;

pub const IDLE_TIMEOUT_SECS: i64 = 5 * 60;
pub const PLANET_THRESHOLD_TOKENS: u64 = 1_000_000;
/// Mid-session forced trigger: every time an open session's running total
/// crosses a multiple of this value, fire a planet trigger without actually
/// closing the session. Lets heavy bursts (a single long conversation, agentic
/// runs) keep yielding discoveries instead of having to wait for a 5-minute
/// idle gap.
pub const FORCED_PLANET_TOKEN_THRESHOLD: u64 = 20_000_000;
const IDLE_CHECK_INTERVAL_SECS: u64 = 30;

#[derive(Debug, Clone)]
struct OpenSession {
    id: i64,
    last_activity: DateTime<Utc>,
    total_tokens: u64,
    /// Number of FORCED_PLANET_TOKEN_THRESHOLD chunks already announced for
    /// this session. Prevents double-firing when a single event pushes the
    /// total past the same boundary that was crossed earlier.
    triggered_chunks: u64,
}

pub struct SessionManager {
    db: Arc<Db>,
    open: Mutex<Option<OpenSession>>,
    closed_tx: broadcast::Sender<ClosedSession>,
}

impl SessionManager {
    pub fn new(db: Arc<Db>, closed_tx: broadcast::Sender<ClosedSession>) -> Arc<Self> {
        Arc::new(Self {
            db,
            open: Mutex::new(None),
            closed_tx,
        })
    }

    /// Start the two background tasks: event consumer and periodic idle checker.
    ///
    /// Uses `tauri::async_runtime::spawn` rather than `tokio::spawn` because Tauri's `setup`
    /// callback runs synchronously outside an active tokio runtime context.
    pub fn spawn(self: Arc<Self>, events: broadcast::Receiver<TokenEvent>) {
        let consumer = self.clone();
        tauri::async_runtime::spawn(consumer.run_consumer(events));

        let ticker = self.clone();
        tauri::async_runtime::spawn(ticker.run_idle_checker());
    }

    fn announce_closed(&self, session_id: i64, total_tokens: u64) {
        let _ = self.closed_tx.send(ClosedSession {
            session_id,
            total_tokens,
        });
    }

    async fn run_consumer(self: Arc<Self>, mut events: broadcast::Receiver<TokenEvent>) {
        loop {
            match events.recv().await {
                Ok(event) => {
                    if let Err(e) = self.handle_event(event).await {
                        eprintln!("[session] handle_event: {e:#}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("[session] broadcast lagged, skipped {skipped} events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    async fn run_idle_checker(self: Arc<Self>) {
        let mut tick = interval(Duration::from_secs(IDLE_CHECK_INTERVAL_SECS));
        loop {
            tick.tick().await;
            if let Err(e) = self.close_if_idle(Utc::now()).await {
                eprintln!("[session] idle check: {e:#}");
            }
        }
    }

    async fn handle_event(&self, event: TokenEvent) -> Result<()> {
        let total = event.total();
        if total == 0 {
            return Ok(());
        }
        let ts = event.timestamp;
        let mut guard = self.open.lock().await;

        // Close stale session if the idle gap was exceeded before this event.
        if let Some(open) = guard.as_ref().cloned() {
            if (ts - open.last_activity).num_seconds() > IDLE_TIMEOUT_SECS {
                let residual = open
                    .total_tokens
                    .saturating_sub(open.triggered_chunks * FORCED_PLANET_TOKEN_THRESHOLD);
                let triggered = residual >= PLANET_THRESHOLD_TOKENS;
                self.db
                    .close_session(open.id, open.last_activity, triggered)?;
                if triggered {
                    self.announce_closed(open.id, open.total_tokens);
                }
                *guard = None;
            }
        }

        // Open a fresh session if none is active.
        if guard.is_none() {
            let id = self.db.create_session(ts)?;
            *guard = Some(OpenSession {
                id,
                last_activity: ts,
                total_tokens: 0,
                triggered_chunks: 0,
            });
        }

        let open = guard
            .as_mut()
            .expect("session must be open after the create_session branch");
        open.total_tokens = open.total_tokens.saturating_add(total);
        open.last_activity = ts;

        self.db.bump_session_tokens(open.id, total)?;
        if let Some(event_id) = event.id {
            self.db.assign_session(event_id, open.id)?;
        }

        // Mid-session forced trigger: fire one planet attempt per 20M-token
        // chunk the session has crossed. A single huge event can advance the
        // counter by more than one chunk, hence the while-loop.
        let target_chunks = open.total_tokens / FORCED_PLANET_TOKEN_THRESHOLD;
        while open.triggered_chunks < target_chunks {
            open.triggered_chunks += 1;
            let snapshot_total = open.triggered_chunks * FORCED_PLANET_TOKEN_THRESHOLD;
            self.announce_closed(open.id, snapshot_total);
        }
        Ok(())
    }

    async fn close_if_idle(&self, now: DateTime<Utc>) -> Result<()> {
        let mut guard = self.open.lock().await;
        let Some(open) = guard.as_ref().cloned() else {
            return Ok(());
        };
        if (now - open.last_activity).num_seconds() > IDLE_TIMEOUT_SECS {
            let residual = open
                .total_tokens
                .saturating_sub(open.triggered_chunks * FORCED_PLANET_TOKEN_THRESHOLD);
            let triggered = residual >= PLANET_THRESHOLD_TOKENS;
            self.db
                .close_session(open.id, open.last_activity, triggered)?;
            if triggered {
                self.announce_closed(open.id, open.total_tokens);
            }
            *guard = None;
        }
        Ok(())
    }
}
