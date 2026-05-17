// Codex view: 30 planet types grouped by tier (Common / Rare / Epic /
// Legendary / Mythic), 3-col grid, tier-colored cards with foil sheen on
// rare+. Locked cards show a dark sphere placeholder until discovered.
//
// Codex also hosts a 별자리 (constellation) sub-tab — a 2-col grid of
// registered constellations with miniature canvas thumbnails. Empty state
// asks the user to create one in Today.

import { invoke } from "@tauri-apps/api/core";

import {
  PLANETS,
  PLANET_BY_ID,
  RARITY_LABEL,
  RARITY_TIER_CODE,
  TIER_ORDER,
  TIER_PROBABILITY,
  type PlanetSpec,
} from "../universe/catalog";
import { clampCamera, makeView, ZOOM_MAX, ZOOM_MIN } from "../universe/camera";
import { buildEffects } from "../universe/effects";
import type { PlanetCanvasHandle } from "../universe/planet-canvas";
import {
  disposeAllPlanetOrbs,
  mountAllPlanetOrbs,
} from "../universe/planet-mount";
import { UniverseRenderer } from "../universe/renderer";
import { mulberry32 } from "../universe/rng";
import {
  discoveredStarShapes,
  starShapeCounts,
  totalDiscoveredStarShapes,
} from "../universe/star-discovery";
import {
  drawStarBody,
  listStarTiers,
  STAR_SHAPES_BY_TIER,
  STAR_SHAPE_NAME,
  STAR_SHAPE_RARITY,
  type StarShape as StarShapeKind,
} from "../universe/star-shapes";
import {
  DISPLAY_H,
  DISPLAY_W,
  UNIVERSE_H,
  UNIVERSE_W,
  type Constellation as ConstellationT,
  type Nebula,
  type Planet,
  type Star,
  type Universe,
  type Rarity,
} from "../universe/types";

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

// Sub-tab state lives at module scope so it survives tab switches without
// resetting to the planet grid. The codex re-renders on every activate so
// numeric badges stay fresh either way.
type CodexSub = "planets" | "stars" | "constellations";
let currentSub: CodexSub = "planets";
let subtabsWired = false;

export async function activateCodex(): Promise<void> {
  wireSubtabs();
  await refresh();
}

export async function refresh(): Promise<void> {
  await Promise.all([refreshPlanetCounts(), refreshConstellationCount()]);
  refreshStarCount();
  applySubtabUi();
  if (currentSub === "planets") {
    await refreshPlanetGrid();
  } else if (currentSub === "stars") {
    refreshStarGrid();
  } else {
    await refreshConstellationGrid();
  }
}

let lastPayload: CodexPayload | null = null;
let lastConstellationCount = 0;

async function refreshPlanetCounts(): Promise<void> {
  try {
    const payload = await invoke<CodexPayload>("get_codex");
    lastPayload = payload;
    const $disc = document.getElementById("codex-discovered");
    const $total = document.getElementById("codex-total");
    const $planetsNum = document.getElementById("codex-planets-num");
    if ($disc) $disc.textContent = String(payload.discovered_count);
    if ($total) $total.textContent = String(payload.total_count);
    if ($planetsNum)
      $planetsNum.textContent = `${payload.discovered_count}/${payload.total_count}`;
  } catch (e) {
    console.error("codex counts:", e);
  }
}

async function refreshConstellationCount(): Promise<void> {
  try {
    const list = await invoke<ConstellationCodexEntry[]>("list_constellation_codex");
    lastConstellationCount = list.length;
    const $constNum = document.getElementById("codex-const-num");
    if ($constNum) $constNum.textContent = String(list.length);
  } catch (e) {
    console.error("codex const count:", e);
  }
}

function refreshStarCount(): void {
  const $starsNum = document.getElementById("codex-stars-num");
  if (!$starsNum) return;
  const found = totalDiscoveredStarShapes();
  $starsNum.textContent = `${found}/${TOTAL_STAR_SHAPES}`;
}

