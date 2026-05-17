// Today view: live universe canvas + bottom HUD + discovery badge.
// Polling drives non-realtime updates (universe payload, session); a Tauri
// listener handles real-time star/planet pushes from the engine.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { PLANET_BY_ID, RARITY_LABEL, TIER_PROBABILITY } from "../universe/catalog";
import { makeView, type View } from "../universe/camera";
import { buildEffects, type EffectLayers, type Mood } from "../universe/effects";
import { UniverseInteraction } from "../universe/interaction";
import type { PlanetCanvasHandle } from "../universe/planet-canvas";
import { disposeAllPlanetOrbs, mountAllPlanetOrbs } from "../universe/planet-mount";
import { UniverseRenderer, type Scene } from "../universe/renderer";
import {
  mountSleepingUniverse,
  type SleepingHandle,
} from "../universe/sleeping-universe";
import { recordStarsEncountered } from "../universe/star-discovery";
import {
  UNIVERSE_H,
  UNIVERSE_W,
  type Constellation,
  type GalaxyType,
  type Nebula,
  type Planet,
  type Star,
  type UniversePayload,
} from "../universe/types";

import { openDiscoveryOverlay, refreshDiscoveryBadge } from "./discovery";

const POLL_INTERVAL_MS = 3000;

const GALAXY_LABEL: Record<GalaxyType, string> = {
  black_hole: "블랙홀",
  nebula: "성운",
  cluster: "별무리",
  galaxy: "은하",
  mega_galaxy: "거대 은하",
  super_cluster: "초은하단",
};

const LAYOUT_BADGE: Record<string, string> = {
  spiral: "SPIRAL",
  elliptical: "ELLIPTICAL",
  irregular: "IRREGULAR",
  dual_cluster: "DUAL",
  scattered: "SCATTERED",
  core_heavy: "CORE",
};

const SLEEPING_TAGLINE = "오늘은 쉬어가요 · 내일 다시 별을 만들어요";
const NORMAL_HINT =
  `<b>별 클릭</b> 별자리 만들기<span class="sep">·</span>` +
  `<b>휠</b> 줌<span class="sep">·</span><b>드래그</b> 이동`;

const CONSTELLATION_COLORS = [
  { main: "rgba(255, 200, 130, 0.9)", glow: "rgba(255, 180, 80, 0.35)" },
  { main: "rgba(140, 200, 255, 0.9)", glow: "rgba(80, 150, 255, 0.35)" },
  { main: "rgba(220, 160, 255, 0.9)", glow: "rgba(180, 100, 255, 0.35)" },
  { main: "rgba(150, 255, 200, 0.9)", glow: "rgba(80, 220, 150, 0.35)" },
  { main: "rgba(255, 170, 200, 0.9)", glow: "rgba(255, 100, 160, 0.35)" },
];

const SUBJECTS = [
  "사슴", "곰", "용", "학", "여우", "거북", "사자", "늑대",
  "백조", "독수리", "나비", "뱀", "말", "돌고래", "호랑이",
];
const ADJECTIVES = [
  "빛나는", "잠든", "날아가는", "춤추는", "고요한",
  "깨어난", "어린", "늙은", "북쪽의", "남쪽의",
];

function autoConstellationName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const s = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
  return `${a} ${s}자리`;
}

function classifyGalaxy(count: number): GalaxyType {
  if (count === 0) return "black_hole";
  if (count <= 30) return "nebula";
  if (count <= 100) return "cluster";
  if (count <= 300) return "galaxy";
  if (count <= 999) return "mega_galaxy";
  return "super_cluster";
}

const numberFmt = new Intl.NumberFormat("ko-KR");

interface TodayState {
  stars: Star[];
  planets: Planet[];
  nebulae: Nebula[];
  constellations: Constellation[];
  currentConstellation: { starIds: number[] } | null;
  constellationColorIdx: number;
  hoveredStarId: number | null;
  view: View;
  pollTimer: number | null;
  renderer: UniverseRenderer | null;
  interaction: UniverseInteraction | null;
  unlistenStars: UnlistenFn | null;
  unlistenPlanet: UnlistenFn | null;
  effects: EffectLayers | null;
  effectsSeed: number | null;
  /** Bar UX state: which row is showing (count vs. naming). */
  drawingMode: "count" | "naming";
}

