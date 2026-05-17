[🇰🇷 한국어](privacy.md) · 🇬🇧 English

# Privacy

What the **current build (v0.1.0)** stores and where. As future versions add opt-in features (community sharing, etc.) this doc updates accordingly.

## One-liner

**The current build does not transmit your token usage logs to any external server.** The only outbound network paths are (1) the auto-update manifest check and (2) the Google Fonts CDN. Neither touches your token data.

## What lives where

### Local only

| Data | Stored in | Format |
|---|---|---|
| Token events (timestamp + count + provider + session id) | `tokenova.sqlite3` in the OS user data dir | SQLite |
| Session metadata (start/end, totals, planet-trigger flag) | Same DB | SQLite |
| Daily universes (stars / planets / constellations / galaxy tier) | Same DB | SQLite |
| User settings (locale, custom provider paths) | `settings` table in the same DB | SQLite |
| Watcher high-water marks | `watch_state` table | SQLite |

DB file location per OS:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.tokenova.app/tokenova.sqlite3` |
| Linux | `~/.local/share/com.tokenova.app/tokenova.sqlite3` |
| Windows | `%APPDATA%\com.tokenova.app\tokenova.sqlite3` |

The file is created with standard user-dir permissions — only your OS user can read it. Backup is a single-file copy. Full reset is a single-file delete.

### Outbound network — exactly two surfaces

#### 1. Auto-update manifest check

- **When**: 3 seconds after app start, once (`src/updater.ts`).
- **Where**: `https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json` (HTTPS, a static file on GitHub).
- **What's sent**: a plain GET. No user identifier, no token data, no usage statistics — **zero bytes leave**.
- **Response handling**: compares `version` from latest.json with the running app. Shows a banner if newer.
- **Disabling**: remove the `startUpdateCheck()` call from `src/updater.ts` and clear `plugins.updater.endpoints` in tauri.conf.json (for personal forks).

#### 2. Google Fonts CDN

- **When**: first webview load.
- **Where**: `fonts.googleapis.com` + `fonts.gstatic.com`.
- **Downloaded**: Geist (sans) + JetBrains Mono (mono) woff2 files.
- **Stored**: in the webview cache → offline thereafter.
- **What's sent**: standard HTTP headers (Referer = app origin, User-Agent = webview). No token data.
- **Disabling**: drop the `<link>` tags from `index.html` → fallback to system fonts (Apple SD Gothic Neo / Pretendard / Noto).

### Telemetry / usage analytics — current build: none

- No analytics SDK in the current build.
- No automatic crash reporting.
- No user ID / device ID tracking.

> Future versions may add opt-in usage statistics or crash reporting. If introduced, it will be noted in the release notes and shipped as off-by-default — only active after the user explicitly opts in.

## Who sees provider logs

- **Only Tokenova's backend.** The Rust watcher uses `fs::read` directly and extracts just two values: `{ timestamp, total_tokens }`.
- Original prompts / responses / code — never read, never stored.
- The extracted token counts go into SQLite and surface in the frontend webview.

```rust
// Actual parser (src-tauri/src/parser/) — token count only:
TokenEvent {
    timestamp: chrono::Utc,
    total_tokens: u64,
    provider: "claude_code" | "codex_cli" | "opencode",
    session_id: Option<i64>,
}
```

## Tray notifications

Uses the OS native notification system (macOS Notification Center / Windows Toast / Linux libnotify). **Only your local OS sees the message text** — disable cloud sync (e.g., iCloud) in your OS settings if you don't want notifications echoing across devices.

## Exporting / deleting universe data

- **Export**: no in-app export currently. Copy the DB file directly.
- **Delete**: quit the app, delete the DB file → next launch starts fresh.
- **Selective delete**: use a SQLite client (`DELETE FROM token_events WHERE …`). Note that stars / planets / achievements have foreign-key relationships and may cascade.

## Code-signing disclaimer

The v0.1.0 release is not signed with an Apple Developer ID or Windows EV certificate. **This is unrelated to malware status** — it just means we haven't paid Apple/Microsoft for an identity certificate yet. Proper signing is planned for v1.0.0.

The full source is public, so if you'd prefer to inspect and build it yourself: see [`../README.en.md#build-from-source`](../README.en.md#build-from-source).

## Questions

Privacy concerns → [GitHub Issues](https://github.com/jkapa0417/tokenova/issues) (for private contact, see jkapa0417's GitHub profile).