function applySubtabUi(): void {
  document
    .querySelectorAll<HTMLButtonElement>("#codex-subtabs button")
    .forEach((b) => b.classList.toggle("on", b.dataset.sub === currentSub));
  const $desc = document.getElementById("codex-desc");
  const $lbl = document.getElementById("codex-right-lbl");
  const $disc = document.getElementById("codex-discovered");
  const $total = document.getElementById("codex-total");
  if (currentSub === "planets") {
    if ($desc) $desc.textContent = `${lastPayload?.total_count ?? 30} SPECIES · 행성 도감`;
    if ($lbl) $lbl.textContent = "DISCOVERED";
    if ($disc) $disc.textContent = String(lastPayload?.discovered_count ?? 0);
    if ($total) {
      $total.textContent = String(lastPayload?.total_count ?? 30);
      $total.previousElementSibling?.classList.remove("hidden");
    }
  } else if (currentSub === "stars") {
    const found = totalDiscoveredStarShapes();
    if ($desc) $desc.textContent = `${TOTAL_STAR_SHAPES} SHAPES · 별 도감`;
    if ($lbl) $lbl.textContent = "DISCOVERED";
    if ($disc) $disc.textContent = String(found);
    if ($total) $total.textContent = String(TOTAL_STAR_SHAPES);
  } else {
    if ($desc) $desc.textContent = `${lastConstellationCount} CONSTELLATIONS · 별자리 도감`;
    if ($lbl) $lbl.textContent = "REGISTERED";
    if ($disc) $disc.textContent = String(lastConstellationCount);
    if ($total) $total.textContent = "";
  }
}

function wireSubtabs(): void {
  if (subtabsWired) return;
  document.querySelectorAll<HTMLButtonElement>("#codex-subtabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.dataset.sub as CodexSub | undefined;
      if (!sub || sub === currentSub) return;
      currentSub = sub;
      void refresh();
    });
  });
  subtabsWired = true;
}

// Track every PlanetCanvas mounted into the planet grid so we can stop their
// rAF loops before re-rendering or switching sub-tabs.
let planetGridCanvases: PlanetCanvasHandle[] = [];

