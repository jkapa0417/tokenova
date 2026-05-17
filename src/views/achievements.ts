// Achievements view: category tabs + gold-halo cards.
//
// Phase F shipped 5 starter achievements only. The category bar exposes the
// 5 planned groups + a 전체 (all) tab. Empty categories show a placeholder.

import { invoke } from "@tauri-apps/api/core";

import { getLocale, t } from "../i18n";

type Category = "starter" | "collection" | "time" | "rhythm" | "anniversary";
type ActiveTab = Category | "all";

interface AchievementCard {
  key: string;
  display_name: string;
  achieved: boolean;
  achieved_at: string | null;
}

interface Meta {
  category: Category;
  rarity: string;
  /** Key into `ICONS` — SVG path data for an inline 24×24 viewBox icon. */
  icon: keyof typeof ICONS;
}

// SVG path data lifted verbatim from the design's `ICONS` map
// (`data.jsx:154-165`). 24×24 viewBox, drawn as stroke-only so they pick up
// `currentColor` from the parent card tier.
const ICONS = {
  compass:       "M12 2L14 11L23 13L14 14L12 23L10 14L1 13L10 11L12 2",
  diamond:       "M12 2L22 12L12 22L2 12Z",
  hourglass:     "M5 3H19V5L13 12L19 19V21H5V19L11 12L5 5V3Z",
  clover:        "M12 7C12 4 9 2 7 4C5 6 5 9 7 11C5 13 5 16 7 18C9 20 12 18 12 15C12 18 15 20 17 18C19 16 19 13 17 11C19 9 19 6 17 4C15 2 12 4 12 7Z",
  constellation: "M3 6L11 11L19 4M11 11L14 19M11 11L6 18",
  star:          "M12 2L14.6 9L22 9L16 13L18 21L12 16L6 21L8 13L2 9L9.4 9Z",
  shield:        "M12 2L4 5V11C4 16 7 20 12 22C17 20 20 16 20 11V5L12 2Z",
  flame:         "M12 2C13 6 15 8 15 12C15 16 12 18 12 22C12 18 9 16 9 12C9 8 11 6 12 2Z",
  moon:          "M16 4C12 4 8 8 8 12C8 16 12 20 16 20C13 18 11 15 11 12C11 9 13 6 16 4Z",
  sunrise:       "M3 18H21M5 14L12 7L19 14M9 18V15M15 18V15",
} as const;

// Display strings (name + description) for each achievement live in the i18n
// dict under `achievements.list.<key>.{name,desc}`. Only the structural
// metadata (category, rarity tag, icon) stays here.
const META: Record<string, Meta> = {
  first_star:             { category: "starter",     rarity: "common",    icon: "star" },
  first_planet:           { category: "starter",     rarity: "common",    icon: "diamond" },
  first_universe:         { category: "starter",     rarity: "common",    icon: "compass" },
  first_constellation:    { category: "starter",     rarity: "common",    icon: "constellation" },
  codex_quarter:          { category: "collection",  rarity: "common",    icon: "diamond" },
  codex_half:             { category: "collection",  rarity: "rare",      icon: "diamond" },
  codex_complete:         { category: "collection",  rarity: "mythic",    icon: "shield" },
  first_rare_planet:      { category: "collection",  rarity: "rare",      icon: "diamond" },
  first_legendary_planet: { category: "collection",  rarity: "legendary", icon: "star" },
  first_mythic_planet:    { category: "collection",  rarity: "mythic",    icon: "shield" },
  first_black_hole:       { category: "time",        rarity: "rare",      icon: "moon" },
  first_mega_galaxy:      { category: "time",        rarity: "epic",      icon: "flame" },
  night_owl:              { category: "rhythm",      rarity: "rare",      icon: "moon" },
  early_bird:             { category: "rhythm",      rarity: "rare",      icon: "sunrise" },
  streak_7:               { category: "anniversary", rarity: "common",    icon: "hourglass" },
  streak_30:              { category: "anniversary", rarity: "rare",      icon: "hourglass" },
  streak_100:             { category: "anniversary", rarity: "epic",      icon: "shield" },
  streak_365:             { category: "anniversary", rarity: "legendary", icon: "shield" },
};

