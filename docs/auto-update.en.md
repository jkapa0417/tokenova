[🇰🇷 한국어](auto-update.md) · 🇬🇧 English

# Auto-Update

How a new release reaches users. Tauri 2 `tauri-plugin-updater` + minisign signing + GitHub Releases manifest.

## Big picture

```
1.  Developer: version bump + git tag v1.x.y + push
        ↓
2.  GitHub Actions: build on 3 OSes + minisign-sign (private key from secret)
        ↓
3.  GitHub Release: artifacts + latest.json auto-uploaded
        ↓
4.  User's app: 3 s after launch, fetches latest.json
        ↓
5.  Current version < manifest version → in-app banner "v1.x.y available"
        ↓
6.  User clicks "Install now" → download platform bundle → verify signature → apply → relaunch
```

## Manifest — `latest.json`

`tauri-action` produces it automatically after build. Shape:

```json
{
  "version": "1.0.0",
  "notes": "release notes…",
  "pub_date": "2026-05-18T10:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "contents of Tokenova_1.0.0_aarch64.app.tar.gz.sig",
      "url": "https://github.com/jkapa0417/tokenova/releases/download/v1.0.0/Tokenova_1.0.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { ... },
    "windows-x86_64": {
      "signature": "…",
      "url": "…Tokenova_1.0.0_x64-setup.nsis.zip"
    },
    "linux-x86_64": {
      "signature": "…",
      "url": "…tokenova_1.0.0_amd64.AppImage"
    }
  }
}
```

Each platform URL points at the **update bundle, not the installer** (`.app.tar.gz` / `.nsis.zip` / `.AppImage`) — that's what the updater plugin can apply in-place.

## Signing

Generate a minisign keypair with [`tauri signer generate`](https://v2.tauri.app/distribute/sign/) — Ed25519, password can be empty (CI secrets protect it anyway).

```bash
npx tauri signer generate -w ~/.tauri/tokenova.key -p ""
# Output:
#   Private: /home/you/.tauri/tokenova.key
#   Public:  /home/you/.tauri/tokenova.key.pub
```

- **Public key** → embedded into `src-tauri/tauri.conf.json` as `plugins.updater.pubkey`. Ships with the app binary.
- **Private key** → **never commit to git**. Lives only as the `TAURI_SIGNING_PRIVATE_KEY` GitHub Repo Secret.

At build time `tauri-action` reads the secret and attaches `.sig` files to each artifact. The user's app verifies the downloaded bundle's signature against the built-in public key — a tampered release is refused.

## Endpoint

`tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json"
    ],
    "pubkey": "<base64 minisign public key>"
  }
}
```

**Important**: the endpoint uses the `/releases/latest/download/…` alias. GitHub's "latest" means:
- the most recent non-prerelease, non-draft release
- prerelease RCs are automatically excluded from the alias → users never see them

## Frontend flow

`src/updater.ts`:

```typescript
// 3 seconds after launch
await initI18n();
applyDomI18n();
// ... view setup
setTimeout(() => void startUpdateCheck(), 3000);
```

`startUpdateCheck()`:
1. `await check()` — plugin fetches latest.json, verifies signature, compares versions.
2. If positive (new version), `setPending(update)` notifies subscribers.
3. If not `dismissed`, the footer banner appears.
4. "Later" sets `dismissed = true` (banner stays hidden for the session).
5. "Install now" calls `update.downloadAndInstall()` then `relaunch()`.

`installPendingUpdate()` is also wired to the Settings tab's "Install v1.x.y" button — same flow.

## Four user-side experiences

| Situation | Surface |
|---|---|
| First-launch banner | Footer toast (translucent dark) — "v1.x.y available" + 2 buttons |
| After "Later", want it back | Settings → About → install button next to version |
| Background check completes after Settings tab is open | `subscribeUpdates` auto-shows the button |
| Download fails | "Install failed — please retry" status + a "Retry" button |

## Per-platform in-place behaviour

| OS | Update bundle | How it applies |
|---|---|---|
| macOS | `.app.tar.gz` | Unpack Tokenova.app, swap, `relaunch()` |
| Windows | `.nsis.zip` (NSIS auto-update) | Download new exe + silent install + restart |
| Linux | `.AppImage` | Overwrite the existing AppImage in place + chmod + relaunch |

`.deb` users don't get auto-update (needs apt privileges) — that's why we recommend `.AppImage` and keep `.deb` as a secondary option.

## Key loss / rotation

Losing the private key means **users can't verify newly signed releases** → they'd have to manually reinstall. So:

- Back up `~/.tauri/tokenova.key` to a password manager (1Password, etc.).
- For routine rotation: generate a new key → swap the pubkey → users on the previous key will need a one-time manual download to flip onto the new key.

## Debug tips

- **Error "Failed to fetch"**: typo in endpoint URL, or the release doesn't exist / is still a draft.
- **Error "could not verify signature"**: the pubkey in tauri.conf.json doesn't match the private key used to sign.
- **User sees "already up to date" despite a new release**: app version ≥ manifest version. Working as intended.
- **Update is found but relaunch doesn't fire**: on macOS this is usually `.app` quarantine attribute. Goes away once we ship with Apple Developer ID signing (not yet).

## Code locations

| Concern | File |
|---|---|
| Endpoint + pubkey | `src-tauri/tauri.conf.json` |
| Plugin registration | `src-tauri/src/lib.rs` (init Builder) |
| Permissions | `src-tauri/capabilities/default.json` (`updater:default`, `process:default`) |
| Cargo deps | `src-tauri/Cargo.toml` (`tauri-plugin-updater`, `tauri-plugin-process`) |
| Frontend caller | `src/updater.ts` |
| Settings integration | `src/views/settings.ts` |
| CI signing | `.github/workflows/release.yml` (env `TAURI_SIGNING_PRIVATE_KEY`) |