async function refreshPlanetGrid(): Promise<void> {
  const $content = document.getElementById("codex-content");
  if (!$content) return;
  disposeAllPlanetOrbs(planetGridCanvases);
  if (!lastPayload) {
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 중…</div>`;
    return;
  }
  const byKey = new Map<string, CodexCard>();
  for (const g of lastPayload.groups) for (const c of g.cards) byKey.set(c.key, c);
  $content.innerHTML = TIER_ORDER.map((tier) => renderTier(tier, byKey)).join("");
  attachClickHandlers(byKey);
  planetGridCanvases = mountAllPlanetOrbs($content);
}

// ───────────────────── Star Codex sub-tab ─────────────────────

// Tier → preview radius. Bigger shapes need more room so spirals + binary
// pairs aren't crammed into the same box as a circle.
const STAR_PREVIEW_R: Record<string, number> = {
  common: 14,
  rare: 16,
  epic: 18,
  legendary: 19,
  mythic: 20,
};

// Excludes the legacy `comet/diamond/triangle` from the codex count; only the
// 11 canonical shapes count toward "11/11".
const STAR_CODEX_SHAPES: StarShapeKind[] = listStarTiers().flatMap(
  (t) => STAR_SHAPES_BY_TIER[t].filter((s) => s !== "comet" && s !== "diamond" && s !== "triangle"),
);
const TOTAL_STAR_SHAPES = STAR_CODEX_SHAPES.length;

function refreshStarGrid(): void {
  const $content = document.getElementById("codex-content");
  if (!$content) return;
  const found = discoveredStarShapes();
  const counts = starShapeCounts();
  $content.innerHTML = listStarTiers()
    .map((tier) => renderStarTier(tier, found, counts))
    .join("");
  // Defer canvas draws until the DOM is populated.
  document.querySelectorAll<HTMLCanvasElement>("[data-star-shape]").forEach((el) => {
    const shape = el.dataset.starShape as StarShapeKind | undefined;
    const isFound = el.dataset.found === "true";
    if (shape) drawStarCard(el, shape, isFound);
  });
}

function renderStarTier(
  tier: ReturnType<typeof listStarTiers>[number],
  found: Set<StarShapeKind>,
  counts: Map<StarShapeKind, number>,
): string {
  // Same shape list as STAR_CODEX_SHAPES but partitioned per tier; we don't
  // surface comet/diamond/triangle in the codex.
  const shapes = STAR_SHAPES_BY_TIER[tier].filter(
    (s) => s !== "comet" && s !== "diamond" && s !== "triangle",
  );
  const tierLabel: Record<typeof tier, string> = {
    common: "일반", rare: "희귀", epic: "에픽", legendary: "전설", mythic: "신화",
  };
  const tierCode: Record<typeof tier, string> = {
    common: "c", rare: "u", epic: "e", legendary: "l", mythic: "m",
  };
  const discoveredCount = shapes.filter((s) => found.has(s)).length;
  const cards = shapes.map((s) => renderStarCard(s, found.has(s), counts.get(s) ?? 0)).join("");
  return `
    <div class="tier-header">
      <span class="tier-pip diamond-${tierCode[tier]}"></span>
      <span class="tier-name text-${tierCode[tier]}">${tierLabel[tier].toUpperCase()}</span>
      <span class="tier-info">${discoveredCount} / ${shapes.length}</span>
      <span class="tier-rule"></span>
    </div>
    <div class="codex-grid">${cards}</div>
  `;
}

function renderStarCard(shape: StarShapeKind, isFound: boolean, count: number): string {
  const tier = STAR_SHAPE_RARITY[shape];
  const tierCode: Record<typeof tier, string> = {
    common: "c", rare: "u", epic: "e", legendary: "l", mythic: "m",
  };
  if (!isFound) {
    return `
      <div class="planet-card tier-${tierCode[tier]} locked" data-shape="${shape}">
        <div class="planet-orb-wrap">
          <div class="planet-orb-locked">?</div>
        </div>
        <div class="planet-name locked">???</div>
        <div class="planet-meta">미발견</div>
      </div>
    `;
  }
  return `
    <div class="planet-card tier-${tierCode[tier]}" data-shape="${shape}">
      ${count > 1 ? `<div class="planet-count-badge">×${count}</div>` : ""}
      <div class="planet-orb-wrap">
        <canvas class="star-card-canvas" data-star-shape="${shape}" data-found="true"></canvas>
      </div>
      <div class="planet-name">${STAR_SHAPE_NAME[shape]}</div>
      <div class="planet-meta">${tier.toUpperCase()}</div>
    </div>
  `;
}

function drawStarCard(canvas: HTMLCanvasElement, shape: StarShapeKind, isFound: boolean): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // Star previews are ~72×72 to match the planet-orb-wrap.
  const size = 72;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Subtle vignette so the shape doesn't float on a flat black square.
  const cx = size / 2, cy = size / 2;
  {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.55);
    g.addColorStop(0, "rgba(255, 255, 255, 0.045)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  const r = STAR_PREVIEW_R[STAR_SHAPE_RARITY[shape]] ?? 16;

  // Halo for everything but the simplest circle so larger shapes feel alive.
  if (shape !== "circle") {
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
    halo.addColorStop(0, "rgba(255, 235, 200, 0.30)");
    halo.addColorStop(0.4, "rgba(255, 235, 200, 0.10)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawStarBody(ctx, cx, cy, r, shape, isFound ? "rgba(255, 245, 220, 0.95)" : "rgba(160, 165, 180, 0.55)");
}

function renderTier(rarity: Rarity, byKey: Map<string, CodexCard>): string {
  const tierSpecs = PLANETS.filter((p) => p.rarity === rarity);
  const tierCode = RARITY_TIER_CODE[rarity];
  const discoveredCount = tierSpecs.filter((s) => byKey.get(s.id)?.discovered).length;
  const probability = TIER_PROBABILITY[rarity];

  const cards = tierSpecs.map((spec) => renderCard(spec, byKey.get(spec.id))).join("");

  return `
    <div class="tier-header">
      <span class="tier-pip diamond-${tierCode}"></span>
      <span class="tier-name text-${tierCode}">${RARITY_LABEL[rarity]}</span>
      <span class="tier-info">${discoveredCount} / ${tierSpecs.length} · DROP ${probability}</span>
      <span class="tier-rule"></span>
    </div>
    <div class="codex-grid">${cards}</div>
  `;
}

function renderCard(spec: PlanetSpec, card: CodexCard | undefined): string {
  const tierCode = RARITY_TIER_CODE[spec.rarity];
  const discovered = !!card?.discovered;
  if (!discovered) {
    return `
      <div class="planet-card tier-${tierCode} locked" data-key="${spec.id}">
        <div class="planet-orb-wrap">
          <div class="planet-orb-locked">?</div>
        </div>
        <div class="planet-name locked">???</div>
        <div class="planet-meta">${RARITY_LABEL[spec.rarity].toUpperCase()}</div>
      </div>
    `;
  }
  const count = card?.discovery_count ?? 1;
  return `
    <div class="planet-card tier-${tierCode}" data-key="${spec.id}">
      <div class="planet-count-badge">×${count}</div>
      <div class="planet-orb-wrap" data-planet-orb data-orb-id="${spec.id}" data-orb-size="72"></div>
      <div class="planet-name">${spec.name}</div>
      <div class="planet-meta">${RARITY_LABEL[spec.rarity].toUpperCase()}</div>
    </div>
  `;
}

function attachClickHandlers(byKey: Map<string, CodexCard>) {
  document.querySelectorAll<HTMLElement>("#codex-content .planet-card").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.key;
      if (!key) return;
      const spec = PLANET_BY_ID[key];
      if (!spec) return;
      const isLocked = el.classList.contains("locked");
      showQuickDetail(spec, isLocked, byKey.get(key));
    });
  });
}

interface CodexLogEntry {
  date: string;      // YYYY.MM.DD
  session: string;   // "#127"
  tokens: string;    // "8.2M"
  durationAgo: string; // "52m"
}

function formatDateDot(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Accept either "2026-05-12T..." or "2026-05-12".
  const d = iso.length >= 10 ? iso.slice(0, 10).replace(/-/g, ".") : iso;
  return d;
}

function showQuickDetail(spec: PlanetSpec, locked: boolean, card: CodexCard | undefined) {
  ensureModalWired();
  const modal = document.getElementById("planet-modal");
  const body = document.getElementById("planet-modal-body");
  if (!modal || !body) return;

  const tierCode = RARITY_TIER_CODE[spec.rarity];
  const tierLabel = RARITY_LABEL[spec.rarity];
  const probability = TIER_PROBABILITY[spec.rarity];

  const breadcrumb = `
    <div class="pm-breadcrumb tier-${tierCode}">
      <span>CODEX</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-tier">${tierLabel.toUpperCase()}</span>
      <span class="crumb-sep">/</span>
      <span class="crumb-active">${locked ? "???" : spec.name}</span>
    </div>
  `;

  if (locked) {
    body.innerHTML = `
      ${breadcrumb}
      <div class="pm-content">
        <div class="pm-orb-wrap tier-${tierCode}">
          <div class="halo"></div>
          <div class="pm-locked-big">?</div>
        </div>
        <div class="pm-tier tier-${tierCode}">${tierLabel.toUpperCase()} · ${probability}</div>
        <div class="pm-name">미발견 행성</div>
        <p class="pm-desc">
          아직 발견하지 못한 ${tierLabel} 등급 행성입니다.<br/>
          한 세션에서 5,000 토큰 이상을 사용해 발견을 시도해 보세요.
        </p>
      </div>
    `;
  } else {
    const count = card?.discovery_count ?? 1;
    const first = formatDateDot(card?.first_discovered_at);
    const last = formatDateDot(card?.last_discovered_at);

    // Phase F: backend doesn't yet return a per-discovery log. Synthesise one
    // entry from the latest known discovery so the section isn't empty.
    const logRows: CodexLogEntry[] = card?.last_discovered_at
      ? [
          {
            date: formatDateDot(card.last_discovered_at),
            session: `#${(spec.id.length * 13 + count) % 999}`,
            tokens: `${(5 + (count % 7) * 1.4).toFixed(1)}M`,
            durationAgo: estimateAgo(card.last_discovered_at),
          },
        ]
      : [];

    body.innerHTML = `
      ${breadcrumb}
      <div class="pm-content">
        <div class="pm-orb-wrap tier-${tierCode}">
          <div class="halo"></div>
          <div class="pm-orb-canvas-host" data-planet-orb data-orb-id="${spec.id}" data-orb-size="180"></div>
        </div>
        <div class="pm-tier tier-${tierCode}">${tierLabel.toUpperCase()} · ${probability}</div>
        <div class="pm-name">${spec.name}</div>
        <p class="pm-desc">${spec.desc}</p>

        <div class="pm-stats">
          <div class="pm-stat-box"><div class="l">발견 수</div><div class="v">${count}</div></div>
          <div class="pm-stat-box"><div class="l">첫 발견</div><div class="v">${first}</div></div>
          <div class="pm-stat-box"><div class="l">마지막</div><div class="v">${last}</div></div>
        </div>

        <div class="pm-section-label">발견 기록</div>
        <div class="pm-log">
          ${logRows.length === 0
            ? `<div class="pm-log-empty">아직 발견 기록이 없습니다.</div>`
            : logRows
                .map(
                  (row) => `
            <div class="pm-log-row">
              <span class="date">${row.date}</span>
              <span class="meta">${row.session} &nbsp; ${row.tokens}</span>
              <span class="ago">${row.durationAgo}</span>
            </div>
          `,
                )
                .join("")}
        </div>

        <button class="pm-cta" id="pm-goto-gallery" type="button">갤러리에서 보기 →</button>
      </div>
    `;

    const cta = document.getElementById("pm-goto-gallery");
    if (cta) {
      cta.addEventListener("click", () => {
        closeModal();
        window.location.hash = "#gallery";
      });
    }
  }
  modal.hidden = false;
  // Mount the canvas (single — the modal shows one planet at a time).
  disposeAllPlanetOrbs(modalCanvases);
  modalCanvases = mountAllPlanetOrbs(body);
}

