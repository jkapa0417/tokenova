// Today view: live canvas of the current universe + bottom stats bar.
// Activates polling only while the tab is visible.

import { invoke } from "@tauri-apps/api/core";

import { makeView, type View } from "../universe/camera";
import { UniverseInteraction } from "../universe/interaction";
import { UniverseRenderer, type Scene } from "../universe/renderer";
import type {
  Constellation,
  Nebula,
  Planet,
  Star,
  UniversePayload,
} from "../universe/types";

const POLL_INTERVAL_MS = 3000;

const GALAXY_LABEL: Record<string, string> = {
  black_hole: "블랙홀",
  nebula: "성운",
  cluster: "별무리",
  galaxy: "은하",
  mega_galaxy: "거대 은하",
  super_cluster: "초은하단",
};

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

function classifyGalaxy(count: number): string {
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
}

let state: TodayState | null = null;

export function activateToday(): void {
  if (state) {
    // Already mounted (e.g. user toggled tabs). Just resume polling.
    state.pollTimer ??= window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
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
  };
  state = local;

  local.interaction = new UniverseInteraction(
    canvas,
    view,
    () => local.stars,
    {
      onChange: () => requestRender(),
      onStarClick: (star) => onStarClick(star),
      onEmptyClick: () => void onEmptyClick(),
      onHoverChange: (star) => {
        local.hoveredStarId = star?.id ?? null;
        requestRender();
      },
    },
  );

  local.pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  void poll();
}

export function deactivateToday(): void {
  if (!state) return;
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  // Keep the renderer/interaction mounted so coming back is instant.
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
  updateConstUI();
  requestRender();
}

async function onEmptyClick() {
  if (!state) return;
  if (!state.currentConstellation || state.currentConstellation.starIds.length < 2) {
    state.currentConstellation = null;
    updateConstUI();
    requestRender();
    return;
  }

  const color =
    CONSTELLATION_COLORS[state.constellationColorIdx % CONSTELLATION_COLORS.length];
  const name = generateConstellationName();
  state.constellationColorIdx++;

  const hint = document.getElementById("s-hint");
  try {
    await invoke("save_constellation", {
      name,
      color: color.main,
      starIds: state.currentConstellation.starIds,
      presetId: null,
    });
    if (hint) hint.textContent = `"${name}" 저장됨`;
  } catch (e) {
    console.error("save_constellation:", e);
    if (hint) hint.textContent = "별자리 저장 실패";
  }
  setTimeout(() => {
    if (hint) hint.textContent = "스크롤: 줌 · 드래그: 이동 · 별 클릭: 별자리";
  }, 2000);

  state.currentConstellation = null;
  updateConstUI();
  await poll();
}

function updateConstUI() {
  const $const = document.getElementById("s-constellation");
  const $hint = document.getElementById("s-hint");
  if (!$const || !state) return;
  if (state.currentConstellation && state.currentConstellation.starIds.length > 0) {
    $const.textContent = `별자리: ${state.currentConstellation.starIds.length}★`;
    if ($hint) $hint.textContent = "빈 공간 클릭: 완성 · 별 클릭: 추가/제거";
  } else {
    $const.textContent =
      state.constellations.length > 0 ? `별자리 ${state.constellations.length}개` : "";
  }
}

async function poll() {
  if (!state) return;
  try {
    const payload = await invoke<UniversePayload>("get_current_universe");
    state.stars = payload.stars;
    state.planets = payload.planets;
    state.nebulae = payload.nebulae;
    state.constellations = payload.constellations;

    const $tokens = document.getElementById("s-tokens");
    const $stars = document.getElementById("s-stars");
    const $galaxy = document.getElementById("s-galaxy");
    if ($tokens) $tokens.textContent = numberFmt.format(payload.today_tokens);
    if ($stars) {
      $stars.textContent =
        `⭐ ${payload.universe.star_count}/1000 · 🪐 ${payload.planets.length}`;
    }
    if ($galaxy) {
      const g =
        payload.universe.galaxy_type ?? classifyGalaxy(payload.universe.star_count);
      $galaxy.textContent = GALAXY_LABEL[g] ?? g;
    }

    updateConstUI();
    requestRender();
  } catch (e) {
    console.error("poll:", e);
  }

  try {
    const session = await invoke<
      { id: number; started_at: string; total_tokens: number } | null
    >("get_current_session");
    const $session = document.getElementById("s-session");
    if ($session) {
      if (session) {
        const mins = Math.max(
          0,
          Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000),
        );
        $session.textContent =
          `세션 #${session.id} · ${mins}분 · ${numberFmt.format(session.total_tokens)}토큰`;
      } else {
        $session.textContent = "세션 없음";
      }
    }
  } catch {
    const $session = document.getElementById("s-session");
    if ($session) $session.textContent = "";
  }
}
