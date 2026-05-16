// Tokenova — design v2 entry point.
//
// Owns:
// - tab routing (#today / #codex / #achievements / #gallery)
// - topbar token pill polling (every 3s)
// - lifecycle hooks per view (activate/deactivate)

import { invoke } from "@tauri-apps/api/core";

import { activateAchievements } from "./views/achievements";
import { activateCodex } from "./views/codex";
import { activateGallery } from "./views/gallery";
import { activateToday, deactivateToday } from "./views/today";

type TabKey = "today" | "codex" | "achievements" | "gallery";

const DEFAULT_TAB: TabKey = "today";
const TOKEN_PILL_INTERVAL_MS = 3000;

let activeTab: TabKey | null = null;

const numberFmt = new Intl.NumberFormat("ko-KR");

function isTabKey(value: string | null | undefined): value is TabKey {
  return value === "today" || value === "codex" || value === "achievements" || value === "gallery";
}

function readHashTab(): TabKey {
  const hash = window.location.hash.replace(/^#/, "");
  return isTabKey(hash) ? hash : DEFAULT_TAB;
}

async function switchTab(target: TabKey, updateHash = true): Promise<void> {
  if (activeTab === target) return;
  if (activeTab === "today") {
    deactivateToday();
  }
  activeTab = target;

  if (updateHash && window.location.hash.replace(/^#/, "") !== target) {
    history.replaceState(null, "", `#${target}`);
  }

  document.querySelectorAll<HTMLElement>(".tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === target);
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((el) => {
    el.hidden = el.dataset.view !== target;
  });

  switch (target) {
    case "today":
      activateToday();
      break;
    case "codex":
      await activateCodex();
      break;
    case "achievements":
      await activateAchievements();
      break;
    case "gallery":
      await activateGallery();
      break;
  }
}

function attachTabClicks() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (isTabKey(tab)) void switchTab(tab);
    });
  });
}

async function refreshTokenPill(): Promise<void> {
  try {
    const total = await invoke<number>("get_today_total");
    const value = document.getElementById("token-pill-value");
    if (!value) return;
    value.textContent = total > 0 ? `${numberFmt.format(total)} TKN` : "0";
  } catch {
    // Silent — keeps the previous value displayed.
  }
}

window.addEventListener("DOMContentLoaded", () => {
  attachTabClicks();
  void switchTab(readHashTab(), false);
  void refreshTokenPill();
  setInterval(() => void refreshTokenPill(), TOKEN_PILL_INTERVAL_MS);
});

window.addEventListener("hashchange", () => {
  void switchTab(readHashTab(), false);
});