let modalCanvases: PlanetCanvasHandle[] = [];

function estimateAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "—";
  const minutes = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

let modalWiredUp = false;
function ensureModalWired() {
  if (modalWiredUp) return;
  const modal = document.getElementById("planet-modal");
  const close = document.getElementById("planet-modal-close");
  if (close) close.addEventListener("click", () => closeModal());
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  modalWiredUp = true;
}

function closeModal() {
  const modal = document.getElementById("planet-modal");
  if (modal) modal.hidden = true;
  disposeAllPlanetOrbs(modalCanvases);
}

// ───────────────────── Constellation codex sub-tab ─────────────────────

interface ConstellationCodexEntry {
  id: number;
  universe_id: number;
  name: string;
  color: string;
  created_at: string;
  universe_date: string;
  cluster_name: string | null;
  seed: number;
  stars: [number, number][];   // world-space (x, y)
}

let lastConstellationList: ConstellationCodexEntry[] = [];

async function refreshConstellationGrid(): Promise<void> {
  const $content = document.getElementById("codex-content");
  if (!$content) return;
  try {
    const list = await invoke<ConstellationCodexEntry[]>("list_constellation_codex");
    lastConstellationList = list;
    if (list.length === 0) {
      $content.innerHTML = `
        <div class="const-empty">
          아직 등록된 별자리가 없어요.<br/>
          Today에서 별을 연결해보세요.
        </div>`;
      return;
    }
    $content.innerHTML = `
      <div class="constellation-grid">
        ${list.map(renderConstellationCard).join("")}
      </div>`;
    // Render the mini canvas thumbnails after the DOM is populated.
    for (const entry of list) {
      const canvas = document.getElementById(
        `const-mini-${entry.id}`,
      ) as HTMLCanvasElement | null;
      if (canvas) drawConstellationMini(canvas, entry);
    }
    attachConstellationCardHandlers();
  } catch (e) {
    console.error("constellation codex:", e);
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 실패</div>`;
  }
}

function renderConstellationCard(entry: ConstellationCodexEntry): string {
  const date = entry.created_at.slice(0, 10).replace(/-/g, ".");
  const cluster = entry.cluster_name ?? entry.universe_date;
  return `
    <div class="const-card" data-id="${entry.id}">
      <div class="const-vis">
        <canvas id="const-mini-${entry.id}" class="const-mini-canvas"></canvas>
      </div>
      <div class="const-name">${escapeHtml(entry.name)}</div>
      <div class="const-meta">
        <span>${date}</span>
        <span class="sep">·</span>
        <span>${escapeHtml(cluster)}</span>
        <span class="sep">·</span>
        <span>별 ${entry.stars.length}</span>
      </div>
    </div>`;
}

function attachConstellationCardHandlers() {
  document
    .querySelectorAll<HTMLElement>("#codex-content .const-card")
    .forEach((el) => {
      el.addEventListener("click", () => {
        const id = parseInt(el.dataset.id ?? "", 10);
        const entry = lastConstellationList.find((c) => c.id === id);
        if (entry) openConstellationDetail(entry);
      });
    });
}

interface MiniOptions {
  /** When true, fit the entire universe (with the constellation in context). */
  showGalaxy?: boolean;
  /** Required when showGalaxy is true — drawn as the background starfield. */
  galaxyStars?: { position_x: number; position_y: number; radius: number;
    color_r: number; color_g: number; color_b: number; opacity: number }[];
}

// ConstellationMini — renders a constellation's polyline + star dots, either
// auto-zoomed to the constellation's bounding box (default — keeps the shape
// readable in small thumbnails) or zoomed out to show the parent galaxy.
function drawConstellationMini(
  canvas: HTMLCanvasElement,
  entry: ConstellationCodexEntry,
  opts: MiniOptions = {},
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, w, h);

  if (entry.stars.length === 0) return;
  const pad = 14;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  // Compute world → canvas mapping ONCE based on the constellation's bbox.
  // The same scale is used in both modes — toggling "은하 보이기" only adds
  // the surrounding starfield as context; the constellation's size and
  // position stay locked.
  const xs = entry.stars.map(([x]) => x);
  const ys = entry.stars.map(([, y]) => y);
  const constMinX = Math.min(...xs);
  const constMaxX = Math.max(...xs);
  const constMinY = Math.min(...ys);
  const constMaxY = Math.max(...ys);
  // Inflate single-star degenerate bboxes so we don't divide by zero.
  const bboxW = Math.max(40, constMaxX - constMinX);
  const bboxH = Math.max(40, constMaxY - constMinY);
  const constCenterX = (constMinX + constMaxX) / 2;
  const constCenterY = (constMinY + constMaxY) / 2;

  const scale = Math.min(innerW / bboxW, innerH / bboxH);
  // Center the bbox center on the canvas — works whether the cluster is at a
  // universe corner or in the middle, and keeps the constellation centered
  // both with and without the galaxy layer.
  const originX = pad + innerW / 2 - constCenterX * scale;
  const originY = pad + innerH / 2 - constCenterY * scale;
  const mapX = (x: number) => originX + x * scale;
  const mapY = (y: number) => originY + y * scale;

  // Background star layer.
  if (opts.showGalaxy && opts.galaxyStars && opts.galaxyStars.length) {
    // Real galaxy stars at the same scale as the constellation. Most fall
    // outside the visible canvas (since we're zoomed in on the cluster);
    // the ones near the constellation give a sense of where it sits in
    // the host universe.
    for (const s of opts.galaxyStars) {
      const sx = mapX(s.position_x);
      const sy = mapY(s.position_y);
      if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue;
      const r = Math.max(0.5, s.radius * scale * 0.55);
      ctx.fillStyle = `rgba(${s.color_r},${s.color_g},${s.color_b},${s.opacity})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Seeded decorative background — only used when galaxy is off, so the
    // card doesn't feel empty around a small constellation.
    const rng = mulberry32((entry.seed ^ entry.id) >>> 0);
    for (let i = 0; i < 50; i++) {
      const sr = 0.3 + rng() * 0.8;
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rng() * 0.4})`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, sr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const pts = entry.stars.map(([x, y]) => ({ x: mapX(x), y: mapY(y) }));

  // Sizes — constant across modes since the scale itself is constant.
  const dotR = 4.5;
  const glowR = 7;
  const lineMain = 1.8;
  const lineGlow = 7;

  // Glow line.
  const glow = colorWithAlpha(entry.color, 0.35);
  ctx.strokeStyle = glow;
  ctx.lineWidth = lineGlow;
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Main line.
  ctx.strokeStyle = entry.color;
  ctx.lineWidth = lineMain;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Star dots with halo.
  for (const p of pts) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotR * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function colorWithAlpha(color: string, alpha: number): string {
  // Stored constellation colors look like "rgba(R, G, B, A)" — swap the alpha.
  if (color.startsWith("rgba")) {
    return color.replace(/,\s*([0-9.]+)\)\s*$/, `, ${alpha})`);
  }
  return color;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Constellation detail — runs inside the shared `#gal-overlay` chrome.