const CATEGORY_KEY: Record<ActiveTab, string> = {
  all: "achievements.category.all",
  starter: "achievements.category.start",
  collection: "achievements.category.collect",
  time: "achievements.category.time",
  rhythm: "achievements.category.rhythm",
  anniversary: "achievements.category.milestone",
};

let activeCat: ActiveTab = "all";
let cards: AchievementCard[] = [];
let wiredUp = false;

export async function activateAchievements(): Promise<void> {
  ensureWired();
  await refresh();
}

function ensureWired() {
  if (wiredUp) return;
  document.querySelectorAll<HTMLButtonElement>(".ach-cat").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = (btn.dataset.cat as ActiveTab) ?? "all";
      activeCat = cat;
      document.querySelectorAll<HTMLButtonElement>(".ach-cat").forEach((b) => {
        b.classList.toggle("on", b.dataset.cat === cat);
      });
      render();
    });
  });
  wiredUp = true;
}

async function refresh() {
  try {
    cards = await invoke<AchievementCard[]>("get_achievements");
  } catch (e) {
    console.error("achievements:", e);
    cards = [];
  }
  const $earned = document.getElementById("ach-earned");
  const $total = document.getElementById("ach-total");
  if ($earned) $earned.textContent = String(cards.filter((c) => c.achieved).length);
  if ($total) $total.textContent = String(cards.length);
  render();
}

function render() {
  const $list = document.getElementById("ach-list");
  if (!$list) return;

  const filtered =
    activeCat === "all"
      ? cards
      : cards.filter((c) => (META[c.key]?.category ?? "starter") === activeCat);

  if (filtered.length === 0) {
    $list.innerHTML = `
      <li style="text-align: center; padding: 40px 0; color: var(--fg-3); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;">
        ${t("achievements.coming_soon", { category: t(CATEGORY_KEY[activeCat]) })}
      </li>
    `;
    return;
  }

  $list.innerHTML = filtered.map(renderCard).join("");
}

function iconSvg(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="${ICONS[name]}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  </svg>`;
}

function renderCard(a: AchievementCard): string {
  const meta = META[a.key];
  const cls = a.achieved ? "unlocked" : "locked";
  const dateLocale = getLocale() === "ko" ? "ko-KR" : "en-US";
  const when = a.achieved && a.achieved_at
    ? new Date(a.achieved_at).toLocaleDateString(dateLocale)
    : "—";
  const progress = a.achieved ? 100 : 0;
  // Prefer the locale-aware name/desc from the i18n dict; fall back to the
  // backend's display_name (Rust-side, possibly localized differently).
  const dictName = t(`achievements.list.${a.key}.name`);
  const name = dictName === `achievements.list.${a.key}.name` ? a.display_name : dictName;
  const description = t(`achievements.list.${a.key}.desc`);
  const descSafe = description === `achievements.list.${a.key}.desc` ? "" : description;
  const rarity = meta?.rarity ?? "common";
  const icon = meta?.icon ?? "star";

  return `
    <li class="ach-card ${cls}">
      <div class="ach-icon">${iconSvg(icon)}</div>
      <div class="ach-body">
        <div class="ach-row1">
          <div class="ach-title">${name}</div>
          <div class="ach-rarity-tag">${rarity}</div>
        </div>
        <div class="ach-desc">${descSafe}</div>
        <div class="ach-prog-row">
          <span>${a.achieved ? t("achievements.earned") : t("achievements.progress")}</span>
          <div class="ach-prog-bar">
            <div class="ach-prog-fill" style="width: ${progress}%"></div>
          </div>
          <span>${when}</span>
        </div>
      </div>
    </li>
  `;
}
