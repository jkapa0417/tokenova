// Gallery view: month-grouped 7-column calendar of past universes.
// Each cell renders a lazy-loaded mini thumbnail (stars only) of that day's
// universe. Clicking a cell opens a fullscreen overlay that reproduces
// Today's universe view — live animations, pan, zoom, planet pins.

import { invoke } from "@tauri-apps/api/core";

import { PLANET_BY_ID, RARITY_LABEL, TIER_PROBABILITY } from "../universe/catalog";
import { makeView } from "../universe/camera";
import { buildEffects } from "../universe/effects";
import { UniverseInteraction } from "../universe/interaction";
import { planetSvg } from "../universe/planet-svg";
import { UniverseRenderer } from "../universe/renderer";
import {
  DISPLAY_H,
  DISPLAY_W,
  UNIVERSE_H,
  UNIVERSE_W,
  type Constellation,
  type Nebula,
  type Planet,
  type Star,
  type Universe,
} from "../universe/types";

type Range = "week" | "month" | "all";

interface UniverseSummary {
  id: number;
  date: string;
  star_count: number;
  planet_count: number;
  galaxy_type: string | null;
  seed: number;
  finalized: boolean;
}

interface ReadOnlyUniverse {
  universe: Universe;
  stars: Star[];
  planets: Planet[];
  nebulae: Nebula[];
  constellations: Constellation[];
}

const MONTH_NAMES = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

// Tiny stroke-only ringed-planet glyph — same visual idea as the 🪐 emoji
// but renders consistently on systems without a color-emoji font (notably
// WSLg, which ships without `fonts-noto-color-emoji` by default).
const PLANET_GLYPH_SVG = `
  <svg viewBox="0 0 14 14" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.1" />
    <ellipse cx="7" cy="7" rx="6" ry="1.8" stroke="currentColor" stroke-width="0.8" transform="rotate(-20 7 7)" />
  </svg>
`;

let currentRange: Range = "week";
let wiredUp = false;
let lastSummaries: UniverseSummary[] = [];

export async function activateGallery(): Promise<void> {
  ensureWired();
  await loadRange(currentRange);
}

function ensureWired() {
  if (wiredUp) return;

  document.querySelectorAll<HTMLButtonElement>("#gallery-range button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = (btn.dataset.range as Range) ?? "week";
      currentRange = range;
      document.querySelectorAll<HTMLButtonElement>("#gallery-range button").forEach((b) => {
        b.classList.toggle("on", b.dataset.range === range);
      });
      void loadRange(range);
    });
  });

  const close = document.getElementById("gal-overlay-close");
  if (close) close.addEventListener("click", () => closeOverlay());
  const backdrop = document.getElementById("gal-overlay");
  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeOverlay();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });

  wiredUp = true;
}

async function loadRange(range: Range) {
  const $stats = document.getElementById("gallery-stats");
  const $content = document.getElementById("gallery-content");
  if (!$stats || !$content) return;
  try {
    const summaries = await invoke<UniverseSummary[]>("get_gallery", { range });
    lastSummaries = summaries;
    paintStats($stats, summaries);
    $content.innerHTML = buildMonthBlocks(summaries, range);
    attachCellClicks();
    primeCellThumbnails();
  } catch (e) {
    console.error("gallery:", e);
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 실패</div>`;
  }
}

function paintStats(el: HTMLElement, summaries: UniverseSummary[]) {
  const totalStars = summaries.reduce((acc, s) => acc + s.star_count, 0);
  const totalPlanets = summaries.reduce((acc, s) => acc + s.planet_count, 0);
  el.innerHTML = `
    <div class="stat"><div class="num">${summaries.length}</div><div class="lbl">우주</div></div>
    <div class="stat"><div class="num">${totalStars}</div><div class="lbl">총 별</div></div>
    <div class="stat"><div class="num">${totalPlanets}</div><div class="lbl">총 행성</div></div>
  `;
}

function buildMonthBlocks(summaries: UniverseSummary[], range: Range): string {
  if (summaries.length === 0) {
    return `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">아직 기록된 우주가 없어요.</div>`;
  }
  const byDate = new Map<string, UniverseSummary>();
  for (const s of summaries) byDate.set(s.date, s);

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const monthsToShow = collectMonths(summaries, range, today);

  return monthsToShow
    .map((month) => renderMonthBlock(month.year, month.month, byDate, todayIso))
    .join("");
}