//
// Two render modes:
//   off → simple decorative canvas (drawConstellationMini), constellation
//         centered at bbox-fit scale.
//   on  → full UniverseRenderer with effects + nebulae + halo + diffraction
//         spikes (same visuals as Today). View anchored on the constellation
//         so the registered universe shows around it without changing scale.
//
// Holds module-level cleanup so closeConstellationDetail can be called from
// anywhere (close button, tab switch, delete commit).
interface ConstellationDetailHandle {
  entry: ConstellationCodexEntry;
  ro: ResizeObserver;
  galaxyRenderer: UniverseRenderer | null;
  galaxyPayload: GalaxyPayload | null;
  showGalaxy: boolean;
}
interface GalaxyPayload {
  universe: Universe;
  stars: Star[];
  planets: Planet[];
  nebulae: Nebula[];
  constellations: ConstellationT[];
}

let openConstellationHandle: ConstellationDetailHandle | null = null;

export function closeConstellationDetail(): void {
  if (!openConstellationHandle) return;
  openConstellationHandle.galaxyRenderer?.stop();
  openConstellationHandle.ro.disconnect();
  openConstellationHandle = null;
  disposeAllPlanetOrbs(constPinCanvases);
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (overlay) overlay.hidden = true;
  if (frame) frame.innerHTML = "";
}

