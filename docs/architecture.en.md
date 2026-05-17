[🇰🇷 한국어](architecture.md) · 🇬🇧 English

# Architecture

A Tauri 2 desktop app. Rust backend + Vanilla TypeScript frontend + a single SQLite file. No mobile/web target; everything runs in one process.

## Module map

```
src-tauri/src/
├── lib.rs                ── Tauri Builder setup + tray + windows
├── commands.rs           ── 28 Tauri commands the frontend invokes
├── db/mod.rs             ── SQLite schema + every query
├── watcher/
│   ├── mod.rs            ── shared watcher helpers (notify crate)
│   ├── claude_code.rs    ── parser for ~/.claude/projects/*.jsonl
│   ├── codex_cli.rs      ── parser for ~/.codex/sessions/**/*.jsonl
│   └── opencode.rs       ── 5-second SQLite polling
├── session.rs            ── 5-min idle session / 20M-token forced trigger
├── engine/
│   ├── mod.rs            ── tokens → stars, session close → planet discovery
│   ├── universe.rs       ── daily universe (seed, layout, palette, cluster name)
│   ├── stars.rs          ── star coordinate distribution (date-seeded)
│   ├── planets.rs        ── rarity roulette + empty-spot placement
│   ├── catalog.rs        ── 30 planet static defs + Korean fallback names
│   ├── achievements.rs   ── 18-achievement trigger logic
│   ├── nebula.rs         ── background nebula placement (decorative only)
│   ├── codex.rs          ── species discovery counts (codex backend)
│   └── types.rs          ── shared types + Rarity / GalaxyType
├── notifier.rs           ── OS tray notifications (3-level policy, daily cap 5)
├── i18n.rs               ── backend KO/EN strings (notifications / planet names / achievements / galaxy tier)
├── parser/               ── one JSONL line → (timestamp, total_tokens)
└── dev_console.rs        ── debug-only HTTP console (E2E triggers)
```

```
src/
├── main.ts               ── tab routing + token-pill poll + tray-menu route listener
├── views/
│   ├── today.ts          ── live universe + HUD + drawing bar
│   ├── codex.ts          ── three subtabs: planets / stars / constellations
│   ├── achievements.ts   ── 18 cards + category tabs
│   ├── gallery.ts        ── 1-week / 1-month / 365-day heatmap + overlay
│   ├── settings.ts       ── Provider health + language + version/update
│   ├── discovery.ts      ── fullscreen planet discovery overlay
│   └── modal.ts          ── shared modal helper
├── universe/
│   ├── renderer.ts       ── canvas rAF loop (stars · nebulae · bg · constellations)
│   ├── camera.ts         ── view (x, y, zoom) + worldToScreen transform
│   ├── interaction.ts    ── wheel zoom / drag pan / click
│   ├── catalog.ts        ── 30-planet static defs (TS side, kept in sync with Rust)
│   ├── star-shapes.ts    ── 14-star shape drawing + codex meta
│   ├── effects.ts        ── shooting stars / dust / mood
│   ├── planet-canvas.ts  ── mounts each planet as a small rotating canvas
│   └── planet-mount.ts   ── auto-mounts/disposes data-planet-orb elements
├── i18n/
│   ├── index.ts          ── t() / setLocale() / subscribeLocale() / applyDomI18n()
│   └── locales/{ko,en}.ts ── ~280-key dictionaries (TS types catch missing keys at compile time)
└── updater.ts            ── boot-time check + footer banner + pending state export
```

## Event flow

```
Provider log change
     │
     ↓ notify (Linux/Mac) / ReadDirectoryChangesW (Win)
   Watcher (Rust)
     │
     │ TokenEvent { provider, timestamp, total_tokens, ... }
     ↓ broadcast::Sender
   ┌───────────────────────────────┐
   │  SessionManager               │  ── 5-min idle close / 20M-chunk trigger
   │   - DB.bump_session_tokens()  │
   │   - DB.close_session()        │
   └──────────┬────────────────────┘
              │ ClosedSession { id, total_tokens }
              ↓ broadcast::Sender
   ┌───────────────────────────────┐
   │  Engine                       │  ── tokens → stars, session → planets
   │   - stars::plan_star_addit()  │
   │   - planets::discover_for_..()│
   │   - achievements::on_*()      │
   │   - Notifier (KO/EN locale)   │
   │   - app.emit("planet_discov")│
   │   - set_tray_discovery(true)  │
   └──────────┬────────────────────┘
              │ Tauri event
              ↓
   ┌───────────────────────────────┐
   │  Frontend                     │
   │   - poll current_universe(3s) │
   │   - listen("stars_added")     │
   │   - listen("planet_discov")   │
   │   - listen("tray-route")      │
   └───────────────────────────────┘
```

## Persistence

One file: `tokenova.sqlite3`. OS-specific locations:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.tokenova.app/` |
| Linux | `~/.local/share/com.tokenova.app/` |
| Windows | `%APPDATA%\com.tokenova.app\` |

Tables:
- `universes` — one row per day (date · seed · layout_shape · palette · cluster_name · star_count · galaxy_type)
- `token_events` — every raw token event (provider · timestamp · total_tokens · session_id)
- `sessions` — session metadata (started_at · last_activity · total_tokens · planet_triggered)
- `stars` · `planets` · `nebulae` · `constellations` — visual assets per universe
- `codex_entries` — planet species discovery counts
- `achievements` — earned achievement keys + timestamps
- `watch_state` · `settings` — watcher high-water marks + user settings (locale, provider paths, etc.)

Schema migrations follow the `v1 → v2` pattern in `db/mod.rs` (`column_exists` + `ALTER TABLE`). Foreign keys are ON.

## Deterministic universe generation

`engine/universe.rs::seed_from_date(date)` hashes a date into a 64-bit number → same date produces the same seed → same layout/palette/cluster name. Modulo selects one of six layouts (`spiral` / `elliptical` / `irregular` / `dual_cluster` / `scattered` / `core_heavy`). Each star's coordinate is jittered by `(seed, star_index)` so the same token count on different days yields different starfields.

## Triple-safe midnight rollover

1. **Dedicated timer** — `tokio::time::sleep` wakes exactly at midnight.
2. **Lazy check on token events** — every new event calls `refresh_date_if_needed`, finalising the previous universe if the date changed.
3. **Lazy check on payload poll** — the 3-second `current_universe_payload` call from the frontend runs the same check.

Even if the OS suspended past midnight, a single new event or the next poll flips the state to the new universe correctly.

## Debug-only modules

- `dev_console.rs` — gated on `#[cfg(debug_assertions)]`. Never compiled into release. Spawns an HTTP listener on port 7777 (activated by `TOKENOVA_DEV_CONSOLE`).
- The tray setup block in `lib.rs` — debug builds flip `set_decorations(true)` + `set_always_on_top(false)` so the popover looks like a normal window.

Detailed usage is in [`../dev-console/README.md`](../dev-console/README.md).