let state: TodayState | null = null;
let escListener: ((e: KeyboardEvent) => void) | null = null;

export function activateToday(): void {
  if (state) {
    state.pollTimer ??= window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    void refreshDiscoveryBadge();
    // The renderer was paused on deactivate; nudge it back to life.
    requestRender();
    attachEscListener();
    return;
  }

  const canvas = document.getElementById("universe-canvas") as HTMLCanvasElement;
  const renderer = new UniverseRenderer(canvas);
  const view = makeView();

  const local: TodayState = {
    stars: [],
    planets: [],
    nebulae: [],
    constellations: [],
    currentConstellation: null,
    constellationColorIdx: 0,
    hoveredStarId: null,
    view,
    pollTimer: null,
    renderer,
    interaction: null,
    unlistenStars: null,
    unlistenPlanet: null,
    effects: null,
    effectsSeed: null,
    drawingMode: "count",
  };
  state = local;

  local.interaction = new UniverseInteraction(canvas, view, () => local.stars, {
    onChange: () => {
      updateZoomTag();
      updatePlanetPins();
      requestRender();
    },
    onStarClick: (star) => onStarClick(star),
    onEmptyClick: () => {
      // Empty-space click during drawing is intentionally a no-op now —
      // saving requires explicit confirmation in the .draw-bar widget.
    },
    onHoverChange: (star) => {
      local.hoveredStarId = star?.id ?? null;
      requestRender();
    },
  });

  // Real-time push: new stars appear without waiting for poll.
  void listen<Star[]>("stars_added", (event) => {
    if (!state) return;
    for (const s of event.payload) {
      if (!state.stars.find((existing) => existing.id === s.id)) {
        state.stars.push(s);
      }
    }
    requestRender();
  }).then((fn) => {
    if (state) state.unlistenStars = fn;
    else fn();
  });

  // Real-time push: open discovery overlay immediately when popover is open.
  void listen<Planet>("planet_discovered", (event) => {
    void openDiscoveryOverlay([event.payload]);
    void refreshDiscoveryBadge();
    void poll();
  }).then((fn) => {
    if (state) state.unlistenPlanet = fn;
    else fn();
  });

  wireDrawingBar();
  attachEscListener();

  local.pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();
  void refreshDiscoveryBadge();
}

export function deactivateToday(): void {
  if (!state) return;
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  // Stop the rAF loop while another tab is active — saves battery and avoids
  // off-screen work. Also dispose the sleeping canvas so we don't burn CPU
  // animating a moon nobody's looking at.
  state.renderer?.stop();
  sleepingHandle?.dispose();
  sleepingHandle = null;
  disposeAllPlanetOrbs(pinCanvases);
  detachEscListener();
}

function requestRender() {
  if (!state || !state.renderer) return;
  const scene: Scene = {
    stars: state.stars,
    nebulae: state.nebulae,
    constellations: state.constellations,
    currentConstellation: state.currentConstellation,
    hoveredStarId: state.hoveredStarId,
    effects: state.effects,
  };
  state.renderer.request(state.view, scene);
}

function updateZoomTag() {
  const el = document.getElementById("zoom-x");
  if (!el || !state) return;
  el.textContent = `${state.view.zoom.toFixed(1)}x`;
}

function onStarClick(star: Star) {
  if (!state) return;
  if (!state.currentConstellation) {
    state.currentConstellation = { starIds: [star.id] };
  } else {
    const idx = state.currentConstellation.starIds.indexOf(star.id);
    if (idx >= 0) {
      state.currentConstellation.starIds.splice(idx, 1);
      if (state.currentConstellation.starIds.length === 0) {
        state.currentConstellation = null;
      }
    } else {
      state.currentConstellation.starIds.push(star.id);
    }
  }
  refreshDrawingBar();
  requestRender();
}

