// Gallery view: month-grouped 7-column calendar of past universes.
// Each cell renders a thumbnail (or blackhole for empty days). Clicking
// opens a fullscreen overlay with the full universe canvas.

import { invoke } from "@tauri-apps/api/core";

import { makeView } from "../universe/camera";
import { UniverseRenderer } from "../universe/renderer";
import type {
  Constellation,
  Nebula,
  Planet,
  Star,
  Universe,
} from "../universe/types";

type Range = "week" | "month" | "all";

interface UniverseSummary {
  id: number;
  date: string;            // YYYY-MM-DD
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
  } catch (e) {
    console.error("gallery:", e);
    $content.innerHTML = `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">로딩 실패</div>`;
  }
}

function paintStats(el: HTMLElement, summaries: UniverseSummary[]) {
  const totalStars = summaries.reduce((acc, s) => acc + s.star_count, 0);
  const totalPlanets = summaries.reduce((acc, s) => acc + s.planet_count, 0);
  const blackHoles = summaries.filter((s) => s.galaxy_type === "black_hole").length;
  el.innerHTML = `
    <div class="stat"><div class="num">${summaries.length}</div><div class="lbl">UNIVERSES</div></div>
    <div class="stat"><div class="num">${totalStars}</div><div class="lbl">STARS</div></div>
    <div class="stat"><div class="num">${totalPlanets}</div><div class="lbl">PLANETS</div></div>
    <div class="stat"><div class="num">${blackHoles}</div><div class="lbl">BLACK HOLES</div></div>
  `;
}

/**
 * Build month blocks. Each block has a header (month name + meta) and a
 * 7-column grid covering every day of that month — empty days render as a
 * muted placeholder, days with universes show the cell.
 */
function buildMonthBlocks(summaries: UniverseSummary[], range: Range): string {
  if (summaries.length === 0) {
    return `<div style="color: var(--fg-3); text-align: center; padding: 40px 0;">아직 기록된 우주가 없어요.</div>`;
  }

  const byDate = new Map<string, UniverseSummary>();
  for (const s of summaries) byDate.set(s.date, s);

  // Determine which months to render.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const monthsToShow = collectMonths(summaries, range, today);

  return monthsToShow
    .map((month) => renderMonthBlock(month.year, month.month, byDate, todayIso))
    .join("");
}

interface MonthSlot {
  year: number;
  month: number; // 0-indexed
}

function collectMonths(
  summaries: UniverseSummary[],
  range: Range,
  today: Date,
): MonthSlot[] {
  const months = new Set<string>();
  // Always include the current month so the user sees today's slot.
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
    // Limit to the current month only.
    return arr.filter((s) => s.year === today.getFullYear() && s.month === today.getMonth());
  }
  if (range === "month") {
    // Current + previous.
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
  const leadingBlanks = firstDay.getDay(); // 0 = Sunday
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
  // Pad to multiple of 7
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
  // Per design: cell is a tiny solid square (or blackhole) — no in-cell canvas.
  // Star density inside a 40px square is unreadable; the fullscreen overlay
  // shows the actual universe.
  return `
    <div class="gallery-cell ${blackCls} ${todayCls}" data-id="${summary.id}" data-date="${iso}">
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

async function openOverlay(summary: UniverseSummary, dateIso: string) {
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (!overlay || !frame) return;

  frame.innerHTML = `
    <canvas id="gal-canvas"></canvas>
    <div class="info-strip">
      <span class="date">${dateIso}</span>
      <span class="meta">⭐ ${summary.star_count} · 🪐 ${summary.planet_count}</span>
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
    // Renderer constructor pins canvas.style.{width,height} to 480/400 px.
    // Override AFTER construction so the canvas fluid-scales into the frame
    // (which is roughly 440×560 inside the popover).
    canvas.style.width = "auto";
    canvas.style.height = "100%";
    canvas.style.maxWidth = "100%";
    canvas.style.display = "block";
    canvas.style.margin = "0 auto";
    renderer.request(makeView(), {
      stars: payload.stars,
      planets: payload.planets,
      nebulae: payload.nebulae,
      constellations: payload.constellations,
      currentConstellation: null,
      hoveredStarId: null,
    });
  } catch (e) {
    console.error("overlay:", e);
  }
}

function closeOverlay() {
  const overlay = document.getElementById("gal-overlay");
  const frame = document.getElementById("gal-overlay-frame");
  if (overlay) overlay.hidden = true;
  if (frame) frame.innerHTML = "";
}