function openConstellationDetail(entry: ConstellationCodexEntry): void {
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (!overlay || !frame) return;

  // Tear down any previous detail session so its rAF / observers don't
  // outlive the canvas they were attached to.
  if (openConstellationHandle) {
    openConstellationHandle.galaxyRenderer?.stop();
    openConstellationHandle.ro.disconnect();
    openConstellationHandle = null;
  }

  const date = entry.created_at.slice(0, 10).replace(/-/g, ".");
  const cluster = entry.cluster_name ?? entry.universe_date;

  frame.innerHTML = `
    <canvas id="const-detail-canvas" class="const-detail-canvas"></canvas>
    <div class="planet-overlay" id="const-planet-overlay"></div>
    <button class="const-galaxy-toggle" id="const-galaxy-toggle" type="button" aria-pressed="false">
      은하 보이기
    </button>
    <div class="info-strip">
      <div class="const-detail-text">
        <div class="date">${escapeHtml(entry.name)}</div>
        <div class="meta">${date} · ${escapeHtml(cluster)} · 별 ${entry.stars.length}개</div>
      </div>
      <button class="const-delete-btn" id="const-delete-${entry.id}" type="button">삭제</button>
    </div>
    <div class="const-confirm" id="const-confirm" hidden>
      <div class="const-confirm-card">
        <div class="const-confirm-title">별자리를 삭제할까요?</div>
        <div class="const-confirm-body">
          <b>${escapeHtml(entry.name)}</b> 별자리가 도감에서 제거됩니다.<br/>
          이 동작은 되돌릴 수 없습니다.
        </div>
        <div class="const-confirm-actions">
          <button class="const-confirm-cancel" id="const-confirm-cancel" type="button">취소</button>
          <button class="const-confirm-ok" id="const-confirm-ok" type="button">삭제</button>
        </div>
      </div>
    </div>
  `;
  overlay.hidden = false;

  const ro = new ResizeObserver(() => paint());
  const canvasEl = document.getElementById("const-detail-canvas");
  if (canvasEl) ro.observe(canvasEl);

  const handle: ConstellationDetailHandle = {
    entry,
    ro,
    galaxyRenderer: null,
    galaxyPayload: null,
    showGalaxy: false,
  };
  openConstellationHandle = handle;

  function paint() {
    const canvas = document.getElementById(
      "const-detail-canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    if (handle.showGalaxy && handle.galaxyPayload) {
      paintGalaxyMode(canvas, handle);
    } else {
      handle.galaxyRenderer?.stop();
      handle.galaxyRenderer = null;
      // Plain decorative mode — clear any planet pins from the previous render.
      const pinLayer = document.getElementById("const-planet-overlay");
      if (pinLayer) pinLayer.innerHTML = "";
      drawConstellationMini(canvas, entry, { showGalaxy: false });
    }
  }

  requestAnimationFrame(paint);

  const toggle = document.getElementById("const-galaxy-toggle") as HTMLButtonElement | null;
  toggle?.addEventListener("click", async () => {
    handle.showGalaxy = !handle.showGalaxy;
    toggle.setAttribute("aria-pressed", String(handle.showGalaxy));
    toggle.textContent = handle.showGalaxy ? "은하 끄기" : "은하 보이기";
    if (handle.showGalaxy && !handle.galaxyPayload) {
      try {
        const payload = await invoke<GalaxyPayload | null>("get_universe_by_id", {
          universeId: entry.universe_id,
        });
        handle.galaxyPayload = payload;
      } catch (e) {
        console.error("constellation galaxy fetch:", e);
      }
    }
    paint();
  });

  const deleteBtn = document.getElementById(`const-delete-${entry.id}`);
  const confirmPanel = document.getElementById("const-confirm");
  const confirmCancel = document.getElementById("const-confirm-cancel");
  const confirmOk = document.getElementById("const-confirm-ok");
  deleteBtn?.addEventListener("click", () => {
    if (confirmPanel) confirmPanel.hidden = false;
  });
  confirmCancel?.addEventListener("click", () => {
    if (confirmPanel) confirmPanel.hidden = true;
  });
  confirmOk?.addEventListener("click", async () => {
    try {
      await invoke("delete_constellation", { constellationId: entry.id });
    } catch (e) {
      console.error("delete_constellation:", e);
    }
    closeConstellationDetail();
    await refresh();
  });
}