async function poll() {
  if (!state) return;
  try {
    const payload = await invoke<UniversePayload>("get_current_universe");
    if (!payload || !payload.universe) {
      throw new Error("empty payload from get_current_universe");
    }
    state.stars = payload.stars ?? [];
    state.planets = payload.planets ?? [];
    state.nebulae = payload.nebulae ?? [];
    state.constellations = payload.constellations ?? [];

    // Record every star we just received as encountered — drives the Star
    // Codex unlock state. Idempotent so re-polls don't double-count.
    recordStarsEncountered(state.stars);

    // (Re)seed effect layers when the universe seed changes — i.e. on first
    // load and again at day rollover. Keep existing layers otherwise so dust
    // and shooting-star pacing stay continuous.
    const seed = payload.universe.seed;
    if (state.effectsSeed !== seed) {
      state.effects = buildEffects(seed);
      state.effectsSeed = seed;
    }

    paintHud(payload);
    paintClusterTag(payload);
    paintMoodBadge(payload, state.effects?.mood ?? null);
    rebuildPlanetPins(state.planets);
    requestRender();
  } catch (e) {
    console.error("poll:", e);
    const $tokens = document.getElementById("hud-tokens");
    if ($tokens) {
      const msg = e instanceof Error ? e.message : String(e);
      $tokens.textContent = `ERR: ${msg.slice(0, 40)}`;
    }
  }

  try {
    const session = await invoke<
      { id: number; started_at: string; total_tokens: number } | null
    >("get_current_session");
    const $session = document.getElementById("hud-session");
    if (!$session) return;
    if (session) {
      const mins = Math.max(
        0,
        Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000),
      );
      $session.innerHTML =
        `<b>SESSION</b> #${session.id}` +
        `<span class="sep">·</span><b>${mins}</b>m ago` +
        `<span class="sep">·</span><b>${numberFmt.format(session.total_tokens)}</b> TKN`;
    } else {
      $session.innerHTML = `<b>SESSION</b> none`;
    }
  } catch {
    /* keep previous text */
  }
}

function paintHud(payload: UniversePayload) {
  const $tokens = document.getElementById("hud-tokens");
  const $stars = document.getElementById("hud-stars");
  const $planets = document.getElementById("hud-planets");
  const $galaxy = document.getElementById("hud-galaxy");
  if ($tokens) $tokens.textContent = numberFmt.format(payload.today_tokens);
  if ($stars) $stars.textContent = String(payload.universe.star_count);
  if ($planets) $planets.textContent = String((payload.planets ?? []).length);
  if ($galaxy) {
    const g =
      payload.universe.galaxy_type ?? classifyGalaxy(payload.universe.star_count);
    $galaxy.textContent = GALAXY_LABEL[g];
  }
  applySleepingMood(payload.universe.star_count === 0);
}

// Track the mounted sleeping canvas so we can dispose its rAF when the
// day rolls over and stars start showing up again.
let sleepingHandle: SleepingHandle | null = null;

function applySleepingMood(isSleeping: boolean) {
  const wrap = document.querySelector(".universe-wrap") as HTMLElement | null;
  if (wrap) wrap.classList.toggle("sleeping-day", isSleeping);
  const hint = document.querySelector(".hint-row");
  if (hint) hint.innerHTML = isSleeping ? SLEEPING_TAGLINE : NORMAL_HINT;

  if (isSleeping) {
    if (!sleepingHandle && wrap) sleepingHandle = mountSleepingUniverse(wrap);
  } else if (sleepingHandle) {
    sleepingHandle.dispose();
    sleepingHandle = null;
  }
}

function paintMoodBadge(payload: UniversePayload, mood: Mood | null) {
  const $layout = document.getElementById("th-layout");
  const $mood = document.getElementById("th-mood");
  const layout = payload.universe.layout_shape ?? "";
  if ($layout) {
    const label = LAYOUT_BADGE[layout];
    if (label) {
      $layout.textContent = label;
      $layout.hidden = false;
    } else {
      $layout.hidden = true;
    }
  }
  if ($mood) {
    if (mood) {
      $mood.textContent = mood.name;
      $mood.style.color = mood.accent;
      $mood.style.borderColor = `${mood.accent}55`;
      $mood.hidden = false;
    } else {
      $mood.hidden = true;
    }
  }
}

