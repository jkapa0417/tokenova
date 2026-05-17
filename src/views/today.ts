// Today view: live universe canvas + bottom HUD + discovery badge.
// Polling drives non-realtime updates (universe payload, session); a Tauri
// listener handles real-time star/planet pushes from the engine.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { PLANET_BY_ID, RARITY_LABEL, TIER_PROBABILITY } from "../universe/catalog";
import { makeView, worldToScreen, type View } from "../universe/camera";
import { DISPLAY_H as CANVAS_H, DISPLAY_W as CANVAS_W } from "../universe/types";
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
  type Constellation,
  type GalaxyType,
  type Nebula,
  type Planet,
  type Star,
  type UniversePayload,
} from "../universe/types";

import { formatNumber, getLocale, t } from "../i18n";
import { ko as koDict } from "../i18n/locales/ko";
import { en as enDict } from "../i18n/locales/en";
import { openDiscoveryOverlay, refreshDiscoveryBadge } from "./discovery";

const POLL_INTERVAL_MS = 3000;

const GALAXY_LABEL_KEY: Record<GalaxyType, string> = {
  black_hole: "galaxy_type.black_hole",
  nebula: "galaxy_type.nebula",
  cluster: "galaxy_type.cluster",
  galaxy: "galaxy_type.galaxy",
  mega_galaxy: "galaxy_type.mega",
  super_cluster: "galaxy_type.super",
};

const LAYOUT_BADGE: Record<string, string> = {
  spiral: "SPIRAL",
  elliptical: "ELLIPTICAL",
  irregular: "IRREGULAR",
  dual_cluster: "DUAL",
  scattered: "SCATTERED",
  core_heavy: "CORE",
};

const CONSTELLATION_COLORS = [
  { main: "rgba(255, 200, 130, 0.9)", glow: "rgba(255, 180, 80, 0.35)" },
  { main: "rgba(140, 200, 255, 0.9)", glow: "rgba(80, 150, 255, 0.35)" },
  { main: "rgba(220, 160, 255, 0.9)", glow: "rgba(180, 100, 255, 0.35)" },
  { main: "rgba(150, 255, 200, 0.9)", glow: "rgba(80, 220, 150, 0.35)" },
  { main: "rgba(255, 170, 200, 0.9)", glow: "rgba(255, 100, 160, 0.35)" },
];

function autoConstellationName(): string {
  // Pull the noun + adjective pool from the current locale dict directly so
  // English mode produces "The Radiant Stag" instead of mixing scripts.
  const dict = getLocale() === "ko" ? koDict : enDict;
  const adjectives = dict.constellation_pool.adjectives;
  const subjects = dict.constellation_pool.subjects;
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  return t("today.constellation.auto_name", { adjective, subject });
}

function classifyGalaxy(count: number): GalaxyType {
  if (count === 0) return "black_hole";
  if (count <= 30) return "nebula";
  if (count <= 100) return "cluster";
  if (count <= 300) return "galaxy";
  if (count <= 999) return "mega_galaxy";
  return "super_cluster";
}

// Locale-aware number formatting — `formatNumber` from "../i18n" picks ko-KR
// or en-US based on current locale, so HUD counts switch grouping at the same
// time as the UI strings.

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
  wireClusterNameEdit();
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
  // Reset the id cache so the next activation rebuilds the pin DOM from
  // scratch — otherwise the "skip rebuild when ids match" optimization
  // sees the same planet list, takes the fast path, and leaves the
  // overlay empty because the canvases were just disposed.
  pinPlanetIds = [];
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
        `<span class="sep">·</span><b>${formatNumber(session.total_tokens)}</b> TKN`;
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
  if ($tokens) paintTokenTicker($tokens, payload.today_tokens);
  if ($stars) $stars.textContent = String(payload.universe.star_count);
  if ($planets) $planets.textContent = String((payload.planets ?? []).length);
  if ($galaxy) {
    const g =
      payload.universe.galaxy_type ?? classifyGalaxy(payload.universe.star_count);
    $galaxy.textContent = t(GALAXY_LABEL_KEY[g]);
  }
  applySleepingMood(payload.universe.star_count === 0);
}

