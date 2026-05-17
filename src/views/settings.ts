// Settings view — LLM provider health + custom watch paths.
//
// Today's settings surface is one section ("LLM Providers"). Each provider
// renders as a card with:
//  - status dot (green = path resolves to the expected node type;
//    amber = path resolves but wrong kind; red = path missing)
//  - last activity + today's event count
//  - editable path with Save / Reset buttons (default falls back to the
//    hard-coded conventional location)
//
// Path changes persist immediately to the `settings` table but only take
// effect after the next app launch — the watchers are spawned once at
// startup. The card explicitly tells the user this.

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

import {
  formatNumber,
  getLocale,
  setLocale,
  subscribeLocale,
  t,
} from "../i18n";
import {
  getPendingUpdate,
  installPendingUpdate,
  subscribeUpdates,
} from "../updater";

interface ProviderHealth {
  id: string;
  name: string;
  default_path: string;
  custom_path: string | null;
  effective_path: string;
  exists: boolean;
  kind_ok: boolean;
  last_event_at: string | null;
  events_today: number;
}

let wiredUp = false;

export async function activateSettings(): Promise<void> {
  wire();
  syncLangButtons();
  await refresh();
  void paintVersion();
}

function wire() {
  if (wiredUp) return;
  document.getElementById("settings-refresh")?.addEventListener("click", () => void refresh());
  document
    .getElementById("settings-update-btn")
    ?.addEventListener("click", () => void runInstall());
  // Refresh the button visibility whenever the updater's pending state changes
  // (e.g. background check finishes after the Settings tab opens). The
  // subscriber fires synchronously with the current value too.
  subscribeUpdates((update) => syncUpdateRow(update?.version ?? null));

  // Language toggle — swap locale on click + reflect the active button.
  document.querySelectorAll<HTMLButtonElement>(".settings-lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const locale = btn.dataset.locale as "ko" | "en" | undefined;
      if (!locale) return;
      void setLocale(locale).then(() => {
        // Provider cards are rebuilt via refresh() so labels swap immediately.
        void refresh();
        // The 정보 row contains dynamic translated text (update button) — re-paint.
        syncUpdateRow(getPendingUpdate()?.version ?? null);
        syncLangButtons();
      });
    });
  });
  // Re-render any externally-driven locale change too (e.g. system locale
  // switch via another mechanism — currently only the buttons, but cheap).
  subscribeLocale(() => {
    void refresh();
    syncUpdateRow(getPendingUpdate()?.version ?? null);
    syncLangButtons();
  });
  wiredUp = true;
}

function syncLangButtons(): void {
  const current = getLocale();
  document.querySelectorAll<HTMLButtonElement>(".settings-lang-btn").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.locale === current);
  });
}

async function paintVersion(): Promise<void> {
  const $v = document.getElementById("settings-version");
  if (!$v) return;
  try {
    $v.textContent = `v${await getVersion()}`;
  } catch (e) {
    console.error("getVersion:", e);
    $v.textContent = "—";
  }
  syncUpdateRow(getPendingUpdate()?.version ?? null);
}

function syncUpdateRow(newVersion: string | null): void {
  const $btn = document.getElementById("settings-update-btn") as HTMLButtonElement | null;
  const $status = document.getElementById("settings-update-status");
  if (!$btn) return;
  if (newVersion) {
    $btn.hidden = false;
    $btn.disabled = false;
    $btn.textContent = t("settings.about.update_button_install", { version: newVersion });
    if ($status) {
      $status.hidden = false;
      $status.textContent = t("settings.about.update_available", { version: newVersion });
    }
  } else {
    $btn.hidden = true;
    if ($status) $status.hidden = true;
  }
}

async function runInstall(): Promise<void> {
  const $btn = document.getElementById("settings-update-btn") as HTMLButtonElement | null;
  const $status = document.getElementById("settings-update-status");
  if (!$btn) return;
  $btn.disabled = true;
  $btn.textContent = t("settings.about.installing");
  if ($status) {
    $status.hidden = false;
    $status.textContent = t("settings.about.install_status");
  }
  try {
    const ok = await installPendingUpdate();
    if (!ok && $status) $status.textContent = t("settings.about.none_available");
  } catch (e) {
    console.error("installPendingUpdate:", e);
    $btn.disabled = false;
    $btn.textContent = t("settings.about.retry");
    if ($status) $status.textContent = t("settings.about.install_failed");
  }
}

async function refresh(): Promise<void> {
  const $list = document.getElementById("settings-providers");
  if (!$list) return;
  try {
    const providers = await invoke<ProviderHealth[]>("get_providers_health");
    $list.innerHTML = providers.map(renderCard).join("");
    attachCardHandlers();
  } catch (e) {
    console.error("get_providers_health:", e);
    $list.innerHTML = `<div class="settings-error">${t("settings.providers.load_failed")}</div>`;
  }
}

