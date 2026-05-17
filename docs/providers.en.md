[🇰🇷 한국어](providers.md) · 🇬🇧 English

# Provider Integrations

How Tokenova tracks token usage. Every provider reads local files directly; the data never leaves your machine (see [Privacy](privacy.en.md)).

## Supported providers at a glance

| Provider | Default path (Linux · macOS) | Windows default | Mechanism |
|---|---|---|---|
| Claude Code | `~/.claude/projects/*.jsonl` | `%USERPROFILE%\.claude\projects\*.jsonl` | Filesystem watcher (notify crate) |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `%USERPROFILE%\.codex\sessions\…` | Filesystem watcher |
| OpenCode | `~/.local/share/opencode/opencode.db` | `%APPDATA%\opencode\opencode.db` | SQLite polled every 5 s |

## Claude Code

- **What it reads**: per-project JSONL logs. Claude Code appends one line per invocation.
- **Parsing**: each line is converted to `{ timestamp, total_tokens }` in `src-tauri/src/parser/`. Total = `input_tokens + output_tokens` (cache-hit tokens aren't split out).
- **First-run friendliness**: on initial install the watcher marks every pre-existing JSONL line as "already consumed" and writes a bootstrap sentinel into the `watch_state` table. Subsequent runs tail normally.

## Codex CLI

- **What it reads**: OpenAI Codex CLI session rollouts. A chronological JSONL under `YYYY/MM/DD/`.
- **Parsing**: same `{ timestamp, total_tokens }` per line. Codex records the OpenAI Responses API usage object, so the sum is `input_tokens + output_tokens`.
- **Recursive watch**: a new date directory is created daily, so the watcher subscribes recursively from the root.

## OpenCode

- **What it reads**: a SQLite DB. Not JSONL — message/session tables hold token counts directly.
- **How**: every 5 seconds, the watcher selects rows newer than the last seen `time_updated`. The high-water mark is stored in `watch_state`. Polling beats notify here because SQLite WAL mutations don't surface cleanly through filesystem watchers.
- **First-run friendliness**: on first launch the high-water mark jumps to the latest existing `time_updated`, so prior history is ignored.

## When the default path doesn't fit

If your tool stores data elsewhere (corporate policy, portable installs, etc.), open **Settings → LLM Providers**, fill in the PATH input on the relevant card, and Save. **Changes take effect after restart** — watchers are spawned once at startup.

### Extra override for OpenCode

OpenCode's official environment variable `OPENCODE_DATA_DIR` is honoured. Example:

```bash
export OPENCODE_DATA_DIR=/mnt/work/opencode-data
```

Resolution priority: **in-app Settings > `OPENCODE_DATA_DIR` env > OS default**.

## Troubleshooting

### "No activity" or "0 events today"

1. Check the status dot on the **Settings → LLM Providers** card:
   - 🟢 green = the path points at a real file/directory and the type matches.
   - 🟡 amber = the path exists but the type is wrong (e.g., a file where a JSONL directory was expected).
   - 🔴 red = the path doesn't exist at all.
2. Verify the provider is actually writing logs there:
   ```bash
   ls -la ~/.claude/projects/    # or the relevant provider location
   tail -1 ~/.claude/projects/your-project/*.jsonl
   ```
3. If the directory is empty, run the provider once (e.g., a short `claude` CLI prompt) and check whether Tokenova's token count goes up.

### Token count looks too high

- The first-run skip may not have triggered. Look for the `bootstrapped_at` row in `watch_state`. If missing, every historical log is being re-ingested.
- DB file location: [Architecture](architecture.en.md#persistence).
- For a clean slate, quit the app, delete the SQLite file, restart.

### `%APPDATA%\opencode\` is empty on Windows

OpenCode's data-directory logic differs across versions. Older builds applied the Linux/macOS path (`~/.local/share/opencode/`) to Windows too, which is a bug. Either:

- Upgrade OpenCode to the latest, or
- Set a custom Windows path in Settings, e.g. `%USERPROFILE%\.local\share\opencode\opencode.db`.

## Adding a new provider (PRs welcome)

1. Add `src-tauri/src/watcher/<provider>.rs` with the signature `spawn_<provider>_watcher(db, events_tx, first_run, override_dir)`. (Mirror the Claude Code implementation.)
2. Add `src-tauri/src/parser/<provider>.rs` that converts one JSONL line / DB row into `{ timestamp, total_tokens }`.
3. Call the spawn in `lib.rs`'s setup.
4. Add the provider id to `commands.rs::default_path_for` / `display_name_for` / `kind_ok` branches — Settings UI auto-renders the card.
5. Add the provider's display name to `i18n/locales/ko.ts` + `en.ts` if needed.
