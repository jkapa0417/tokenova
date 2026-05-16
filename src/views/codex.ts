// Codex view: 30 planet types grouped by rarity. Discovered cards show a
// procedurally-coloured thumbnail; undiscovered ones show "???".

import { invoke } from "@tauri-apps/api/core";

import { openModal } from "./modal";

type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

interface CodexCard {
  key: string;
  display_name: string;
  rarity: Rarity;
  discovered: boolean;
  discovery_count: number;
  first_discovered_at: string | null;
  last_discovered_at: string | null;
}

interface CodexGroup {
  rarity: Rarity;
  total: number;
  discovered: number;
  cards: CodexCard[];
}

interface CodexPayload {
  groups: CodexGroup[];
  total_count: number;
  discovered_count: number;
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: "일반",
  rare: "희귀",
  epic: "에픽",
  legendary: "전설",
  mythic: "신화",
};

const PLANET_THUMB_COLORS: Record<string, string> = {
  // Common
  earth_like: "#5a8fbf",
  gas_giant: "#d4a574",
  mars_like: "#cd5c3a",
  ice_giant: "#a8d0e6",
  dead_world: "#5a5a6e",
  lava_world: "#ff5733",
  crystal: "#9d4edd",
  ocean_world: "#185fa5",
  desert_world: "#d4a04b",
  mist_world: "#9fa8b8",
  volcanic: "#993c1d",
  jungle: "#3b6d11",
  // Rare
  storm: "#534ab7",
  pearl: "#f4ecf7",
  amethyst: "#9b59b6",
  emerald: "#1b8a64",
  mirror: "#bdc3c7",
  botanical: "#27ae60",
  mystic: "#854f0b",
  twilight: "#7e57c2",
  nocturnal: "#283593",
  multi_ocean: "#0288d1",
  // Epic
  diamond: "#b3e5fc",
  rainbow: "#feca57",
  mask: "#212121",
  golden: "#ffd700",
  grid: "#34495e",
  // Legendary
  eye_world: "#2a2a44",
  ancient_civilization: "#9c7a14",
  // Mythic
  dyson_sphere: "#ff9a4d",
};

let loaded = false;

export async function activateCodex(): Promise<void> {
  if (loaded) return; // Codex is mostly static; refresh on each activation.
  await refresh();
}

export async function refresh(): Promise<void> {
  const $summary = document.getElementById("codex-summary");
  const $content = document.getElementById("codex-content");
  if (!$summary || !$content) return;

  try {
    const payload = await invoke<CodexPayload>("get_codex");
    $summary.innerHTML =
      `발견 <strong>${payload.discovered_count}</strong> / ${payload.total_count}`;
    $content.innerHTML = payload.groups.map(renderGroup).join("");
    attachClickHandlers(payload.groups);
    loaded = true;
  } catch (e) {
    console.error("codex:", e);
    $summary.textContent = "로딩 실패";
  }
}

function renderGroup(group: CodexGroup): string {
  const cards = group.cards.map((c) => renderCard(c)).join("");
  return `
    <div class="codex-group">
      <div class="codex-group-header">
        <span class="codex-rarity-label r-${group.rarity}">${RARITY_LABEL[group.rarity]}</span>
        <span class="codex-progress">${group.discovered} / ${group.total}</span>
      </div>
      <div class="codex-grid">${cards}</div>
    </div>
  `;
}

function renderCard(card: CodexCard): string {
  if (!card.discovered) {
    return `
      <div class="codex-card undiscovered" data-key="${card.key}">
        <div class="codex-thumb">?</div>
        <div class="codex-name">???</div>
      </div>
    `;
  }
  const color = PLANET_THUMB_COLORS[card.key] ?? "#888";
  return `
    <div class="codex-card discovered r-${card.rarity}" data-key="${card.key}">
      <div class="codex-thumb" style="--planet-color: ${color}"></div>
      <div class="codex-name">${card.display_name}</div>
      <div class="codex-count">×${card.discovery_count}</div>
    </div>
  `;
}

function attachClickHandlers(groups: CodexGroup[]) {
  const byKey = new Map<string, CodexCard>();
  for (const g of groups) for (const c of g.cards) byKey.set(c.key, c);
  document.querySelectorAll<HTMLElement>(".codex-card").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.key;
      if (!key) return;
      const card = byKey.get(key);
      if (card) openCardModal(card);
    });
  });
}

function openCardModal(card: CodexCard) {
  if (!card.discovered) {
    openModal(`
      <div class="modal-title">미발견 행성</div>
      <div class="modal-subtitle">${RARITY_LABEL[card.rarity]}</div>
      <p>아직 발견하지 못한 행성입니다. 한 세션에서 5,000 토큰 이상을 사용해 행성을 발견해 보세요.</p>
    `);
    return;
  }
  const color = PLANET_THUMB_COLORS[card.key] ?? "#888";
  const first = card.first_discovered_at
    ? new Date(card.first_discovered_at).toLocaleDateString("ko-KR")
    : "—";
  const last = card.last_discovered_at
    ? new Date(card.last_discovered_at).toLocaleDateString("ko-KR")
    : "—";
  openModal(`
    <div class="codex-thumb" style="--planet-color: ${color}; width: 80px; height: 80px; margin: 0 auto 12px"></div>
    <div class="modal-title" style="text-align: center">${card.display_name}</div>
    <div class="modal-subtitle" style="text-align: center">${RARITY_LABEL[card.rarity]}</div>
    <div class="modal-stat">발견 횟수: ${card.discovery_count}회</div>
    <div class="modal-stat">첫 발견: ${first}</div>
    <div class="modal-stat">최근 발견: ${last}</div>
  `);
}