// ─── Token ticker (stock-quote style digit roll) ───
//
// Renders `value` as a row of 1-character columns. Each digit column shows a
// vertical strip of 0-9 stacked; setting `translateY: -N * 10%` reveals the
// Nth digit. CSS transition animates the slide so updates feel like a real
// ticker. Commas / minus signs / leading zeros are static spans.


function paintTokenTicker(host: HTMLElement, value: number): void {
  const text = formatNumber(value);
  // Build / reconcile the digit slots.
  if (host.dataset.tickerInited !== "true" || host.childElementCount === 0) {
    host.classList.add("token-ticker");
    host.innerHTML = buildTickerHtml(text);
    host.dataset.tickerInited = "true";
    return;
  }

  // If the formatted string length changed (e.g. crossed a thousand), rebuild
  // from scratch so we don't try to in-place mutate a different layout.
  const expected = host.querySelectorAll(".tk-slot").length;
  const incomingSlots = text.split("");
  if (incomingSlots.length !== expected) {
    host.innerHTML = buildTickerHtml(text);
    return;
  }

  // Same width — just update each slot's offset. Digit slots animate via
  // CSS transition on transform.
  const slots = host.querySelectorAll<HTMLElement>(".tk-slot");
  for (let i = 0; i < slots.length; i++) {
    const ch = incomingSlots[i];
    const slot = slots[i];
    if (slot.classList.contains("tk-digit")) {
      const d = parseInt(ch, 10);
      if (!isNaN(d)) {
        const col = slot.firstElementChild as HTMLElement | null;
        if (col) col.style.transform = `translateY(${-d * 10}%)`;
      } else {
        // The slot used to be a digit but the new char is punctuation —
        // happens when crossing 10^N boundaries the same length filter
        // above didn't catch. Replace it inline.
        slot.replaceWith(staticSlot(ch));
      }
    } else if (slot.textContent !== ch) {
      slot.textContent = ch;
    }
  }
}

function buildTickerHtml(text: string): string {
  return text.split("").map((ch) => {
    const d = parseInt(ch, 10);
    if (!isNaN(d)) {
      // Pre-render a 0-9 column; CSS will translateY to expose the target digit.
      const col = "0123456789".split("").map((n) => `<span>${n}</span>`).join("");
      return `<span class="tk-slot tk-digit"><span class="tk-col" style="transform: translateY(${-d * 10}%)">${col}</span></span>`;
    }
    return `<span class="tk-slot tk-static">${escapeChar(ch)}</span>`;
  }).join("");
}

function staticSlot(ch: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "tk-slot tk-static";
  span.textContent = ch;
  return span;
}

function escapeChar(ch: string): string {
  return ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch;
}

// Track the mounted sleeping canvas so we can dispose its rAF when the
// day rolls over and stars start showing up again.
let sleepingHandle: SleepingHandle | null = null;

function applySleepingMood(isSleeping: boolean) {
  const wrap = document.querySelector(".universe-wrap") as HTMLElement | null;
  if (wrap) wrap.classList.toggle("sleeping-day", isSleeping);
  const hint = document.querySelector(".hint-row");
  if (hint) hint.innerHTML = isSleeping ? t("today.sleeping") : t("today.hint");

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
    // Korean (and other IME-driven) input fires keydown for the Enter key
    // that ALSO commits an in-progress composition. Skip our handler while
    // composition is active so the IME finishes naturally and the typed
    // characters actually land in the input. `e.isComposing` is the safe
    // signal; some browsers also use keyCode 229.
    if ((e as KeyboardEvent).isComposing || e.keyCode === 229) return;
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
    const $label = document.getElementById("draw-bar-label");
    const $muted = document.getElementById("draw-bar-muted");
    const $save = document.getElementById("draw-bar-save") as HTMLButtonElement | null;
    if ($label) $label.innerHTML = t("today.draw_bar.connected_n", { count });
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
    imeSafeFocus($input);
  }
}

