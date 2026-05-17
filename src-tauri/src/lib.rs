mod commands;
mod db;
mod engine;
mod i18n;
mod notifier;
mod parser;
mod session;
mod watcher;

// Dev console (HTTP server) is debug-only — release builds never include it.
#[cfg(debug_assertions)]
mod dev_console;

use std::sync::{Arc, Mutex};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent, TrayIconId},
    AppHandle, Emitter, Manager,
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            commands::rename_current_galaxy,
            commands::list_constellation_codex,
            commands::delete_constellation,
            commands::get_universe_by_id,
            commands::get_gallery,
            commands::get_pending_discoveries,
            commands::acknowledge_planets,
            commands::get_providers_health,
            commands::set_provider_path,
            commands::clear_provider_path,
            commands::get_setting,
            commands::set_locale,
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

            // Defer a second `set_focus` until after the webview has finished
            // its initial load. On Linux/WSLg WebKit2GTK (and Windows WebView2)
            // an immediate setup-time focus can fire before the document is
            // ready, leaving the native window focused but the HTML doc in a
            // "ghost focus" state — letters reach the input but OS IME hotkeys
            // (한/영, Shift+Space) get swallowed before the webview sees them.
            // A short async wait then re-issuing set_focus rebinds the IM
            // context to the live document. Runs in both debug and release.
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    let _ = win.set_focus();
                });
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
            let notifier = Arc::new(Notifier::new(db.clone(), Policy::Standard));
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

            // Dev console — only in debug builds AND only when explicitly
            // opted-in via the TOKENOVA_DEV_CONSOLE env var, so a routine
            // `npm run tauri dev` doesn't bind 7777 unprompted.
            #[cfg(debug_assertions)]
            {
                let engine: tauri::State<Arc<Engine>> = app.state();
                dev_console::maybe_start(db.clone(), engine.inner().clone(), events_tx.clone());
            }

            app.manage(events_tx);

            // --- Tray icon + popover toggle ---
            //
            // Platform-specific icon: macOS gets a monochrome silhouette that
            // the system tints automatically for light/dark menubars; Windows
            // and Linux get the full-colour planet-with-gold-ring so the brand
            // mark stays identifiable in the system tray.
            let tray_icon = Image::from_bytes(default_tray_bytes())?;
            let open_i = MenuItem::with_id(app, "open", "Open Tokenova", true, None::<&str>)?;
            let today_i = MenuItem::with_id(app, "today", "Today", true, None::<&str>)?;
            let codex_i = MenuItem::with_id(app, "codex", "Codex", true, None::<&str>)?;
            let achievements_i =
                MenuItem::with_id(app, "achievements", "Achievements", true, None::<&str>)?;
            let gallery_i = MenuItem::with_id(app, "gallery", "Gallery", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(
                app,
                "quit",
                "Quit Tokenova",
                true,
                Some("CmdOrCtrl+Q"),
            )?;
            let menu = Menu::with_items(
                app,
                &[
                    &open_i,
                    &sep,
                    &today_i,
                    &codex_i,
                    &achievements_i,
                    &gallery_i,
                    &settings_i,
                    &sep,
                    &quit_i,
                ],
            )?;
            let tray = TrayIconBuilder::with_id("tokenova-tray")
                .icon(tray_icon)
                // No-op on Windows/Linux. On macOS this tells AppKit the PNG
                // is a template image — black silhouette gets auto-tinted to
                // match the menubar accent + dark mode.
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Tokenova")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        // Route through the popover by emitting a `tray-route`
                        // event the frontend listens to. Show + focus the
                        // window first so a hidden tray-app surfaces too.
                        id @ ("open" | "today" | "codex" | "achievements" | "gallery" | "settings") => {
                            show_and_route(app, id);
                        }
                        _ => {}
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
            // Stash the tray id so `set_tray_discovery` can find it later
            // when a new planet shows up and we need to swap the icon to the
            // gold-dot variant.
            app.manage(TrayHandle { id: tray.id().clone() });

            // If the app was closed with unacknowledged discoveries still in
            // the queue, surface them by starting in the discovery state.
            let pending = db.list_unacknowledged_planets().unwrap_or_default();
            if !pending.is_empty() {
                let _ = set_tray_discovery(&app.handle().clone(), true);
            }

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
        // Second focus after the webview has had a tick to settle. Without
        // this, on Linux/WSLg the IM context can stay bound to the previous
        // native window and OS hotkeys (한/영) get dropped before reaching
        // the webview. Cheap and idempotent on macOS/Windows where it's a no-op.
        let win = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            let _ = win.set_focus();
        });
    }
}

// ─── Tray icon assets — baked into the binary at compile time ───
//
// The bytes live in `src-tauri/icons/`. `include_bytes!` is platform-aware
// only via the `#[cfg]` attribute on each constant.

#[cfg(target_os = "macos")]
const TRAY_DEFAULT_BYTES: &[u8] = include_bytes!("../icons/tray-mac.png");
#[cfg(target_os = "macos")]
const TRAY_DISCOVERY_BYTES: &[u8] = include_bytes!("../icons/tray-mac-discovery.png");

#[cfg(not(target_os = "macos"))]
const TRAY_DEFAULT_BYTES: &[u8] = include_bytes!("../icons/tray-win.png");
#[cfg(not(target_os = "macos"))]
const TRAY_DISCOVERY_BYTES: &[u8] = include_bytes!("../icons/tray-win-discovery.png");

fn default_tray_bytes() -> &'static [u8] {
    TRAY_DEFAULT_BYTES
}

fn discovery_tray_bytes() -> &'static [u8] {
    TRAY_DISCOVERY_BYTES
}

/// Tray icon handle saved into managed state so the rest of the app can swap
/// the icon (e.g. when a new planet is discovered).
struct TrayHandle {
    id: TrayIconId,
}

/// Swap the tray icon to the gold-dot "discovery" variant. Safe to call
/// repeatedly; the same image is just re-applied.
pub(crate) fn set_tray_discovery(app: &AppHandle, on: bool) -> tauri::Result<()> {
    let Some(state) = app.try_state::<TrayHandle>() else {
        return Ok(()); // setup hasn't finished yet
    };
    let Some(tray) = app.tray_by_id(&state.id) else {
        return Ok(());
    };
    let bytes = if on {
        discovery_tray_bytes()
    } else {
        default_tray_bytes()
    };
    tray.set_icon(Some(Image::from_bytes(bytes)?))?;
    Ok(())
}

/// Show + focus the main popover, then emit a `tray-route` event the
/// frontend listens for to switch tabs. Called from the right-click menu
/// items (Today, Codex, Achievements, Gallery, Settings, Open).
fn show_and_route(app: &AppHandle, route: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.move_window(Position::TrayCenter);
        let _ = window.show();
        let _ = window.set_focus();
    }
    // "open" means just surface the window — no tab change.
    if route != "open" {
        let _ = app.emit("tray-route", route);
    }
}