function healthClass(p: ProviderHealth): "ok" | "warn" | "bad" {
  if (!p.exists) return "bad";
  if (!p.kind_ok) return "warn";
  return "ok";
}

function healthLabel(p: ProviderHealth): string {
  if (!p.exists) return t("settings.providers.path_missing");
  if (!p.kind_ok) return t("settings.providers.kind_mismatch");
  if (p.events_today > 0) return t("settings.providers.today_count", { count: formatNumber(p.events_today) });
  if (p.last_event_at) return t("settings.providers.recent_activity", { ago: formatAgo(p.last_event_at) });
  return t("settings.providers.no_activity");
}

function formatAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t("settings.providers.ago_now");
  if (minutes < 60) return t("settings.providers.ago_minutes", { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("settings.providers.ago_hours", { hours });
  const days = Math.round(hours / 24);
  return t("settings.providers.ago_days", { days });
}

function renderCard(p: ProviderHealth): string {
  const cls = healthClass(p);
  const label = healthLabel(p);
  const usingCustom = !!p.custom_path;
  const dateLocale = getLocale() === "ko" ? "ko-KR" : "en-US";
  const lastSeen = p.last_event_at
    ? new Date(p.last_event_at).toLocaleString(dateLocale)
    : "—";
  const pathTag = usingCustom
    ? '<span class="provider-tag">CUSTOM</span>'
    : '<span class="provider-tag muted">DEFAULT</span>';
  return `
    <div class="provider-card" data-provider="${p.id}">
      <div class="provider-head">
        <div class="provider-name">
          <span class="provider-dot dot-${cls}"></span>
          ${escapeHtml(p.name)}
        </div>
        <div class="provider-stat ${cls}">${escapeHtml(label)}</div>
      </div>
      <div class="provider-meta">
        <div class="provider-meta-row">
          <span class="provider-meta-l">${t("settings.providers.label_recent")}</span>
          <span class="provider-meta-v">${escapeHtml(lastSeen)}</span>
        </div>
        <div class="provider-meta-row">
          <span class="provider-meta-l">${t("settings.providers.label_today_events")}</span>
          <span class="provider-meta-v">${formatNumber(p.events_today)}</span>
        </div>
      </div>
      <div class="provider-path-row">
        <label class="provider-path-label">PATH ${pathTag}</label>
        <input
          class="provider-path-input"
          type="text"
          data-default="${escapeAttr(p.default_path)}"
          placeholder="${escapeAttr(p.default_path)}"
          value="${escapeAttr(p.custom_path ?? "")}"
        />
        <div class="provider-actions">
          <button class="provider-btn ghost" data-action="reset" type="button" ${usingCustom ? "" : "disabled"}>
            ${t("settings.providers.reset")}
          </button>
          <button class="provider-btn primary" data-action="save" type="button">
            ${t("settings.providers.save")}
          </button>
        </div>
      </div>
      ${usingCustom
        ? `<div class="provider-default-hint">${t("settings.providers.default_label", { path: `<code>${escapeHtml(p.default_path)}</code>` })}</div>`
        : ""}
    </div>
  `;
}

function attachCardHandlers() {
  document.querySelectorAll<HTMLElement>(".provider-card").forEach((card) => {
    const id = card.dataset.provider;
    if (!id) return;
    const input = card.querySelector<HTMLInputElement>(".provider-path-input");
    const saveBtn = card.querySelector<HTMLButtonElement>('[data-action="save"]');
    const resetBtn = card.querySelector<HTMLButtonElement>('[data-action="reset"]');

    saveBtn?.addEventListener("click", async () => {
      if (!input) return;
      const value = input.value.trim();
      try {
        if (value === "") {
          await invoke("clear_provider_path", { providerId: id });
        } else {
          await invoke("set_provider_path", { providerId: id, path: value });
        }
        flashCard(card, t("settings.providers.saved_custom"));
        await refresh();
      } catch (e) {
        console.error("set_provider_path:", e);
        flashCard(card, t("settings.providers.save_failed"), true);
      }
    });

    resetBtn?.addEventListener("click", async () => {
      try {
        await invoke("clear_provider_path", { providerId: id });
        flashCard(card, t("settings.providers.reset_default"));
        await refresh();
      } catch (e) {
        console.error("clear_provider_path:", e);
        flashCard(card, t("settings.providers.reset_failed"), true);
      }
    });
  });
}

function flashCard(card: HTMLElement, message: string, isError = false): void {
  let toast = card.querySelector(".provider-toast") as HTMLElement | null;
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "provider-toast";
    card.appendChild(toast);
  }
  toast.classList.toggle("err", isError);
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast?.classList.remove("show"), 2400);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
