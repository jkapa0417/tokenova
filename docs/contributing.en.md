[🇰🇷 한국어](contributing.md) · 🇬🇧 English

# Contributing

Small side project — PRs welcome. For larger features please open an issue first to align on direction.

## Quick start

```bash
git clone https://github.com/jkapa0417/tokenova
cd tokenova
npm install
npm run tauri dev     # dev mode (popover renders as a decorated window)
```

Prerequisites: see the [Build From Source](../README.en.md#build-from-source) section in the README.

## What kinds of PRs we accept

### Welcome

- 🐛 **Bug fixes** — small or large, both fine
- 🎨 **Visual polish** — stars / planets / background / animation tuning
- 🌐 **i18n improvements** — new locales, better translations
- 📦 **New provider integrations** — Cursor / Gemini Code / etc. ([guide](providers.en.md))
- 📊 **More codex entries** — new planet species / star shapes (without changing rarity weights)
- 🏆 **New achievements** — engine key + trigger logic + i18n text
- 📝 **Documentation improvements**

### Discuss first

- 🏗️ **Architectural changes** — large module reshuffles, DB schema changes
- 💰 **Anything about monetisation / seasons** — affects business direction
- 🌐 **New external network dependencies** — might conflict with privacy doc commitments

For these, please open an [Issue](https://github.com/jkapa0417/tokenova/issues) before sending a PR.

## Commit messages

This repo uses a 1-line subject + blank + body format. Example:

```
Drop MSI from Windows bundles — ship NSIS EXE only

The Tauri auto-updater plugin only supports in-place upgrades for the
NSIS exe target on Windows; MSI users would have to manually re-install
on every release.
...
```

Guidelines:
- **Subject**: imperative verb + what you did (aim for under 50 chars). Don't be vague — "Fix bug" is bad, "Fix planet pins drifting away from stars during zoom/drag" is good.
- **Body**: explain *why*. The diff already shows *what*. Context, trade-offs, alternatives considered.
- **Issue references**: include `Closes #123` / `Fixes #456` if applicable.
- **Co-Authored-By**: if AI tooling was involved, add it as a trailer (this repo's convention).

## PR checklist

Before sending a PR:

- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `cd src-tauri && cargo check` → 0 warnings (or intentionally marked with `#[allow]`)
- [ ] `cd src-tauri && cargo fmt --check`
- [ ] `cd src-tauri && cargo clippy --no-deps -- -D warnings`
- [ ] `cd src-tauri && cargo test --lib`
- [ ] If you added UI strings → both KO + EN ([i18n guide](i18n.en.md))
- [ ] New i18n keys are in the dict (otherwise the raw key text is rendered — caught quickly)
- [ ] For visual changes, before/after screenshot or GIF (optional)
- [ ] Relevant docs updated (especially [game-mechanics.en.md](game-mechanics.en.md) for number changes)

Copy this checklist into your PR body with ☑️ marks — speeds up review.

## Coding conventions

### Rust

- Default `cargo fmt` formatting (no custom rustfmt.toml)
- `cargo clippy --no-deps -- -D warnings` — warnings block PRs
- Common patterns:
  - `anyhow::Result` for app errors, `?` to propagate
  - `tokio` async runtime — wrap blocking work in `spawn_blocking`
  - DB access lives only in `db/mod.rs`; external modules take `Arc<Db>`
  - Module decoupling via `broadcast` channels
- Visibility: don't `pub` unless something outside needs it. Functions only used by dev-console get `#[cfg_attr(not(debug_assertions), allow(dead_code))]`.
- Comments: focus on WHY. The code itself shows WHAT.

### TypeScript

- ESM (`type: "module"`). Relative-path imports.
- `npx tsc --noEmit` strict mode must pass.
- Style:
  - Vanilla DOM API (no framework). `document.querySelector` / `addEventListener` directly.
  - Lifecycle convention: `activate<View>()` + `deactivate<View>()`.
  - All user-facing strings go through `t()`.
  - Polling views react to locale changes with `subscribeLocale`.
- Comments: same — WHY. Visual / timing decisions especially.

### CSS

- One `styles.css` file, sectioned by big header comments.
- CSS variables (`--gold`, `--fg-1`, etc.) for colour + font consistency.
- New components follow BEM-ish: `.foo`, `.foo-bar`, `.foo[hidden]`.

## Issues / bug reports

See the [issue template](https://github.com/jkapa0417/tokenova/issues/new). Helpful info:

- **Environment**: OS + version, Tokenova version (Settings → About → Version)
- **Steps to reproduce**: 1, 2, 3, …
- **Expected vs actual**
- **Logs**: Tokenova console output if accessible. macOS Console.app, Windows Event Viewer, Linux stderr.
- **Screenshots/GIFs**: very helpful for visual bugs.

## Code of conduct

Be respectful. No personal attacks. Critique code / ideas, not people. Korean or English both fine.

## Licence agreement

Sending a PR means you agree to contribute that code under this repo's licence ([FSL-1.1-ALv2](../LICENSE.md)).

## Thanks

Tokenova stands on the shoulders of:
- [Tauri 2](https://v2.tauri.app/)
- [rusqlite](https://github.com/rusqlite/rusqlite)
- [notify](https://github.com/notify-rs/notify)
- [chrono](https://github.com/chronotope/chrono)
- [rand_pcg](https://crates.io/crates/rand_pcg)
- [Vite](https://vitejs.dev/)
- [Geist](https://vercel.com/font) · [JetBrains Mono](https://www.jetbrains.com/lp/mono/)

PRs + issues welcome. 🪐
