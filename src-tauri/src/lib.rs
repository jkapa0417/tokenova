mod commands;
mod db;
mod engine;
mod notifier;
mod parser;
mod session;
mod watcher;

use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};
use tokio::sync::broadcast;

use crate::db::{Db, TokenEvent};
use crate::engine::{ClosedSession, Engine};
use crate::notifier::{Notifier, Policy};
use crate::session::SessionManager;
use crate::watcher::{
    spawn_claude_code_watcher, spawn_codex_cli_watcher, spawn_opencode_watcher, WatcherHandle,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_today_total,
            commands::get_recent_token_events,
            commands::get_current_session,
            commands::get_session_by_id,
            commands::get_discovery_ordinal,
            commands::get_current_universe,
            commands::get_codex,
            commands::get_achievements,
            commands::save_constellation,
            commands::list_constellation_codex,
            commands::delete_constellation,
            commands::get_universe_by_id,
            commands::get_gallery,
            commands::get_pending_discoveries,
            commands::acknowledge_planets,
            commands::get_providers_health,
            commands::set_provider_path,
            commands::clear_provider_path,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // In debug builds the popover is shown + decorated so devs can see
            // and resize the WebView without a working tray (e.g. WSL2).
            // Release builds keep the tray-only popover behavior from tauri.conf.json.
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(true);
                let _ = window.set_always_on_top(false);
                let _ = window.set_skip_taskbar(false);
                let _ = window.show();
                let _ = window.set_focus();
            }

            // --- DB ---
            let data_dir = app.path().app_data_dir().expect("resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let db_path = data_dir.join("tokenova.sqlite3");
            let db = Arc::new(Db::open(&db_path).expect("db opens"));
            // True only on the very first launch (no bootstrap sentinel row
            // in `watch_state` yet). Watchers use this to skip-to-end so a
            // fresh install starts at 0 tokens instead of ingesting the
            // user's entire prior Claude / Codex / OpenCode history.
            let first_run = !db.is_bootstrapped().unwrap_or(false);
            app.manage(db.clone());

            // --- Notifier ---
            let notifier = Arc::new(Notifier::new(Policy::Standard));
            app.manage(notifier.clone());

            // --- Event buses ---
            let (events_tx, events_rx_engine) = broadcast::channel::<TokenEvent>(256);
            let events_rx_session = events_tx.subscribe();
            let (closed_tx, closed_rx_engine) = broadcast::channel::<ClosedSession>(64);

            // --- Engine (universe + stars + planets + nebulae + achievements) ---
            let engine = Engine::bootstrap(db.clone(), app.handle().clone(), notifier.clone())
                .expect("engine boots");
            engine.clone().spawn(events_rx_engine, closed_rx_engine);
            app.manage(engine);

            // --- Session manager ---
            SessionManager::new(db.clone(), closed_tx).spawn(events_rx_session);

            // --- Watchers ---
            // Read per-provider path overrides from settings so users can
            // point Tokenova at non-default install locations.
            let claude_override = db
                .get_setting("provider.claude_code.path")
                .ok()
                .flatten()
                .map(std::path::PathBuf::from);
            let codex_override = db
                .get_setting("provider.codex_cli.path")
                .ok()
                .flatten()
                .map(std::path::PathBuf::from);
            let opencode_override = db
                .get_setting("provider.opencode.path")
                .ok()
                .flatten()
                .map(std::path::PathBuf::from);

            let claude_handle = spawn_claude_code_watcher(
                db.clone(),
                events_tx.clone(),
                first_run,
                claude_override,
            )
            .expect("claude code watcher initialized");
            let codex_handle = spawn_codex_cli_watcher(
                db.clone(),
                events_tx.clone(),
                first_run,
                codex_override,
            )
            .expect("codex cli watcher initialized");
            spawn_opencode_watcher(db.clone(), events_tx.clone(), first_run, opencode_override)
                .expect("opencode watcher initialized");
            // Mark bootstrap done so subsequent launches resume incremental
            // ingestion. Each watcher's bootstrap task captured `first_run`
            // by value already, so toggling the sentinel here is race-free.
            if first_run {
                if let Err(e) = db.mark_bootstrapped() {
                    eprintln!("[bootstrap] failed to mark complete: {e:#}");
                }
            }
            // Hold the JSONL watcher handles for the lifetime of the app.
            app.manage(
                Mutex::new((claude_handle, codex_handle)) as Mutex<(WatcherHandle, WatcherHandle)>
            );
            app.manage(events_tx);

            // --- Tray icon + popover toggle (Phase A) ---
            let quit_item = MenuItem::with_id(app, "quit", "Quit Tokenova", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_item])?;
            let _tray = TrayIconBuilder::with_id("tokenova-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_popover(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.move_window(Position::TrayCenter);
        let _ = window.show();
        let _ = window.set_focus();
    }
}
