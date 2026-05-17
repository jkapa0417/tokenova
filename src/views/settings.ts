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
  wiredUp = true;
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
    $btn.textContent = `v${newVersion} 설치`;
    if ($status) {
      $status.hidden = false;
      $status.textContent = `새 버전 v${newVersion} 사용 가능`;
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
  $btn.textContent = "다운로드 중…";
  if ($status) {
    $status.hidden = false;
    $status.textContent = "업데이트 다운로드 중…";
  }
  try {
    const ok = await installPendingUpdate();
    if (!ok && $status) $status.textContent = "사용 가능한 업데이트가 없습니다.";
  } catch (e) {
    console.error("installPendingUpdate:", e);
    $btn.disabled = false;
    $btn.textContent = "재시도";
    if ($status) $status.textContent = "설치 실패 — 다시 시도해주세요.";
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
    $list.innerHTML = `<div class="settings-error">상태를 불러오지 못했습니다.</div>`;
  }
}

function healthClass(p: ProviderHealth): "ok" | "warn" | "bad" {
  if (!p.exists) return "bad";
  if (!p.kind_ok) return "warn";
  return "ok";
}

function healthLabel(p: ProviderHealth): string {
  if (!p.exists) return "경로 없음";
  if (!p.kind_ok) return "경로 형식 불일치";
  if (p.events_today > 0) return `오늘 ${p.events_today.toLocaleString("ko-KR")}건`;
  if (p.last_event_at) return `최근 ${formatAgo(p.last_event_at)}`;
  return "활동 없음";
}

function formatAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  return `${days}일 전`;
}

function renderCard(p: ProviderHealth): string {
  const cls = healthClass(p);
  const label = healthLabel(p);
  const usingCustom = !!p.custom_path;
  const lastSeen = p.last_event_at
    ? new Date(p.last_event_at).toLocaleString("ko-KR")
    : "—";
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
          <span class="provider-meta-l">최근 활동</span>
          <span class="provider-meta-v">${escapeHtml(lastSeen)}</span>
        </div>
        <div class="provider-meta-row">
          <span class="provider-meta-l">오늘 이벤트</span>
          <span class="provider-meta-v">${p.events_today.toLocaleString("ko-KR")}</span>
        </div>
      </div>
      <div class="provider-path-row">
        <label class="provider-path-label">
          경로 ${usingCustom
            ? '<span class="provider-tag">CUSTOM</span>'
            : '<span class="provider-tag muted">DEFAULT</span>'}
        </label>
        <input
          class="provider-path-input"
          type="text"
          data-default="${escapeAttr(p.default_path)}"
          placeholder="${escapeAttr(p.default_path)}"
          value="${escapeAttr(p.custom_path ?? "")}"
        />
        <div class="provider-actions">
          <button class="provider-btn ghost" data-action="reset" type="button" ${usingCustom ? "" : "disabled"}>
            기본값
          </button>
          <button class="provider-btn primary" data-action="save" type="button">
            저장
          </button>
        </div>
      </div>
      ${usingCustom
        ? `<div class="provider-default-hint">기본: <code>${escapeHtml(p.default_path)}</code></div>`
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
        flashCard(card, "변경됨 · 재시작 시 적용");
        await refresh();
      } catch (e) {
        console.error("set_provider_path:", e);
        flashCard(card, "저장 실패", true);
      }
    });

    resetBtn?.addEventListener("click", async () => {
      try {
        await invoke("clear_provider_path", { providerId: id });
        flashCard(card, "기본값으로 복원 · 재시작 시 적용");
        await refresh();
      } catch (e) {
        console.error("clear_provider_path:", e);
        flashCard(card, "복원 실패", true);
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
