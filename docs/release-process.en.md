[🇰🇷 한국어](release-process.md) · 🇬🇧 English

# Release Process

A single tag push triggers builds on three OSes + signing + GitHub Release publish + auto-update manifest generation. The manual steps are just version bump + tag.

## One-time setup (for forks / first run)

1. **Generate a signing keypair**
   ```bash
   npx tauri signer generate -w ~/.tauri/tokenova.key -p ""
   cat ~/.tauri/tokenova.key.pub  # copy the public key
   ```
2. **Public key → conf**: paste the line above into `src-tauri/tauri.conf.json`'s `plugins.updater.pubkey`.
3. **Private key → GitHub Secret**: paste the contents of `~/.tauri/tokenova.key` into https://github.com/jkapa0417/tokenova/settings/secrets/actions → `TAURI_SIGNING_PRIVATE_KEY`.
4. **Workflow permissions**: Settings → Actions → General → Workflow permissions → **"Read and write permissions"**.

## Regular release procedure

### 1. Bump the version

Three files must stay in sync:

```jsonc
// package.json
"version": "1.0.0"
```
```jsonc
// src-tauri/tauri.conf.json
"version": "1.0.0"
```
```toml
# src-tauri/Cargo.toml
version = "1.0.0"
```

> ⚠️ **WiX gotcha**: if you build a Windows MSI, the pre-release suffix must be **numeric only** (`0.1.0-1` OK, `0.1.0-rc.1` ❌). Our current build only ships NSIS exe so this doesn't apply, but watch out if MSI is reintroduced.

```bash
cargo check --release  # compile check
npm run tauri build     # (optional) local verification
```

### 2. Commit + push

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Bump to v1.0.0"
git push origin main
```

### 3. Create + push the tag

**Live release**:
```bash
git tag v1.0.0
git push origin v1.0.0
```

**Prerelease (RC, beta, etc.)** — tag name must contain a `-`:
```bash
git tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

The workflow's `prerelease: ${{ contains(github.ref_name, '-') }}` flips on automatically when a dash is present → GitHub Release gets a "Pre-release" badge + is excluded from `/releases/latest/download/`.

### 4. CI takes over

Pushing the tag triggers `.github/workflows/release.yml`:

| Job | Runner | Artifacts | Duration |
|---|---|---|---|
| `publish-tauri` matrix | macos-latest | `Tokenova_X.Y.Z_universal.dmg` + `.app.tar.gz` + `.sig` | ~25-35 min |
| | windows-latest | `Tokenova_X.Y.Z_x64-setup.exe` + `.nsis.zip` + `.sig` | ~10-15 min |
| | ubuntu-22.04 | `tokenova_X.Y.Z_amd64.AppImage` + `.deb` + `.sig` | ~8-12 min |

Also auto-generated:
- `latest.json` (the auto-updater manifest)

Everything uploads to `https://github.com/jkapa0417/tokenova/releases/tag/vX.Y.Z`.

### 5. Monitor

https://github.com/jkapa0417/tokenova/actions

- 🟡 in progress / ✅ success / ❌ failure — colour at a glance
- Click into a job → step-by-step logs
- Expand a failed step for the exact error

### 6. Verify + announce

When all three OSes finish:

1. Check the Release page — six+ assets + `latest.json` should all be there.
2. Download at least one platform installer to verify the actual binary runs.
3. (For live releases) earlier-version users start seeing the banner within 5-15 minutes.

## Common failure modes

### "Resource not accessible by integration"

**Cause**: the workflow lacks permission to create a GitHub Release.
**Fix**: Settings → Actions → General → Workflow permissions → "Read and write permissions". Then "Re-run failed jobs".

### "Couldn't find release with tag" + same-commit retry fails

**Cause**: three jobs racing to create the release. Race-condition stutter.
**Fix**: usually self-heals on retry; if not, delete the partial release on the Releases page and re-run the workflow.

### WiX MSI download 502 (Windows job)

**Cause**: GitHub's WiX toolset CDN had a transient blip.
**Fix**: just re-run. If you only build NSIS exe, this download isn't invoked at all.

### Signature verification failure ("could not verify signature")

**Cause**: the pubkey in `tauri.conf.json` doesn't match the private key that signed the release.
**Fix**: confirm the exact one-line public key is pasted into conf. Or re-verify the `TAURI_SIGNING_PRIVATE_KEY` secret's contents.

## Rollback / pulling a bad release

### If users haven't received it yet

1. Releases page → ⋯ on the affected release → **Delete**.
2. Delete the tag: `git push --delete origin vX.Y.Z` + `git tag -d vX.Y.Z`.
3. Fix, re-tag (same name or different), re-publish.

### If users already received a broken version

1. **Publish a fixed version (vX.Y.Z+1) quickly** — auto-updater will pick it up naturally.
2. Mark the bad release as prerelease or delete it — so `/releases/latest/download/` points at the new one.

> minisign signing doesn't invalidate an already-downloaded binary. For security-critical issues, push a fixed release and surface a banner.

## Manifest sanity check

After a build, eyeball `latest.json`:

```bash
curl -s https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json | jq .
```

Verify `version`, `platforms.darwin-aarch64.url`, `platforms.darwin-aarch64.signature` etc. are populated.

## Quick reference

```bash
# Live release
git tag v1.0.0 && git push origin v1.0.0

# Prerelease (test)
git tag v1.0.0-rc.1 && git push origin v1.0.0-rc.1

# Delete a mis-pushed tag
git push --delete origin v1.0.0-rc.1
git tag -d v1.0.0-rc.1
```
