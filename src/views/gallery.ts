// Gallery view: month-grouped 7-column calendar of past universes.
// Each cell renders a lazy-loaded mini thumbnail (stars only) of that day's
// universe. Clicking a cell opens a fullscreen overlay that reproduces
// Today's universe view — live animations, pan, zoom, planet pins.

import { invoke } from "@tauri-apps/api/core";

import { PLANET_BY_ID, RARITY_LABEL, TIER_PROBABILITY } from "../universe/catalog";
import { makeView } from "../universe/camera";
import { buildEffects } from "../universe/effects";
import { UniverseInteraction } from "../universe/interaction";
import type { PlanetCanvasHandle } from "../universe/planet-canvas";
import { disposeAllPlanetOrbs, mountAllPlanetOrbs } from "../universe/planet-mount";
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

// Tiny stroke-only ringed-planet glyph — same visual idea as the 🪐 emoji
// but renders consistently on systems without a color-emoji font (notably
// WSLg, which ships without `fonts-noto-color-emoji` by default).
const PLANET_GLYPH_SVG = `
  <svg viewBox="0 0 14 14" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.1" />
    <ellipse cx="7" cy="7" rx="6" ry="1.8" stroke="currentColor" stroke-width="0.8" transform="rotate(-20 7 7)" />
  </svg>
`;

