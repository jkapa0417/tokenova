// Tokenova — design v2 entry point.
//
// Owns:
// - tab routing (#today / #codex / #achievements / #gallery)
// - topbar token pill polling (every 3s)
// - lifecycle hooks per view (activate/deactivate)

import { invoke } from "@tauri-apps/api/core";

import { activateAchievements } from "./views/achievements";
import {
  activateCodex,
  closeConstellationDetail,
  closePlanetModal,
} from "./views/codex";
import { activateGallery, closeGalleryOverlay } from "./views/gallery";
import { activateSettings } from "./views/settings";
import { activateToday, deactivateToday } from "./views/today";

type TabKey = "today" | "codex" | "achievements" | "gallery" | "settings";

const DEFAULT_TAB: TabKey = "today";
const TOKEN_PILL_INTERVAL_MS = 3000;

let activeTab: TabKey | null = null;

const numberFmt = new Intl.NumberFormat("ko-KR");

function isTabKey(value: string | null | undefined): value is TabKey {
  return value === "today" || value === "codex" || value === "achievements"
    || value === "gallery" || value === "settings";
}

function readHashTab(): TabKey {
  const hash = window.location.hash.replace(/^#/, "");
  return isTabKey(hash) ? hash : DEFAULT_TAB;
}

async function switchTab(target: TabKey, updateHash = true): Promise<void> {
  if (activeTab === target) return;
  // Dismiss any open modal/overlay before switching — a planet detail or a
  // constellation detail belonging to the previous tab shouldn't bleed into
  // the next one.
  closeAllModals();
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
    case "settings":
      await activateSettings();
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

/**
 * Closes every modal/overlay in the app. Called on tab switch and from the
 * global Esc / close-button handlers wired below. Each module's closer takes
 * care of its own renderer/observer cleanup.
 */
function closeAllModals() {
  closeGalleryOverlay();
  closeConstellationDetail();
  closePlanetModal();
  // Discovery overlay closes via its own DISMISS / CODEX buttons. Hiding it
  // here keeps the screen clean on tab switch; pending discoveries fall
  // back to the +N badge on Today next time.
  const disc = document.getElementById("discovery-overlay");
  if (disc) disc.hidden = true;
}

function wireGlobalModalHandlers() {
  // `gal-overlay` is shared between Gallery detail and Constellation detail.
  // Wire its chrome once at init so closing works regardless of which view
  // opened it (the previous setup only attached during Gallery activation).
  const galOverlay = document.getElementById("gal-overlay");
  const galClose = document.getElementById("gal-overlay-close");
  galClose?.addEventListener("click", () => {
    closeGalleryOverlay();
    closeConstellationDetail();
  });
  galOverlay?.addEventListener("click", (e) => {
    if (e.target === galOverlay) {
      closeGalleryOverlay();
      closeConstellationDetail();
    }
  });

  // Planet quick-detail modal.
  const planetModal = document.getElementById("planet-modal");
  const planetClose = document.getElementById("planet-modal-close");
  planetClose?.addEventListener("click", () => closePlanetModal());
  planetModal?.addEventListener("click", (e) => {
    if (e.target === planetModal) closePlanetModal();
  });

  // Global Escape: close anything that's open.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Ignore Escape while typing into the drawing-bar name input — its
      // own handler returns to the count row instead of closing modals.
      const target = e.target as HTMLElement | null;
      if (target && target.id === "draw-bar-name") return;
      closeAllModals();
    }
  });
}

async function refreshTokenPill(): Promise<void> {
  try {
    const total = await invoke<number>("get_today_total");
    const value = document.getElementById("token-pill-value");
    if (!value) return;
    value.textContent = total > 0 ? formatCompactTokens(total) : "0";
  } catch {
    // Silent — keeps the previous value displayed.
  }
}

/**
 * Compact token formatting for the topbar pill — full digits up to 9 figures,
 * then "1.0B / 12.3B" past 1,000,000,000. The main Today HUD stays at full
 * digits via `numberFmt`; only the pill collapses.
 */
function formatCompactTokens(n: number): string {
  if (n < 1_000_000_000) return numberFmt.format(n);
  const billions = n / 1_000_000_000;
  return billions >= 10
    ? `${Math.round(billions)}B`
    : `${(Math.round(billions * 10) / 10).toFixed(1)}B`;
}

window.addEventListener("DOMContentLoaded", () => {
  attachTabClicks();
  wireGlobalModalHandlers();
  void switchTab(readHashTab(), false);
  void refreshTokenPill();
  setInterval(() => void refreshTokenPill(), TOKEN_PILL_INTERVAL_MS);
});

window.addEventListener("hashchange", () => {
  void switchTab(readHashTab(), false);
});