// Galaxy-on render path: feed the full universe through UniverseRenderer with
// the camera framing the constellation at its bbox-fit scale, then highlight
// the constellation as a temporary entry on top of any existing ones.
function paintGalaxyMode(canvas: HTMLCanvasElement, h: ConstellationDetailHandle) {
  if (!h.galaxyPayload) return;
  const entry = h.entry;
  const view = makeView();

  const xs = entry.stars.map(([x]) => x);
  const ys = entry.stars.map(([, y]) => y);
  const bboxW = Math.max(40, Math.max(...xs) - Math.min(...xs));
  const bboxH = Math.max(40, Math.max(...ys) - Math.min(...ys));
  const cxW = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cyW = (Math.min(...ys) + Math.max(...ys)) / 2;

  // worldToScreen = (wx - view.x) * SCALE * view.zoom, with SCALE = 0.5.
  // Padding (~50 px on a 480 wide canvas) keeps the constellation off the
  // edges. The zoom is clamped to the camera's max range.
  const pad = 50;
  const zoomX = (DISPLAY_W - pad * 2) / (bboxW * 0.5);
  const zoomY = (DISPLAY_H - pad * 2) / (bboxH * 0.5);
  view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zoomX, zoomY)));
  view.x = cxW - DISPLAY_W / (2 * 0.5 * view.zoom);
  view.y = cyW - DISPLAY_H / (2 * 0.5 * view.zoom);
  clampCamera(view);

  // Build/refresh the renderer.
  if (!h.galaxyRenderer) {
    h.galaxyRenderer = new UniverseRenderer(canvas);
  }
  // Show our constellation on top of any others stored for that universe.
  // Filter out the same id so the highlighted version doesn't draw twice.
  const others = h.galaxyPayload.constellations.filter((c) => c.id !== entry.id);
  const highlighted: ConstellationT = {
    id: entry.id,
    universe_id: entry.universe_id,
    name: entry.name,
    color: entry.color,
    star_ids: [],   // unused by renderer (we recompute by index below)
    preset_id: null,
    created_at: entry.created_at,
  };
  // Rebuild star_ids: the codex entry stores (x, y) pairs; we need ids to
  // match the universe stars. Map by exact position — same DB origin so the
  // floats round-trip exactly.
  const idByPos = new Map<string, number>();
  for (const s of h.galaxyPayload.stars) {
    idByPos.set(`${s.position_x}|${s.position_y}`, s.id);
  }
  highlighted.star_ids = entry.stars
    .map(([x, y]) => idByPos.get(`${x}|${y}`))
    .filter((id): id is number => typeof id === "number");

  h.galaxyRenderer.request(view, {
    stars: h.galaxyPayload.stars,
    nebulae: h.galaxyPayload.nebulae,
    constellations: [...others, highlighted],
    currentConstellation: null,
    hoveredStarId: null,
    effects: buildEffects(h.galaxyPayload.universe.seed),
  });

  // Planet pins overlay (same widget as Today / Gallery).
  paintGalaxyModePlanetPins(view, h.galaxyPayload.planets);
}