// ───────────────────── Constellation drawing bar ─────────────────────
//
// Replaces the old auto-save-on-empty-click flow. Bar appears while
// `currentConstellation` is non-null and toggles between a count row
// (취소 / 별자리 등록) and a naming row (input / 뒤로 / 등록).

function wireDrawingBar(): void {
  const cancelBtn = document.getElementById("draw-bar-cancel");
  const saveBtn = document.getElementById("draw-bar-save");
  const backBtn = document.getElementById("draw-bar-back");
  const commitBtn = document.getElementById("draw-bar-commit");
  const input = document.getElementById("draw-bar-name") as HTMLInputElement | null;

  cancelBtn?.addEventListener("click", () => cancelCurrent());
  saveBtn?.addEventListener("click", () => enterNamingMode());
  backBtn?.addEventListener("click", () => exitNamingMode());
  commitBtn?.addEventListener("click", () => void commitCurrent());

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitCurrent();
    } else if (e.key === "Escape") {
      e.preventDefault();
      exitNamingMode();
    }
  });
}

function attachEscListener(): void {
  if (escListener) return;
  escListener = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Don't steal Escape while typing into the name input — the input has
    // its own handler that backs out of naming mode.
    const target = e.target as HTMLElement | null;
    if (target && target.id === "draw-bar-name") return;
    if (state?.currentConstellation) {
      e.preventDefault();
      cancelCurrent();
    }
  };
  document.addEventListener("keydown", escListener);
}

function detachEscListener(): void {
  if (!escListener) return;
  document.removeEventListener("keydown", escListener);
  escListener = null;
}

function refreshDrawingBar(): void {
  const bar = document.getElementById("draw-bar");
  if (!bar || !state) return;
  const current = state.currentConstellation;
  if (!current) {
    bar.hidden = true;
    state.drawingMode = "count";
    showCountRow();
    return;
  }
  bar.hidden = false;
  if (state.drawingMode === "count") {
    showCountRow();
    const count = current.starIds.length;
    const $count = document.getElementById("draw-bar-count");
    const $muted = document.getElementById("draw-bar-muted");
    const $save = document.getElementById("draw-bar-save") as HTMLButtonElement | null;
    if ($count) $count.textContent = String(count);
    if ($muted) $muted.hidden = count >= 2;
    if ($save) $save.disabled = count < 2;
  } else {
    showNameRow();
  }
}

function showCountRow(): void {
  const $count = document.getElementById("draw-bar-count-row");
  const $name = document.getElementById("draw-bar-name-row");
  const $hint = document.getElementById("draw-bar-hint");
  if ($count) $count.hidden = false;
  if ($name) $name.hidden = true;
  if ($hint) $hint.hidden = true;
}

function showNameRow(): void {
  const $count = document.getElementById("draw-bar-count-row");
  const $name = document.getElementById("draw-bar-name-row");
  const $hint = document.getElementById("draw-bar-hint");
  const $input = document.getElementById("draw-bar-name") as HTMLInputElement | null;
  if ($count) $count.hidden = true;
  if ($name) $name.hidden = false;
  if ($hint) $hint.hidden = false;
  if ($input) {
    $input.value = "";
    $input.placeholder = autoConstellationName();
    setTimeout(() => $input.focus(), 30);
  }
}

function enterNamingMode(): void {
  if (!state || !state.currentConstellation) return;
  if (state.currentConstellation.starIds.length < 2) return;
  state.drawingMode = "naming";
  refreshDrawingBar();
}

function exitNamingMode(): void {
  if (!state) return;
  state.drawingMode = "count";
  refreshDrawingBar();
}

