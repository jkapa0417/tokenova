// Gallery view: grid of past universes with range selector + detail modal.
// Each cell renders a small read-only canvas preview.

import { invoke } from "@tauri-apps/api/core";

import { worldToScreen, makeView } from "../universe/camera";
import { UniverseRenderer } from "../universe/renderer";
import {
  DISPLAY_H,
  DISPLAY_W,
  type Constellation,
  type Nebula,
  type Planet,
  type Star,
  type Universe,
} from "../universe/types";

import { openModal } from "./modal";

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

const GALAXY_ICON: Record<string, string> = {
  black_hole: "●",
  nebula: "✦",
  cluster: "✧",
  galaxy: "☆",
  mega_galaxy: "★",
  super_cluster: "✶",
};

const GALAXY_LABEL: Record<string, string> = {
  black_hole: "블랙홀",
  nebula: "성운",
  cluster: "별무리",
  galaxy: "은하",
  mega_galaxy: "거대 은하",
  super_cluster: "초은하단",
};

let currentRange: Range = "week";
let attached = false;

export async function activateGallery(): Promise<void> {
  ensureControls();
  await loadRange(currentRange);
}

function ensureControls() {
  if (attached) return;
  document.querySelectorAll<HTMLButtonElement>(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = (btn.dataset.range as Range) ?? "week";
      currentRange = range;
      void loadRange(range);
    });
  });
  attached = true;
}

async function loadRange(range: Range) {
  const $grid = document.getElementById("gallery-grid");
  if (!$grid) return;

  document.querySelectorAll<HTMLButtonElement>(".range-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === range);
  });

  try {
    const summaries = await invoke<UniverseSummary[]>("get_gallery", { range });
    if (summaries.length === 0) {
      $grid.innerHTML = `<div class="gallery-empty">아직 기록된 우주가 없어요.</div>`;
      return;
    }
    $grid.innerHTML = summaries.map(renderCell).join("");
    summaries.forEach((s) => {
      drawMini(s);
      const cell = $grid.querySelector<HTMLElement>(`[data-id="${s.id}"]`);
      cell?.addEventListener("click", () => void openDetail(s));
    });
  } catch (e) {
    console.error("gallery:", e);
    $grid.innerHTML = `<div class="gallery-empty">로딩 실패</div>`;
  }
}

function renderCell(s: UniverseSummary): string {
  const galaxy = s.galaxy_type ?? "(진행 중)";
  const icon = (s.galaxy_type && GALAXY_ICON[s.galaxy_type]) ?? "·";
  return `
    <div class="gallery-cell" data-id="${s.id}">
      <canvas class="gallery-mini" id="mini-${s.id}" width="120" height="100"></canvas>
      <div class="gallery-date">${formatDate(s.date)}</div>
      <div class="gallery-meta">${icon} ${formatGalaxy(galaxy)} · ⭐${s.star_count} · 🪐${s.planet_count}</div>
    </div>
  `;
}

function formatDate(iso: string): string {
  // ISO `YYYY-MM-DD` → `M/D`
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function formatGalaxy(g: string): string {
  return GALAXY_LABEL[g] ?? g;
}

/**
 * Draw a tiny preview into the mini-canvas without going through the full
 * UniverseRenderer (which is sized 480×400). We only need stars + nebulae
 * sketched onto a 120×100 strip.
 */
async function drawMini(summary: UniverseSummary) {
  const canvas = document.getElementById(`mini-${summary.id}`) as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Lazy-load the per-universe payload only when the mini is visible. Cells
  // are few enough that we can afford one query each.
  try {
    const payload = await invoke<ReadOnlyUniverse | null>("get_universe_by_id", {
      universeId: summary.id,
    });
    if (!payload) return;
    drawMiniInto(ctx, canvas.width, canvas.height, payload);
  } catch (e) {
    console.error("mini draw:", e);
  }
}

function drawMiniInto(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  payload: ReadOnlyUniverse,
) {
  const scaleX = w / DISPLAY_W;
  const scaleY = h / DISPLAY_H;
  const view = makeView();

  // Nebulae as low-opacity blobs.
  for (const n of payload.nebulae) {
    const s = worldToScreen(view, n.position_x, n.position_y);
    const r = (n.radius / 2) * scaleX; // ratio matches camera's SCALE constant
    const grad = ctx.createRadialGradient(s.x * scaleX, s.y * scaleY, 0, s.x * scaleX, s.y * scaleY, r);
    grad.addColorStop(0, `${n.color} ${n.opacity * 0.6})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x * scaleX, s.y * scaleY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stars as tiny dots. Decimate at high counts so the preview stays readable.
  const decimate = Math.max(1, Math.ceil(payload.stars.length / 200));
  for (let i = 0; i < payload.stars.length; i += decimate) {
    const star = payload.stars[i];
    const s = worldToScreen(view, star.position_x, star.position_y);
    const r = Math.max(0.5, star.radius * 0.5 * scaleX);
    ctx.fillStyle = `rgba(${star.color_r},${star.color_g},${star.color_b},${star.opacity})`;
    ctx.beginPath();
    ctx.arc(s.x * scaleX, s.y * scaleY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Planets as small filled circles.
  for (const p of payload.planets) {
    const s = worldToScreen(view, p.position_x, p.position_y);
    ctx.fillStyle = "rgba(255, 211, 130, 0.9)";
    ctx.beginPath();
    ctx.arc(s.x * scaleX, s.y * scaleY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function openDetail(s: UniverseSummary) {
  try {
    const payload = await invoke<ReadOnlyUniverse | null>("get_universe_by_id", {
      universeId: s.id,
    });
    if (!payload) {
      openModal(`<div class="modal-title">우주를 찾을 수 없음</div>`);
      return;
    }
    const constellations = payload.constellations.length;
    const galaxy = payload.universe.galaxy_type ?? "(진행 중)";

    openModal(`
      <div class="modal-title">${formatDate(payload.universe.date)} 우주</div>
      <div class="modal-subtitle">${formatGalaxy(galaxy)}</div>
      <canvas id="modal-canvas" width="${DISPLAY_W}" height="${DISPLAY_H}"></canvas>
      <div class="modal-stat">⭐ 별: ${payload.stars.length}</div>
      <div class="modal-stat">🪐 행성: ${payload.planets.length}</div>
      <div class="modal-stat">✦ 별자리: ${constellations}</div>
    `);
    // Render the full universe into the modal canvas. Re-use the main
    // renderer's drawing logic on a fresh canvas. Display-shrink via CSS so
    // the 480-wide canvas fits comfortably inside the 480-wide popover modal.
    const canvas = document.getElementById("modal-canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const renderer = new UniverseRenderer(canvas);
    canvas.style.width = "360px";
    canvas.style.height = "300px";
    renderer.request(makeView(), {
      stars: payload.stars,
      planets: payload.planets,
      nebulae: payload.nebulae,
      constellations: payload.constellations,
      currentConstellation: null,
      hoveredStarId: null,
    });
  } catch (e) {
    console.error("gallery detail:", e);
    openModal(`<div class="modal-title">로딩 실패</div>`);
  }
}