interface MonthSlot {
  year: number;
  month: number;
}

function collectMonths(
  summaries: UniverseSummary[],
  range: Range,
  today: Date,
): MonthSlot[] {
  const months = new Set<string>();
  months.add(`${today.getFullYear()}-${today.getMonth()}`);
  for (const s of summaries) {
    const [y, m] = s.date.split("-").map((x) => parseInt(x, 10));
    months.add(`${y}-${m - 1}`);
  }
  const arr = Array.from(months).map((key) => {
    const [y, m] = key.split("-").map((x) => parseInt(x, 10));
    return { year: y, month: m };
  });
  arr.sort((a, b) => b.year - a.year || b.month - a.month);

  if (range === "week") {
    return arr.filter((s) => s.year === today.getFullYear() && s.month === today.getMonth());
  }
  if (range === "month") {
    return arr.slice(0, 2);
  }
  return arr;
}

function renderMonthBlock(
  year: number,
  month: number,
  byDate: Map<string, UniverseSummary>,
  todayIso: string,
): string {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const cellsInMonth = daysInMonth;
  const monthRecords = Array.from(byDate.entries()).filter(([d]) =>
    d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`),
  );

  const cells: string[] = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push(`<div class="gallery-cell empty"></div>`);
  }
  for (let day = 1; day <= cellsInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const summary = byDate.get(iso);
    cells.push(renderCell(iso, day, summary, iso === todayIso));
  }
  while (cells.length % 7 !== 0) cells.push(`<div class="gallery-cell empty"></div>`);

  return `
    <div class="month-block">
      <div class="month-head">
        <h3>${year}년 ${MONTH_NAMES[month]}</h3>
        <span class="meta">${monthRecords.length} UNIVERSES</span>
      </div>
      <div class="gallery-grid">${cells.join("")}</div>
    </div>
  `;
}

function renderCell(
  iso: string,
  day: number,
  summary: UniverseSummary | undefined,
  isToday: boolean,
): string {
  if (!summary) {
    return `<div class="gallery-cell empty"><span class="day-label">${day}</span></div>`;
  }
  const isBlack = summary.galaxy_type === "black_hole" || summary.star_count === 0;
  const todayCls = isToday ? "today" : "";
  const blackCls = isBlack ? "blackhole" : "";
  const badge = summary.planet_count > 0 ? `<span class="badge"></span>` : "";
  // Black-hole days keep the CSS-only ring; everything else gets a lazy
  // thumbnail canvas drawn from the universe's actual stars.
  const thumb = isBlack
    ? ""
    : `<canvas class="cell-thumb" data-thumb-id="${summary.id}"></canvas>`;
  return `
    <div class="gallery-cell ${blackCls} ${todayCls}" data-id="${summary.id}" data-date="${iso}">
      ${thumb}
      ${badge}
      <span class="day-label">${day}</span>
    </div>
  `;
}

function attachCellClicks() {
  document.querySelectorAll<HTMLElement>(".gallery-cell:not(.empty)").forEach((cell) => {
    cell.addEventListener("click", () => {
      const id = cell.dataset.id;
      const date = cell.dataset.date;
      if (!id || !date) return;
      const summary = lastSummaries.find((s) => s.id === parseInt(id, 10));
      if (summary) void openOverlay(summary, date);
    });
  });
}

// ───────────────────── Cell thumbnails ─────────────────────
//
// Each non-empty cell holds a `<canvas class="cell-thumb">`. When the cell
// scrolls into view, we fetch its universe data (stars only — we don't need
// planets/nebulae at thumbnail scale) and draw a simplified starfield. The
// fetched data is cached so re-scroll doesn't refetch.

const thumbnailCache = new Map<number, Star[]>();
let thumbObserver: IntersectionObserver | null = null;

function primeCellThumbnails(): void {
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        thumbObserver?.unobserve(canvas);
        const idStr = canvas.dataset.thumbId;
        if (!idStr) continue;
        const id = parseInt(idStr, 10);
        void renderThumbnail(canvas, id);
      }
    },
    { rootMargin: "60px" },
  );
  document
    .querySelectorAll<HTMLCanvasElement>(".cell-thumb[data-thumb-id]")
    .forEach((el) => thumbObserver?.observe(el));
}

async function renderThumbnail(canvas: HTMLCanvasElement, id: number) {
  let stars = thumbnailCache.get(id);
  if (!stars) {
    try {
      const payload = await invoke<ReadOnlyUniverse | null>("get_universe_by_id", {
        universeId: id,
      });
      if (!payload) return;
      stars = payload.stars;
      thumbnailCache.set(id, stars);
    } catch (e) {
      console.error("thumbnail fetch:", e);
      return;
    }
  }
  drawThumbnail(canvas, stars);
}

function drawThumbnail(canvas: HTMLCanvasElement, stars: Star[]) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, w, h);

  // Map world-space → cell rect. Stars use their stored opacity but radius
  // is scaled down so the field reads as a soft cluster, not a pixel storm.
  const sx = w / UNIVERSE_W;
  const sy = h / UNIVERSE_H;
  for (const star of stars) {
    const x = star.position_x * sx;
    const y = star.position_y * sy;
    const r = Math.max(0.4, star.radius * 0.35);
    ctx.fillStyle = `rgba(${star.color_r},${star.color_g},${star.color_b},${star.opacity})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ───────────────────── Detail overlay (Today-like) ─────────────────────
//
// Reproduces the Today view's interactive universe for any past day: continuous
// rAF + effect layers + pan/zoom interaction + planet pin overlay + header
// badges + bottom HUD. Read-only — clicking stars does nothing (gallery is
// the archive, not the editor); clicking planets opens the codex modal.

const LAYOUT_BADGE: Record<string, string> = {
  spiral: "SPIRAL",
  elliptical: "ELLIPTICAL",
  irregular: "IRREGULAR",
  dual_cluster: "DUAL",
  scattered: "SCATTERED",
  core_heavy: "CORE",
};

const GALAXY_LABEL: Record<string, string> = {
  black_hole: "블랙홀",
  nebula: "성운",
  cluster: "별무리",
  galaxy: "은하",
  mega_galaxy: "거대 은하",
  super_cluster: "초은하단",
};

interface OverlayHandle {
  renderer: UniverseRenderer;
  interaction: UniverseInteraction;
  view: ReturnType<typeof makeView>;
  payload: ReadOnlyUniverse;
  hoveredStarId: number | null;
}

let openOverlayHandle: OverlayHandle | null = null;

async function openOverlay(summary: UniverseSummary, dateIso: string) {
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (!overlay || !frame) return;

  // Mirror Today's layout: top header (cluster + zoom + mood + layout),
  // full-bleed universe-wrap (canvas + planet pin overlay), bottom HUD.
  // The close button lives outside .frame so it doesn't move with content.
  frame.innerHTML = `
    <div class="gal-header">
      <div class="gal-cluster">
        <span class="th-glyph"></span>
        <span class="gal-cluster-name" id="gal-cluster-name">—</span>
        <span class="gal-cluster-sub" id="gal-cluster-sub">SEED · —</span>
      </div>
      <div class="gal-header-right">
        <span class="th-layout" id="gal-layout" hidden>—</span>
        <span class="th-mood" id="gal-mood" hidden>—</span>
        <span class="th-zoom-lbl">ZOOM</span>
        <span class="th-zoom-x" id="gal-zoom-x">1.0x</span>
      </div>
    </div>
    <div class="gal-stage">
      <canvas id="gal-canvas"></canvas>
      <div class="planet-overlay" id="gal-planet-overlay"></div>
    </div>
    <div class="gal-hud">
      <div class="gal-hud-row1">
        <span class="gal-date">${dateIso}</span>
        <span class="star-counter">
          <span class="gly"><span style="height:3px"></span><span style="height:6px"></span><span style="height:9px"></span></span>
          <b>${summary.star_count}</b>
          <span class="sep">·</span>
          <span class="planet-glyph" aria-hidden="true">${PLANET_GLYPH_SVG}</span>
          <b>${summary.planet_count}</b>
          <span class="sep">·</span>
          <span class="gtype" id="gal-galaxy">—</span>
        </span>
      </div>
      <div class="gal-hud-hint">
        <b>WHEEL</b> ZOOM<span class="sep">·</span><b>DRAG</b> PAN<span class="sep">·</span>행성 클릭하면 도감 열림
      </div>
    </div>
  `;
  overlay.hidden = false;

  try {
    const payload = await invoke<ReadOnlyUniverse | null>("get_universe_by_id", {
      universeId: summary.id,
    });
    if (!payload) return;
    const canvas = document.getElementById("gal-canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    const renderer = new UniverseRenderer(canvas);
    const view = makeView();
    const handle: OverlayHandle = {
      renderer,
      interaction: null as unknown as UniverseInteraction,
      view,
      payload,
      hoveredStarId: null,
    };
    openOverlayHandle = handle;

    handle.interaction = new UniverseInteraction(canvas, view, () => payload.stars, {
      onChange: () => {
        updateGalZoomTag(view);
        updateGalPlanetPins(view);
        renderScene();
      },
      onStarClick: () => {/* gallery is read-only — no constellation editing */},
      onEmptyClick: () => {/* no-op */},
      onHoverChange: (star) => {
        handle.hoveredStarId = star?.id ?? null;
        renderScene();
      },
    });

    paintGalHeader(payload, dateIso);
    paintGalGalaxy(payload, summary);
    rebuildGalPlanetPins(payload.planets);
    updateGalPlanetPins(view);
    updateGalZoomTag(view);
    renderScene();
  } catch (e) {
    console.error("overlay:", e);
  }
}

function renderScene() {
  const h = openOverlayHandle;
  if (!h) return;
  h.renderer.request(h.view, {
    stars: h.payload.stars,
    nebulae: h.payload.nebulae,
    constellations: h.payload.constellations,
    currentConstellation: null,
    hoveredStarId: h.hoveredStarId,
    // Past universe — but live effects (parallax bg, dust drift, twinkle,
    // shooting stars, mood wash) still bring the snapshot to life so it
    // feels like the same Today canvas, frozen in time.
    effects: buildEffects(h.payload.universe.seed),
  });
}

function paintGalHeader(payload: ReadOnlyUniverse, dateIso: string) {
  const $name = document.getElementById("gal-cluster-name");
  const $sub = document.getElementById("gal-cluster-sub");
  const $layout = document.getElementById("gal-layout");
  const $mood = document.getElementById("gal-mood");
  if ($name) $name.textContent = payload.universe.cluster_name ?? dateIso;
  if ($sub) {
    const layout = payload.universe.layout_shape ?? "—";
    $sub.textContent = `SEED · ${payload.universe.seed & 0xffff} · ${layout.toUpperCase()}`;
  }
  if ($layout) {
    const label = LAYOUT_BADGE[payload.universe.layout_shape ?? ""];
    if (label) {
      $layout.textContent = label;
      $layout.hidden = false;
    } else {
      $layout.hidden = true;
    }
  }
  // Mood is derived from seed via buildEffects — peek at it for the badge.
  if ($mood) {
    const mood = buildEffects(payload.universe.seed).mood;
    $mood.textContent = mood.name;
    $mood.style.color = mood.accent;
    $mood.style.borderColor = `${mood.accent}55`;
    $mood.hidden = false;
  }
}

function paintGalGalaxy(payload: ReadOnlyUniverse, summary: UniverseSummary) {
  const $g = document.getElementById("gal-galaxy");
  if (!$g) return;
  const key = payload.universe.galaxy_type ?? classifyGalaxy(summary.star_count);
  $g.textContent = GALAXY_LABEL[key] ?? key;
}

function classifyGalaxy(count: number): string {
  if (count === 0) return "black_hole";
  if (count <= 30) return "nebula";
  if (count <= 100) return "cluster";
  if (count <= 300) return "galaxy";
  if (count <= 999) return "mega_galaxy";
  return "super_cluster";
}

function updateGalZoomTag(view: ReturnType<typeof makeView>) {
  const $z = document.getElementById("gal-zoom-x");
  if ($z) $z.textContent = `${view.zoom.toFixed(1)}x`;
}

function rebuildGalPlanetPins(planets: Planet[]) {
  const layer = document.getElementById("gal-planet-overlay");
  if (!layer) return;
  layer.innerHTML = planets.map(renderPinHtml).join("");
  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.planetId ?? "", 10);
      const planet = planets.find((p) => p.id === id);
      if (planet) openCodexForPlanet(planet);
    });
  });
}