function cancelCurrent(): void {
  if (!state) return;
  state.currentConstellation = null;
  state.drawingMode = "count";
  refreshDrawingBar();
  requestRender();
}

async function commitCurrent(): Promise<void> {
  if (!state || !state.currentConstellation) return;
  if (state.currentConstellation.starIds.length < 2) return;

  const $input = document.getElementById("draw-bar-name") as HTMLInputElement | null;
  const typed = ($input?.value ?? "").trim();
  const name = typed || autoConstellationName();
  const color =
    CONSTELLATION_COLORS[state.constellationColorIdx % CONSTELLATION_COLORS.length];
  state.constellationColorIdx++;

  const starIds = state.currentConstellation.starIds.slice();

  try {
    await invoke("save_constellation", {
      name,
      color: color.main,
      starIds,
      presetId: null,
    });
  } catch (e) {
    console.error("save_constellation:", e);
  }

  state.currentConstellation = null;
  state.drawingMode = "count";
  refreshDrawingBar();
  await poll();
}

// ───────────────────── Planet pins overlay ─────────────────────
//
// Planets sit at fixed world coords. We render them as DOM elements on top of
// the canvas (one `.planet-pin` per planet) and reposition + rescale them
// every time the camera moves. Using DOM (not canvas) lets us hover, show a
// tooltip, and reuse the exact same procedural SVG that Codex renders.

const PIN_BASE_PX = 26;
const PIN_MIN_PX = 14;
const PIN_MAX_PX = 96;

let pinCanvases: PlanetCanvasHandle[] = [];

function rebuildPlanetPins(planets: Planet[]) {
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  disposeAllPlanetOrbs(pinCanvases);
  layer.innerHTML = planets.map(renderPinHtml).join("");
  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.planetId ?? "", 10);
      const planet = state?.planets.find((p) => p.id === id);
      if (planet) void openDiscoveryOverlay([planet]);
    });
  });
  pinCanvases = mountAllPlanetOrbs(layer);
  updatePlanetPins();
}

function renderPinHtml(p: Planet): string {
  const spec = PLANET_BY_ID[p.planet_type];
  const orb = spec
    ? `<div data-planet-orb data-orb-id="${spec.id}" data-orb-size="26"></div>`
    : "";
  const isNew = !p.acknowledged_at;
  const tierLabel = RARITY_LABEL[p.rarity];
  const prob = TIER_PROBABILITY[p.rarity];
  const displayName = spec?.name ?? p.planet_type;
  return `
    <div class="planet-pin"
         data-planet-id="${p.id}"
         data-rarity="${p.rarity}"
         data-new="${isNew}"
         data-px="${p.position_x}"
         data-py="${p.position_y}">
      <div class="pin-halo"></div>
      <div class="pin-svg-wrap">${orb}</div>
      <div class="pin-new-badge">NEW</div>
      <div class="pin-tooltip">
        <span class="pin-tt-name">${displayName}</span>
        <span class="pin-tt-meta">${tierLabel.toUpperCase()} · ${prob}</span>
      </div>
    </div>
  `;
}

// Halo extends `inset: -6px` and the NEW badge pokes ~10 px past the corner,
// so the effective sprite half-extent is larger than the 13 px pin radius.
const PIN_SPRITE_HALF_PX = 22;

function updatePlanetPins() {
  if (!state) return;
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  const view = state.view;
  const visibleW = UNIVERSE_W / view.zoom;
  const visibleH = UNIVERSE_H / view.zoom;
  const sizePx = clamp(
    PIN_MIN_PX,
    PIN_MAX_PX,
    PIN_BASE_PX + (view.zoom - 1) * 10,
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

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

function paintClusterTag(payload: UniversePayload) {
  const $name = document.getElementById("cluster-name");
  const $sub = document.getElementById("cluster-sub");
  if ($name) $name.textContent = payload.universe.cluster_name ?? payload.universe.date;
  if ($sub) {
    const layout = payload.universe.layout_shape ?? "—";
    $sub.textContent = `SEED · ${payload.universe.seed & 0xffff} · ${layout.toUpperCase()}`;
  }
}
