// Achievements view: category tabs + gold-halo cards.
//
// Phase F shipped 5 starter achievements only. The category bar exposes the
// 5 planned groups + a 전체 (all) tab. Empty categories show a placeholder.

import { invoke } from "@tauri-apps/api/core";

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
  description: string;
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

const META: Record<string, Meta> = {
  // ── 시작 (start) ──
  first_star: {
    category: "starter", rarity: "common", icon: "star",
    description: "첫 토큰이 별이 되어 우주에 떠올랐습니다.",
  },
  first_planet: {
    category: "starter", rarity: "common", icon: "diamond",
    description: "한 세션에서 5,000 토큰을 채워 첫 행성을 발견했습니다.",
  },
  first_universe: {
    category: "starter", rarity: "common", icon: "compass",
    description: "하루 100별을 넘겨 첫 우주를 형성했습니다.",
  },
  first_constellation: {
    category: "starter", rarity: "common", icon: "constellation",
    description: "별 둘 이상을 이어 첫 별자리를 만들었습니다.",
  },

  // ── 수집 (collect) ──
  codex_quarter: {
    category: "collection", rarity: "common", icon: "diamond",
    description: "도감 8종 발견 — 25 % 도달.",
  },
  codex_half: {
    category: "collection", rarity: "rare", icon: "diamond",
    description: "도감 15종 발견 — 절반 채움.",
  },
  codex_complete: {
    category: "collection", rarity: "mythic", icon: "shield",
    description: "30종 행성을 모두 발견해 도감을 완성했습니다.",
  },
  first_rare_planet: {
    category: "collection", rarity: "rare", icon: "diamond",
    description: "희귀 등급 이상의 행성을 처음 만났습니다.",
  },
  first_legendary_planet: {
    category: "collection", rarity: "legendary", icon: "star",
    description: "전설(Legendary) 등급 행성 발견.",
  },
  first_mythic_planet: {
    category: "collection", rarity: "mythic", icon: "shield",
    description: "신화(Mythic) 등급 행성 발견 — 가장 드문 만남.",
  },

  // ── 시간 (time) ──
  first_black_hole: {
    category: "time", rarity: "rare", icon: "moon",
    description: "토큰 한 톨도 쓰지 않은 하루 — 잠든 우주의 날.",
  },
  first_mega_galaxy: {
    category: "time", rarity: "epic", icon: "flame",
    description: "하루 별 캡 1000에 도달해 거대 은하를 형성.",
  },

  // ── 리듬 (rhythm) — 시간대 누적, 아직 엔진 미구현 ──
  night_owl: {
    category: "rhythm", rarity: "rare", icon: "moon",
    description: "자정~새벽 4시 작업 누적 10시간.",
  },
  early_bird: {
    category: "rhythm", rarity: "rare", icon: "sunrise",
    description: "오전 5시~8시 작업 누적 10시간.",
  },

  // ── 기념 (anniversary) — 연속 기록, 아직 엔진 미구현 ──
  streak_7: {
    category: "anniversary", rarity: "common", icon: "hourglass",
    description: "7일 연속 우주를 형성했습니다.",
  },
  streak_30: {
    category: "anniversary", rarity: "rare", icon: "hourglass",
    description: "30일 연속 우주를 형성했습니다.",
  },
  streak_100: {
    category: "anniversary", rarity: "epic", icon: "shield",
    description: "100일 연속 우주를 형성했습니다.",
  },
  streak_365: {
    category: "anniversary", rarity: "legendary", icon: "shield",
    description: "365일 연속 — 한 해를 우주로 채웠습니다.",
  },
};

const CATEGORY_LABEL: Record<ActiveTab, string> = {
  all: "전체",
  starter: "시작",
  collection: "수집",
  time: "시간",
  rhythm: "리듬",
  anniversary: "기념",
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
        ${CATEGORY_LABEL[activeCat]} — 곧 추가 예정
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
  const when = a.achieved && a.achieved_at
    ? new Date(a.achieved_at).toLocaleDateString("ko-KR")
    : "—";
  const progress = a.achieved ? 100 : 0;
  const description = meta?.description ?? "";
  const rarity = meta?.rarity ?? "common";
  const icon = meta?.icon ?? "star";

  return `
    <li class="ach-card ${cls}">
      <div class="ach-icon">${iconSvg(icon)}</div>
      <div class="ach-body">
        <div class="ach-row1">
          <div class="ach-title">${a.display_name}</div>
          <div class="ach-rarity-tag">${rarity}</div>
        </div>
        <div class="ach-desc">${description}</div>
        <div class="ach-prog-row">
          <span>${a.achieved ? "달성" : "진행 중"}</span>
          <div class="ach-prog-bar">
            <div class="ach-prog-fill" style="width: ${progress}%"></div>
          </div>
          <span>${when}</span>
        </div>
      </div>
    </li>
  `;
}