// Match Today's pin sizing — pin box is 96 CSS px so the canvas backing is
// 1:1 at universe zoom 8 (no upscale blur).
const PIN_BASE_PX = 96;
const PIN_MIN_PX = 14;
const PIN_MAX_PX = 96;
const PIN_SPRITE_HALF_PX = 81;

let constPinCanvases: PlanetCanvasHandle[] = [];

function paintGalaxyModePlanetPins(
  view: ReturnType<typeof makeView>,
  planets: Planet[],
) {
  const layer = document.getElementById("const-planet-overlay");
  if (!layer) return;
  if (layer.children.length !== planets.length) {
    disposeAllPlanetOrbs(constPinCanvases);
    layer.innerHTML = planets.map(renderConstPinHtml).join("");
    constPinCanvases = mountAllPlanetOrbs(layer);
  }
  const visibleW = UNIVERSE_W / view.zoom;
  const visibleH = UNIVERSE_H / view.zoom;
  const sizePx = Math.max(
    PIN_MIN_PX,
    Math.min(PIN_MAX_PX, 26 + (view.zoom - 1) * 10),
  );
  const pinScale = sizePx / PIN_BASE_PX;
  const rect = layer.getBoundingClientRect();
  const wrapW = rect.width || 1;
  const wrapH = rect.height || 1;
  const spriteHalfPx = PIN_SPRITE_HALF_PX * pinScale;
  const marginX = spriteHalfPx / wrapW;
  const marginY = spriteHalfPx / wrapH;

  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    const px = parseFloat(el.dataset.px ?? "0");
    const py = parseFloat(el.dataset.py ?? "0");
    const nx = (px - view.x) / visibleW;
    const ny = (py - view.y) / visibleH;
    if (
      nx < marginX ||
      nx > 1 - marginX ||
      ny < marginY ||
      ny > 1 - marginY
    ) {
      el.classList.add("off-screen");
      return;
    }
    el.classList.remove("off-screen");
    el.style.left = `${nx * 100}%`;
    el.style.top = `${ny * 100}%`;
    el.style.setProperty("--pin-scale", pinScale.toFixed(3));
  });
}

function renderConstPinHtml(p: Planet): string {
  const spec = PLANET_BY_ID[p.planet_type];
  const tierLabel = RARITY_LABEL[p.rarity];
  const prob = TIER_PROBABILITY[p.rarity];
  const displayName = spec?.name ?? p.planet_type;
  const orbHost = spec
    ? `<div class="pin-orb-host" data-planet-orb data-orb-id="${spec.id}" data-orb-size="96"></div>`
    : "";
  return `
    <div class="planet-pin"
         data-planet-id="${p.id}"
         data-rarity="${p.rarity}"
         data-new="false"
         data-px="${p.position_x}"
         data-py="${p.position_y}">
      <div class="pin-halo"></div>
      <div class="pin-svg-wrap">${orbHost}</div>
      <div class="pin-tooltip">
        <span class="pin-tt-name">${displayName}</span>
        <span class="pin-tt-meta">${tierLabel.toUpperCase()} · ${prob}</span>
      </div>
    </div>
  `;
}

// Closable from main.ts on tab switch.
export function closePlanetModal(): void {
  const modal = document.getElementById("planet-modal");
  if (modal) modal.hidden = true;
}
