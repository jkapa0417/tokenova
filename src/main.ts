// Tokenova — Phase E entry point. Tab manager + view activation.
//
// Each view module owns its own DOM (under #app .view[data-view=...]) and
// exposes an async `activate*()` hook. Today also has a `deactivateToday()`
// to pause its polling timer; other views are static enough to skip.

import { activateAchievements } from "./views/achievements";
import { activateCodex } from "./views/codex";
import { activateGallery } from "./views/gallery";
import { activateToday, deactivateToday } from "./views/today";

type TabKey = "today" | "codex" | "achievements" | "gallery";

const TABS: TabKey[] = ["today", "codex", "achievements", "gallery"];

const DEFAULT_TAB: TabKey = "today";

let activeTab: TabKey | null = null;

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

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((el) => {
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

window.addEventListener("DOMContentLoaded", () => {
  attachTabClicks();
  void switchTab(readHashTab(), false);
});

window.addEventListener("hashchange", () => {
  void switchTab(readHashTab(), false);
});

// keep TABS referenced (helps tree-shake but mostly documents the set)
void TABS;
