// Today view: live universe canvas + bottom HUD + discovery badge.
// Polling drives non-realtime updates (universe payload, session); a Tauri
// listener handles real-time star/planet pushes from the engine.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { PLANET_BY_ID, RARITY_LABEL, TIER_PROBABILITY } from "../universe/catalog";
import { makeView, type View } from "../universe/camera";
import { UniverseInteraction } from "../universe/interaction";
import { planetSvg } from "../universe/planet-svg";
import { UniverseRenderer, type Scene } from "../universe/renderer";
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

const BLACKHOLE_TAGLINE = "오늘은 쉬어가요. · 블랙홀도 우주의 일부입니다.";

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

function generateConstellationName(): string {
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
}

let state: TodayState | null = null;

export function activateToday(): void {
  if (state) {
    state.pollTimer ??= window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    void refreshDiscoveryBadge();
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
  };
  state = local;

  local.interaction = new UniverseInteraction(canvas, view, () => local.stars, {
    onChange: () => {
      updateZoomTag();
      updatePlanetPins();
      requestRender();
    },
    onStarClick: (star) => onStarClick(star),
    onEmptyClick: () => void onEmptyClick(),
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

  local.pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();
  // Show any pending overlays for planets discovered while the popover was closed.
  void refreshDiscoveryBadge();
}

export function deactivateToday(): void {
  if (!state) return;
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function requestRender() {
  if (!state || !state.renderer) return;
  const scene: Scene = {
    stars: state.stars,
    planets: state.planets,
    nebulae: state.nebulae,
    constellations: state.constellations,
    currentConstellation: state.currentConstellation,
    hoveredStarId: state.hoveredStarId,
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
  requestRender();
}

async function onEmptyClick() {
  if (!state) return;
  if (!state.currentConstellation || state.currentConstellation.starIds.length < 2) {
    state.currentConstellation = null;
    requestRender();
    return;
  }

  const color =
    CONSTELLATION_COLORS[state.constellationColorIdx % CONSTELLATION_COLORS.length];
  const name = generateConstellationName();
  state.constellationColorIdx++;

  try {
    await invoke("save_constellation", {
      name,
      color: color.main,
      starIds: state.currentConstellation.starIds,
      presetId: null,
    });
  } catch (e) {
    console.error("save_constellation:", e);
  }

  state.currentConstellation = null;
  await poll();
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

    paintHud(payload);
    paintClusterTag(payload);
    rebuildPlanetPins(state.planets);
    requestRender();
  } catch (e) {
    console.error("poll:", e);
    // Surface the failure on-screen so issues are visible without dev tools.
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
  const $galaxy = document.getElementById("hud-galaxy");
  if ($tokens) $tokens.textContent = numberFmt.format(payload.today_tokens);
  if ($stars) $stars.textContent = String(payload.universe.star_count);
  if ($galaxy) {
    const g =
      payload.universe.galaxy_type ?? classifyGalaxy(payload.universe.star_count);
    $galaxy.textContent = GALAXY_LABEL[g];
  }
  applyBlackholeMood(payload.universe.star_count === 0);
}

function applyBlackholeMood(isBlackhole: boolean) {
  const wrap = document.querySelector(".universe-wrap");
  if (wrap) wrap.classList.toggle("blackhole-day", isBlackhole);
  const hint = document.querySelector(".hint-row");
  if (!hint) return;
  if (isBlackhole) {
    hint.innerHTML = BLACKHOLE_TAGLINE;
  } else {
    hint.innerHTML =
      `<b>WHEEL</b> ZOOM<span class="sep">·</span><b>DRAG</b> PAN<span class="sep">·</span><b>CLICK</b> CONSTELLATION`;
  }
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

function rebuildPlanetPins(planets: Planet[]) {
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  layer.innerHTML = planets.map(renderPinHtml).join("");
  // Wire click → open the discovery overlay (single-item) for any pin.
  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.planetId ?? "", 10);
      const planet = state?.planets.find((p) => p.id === id);
      if (planet) void openDiscoveryOverlay([planet]);
    });
  });
  updatePlanetPins();
}

function renderPinHtml(p: Planet): string {
  const spec = PLANET_BY_ID[p.planet_type];
  const orb = spec ? planetSvg(spec, 26) : "";
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

function updatePlanetPins() {
  if (!state) return;
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  const view = state.view;
  // Visible window of world coordinates at current zoom/pan.
  const visibleW = UNIVERSE_W / view.zoom;
  const visibleH = UNIVERSE_H / view.zoom;
  // Pin pixel size scales linearly from 26 at zoom 1 to 96 at zoom 8.
  const sizePx = clamp(
    PIN_MIN_PX,
    PIN_MAX_PX,
    PIN_BASE_PX + (view.zoom - 1) * 10,
  );
  const pinScale = sizePx / PIN_BASE_PX;

  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    const px = parseFloat(el.dataset.px ?? "0");
    const py = parseFloat(el.dataset.py ?? "0");
    const nx = (px - view.x) / visibleW;
    const ny = (py - view.y) / visibleH;
    // Outside the viewport → hide. Otherwise position by percentage so we
    // automatically follow any container resize.
    if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > 1.02) {
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