let currentRange: Range = "month";
let wiredUp = false;
let lastSummaries: UniverseSummary[] = [];
let monthOffset = 0;          // 0 = current month, negative = earlier months

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
  // All three new layouts care about the entire history for stats /
  // heatmap; the week layout culls to 7 days client-side. Fetching once
  // is simpler than range-specific backend filters.
  try {
    const summaries = await invoke<UniverseSummary[]>("get_gallery", { range: "all" });
    lastSummaries = summaries;
    // Stats card is rendered inside each view's own header so the page
    // doesn't carry a duplicate row. Clear the legacy `#gallery-stats`.
    $stats.innerHTML = "";
    const today = new Date();
    const byDate = indexByDate(summaries);
    $content.innerHTML = "";
    if (range === "week") {
      $content.innerHTML = renderWeekView(byDate, today);
    } else if (range === "month") {
      $content.innerHTML = renderMonthView(byDate, today, monthOffset);
      wireMonthNav(byDate, today);
    } else {
      $content.innerHTML = renderHeatmapView(byDate, today);
    }
    attachCellClicks();
    primeCellThumbnails();
  } catch (e) {
    console.error("gallery:", e);
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 실패</div>`;
  }
}

function indexByDate(summaries: UniverseSummary[]): Map<string, UniverseSummary> {
  const m = new Map<string, UniverseSummary>();
  for (const s of summaries) m.set(s.date, s);
  return m;
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isBlackhole(s: UniverseSummary): boolean {
  return s.galaxy_type === "black_hole" || s.star_count === 0;
}

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
const NUM = new Intl.NumberFormat("ko-KR");

// ───────────── Week view (horizontal 7-cell strip) ─────────────

function renderWeekView(byDate: Map<string, UniverseSummary>, today: Date): string {
  const days: { date: Date; u: UniverseSummary | undefined; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: d, u: byDate.get(isoOf(d)), isToday: i === 0 });
  }
  const stats = days.reduce(
    (acc, day) => ({
      universes: acc.universes + (day.u && day.u.star_count > 0 ? 1 : 0),
      stars: acc.stars + (day.u?.star_count ?? 0),
      planets: acc.planets + (day.u?.planet_count ?? 0),
    }),
    { universes: 0, stars: 0, planets: 0 },
  );
  const first = days[0].date;
  const last = days[6].date;
  const rangeLabel = `${first.getMonth() + 1}.${first.getDate()} – ${last.getMonth() + 1}.${last.getDate()}`;

  const cells = days
    .map((day) => {
      const iso = isoOf(day.date);
      const blank = !day.u;
      const blackhole = day.u && isBlackhole(day.u);
      const cls = ["week-cell"];
      if (day.isToday) cls.push("today");
      if (blank || blackhole) cls.push("no-thumb");
      const dowCls = day.date.getDay() === 0 ? " sun" : "";
      let thumb = "";
      if (blackhole) {
        thumb = `<div class="thumb-blackhole"></div>`;
      } else if (day.u) {
        thumb = `<canvas class="cell-thumb" data-thumb-id="${day.u.id}"></canvas>`;
      } else {
        thumb = `<div class="thumb-empty">·</div>`;
      }
      const meta = blackhole
        ? `잠든 우주`
        : day.u
          ? `${day.u.star_count}<span class="dim">★</span>`
          : `—`;
      const dataAttrs = day.u
        ? `data-id="${day.u.id}" data-date="${iso}"`
        : "";
      return `
        <div class="${cls.join(" ")}" ${dataAttrs}>
          <div class="week-dow${dowCls}">${DOW_KO[day.date.getDay()]}</div>
          <div class="week-num">${day.date.getDate()}</div>
          <div class="week-thumb">${thumb}</div>
          <div class="week-meta">${meta}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="week-header">
      <div>
        <div class="week-title">이번 주</div>
        <div class="week-sub">${rangeLabel}</div>
      </div>
      <div class="week-stats">
        <span><b>${stats.universes}</b>우주</span>
        <span><b>${NUM.format(stats.stars)}</b>별</span>
        <span><b>${stats.planets}</b>행성</span>
      </div>
    </div>
    <div class="week-strip">${cells}</div>
  `;
}

// ───────────── Month view (calendar with offset) ─────────────

function renderMonthView(
  byDate: Map<string, UniverseSummary>,
  today: Date,
  offset: number,
): string {
  const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthEntries: UniverseSummary[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const u = byDate.get(isoOf(new Date(year, month, d)));
    if (u) monthEntries.push(u);
  }
  const recorded = monthEntries.filter((u) => u.star_count > 0).length;
  const totalStars = monthEntries.reduce((s, u) => s + u.star_count, 0);
  const totalPlanets = monthEntries.reduce((s, u) => s + u.planet_count, 0);

  const monthLabel = monthDate.toLocaleString("ko-KR", { year: "numeric", month: "long" });
  const canNext = offset < 0;

  const cells: string[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(`<div class="cal-cell out"></div>`);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const iso = isoOf(cellDate);
    const u = byDate.get(iso);
    const isToday = sameDay(cellDate, today);
    const isFuture = cellDate > today;
    if (!u) {
      const empty = ["cal-cell", "empty"];
      if (isFuture) empty.push("future");
      if (isToday) empty.push("today");
      cells.push(`<div class="${empty.join(" ")}"><span class="dno">${d}</span></div>`);
    } else {
      const blackhole = isBlackhole(u);
      const classes = ["cal-cell"];
      if (blackhole) classes.push("blackhole");
      if (isToday) classes.push("today");
      const thumb = blackhole
        ? ""
        : `<canvas class="cell-thumb" data-thumb-id="${u.id}"></canvas>`;
      const badge = u.planet_count > 0 ? `<span class="badge"></span>` : "";
      cells.push(`
        <div class="${classes.join(" ")}" data-id="${u.id}" data-date="${iso}">
          ${thumb}
          <span class="dno">${d}</span>
          ${badge}
        </div>
      `);
    }
  }

  const dowHeader = DOW_KO.map((d, i) =>
    `<span${i === 0 ? ' class="sun"' : ""}>${d}</span>`
  ).join("");

  return `
    <div class="month-nav">
      <button class="month-arrow" id="gallery-month-prev" type="button" aria-label="이전 달">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="month-title">
        <div class="m-name">${monthLabel}</div>
        <div class="m-meta">${recorded}일 · ${NUM.format(totalStars)}★ · 행성 ${totalPlanets}</div>
      </div>
      <button class="month-arrow" id="gallery-month-next" type="button" aria-label="다음 달" ${canNext ? "" : "disabled"}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <div class="dow-header">${dowHeader}</div>
    <div class="cal-grid">${cells.join("")}</div>
  `;
}

function wireMonthNav(byDate: Map<string, UniverseSummary>, today: Date) {
  const prev = document.getElementById("gallery-month-prev") as HTMLButtonElement | null;
  const next = document.getElementById("gallery-month-next") as HTMLButtonElement | null;
  const repaint = () => {
    const $content = document.getElementById("gallery-content");
    if (!$content) return;
    $content.innerHTML = renderMonthView(byDate, today, monthOffset);
    wireMonthNav(byDate, today);
    attachCellClicks();
    primeCellThumbnails();
  };
  prev?.addEventListener("click", () => {
    monthOffset--;
    repaint();
  });
  next?.addEventListener("click", () => {
    if (monthOffset < 0) {
      monthOffset++;
      repaint();
    }
  });
}

// ───────────── Heatmap (53×7 last-365-days GitHub-style) ─────────────

function renderHeatmapView(
  byDate: Map<string, UniverseSummary>,
  today: Date,
): string {
  // Anchor 53-week window so the rightmost column ends at today and the
  // leftmost column starts on the Sunday >= today - 364 days.
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());

  interface HmCell { date: Date; u: UniverseSummary | undefined; future: boolean; isToday: boolean }
  const cols: HmCell[][] = [];
  const monthMarkers: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let c = 0; c < 53; c++) {
    const col: HmCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + c * 7 + d);
      if (day > today) {
        col.push({ date: day, u: undefined, future: true, isToday: false });
      } else {
        col.push({
          date: day,
          u: byDate.get(isoOf(day)),
          future: false,
          isToday: sameDay(day, today),
        });
      }
    }
    const colMonth = col[0].date.getMonth();
    if (colMonth !== lastMonth) {
      monthMarkers.push({
        col: c,
        label: col[0].date.toLocaleString("ko-KR", { month: "short" }),
      });
      lastMonth = colMonth;
    }
    cols.push(col);
  }

  // Year stats.
  const yearU: UniverseSummary[] = [];
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const u = byDate.get(isoOf(d));
    if (u) yearU.push(u);
  }
  const totalUniverses = yearU.filter((u) => u.star_count > 0).length;
  const totalStars = yearU.reduce((s, u) => s + u.star_count, 0);
  const totalPlanets = yearU.reduce((s, u) => s + u.planet_count, 0);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const u = byDate.get(isoOf(d));
    if (u && u.star_count > 0) streak++;
    else break;
  }

  const levelFor = (u: UniverseSummary | undefined): number => {
    if (!u) return 0;
    if (isBlackhole(u)) return -1;
    const s = u.star_count;
    if (s === 0) return 0;
    if (s < 50) return 1;
    if (s < 100) return 2;
    if (s < 200) return 3;
    return 4;
  };

  const colsHtml = cols
    .map((col) => {
      const cells = col
        .map((d) => {
          if (d.future) return `<div class="hm-cell future"></div>`;
          const lvl = levelFor(d.u);
          const classes = ["hm-cell"];
          if (lvl === -1) classes.push("blackhole");
          else classes.push(`level-${lvl}`);
          if (d.isToday) classes.push("today");
          if (d.u) classes.push("has");
          const dataAttrs = d.u
            ? `data-id="${d.u.id}" data-date="${isoOf(d.date)}"`
            : "";
          const tip = d.u
            ? `${d.date.toLocaleDateString("ko-KR")} · ${isBlackhole(d.u) ? "잠든 우주" : `${d.u.star_count}★ · 행성 ${d.u.planet_count}`}`
            : d.date.toLocaleDateString("ko-KR");
          return `<div class="${classes.join(" ")}" title="${tip}" ${dataAttrs}></div>`;
        })
        .join("");
      return `<div class="hm-col">${cells}</div>`;
    })
    .join("");

  const monthsHtml = monthMarkers
    .map((m) => `<span style="left: ${(m.col * 100) / 53}%">${m.label}</span>`)
    .join("");

  return `
    <div class="heatmap-stats">
      <div class="hm-stat">
        <div class="hm-num">${totalUniverses}<span class="of">/365</span></div>
        <div class="hm-lbl">우주</div>
      </div>
      <div class="hm-stat">
        <div class="hm-num">${streak}<span class="of">일</span></div>
        <div class="hm-lbl">연속 기록</div>
      </div>
      <div class="hm-stat">
        <div class="hm-num">${NUM.format(totalStars)}</div>
        <div class="hm-lbl">총 별</div>
      </div>
      <div class="hm-stat">
        <div class="hm-num">${totalPlanets}</div>
        <div class="hm-lbl">행성</div>
      </div>
    </div>
    <div class="heatmap-wrap">
      <div class="hm-months">${monthsHtml}</div>
      <div class="hm-body">
        <div class="hm-dow">
          <span>월</span><span>수</span><span>금</span>
        </div>
        <div class="hm-grid">${colsHtml}</div>
      </div>
      <div class="hm-legend">
        <span>적음</span>
        <span class="hm-cell level-0"></span>
        <span class="hm-cell level-1"></span>
        <span class="hm-cell level-2"></span>
        <span class="hm-cell level-3"></span>
        <span class="hm-cell level-4"></span>
        <span>많음</span>
        <span class="hm-sep">·</span>
        <span class="hm-cell blackhole"></span>
        <span>잠든 우주</span>
      </div>
    </div>
  `;
}

function attachCellClicks() {
  document
    .querySelectorAll<HTMLElement>(
      ".week-cell[data-id], .cal-cell[data-id], .hm-cell.has[data-id]",
    )
    .forEach((cell) => {
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

let galPinCanvases: PlanetCanvasHandle[] = [];

function rebuildGalPlanetPins(planets: Planet[]) {
  const layer = document.getElementById("gal-planet-overlay");
  if (!layer) return;
  disposeAllPlanetOrbs(galPinCanvases);
  layer.innerHTML = planets.map(renderPinHtml).join("");
  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.planetId ?? "", 10);
      const planet = planets.find((p) => p.id === id);
      if (planet) openCodexForPlanet(planet);
    });
  });
  galPinCanvases = mountAllPlanetOrbs(layer);
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
  const orb = spec
    ? `<div class="pin-orb-host" data-planet-orb data-orb-id="${spec.id}" data-orb-size="96"></div>`
    : "";
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

// Match Today's pin sizing — see today.ts for the rationale (canvas backing
// at logical 96 keeps zoom-in sharp; scale always downsamples).
const PIN_BASE_PX = 96;
const PIN_MIN_PX = 14;
const PIN_MAX_PX = 96;
const PIN_SPRITE_HALF_PX = 81;

function updateGalPlanetPins(view: ReturnType<typeof makeView>) {
  const layer = document.getElementById("gal-planet-overlay");
  if (!layer) return;
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

export function closeGalleryOverlay() {
  openOverlayHandle?.renderer.stop();
  openOverlayHandle = null;
  disposeAllPlanetOrbs(galPinCanvases);
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
