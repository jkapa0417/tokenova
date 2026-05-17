# Tokenova Dev Console

Local-only web console for driving the running Tokenova app during E2E
testing. Lets you inject token events, force planet discoveries, clear
today's data, etc. — without producing real coding activity in Claude
Code / Codex CLI / OpenCode.

## Scope (read carefully)

This console exists **for development only**:

- The Rust-side HTTP listener is compiled in via `#[cfg(debug_assertions)]`.
  Release builds (`cargo build --release`, including everything Tauri
  bundles into `.dmg` / `.exe`) never include this code path.
- Even debug builds keep the listener dormant until you launch with
  `TOKENOVA_DEV_CONSOLE=1`. A casual `npm run tauri dev` doesn't open the
  port.
- This folder (`dev-console/`) lives outside `frontendDist`
  (`tauri.conf.json` points the bundler at `../dist`, the vite build of
  `src/`), so it isn't packaged into the installer either.

If you accidentally ship a build that responds on `127.0.0.1:7777`, the
release flow is broken — flag it.

## Running

```bash
# 1. Start Tokenova with the dev console enabled.
TOKENOVA_DEV_CONSOLE=1 npm run tauri dev
# (The app prints "[dev-console] listening on http://127.0.0.1:7777")

# 2. Open this folder over a static server in another terminal.
cd dev-console
python3 -m http.server 8000
# → http://127.0.0.1:8000
```

You can also open `index.html` directly via `file://` — browsers usually
allow `fetch()` to `127.0.0.1` from local files, but a static server is
the conservative path.

## Endpoints (`127.0.0.1:7777`)

| Method | Path               | Body                                                                                              | What it does |
|--------|--------------------|---------------------------------------------------------------------------------------------------|--------------|
| GET    | `/state`           | —                                                                                                 | today_total / session / universe summary |
| POST   | `/token-event`     | `{ provider?, model?, input_tokens?, output_tokens?, cache_read?, cache_write? }`                  | Injects a synthetic `TokenEvent` through the same broadcast bus the watchers use. Drives stars + sessions naturally. |
| POST   | `/trigger-planet`  | `{ session_total_tokens?: number }`                                                                | Forces a `discover_for_session(...)` against today's universe with a synthetic session id. |
| POST   | `/clear-today`     | —                                                                                                  | Deletes today's planets / stars / constellations + clears the `codex` table. |
| POST   | `/reset-bootstrap` | —                                                                                                  | Clears the first-run sentinel so the next launch re-baselines every watcher to end-of-file. |

All responses are JSON with permissive CORS so the console can hit them
from any local origin.

## Notes

- Token events go through the **same `events_tx` broadcast** the JSONL
  watchers feed, so the engine treats them like real activity — sessions
  open, stars accumulate, planets fire at the 5000-token threshold.
- `/trigger-planet` bypasses the session pipeline and inserts a planet
  row directly. Use it for visual QA when you don't care about the
  session lifecycle.
- `/clear-today` is destructive — it wipes everything but `universes` and
  `achievements`. Re-injecting tokens after clear will regenerate stars
  and re-attribute discoveries.