// Focus an input in a way that's reliable across WebView2 (Windows) and
// WebKit2GTK (Linux/WSLg). The straight `.focus()` call sometimes leaves the
// document in a "ghost focus" state where Latin keys work but OS-level IME
// hotkeys (한/영, Shift+Space) get swallowed before reaching the webview.
// Wrapping focus in a small timeout + a blur/refocus cycle forces the webview
// to (re)bind its input-method context to the live element.
function imeSafeFocus(el: HTMLInputElement | HTMLTextAreaElement): void {
  setTimeout(() => {
    el.focus();
    // One blur+refocus tick to nudge the webview's IM context into rebinding.
    // No-op for users where focus already worked; helps the cases where it didn't.
    setTimeout(() => {
      el.blur();
      el.focus();
      if (typeof (el as HTMLInputElement).select === "function") {
        try {
          (el as HTMLInputElement).select();
        } catch {
          // ignore — some elements (range/file inputs) don't support select()
        }
      }
    }, 20);
  }, 100);
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

// Pin wrap is now 96 CSS px so the canvas inside has matching backing
// resolution. CSS transform: scale only ever DOWNSCALES (0.14-1.0), which
// the GPU does smoothly — no upscale blur at high universe zoom.
const PIN_BASE_PX = 96;
const PIN_MIN_PX = 14;
const PIN_MAX_PX = 96;

let pinCanvases: PlanetCanvasHandle[] = [];
let pinPlanetIds: number[] = [];

function rebuildPlanetPins(planets: Planet[]) {
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  // Skip the heavy dispose-and-remount when the universe's planet list
  // hasn't actually changed — every 3 s poll() was rebuilding all pins
  // unconditionally, which restarted every PlanetCanvas's rAF and gave a
  // visible "all planets flash from the start" effect.
  const nextIds = planets.map((p) => p.id);
  if (sameIdList(nextIds, pinPlanetIds)) {
    updatePlanetPins();
    return;
  }
  pinPlanetIds = nextIds;
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

function sameIdList(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function renderPinHtml(p: Planet): string {
  const spec = PLANET_BY_ID[p.planet_type];
  const orb = spec
    ? `<div class="pin-orb-host" data-planet-orb data-orb-id="${spec.id}" data-orb-size="96"></div>`
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

// Visual sprite half-extent at pinScale=1.0 (universe zoom 8) = pin box 96
// + halo + badge ≈ 162 visual px wide, half ≈ 81. spriteHalfPx is scaled
// by pinScale so culling is correct at any zoom.
const PIN_SPRITE_HALF_PX = 81;

function updatePlanetPins() {
  if (!state) return;
  const layer = document.getElementById("planet-overlay");
  if (!layer) return;
  const view = state.view;
  // Visual size grows from 26 (zoom 1) to 96 (zoom 8); PIN_BASE_PX (96) is
  // the pin's CSS box, so pinScale = visualSize / 96 sits in 0.27..1.0.
  const sizePx = clamp(
    PIN_MIN_PX,
    PIN_MAX_PX,
    26 + (view.zoom - 1) * 10,
  );
  const pinScale = sizePx / PIN_BASE_PX;
  const spriteHalfPx = PIN_SPRITE_HALF_PX * pinScale;

  // Position pins in canvas-space pixels (same coord system the renderer
  // draws stars into) rather than overlay percentages. The canvas itself
  // is pinned inline to CANVAS_W × CANVAS_H CSS pixels at the wrap's
  // top-left (see UniverseRenderer ctor), while .planet-overlay extends to
  // the full wrap with `inset: 0`. Using percentages of the overlay made
  // off-centre planets drift as the wrap's height (≈ window height − HUD)
  // differed from CANVAS_H, especially during zoom where the drift scales
  // with view position.
  //
  // Pixel positioning via worldToScreen guarantees pin and underlying star
  // share the exact same screen coordinate at every zoom level.
  const rect = layer.getBoundingClientRect();
  const overlayH = rect.height || CANVAS_H;
  const hudEl = document.querySelector(".today-hud") as HTMLElement | null;
  const hudRect = hudEl?.getBoundingClientRect();
  const hudOverlapPx = hudRect
    ? Math.max(0, rect.bottom - hudRect.top)
    : 0;
  // Bottom cull: whichever is tighter — canvas bottom edge (CANVAS_H) or
  // the visible region above the HUD readout. Pins beyond either get hidden
  // so they don't poke into the HUD or hang off the canvas.
  const cullBottom = Math.min(CANVAS_H, overlayH - hudOverlapPx);

  layer.querySelectorAll<HTMLElement>(".planet-pin").forEach((el) => {
    const px = parseFloat(el.dataset.px ?? "0");
    const py = parseFloat(el.dataset.py ?? "0");
    const screen = worldToScreen(view, px, py);
    if (
      screen.x < spriteHalfPx ||
      screen.x > CANVAS_W - spriteHalfPx ||
      screen.y < spriteHalfPx ||
      screen.y > cullBottom - spriteHalfPx
    ) {
      el.classList.add("off-screen");
      return;
    }
    el.classList.remove("off-screen");
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    el.style.setProperty("--pin-scale", pinScale.toFixed(3));
  });
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

function paintClusterTag(payload: UniversePayload) {
  const $name = document.getElementById("cluster-name");
  const $sub = document.getElementById("cluster-sub");
  // Skip overwriting during an active rename so the user's in-progress input
  // isn't blown away by the next 3-second poll.
  if ($name && !$name.classList.contains("editing")) {
    $name.textContent = payload.universe.cluster_name ?? payload.universe.date;
  }
  if ($sub) {
    const layout = payload.universe.layout_shape ?? "—";
    $sub.textContent = `SEED · ${payload.universe.seed & 0xffff} · ${layout.toUpperCase()}`;
  }
}

// Inline-edit the cluster name on click. Enter / blur commits, Escape reverts.
// IME composition is respected so Korean (and other) input works.
function wireClusterNameEdit(): void {
  const $name = document.getElementById("cluster-name");
  if (!$name) return;
  $name.title = t("today.cluster_edit_tip");
  $name.addEventListener("click", () => {
    if ($name.classList.contains("editing")) return;
    const current = ($name.textContent ?? "").trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "th-name-input";
    input.value = current;
    input.maxLength = 40;
    input.lang = "ko";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.placeholder = t("today.cluster_name_placeholder");

    $name.classList.add("editing");
    $name.textContent = "";
    $name.appendChild(input);
    // NB: don't use imeSafeFocus here. Its blur/refocus rebinding cycle would
    // trigger our own blur listener below (which commits + destroys the
    // input), so the field would vanish the instant we open it. A plain
    // delayed focus is enough because the user just clicked into the app —
    // the webview already has focus and the IM context is live.
    let openingFocus = true;
    setTimeout(() => {
      input.focus();
      input.select();
      // Tiny grace period after focus before we let blur commit, so any
      // focus-shuffle from the browser during element insertion doesn't
      // immediately fire the commit path.
      setTimeout(() => {
        openingFocus = false;
      }, 50);
    }, 60);

    let committing = false;
    const finish = async (commit: boolean) => {
      if (committing) return;
      committing = true;
      if (!commit) {
        $name.classList.remove("editing");
        $name.textContent = current;
        return;
      }
      try {
        const newName = await invoke<string>("rename_current_galaxy", {
          name: input.value,
        });
        $name.classList.remove("editing");
        $name.textContent = newName;
      } catch (e) {
        console.error("rename_current_galaxy:", e);
        $name.classList.remove("editing");
        $name.textContent = current;
      }
    };

    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => {
      if (openingFocus) return;
      void finish(true);
    });
  });
}
