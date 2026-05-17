// Auto-update flow.
//
// On app start we ask the updater plugin to fetch the manifest from the
// endpoint configured in tauri.conf.json. If a newer version is available,
// surface a minimal in-app notice with two actions:
//   - "지금 설치" → download + install + relaunch
//   - "나중에"   → dismiss for this session
//
// The plugin verifies signatures using the public key in tauri.conf.json, so
// a corrupted or unsigned release will never be installed.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

let dismissed = false;
// Most recent positive `check()` result. Settings UI reads this so users who
// pressed "나중에" on the startup banner can still trigger the install from
// the Settings tab without waiting for the next app launch.
let pending: Update | null = null;
type Listener = (update: Update | null) => void;
const listeners = new Set<Listener>();

export function getPendingUpdate(): Update | null {
  return pending;
}

export function subscribeUpdates(fn: Listener): () => void {
  listeners.add(fn);
  // Push current state immediately so subscribers don't have to race the
  // initial check.
  fn(pending);
  return () => listeners.delete(fn);
}

function setPending(update: Update | null): void {
  pending = update;
  for (const fn of listeners) fn(update);
}

export async function startUpdateCheck(): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      setPending(null);
      return;
    }
    setPending(update);
    if (dismissed) return;
    showUpdateBanner(update);
  } catch (e) {
    // Network failure / missing manifest is expected before any release is
    // published. Don't spam the console — just log once for diagnostics.
    console.warn("[updater] check failed:", e);
  }
}

/// Trigger download + install + relaunch for the currently pending update.
/// Returns false if no update is pending. Throws on install failure so the
/// caller can surface the error.
export async function installPendingUpdate(): Promise<boolean> {
  const update = pending;
  if (!update) return false;
  await update.downloadAndInstall();
  await relaunch();
  return true;
}

function showUpdateBanner(update: Update): void {
  // Reuse an existing banner if one is already open (idempotent re-check).
  let banner = document.getElementById("update-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "update-banner";
    banner.className = "update-banner";
    document.body.appendChild(banner);
  }

  const v = update.version;
  banner.innerHTML = `
    <span class="update-banner-msg">새 버전 <b>v${escapeHtml(v)}</b> 사용 가능</span>
    <button class="update-banner-btn ghost" data-act="later">나중에</button>
    <button class="update-banner-btn primary" data-act="install">지금 설치</button>
  `;

  banner.querySelector<HTMLButtonElement>("[data-act=later]")?.addEventListener(
    "click",
    () => {
      dismissed = true;
      banner?.remove();
    },
  );

  banner.querySelector<HTMLButtonElement>("[data-act=install]")?.addEventListener(
    "click",
    async () => {
      const installBtn = banner!.querySelector<HTMLButtonElement>("[data-act=install]");
      const laterBtn = banner!.querySelector<HTMLButtonElement>("[data-act=later]");
      if (installBtn) {
        installBtn.disabled = true;
        installBtn.textContent = "다운로드 중…";
      }
      if (laterBtn) laterBtn.disabled = true;
      try {
        await update.downloadAndInstall();
        // On Windows the installer relaunches automatically; on macOS/Linux
        // we have to ask the runtime to restart the binary ourselves.
        await relaunch();
      } catch (e) {
        console.error("[updater] install failed:", e);
        if (installBtn) {
          installBtn.disabled = false;
          installBtn.textContent = "재시도";
        }
        if (laterBtn) laterBtn.disabled = false;
      }
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}
