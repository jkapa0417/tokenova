// 30-planet catalog mirroring the design's `data.jsx` — names, descriptions,
// palettes, feature flags. Used by Codex, Discovery overlay, and (eventually)
// the procedural SVG planet renderer.

import type { Rarity } from "./types";

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "일반",
  rare: "희귀",
  epic: "에픽",
  legendary: "전설",
  mythic: "신화",
};

export const RARITY_TIER_CODE: Record<Rarity, "c" | "u" | "e" | "l" | "m"> = {
  common: "c",
  rare: "u",
  epic: "e",
  legendary: "l",
  mythic: "m",
};

// Object-form rings (gas giants, ancient civilization). Strict-typing the
// fields the canvas renderer reads keeps the planet entries below honest.
export interface PlanetRingSpec {
  tilt?: number;
  color?: string;
  count?: number;
  radii?: number[];
  thin?: boolean;
  spin?: boolean;
  wobble?: boolean;
}

export interface PlanetMoonSpec {
  color?: string;
  distance?: number;
  size?: number;
  speed?: number;
}

// Discriminator for non-spherical planets that take a fully custom render
// path: `gem` = faceted polyhedron, `split` = mask (day/night), `flower` =
// pearl-petal silhouette (botanical), `blackhole` = event horizon canvas.
export type PlanetShape = "gem" | "split" | "flower" | "blackhole";

export interface PlanetFeatures {
  bands?: boolean;
  spot?: boolean;
  continents?: boolean;
  continentColor?: string;
  clouds?: boolean;
  atmo?: boolean;
  polar?: boolean;
  canyons?: boolean;
  craters?: boolean;
  bigCrater?: boolean;
  veins?: boolean;
  dense_veins?: boolean;
  hotspots?: boolean;
  vortex?: boolean;
  megaVortex?: boolean;
  iridescent?: boolean;
  highlight?: boolean;
  glow?: boolean;
  facets?: boolean;
  sparkle?: boolean;
  dunes?: boolean;
  dust?: boolean;
  dustStorm?: boolean;
  cityLights?: boolean;
  denseCities?: boolean;
  constellationCities?: boolean;
  multiOcean?: boolean;
  vividBands?: boolean;
  oceanWaves?: boolean;
  fullCoverage?: boolean;
  mist?: boolean;
  denseFog?: boolean;
  grid?: boolean;
  denseGrid?: boolean;
  maze?: boolean;
  terminator?: boolean;
  duskTerminator?: boolean;
  duskHalo?: boolean;
  nightLights?: boolean;
  nightColor?: string;
  dayColor?: string;
  dayHighlight?: boolean;
  nightStars?: boolean;
  innerStars?: boolean;
  rainbow?: boolean;
  vividRainbow?: boolean;
  prism?: boolean;
  bigEye?: boolean;
  structures?: boolean;
  rings?: boolean | PlanetRingSpec;
  dyson?: boolean;
  // Volcanic / lava feature flags (design v3 differentiated lava vs volcanic).
  lavaSurface?: boolean;
  ioSpots?: boolean;
  megaVolcano?: boolean;
  // Mystic / pearl / etc.
  mysticAura?: boolean;
  runes?: boolean;
  pearlShine?: boolean;
  /** Generic axial-rotation surface flecks — used for pearl/mirror/mystic/etc. */
  slowSurface?: boolean;
  // Visual discriminator for non-spherical body silhouettes + a side-count
  // for `gem`. The planet-canvas renderer dispatches on this before the
  // sphere pipeline.
  shape?: PlanetShape;
  gemSides?: number;
  // Mirror world: star reflections on metallic surface.
  reflections?: boolean;
  // Golden world.
  metallic?: boolean;
  heatHaze?: boolean;
  // Mask world specific.
  // Generic moon orbit (earth_like / ocean_world).
  moon?: PlanetMoonSpec;
}

export interface PlanetSpec {
  id: string;
  rarity: Rarity;
  name: string;
  desc: string;
  palette: [string, string, string];
  features: PlanetFeatures;
}

