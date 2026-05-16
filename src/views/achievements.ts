// Achievements view: category tabs + gold-halo cards.
//
// Phase F shipped 5 starter achievements only. The category bar exposes the
// 5 planned groups (시작 / 수집 / 시간 / 리듬 / 기념). Empty categories show
// a friendly placeholder.

import { invoke } from "@tauri-apps/api/core";

type Category = "starter" | "collection" | "time" | "rhythm" | "anniversary";

interface AchievementCard {
  key: string;
  display_name: string;
  achieved: boolean;
  achieved_at: string | null;
}

// Map starter achievement keys to a rarity-style label + description.
// Other categories surface as "coming soon" placeholders for now.
interface Meta {
  category: Category;
  rarity: string;
  description: string;
  icon: string;
}

const META: Record<string, Meta> = {
  first_star: {
    category: "starter",
    rarity: "common",
    description: "첫 토큰이 별이 되어 우주에 떠올랐습니다.",
    icon: "✦",
  },
  first_planet: {
    category: "starter",
    rarity: "common",
    description: "한 세션에서 5,000 토큰을 채워 첫 행성을 발견했습니다.",
    icon: "✦",
  },
  first_black_hole: {
    category: "time",
    rarity: "rare",
    description: "토큰 한 톨도 쓰지 않은 하루. 블랙홀의 날.",
    icon: "◉",
  },
  first_mega_galaxy: {
    category: "collection",
    rarity: "epic",
    description: "별 300개 이상을 채워 거대 은하를 형성했습니다.",
    icon: "✶",
  },
  first_rare_planet: {
    category: "collection",
    rarity: "rare",
    description: "희귀 등급 이상의 행성을 처음 만났습니다.",
    icon: "✺",
  },
};

const CATEGORY_LABEL: Record<Category, string> = {
  starter: "시작",
  collection: "수집",
  time: "시간",
  rhythm: "리듬",
  anniversary: "기념",
};

let activeCat: Category = "starter";
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
      const cat = (btn.dataset.cat as Category) ?? "starter";
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

  const filtered = cards.filter((c) => (META[c.key]?.category ?? "starter") === activeCat);

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

function renderCard(a: AchievementCard): string {
  const meta = META[a.key] ?? { rarity: "common", description: "", icon: "✦" };
  const cls = a.achieved ? "unlocked" : "locked";
  const when = a.achieved && a.achieved_at
    ? new Date(a.achieved_at).toLocaleDateString("ko-KR")
    : "—";
  const progress = a.achieved ? 100 : 0;

  return `
    <li class="ach-card ${cls}">
      <div class="ach-icon">${meta.icon}</div>
      <div class="ach-body">
        <div class="ach-row1">
          <div class="ach-title">${a.display_name}</div>
          <div class="ach-rarity-tag">${meta.rarity}</div>
        </div>
        <div class="ach-desc">${meta.description}</div>
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