// Past-universe planet click → jump to that planet's codex card (the user
// already discovered it, so the Today-style "NEW DISCOVERY" overlay would
// be a lie; codex is the right destination).
function openCodexForPlanet(planet: Planet) {
  closeOverlay();
  window.location.hash = "#codex";
  // The codex view exposes a click-to-open quick detail. We rely on its
  // existing `data-key` attribute and dispatch a programmatic click after
  // it activates.
  setTimeout(() => {
    const card = document.querySelector<HTMLElement>(
      `#codex-content .planet-card[data-key="${planet.planet_type}"]`,
    );
    card?.click();
  }, 180);
}

function renderPinHtml(p: Planet): string {
  const spec = PLANET_BY_ID[p.planet_type];
  const orb = spec ? planetSvg(spec, 26) : "";
  const tierLabel = RARITY_LABEL[p.rarity];
  const prob = TIER_PROBABILITY[p.rarity];
  const displayName = spec?.name ?? p.planet_type;
  return `
    <div class="planet-pin"
         data-planet-id="${p.id}"
         data-rarity="${p.rarity}"
         data-new="false"
         data-px="${p.position_x}"
         data-py="${p.position_y}">
      <div class="pin-halo"></div>
      <div class="pin-svg-wrap">${orb}</div>
      <div class="pin-tooltip">
        <span class="pin-tt-name">${displayName}</span>
        <span class="pin-tt-meta">${tierLabel.toUpperCase()} · ${prob}</span>
      </div>
    </div>
  `;
}

const PIN_BASE_PX = 26;
const PIN_MIN_PX = 14;
const PIN_MAX_PX = 96;
const PIN_SPRITE_HALF_PX = 22;

function updateGalPlanetPins(view: ReturnType<typeof makeView>) {
  const layer = document.getElementById("gal-planet-overlay");
  if (!layer) return;
  const visibleW = UNIVERSE_W / view.zoom;
  const visibleH = UNIVERSE_H / view.zoom;
  const sizePx = Math.max(
    PIN_MIN_PX,
    Math.min(PIN_MAX_PX, PIN_BASE_PX + (view.zoom - 1) * 10),
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

export function closeGalleryOverlay() {
  openOverlayHandle?.renderer.stop();
  openOverlayHandle = null;
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (overlay) overlay.hidden = true;
  if (frame) frame.innerHTML = "";
}

// Internal alias kept for the click handlers defined elsewhere in this file.
function closeOverlay() { closeGalleryOverlay(); }

// Re-export for tree-shaking analysis & to mute "unused import" warnings.
void DISPLAY_W;
void DISPLAY_H;