export const PLANETS: PlanetSpec[] = [
  // ────── Common (12) — 70% ──────
  { id: "earth_like", rarity: "common", name: "지구형",
    desc: "온화한 대기와 푸른 바다, 흩어진 구름. 가장 흔하지만 가장 그리운 풍경.",
    palette: ["#5aa1d8", "#1c4878", "#0a2440"],
    features: {
      continents: true, continentColor: "#3a7a4a", clouds: true, atmo: true, polar: true,
      moon: { color: "#a8acb5", distance: 1.65, size: 0.16, speed: 0.4 },
    } },
  { id: "gas_giant", rarity: "common", name: "가스 거인",
    desc: "거대한 메탄·암모니아 폭풍이 띠를 이루며 흐른다. 토성 같은 거대 고리가 행성을 두른다.",
    palette: ["#d8b078", "#7a5028", "#3a2010"],
    features: {
      bands: true, spot: true,
      rings: { tilt: 0.32, color: "#d8b078", count: 3, radii: [1.32, 1.5, 1.68] },
    } },
  { id: "mars_like", rarity: "common", name: "화성형",
    desc: "산화철의 깊은 붉은빛. 거대 협곡이 적도를 가르고 양 극에 옅은 극관.",
    palette: ["#c97357", "#5a2a1d", "#2e1612"],
    features: { polar: true, canyons: true, craters: true, dust: true } },
  { id: "ice_giant", rarity: "common", name: "얼음 거인",
    desc: "청록빛 메탄 대기. 행성을 가로지르는 얇은 푸른 고리.",
    palette: ["#5fb5e8", "#1c4a78", "#0a2e58"],
    features: {
      bands: true, atmo: true,
      rings: { tilt: 0.2, color: "#a8d8f0", count: 2, radii: [1.35, 1.55], thin: true },
    } },
  { id: "dead_world", rarity: "common", name: "죽은 세계",
    desc: "대기 없는 회색 본체. 수십억 년의 충돌 흔적과 거대 크레이터.",
    palette: ["#a8acb5", "#52555c", "#1f2128"],
    features: { craters: true, bigCrater: true } },
  { id: "lava_world", rarity: "common", name: "용암 세계",
    desc: "절반 이상이 흐르는 마그마. 다타 버린 표면에서 광래하는 용암 강이 멈추지 않는다.",
    palette: ["#5a2a18", "#1a0808", "#080404"],
    features: { lavaSurface: true, glow: true } },
  { id: "crystal", rarity: "common", name: "수정",
    desc: "표면이 거대한 단일 결정으로 이루어진 행성. 모든 빛이 한 번 더 갈라진다.",
    palette: ["#a8c8e8", "#4a6898", "#1c2848"],
    features: { shape: "gem", gemSides: 6 } },
  { id: "ocean_world", rarity: "common", name: "바다 세계",
    desc: "한 점의 육지도 없이 깊은 바다만 가득. 작은 위성 하나가 동행한다.",
    palette: ["#3a8ac8", "#0e3a68", "#04162e"],
    features: {
      clouds: true, atmo: true, highlight: true, oceanWaves: true,
      moon: { color: "#e8d4b0", distance: 1.55, size: 0.12, speed: 0.55 },
    } },
  { id: "desert_world", rarity: "common", name: "사막 세계",
    desc: "말라버린 바다와 끝없는 모래 능선. 거대한 모래폭풍이 영원히 돈다.",
    palette: ["#d8a868", "#7a5028", "#2e1f10"],
    features: { dunes: true, dustStorm: true } },
  { id: "mist_world", rarity: "common", name: "안개 세계",
    desc: "두꺼운 안개가 표면을 영원히 감춘다. 빛만이 흘러나온다.",
    palette: ["#d4d0e0", "#6e6878", "#1f1c28"],
    features: { atmo: true, glow: true, clouds: true, mist: true, denseFog: true } },
  { id: "volcanic", rarity: "common", name: "화산 행성",
    desc: "표면 곳곳에서 타오르는 수십 개의 활화산. 아이오의 익은 아우.",
    palette: ["#5a2418", "#1a0808", "#040202"],
    features: { ioSpots: true, glow: true } },
  { id: "jungle", rarity: "common", name: "정글 행성",
    desc: "대륙 전체를 덮은 거대 식생. 광합성이 행성을 초록으로 물들였다.",
    palette: ["#6ab075", "#1f4a28", "#082010"],
    features: { continents: true, continentColor: "#2a6a30", clouds: true, atmo: true, fullCoverage: true } },

  // ────── Rare (10) — 20% ──────
  { id: "storm", rarity: "rare", name: "폭풍 행성",
    desc: "단 하나의 거대 폭풍이 행성 전체를 휘감는다. 그 중심에 작은 정적이 있다.",
    palette: ["#7a9bc8", "#2e426a", "#0a1424"],
    features: { vortex: true, megaVortex: true } },
  { id: "pearl", rarity: "rare", name: "진주 행성",
    desc: "대기 분자가 항성광을 분해해 진주빛을 반사한다. 보는 각도마다 색이 변한다.",
    palette: ["#f0dccc", "#a89878", "#5a4a3a"],
    features: { iridescent: true, highlight: true, glow: true, pearlShine: true, slowSurface: true } },
  { id: "amethyst", rarity: "rare", name: "자수정",
    desc: "보랏빛 결정 격자가 표면 전체에 새겨졌다. 자른 듯한 모서리들.",
    palette: ["#b290f2", "#5a3a8a", "#22143a"],
    features: { shape: "gem", gemSides: 6, sparkle: true, glow: true } },
  { id: "emerald", rarity: "rare", name: "에메랄드",
    desc: "광합성 박테리아가 만들어낸 깊은 초록 행성. 보석처럼 빛난다.",
    palette: ["#5fae7e", "#1e4a30", "#0a201a"],
    features: { shape: "gem", gemSides: 6, glow: true } },
  { id: "mirror", rarity: "rare", name: "거울 행성",
    desc: "거울 같은 금속 표면이 항성의 모습과 별들을 한 번 더 비춘다.",
    palette: ["#e8eaf0", "#7c8088", "#2a2c34"],
    features: { highlight: true, glow: true, reflections: true, slowSurface: true } },
  { id: "botanical", rarity: "rare", name: "식물의 세계",
    desc: "지능 있는 식물이 행성 표면에 정원 같은 동심원 무늬를 만든다.",
    palette: ["#74c08a", "#2e6a3e", "#1a3a26"],
    features: { shape: "flower", atmo: true, glow: true } },
  { id: "mystic", rarity: "rare", name: "신비의 행성",
    desc: "관측될 때마다 미세하게 다른 무늬가 나타난다. 패턴은 알려진 바 없다.",
    palette: ["#8db5d8", "#36527a", "#101830"],
    features: { mysticAura: true, glow: true, atmo: true, runes: true, slowSurface: true } },
  { id: "twilight", rarity: "rare", name: "황혼 행성",
    desc: "조석 고정. 한쪽은 영원한 노을, 반대쪽은 영원한 밤. 어둠 속에 도시 불빛.",
    palette: ["#e89568", "#7a4628", "#3a1c10"],
    features: { duskTerminator: true, nightLights: true, duskHalo: true, atmo: true, slowSurface: true } },
  { id: "nocturnal", rarity: "rare", name: "야행성 행성",
    desc: "표면이 빛을 흡수하는 검은 본체. 도시 불빛이 별자리를 그린다.",
    palette: ["#2a2e3a", "#0e1018", "#040508"],
    features: { cityLights: true, denseCities: true, constellationCities: true } },
  { id: "multi_ocean", rarity: "rare", name: "다중해",
    desc: "서로 섞이지 않는 여러 액체가 층층이 흐른다. 색의 줄.",
    palette: ["#5fc7c0", "#1c4f4d", "#0a262e"],
    features: { bands: true, multiOcean: true, atmo: true, vividBands: true, slowSurface: true } },

  // ────── Epic (5) — 8% ──────
  { id: "diamond", rarity: "epic", name: "다이아몬드",
    desc: "극압에서 형성된 단일 다이아몬드 본체. 별빛이 무지개로 흩어진다.",
    palette: ["#f0f4ff", "#8ca8c4", "#3a4a64"],
    features: { shape: "gem", gemSides: 8, sparkle: true, highlight: true, glow: true, prism: true } },
  { id: "rainbow", rarity: "epic", name: "무지개 행성",
    desc: "대기 회절로 행성 표면이 일곱 개의 색띠로 갈라져 보인다.",
    palette: ["#feca57", "#7a78d8", "#3a1a4a"],
    features: { rainbow: true, vividRainbow: true, glow: true, atmo: true, slowSurface: true } },
  { id: "mask", rarity: "epic", name: "가면 행성",
    desc: "한 면은 황금빛 사막, 한 면은 별이 비치는 어둠. 경계선은 칼처럼 날카롭다.",
    palette: ["#e0d8c8", "#1a1828", "#040408"],
    features: {
      shape: "split", dayColor: "#f0c878", nightColor: "#0c0c1a",
      dayHighlight: true, nightStars: true,
    } },
  { id: "golden", rarity: "epic", name: "황금 행성",
    desc: "핵까지 금속 금으로 이루어진 행성. 항성과 동등한 광채.",
    palette: ["#ffd700", "#a88820", "#5a4810"],
    features: { highlight: true, glow: true, sparkle: true, metallic: true, heatHaze: true, slowSurface: true } },
  { id: "grid", rarity: "epic", name: "격자 행성",
    desc: "표면 전체에 빛나는 격자 무늬가 자연적으로 형성됨. 누가 만들었는지 모른다.",
    palette: ["#4a6890", "#1a2848", "#08101c"],
    features: { grid: true, glow: true, denseGrid: true, slowSurface: true } },

  // ────── Legendary (2) — 1.9% ──────
  { id: "eye_world", rarity: "legendary", name: "눈동자 세계",
    desc: "행성 전체가 하나의 거대한 눈. 관측자를 마주 본다.",
    palette: ["#e8c89e", "#7a5028", "#1a1018"],
    features: { bigEye: true, glow: true } },
  { id: "ancient_civilization", rarity: "legendary", name: "고대 문명",
    desc: "표면에 박힌 거대 구조물. 누가 만들었는지 알려진 바 없다. 밤에는 불빛이 켜진다.",
    palette: ["#c4ad75", "#5a4825", "#1a1208"],
    features: {
      structures: true, cityLights: true,
      rings: { tilt: 0.36, color: "#a08068", count: 2, radii: [1.36, 1.55], spin: true, wobble: true },
    } },

  // ────── Mythic (2) — 0.1% ──────
  { id: "dyson_sphere", rarity: "mythic", name: "다이슨 구체",
    desc: "항성을 완전히 둘러싼 거대 구조물. 모든 빛이 안으로 흘러 들어간다.",
    palette: ["#ffd89a", "#f08c6d", "#5a2018"],
    features: { dyson: true } },
  { id: "black_hole", rarity: "mythic", name: "블랙홀",
    desc: "시공간을 삼키는 단 하나의 점. 빛조차 빠져나오지 못한다. 강착 원반의 빛으로만 그 존재가 확인된다.",
    palette: ["#1a1018", "#0a060c", "#000"],
    features: { shape: "blackhole" } },
];

export const PLANET_BY_ID: Record<string, PlanetSpec> = Object.fromEntries(
  PLANETS.map((p) => [p.id, p]),
);

export const PLANET_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  PLANETS.map((p) => [p.id, p.name]),
);

export const PLANET_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  PLANETS.map((p) => [p.id, p.desc]),
);

export const TIER_ORDER: Rarity[] = ["common", "rare", "epic", "legendary", "mythic"];

export const TIER_PROBABILITY: Record<Rarity, string> = {
  common: "70%",
  rare: "20%",
  epic: "8%",
  legendary: "1.9%",
  mythic: "0.1%",
};
