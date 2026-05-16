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
  veins?: boolean;
  hotspots?: boolean;
  vortex?: boolean;
  iridescent?: boolean;
  highlight?: boolean;
  glow?: boolean;
  facets?: boolean;
  sparkle?: boolean;
  dunes?: boolean;
  cityLights?: boolean;
  multiOcean?: boolean;
  mist?: boolean;
  grid?: boolean;
  maze?: boolean;
  terminator?: boolean;
  nightColor?: string;
  innerStars?: boolean;
  rainbow?: boolean;
  bigEye?: boolean;
  structures?: boolean;
  rings?: boolean;
  dyson?: boolean;
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
    features: { continents: true, continentColor: "#3a7a4a", clouds: true, atmo: true, polar: true } },
  { id: "gas_giant", rarity: "common", name: "가스 거인",
    desc: "거대한 메탄·암모니아 폭풍이 띠를 이루며 흐른다. 한쪽엔 영원히 돌아가는 거대 점이 있다.",
    palette: ["#d8b078", "#7a5028", "#3a2010"],
    features: { bands: true, spot: true } },
  { id: "mars_like", rarity: "common", name: "화성형",
    desc: "산화철의 깊은 붉은빛. 옅은 극관과 거대한 협곡이 적도를 가로지른다.",
    palette: ["#c97357", "#5a2a1d", "#2e1612"],
    features: { polar: true, canyons: true, craters: true } },
  { id: "ice_giant", rarity: "common", name: "얼음 거인",
    desc: "청록빛 메탄 대기가 빛을 굴절시키는 차가운 거인.",
    palette: ["#5fb5e8", "#1c4a78", "#0a2e58"],
    features: { bands: true, atmo: true } },
  { id: "dead_world", rarity: "common", name: "죽은 세계",
    desc: "대기 없는 회색 본체. 수십억 년의 충돌 흔적만 새겨졌다.",
    palette: ["#a8acb5", "#52555c", "#1f2128"],
    features: { craters: true } },
  { id: "lava_world", rarity: "common", name: "용암 세계",
    desc: "식어버린 표면 아래 살아 있는 마그마 격자가 흐른다.",
    palette: ["#5a2a18", "#1a0808", "#080404"],
    features: { veins: true, hotspots: true } },
  { id: "crystal", rarity: "common", name: "수정",
    desc: "표면이 거대한 단일 결정으로 이루어진 행성. 모든 빛이 한 번 더 갈라진다.",
    palette: ["#a8c8e8", "#4a6898", "#1c2848"],
    features: { facets: true, sparkle: true } },
  { id: "ocean_world", rarity: "common", name: "바다 세계",
    desc: "한 점의 육지도 없이 깊은 바다만 가득. 한 줄기 구름만 떠 있다.",
    palette: ["#3a8ac8", "#0e3a68", "#04162e"],
    features: { clouds: true, atmo: true, highlight: true } },
  { id: "desert_world", rarity: "common", name: "사막 세계",
    desc: "말라버린 바다와 끝없는 모래 능선이 평행한 줄을 이룬다.",
    palette: ["#d8a868", "#7a5028", "#2e1f10"],
    features: { dunes: true } },
  { id: "mist_world", rarity: "common", name: "안개 세계",
    desc: "두꺼운 안개가 표면을 영원히 감춘다. 빛만이 흘러나온다.",
    palette: ["#d4d0e0", "#6e6878", "#1f1c28"],
    features: { atmo: true, glow: true, clouds: true, mist: true } },
  { id: "volcanic", rarity: "common", name: "화산 행성",
    desc: "대륙 전체에 활화산. 황혼이 끝나지 않는다.",
    palette: ["#5a2418", "#1a0808", "#040202"],
    features: { hotspots: true, veins: true } },
  { id: "jungle", rarity: "common", name: "정글 행성",
    desc: "대륙 전체를 덮은 거대 식생. 광합성이 행성을 초록으로 물들였다.",
    palette: ["#6ab075", "#1f4a28", "#082010"],
    features: { continents: true, continentColor: "#2e6a32", clouds: true, atmo: true } },

  // ────── Rare (10) — 20% ──────
  { id: "storm", rarity: "rare", name: "폭풍 행성",
    desc: "단 하나의 거대 폭풍이 행성 전체를 휘감는다. 그 중심에 작은 정적이 있다.",
    palette: ["#7a9bc8", "#2e426a", "#0a1424"],
    features: { vortex: true } },
  { id: "pearl", rarity: "rare", name: "진주 행성",
    desc: "대기 분자가 항성광을 분해해 진주빛을 반사한다. 보는 각도마다 색이 변한다.",
    palette: ["#f0dccc", "#a89878", "#5a4a3a"],
    features: { iridescent: true, highlight: true, glow: true } },
  { id: "amethyst", rarity: "rare", name: "자수정",
    desc: "보랏빛 결정 격자가 표면 전체에 새겨졌다. 자른 듯한 모서리들.",
    palette: ["#b290f2", "#5a3a8a", "#22143a"],
    features: { facets: true, sparkle: true, glow: true } },
  { id: "emerald", rarity: "rare", name: "에메랄드",
    desc: "광합성 박테리아가 만들어낸 깊은 초록 행성. 보석처럼 빛난다.",
    palette: ["#5fae7e", "#1e4a30", "#0a201a"],
    features: { facets: true, glow: true, atmo: true } },
  { id: "mirror", rarity: "rare", name: "거울 행성",
    desc: "거울 같은 금속 표면이 항성의 모습을 한 번 더 비춘다.",
    palette: ["#e8eaf0", "#7c8088", "#2a2c34"],
    features: { highlight: true, glow: true } },
  { id: "botanical", rarity: "rare", name: "식물의 세계",
    desc: "지능 있는 식물이 행성 표면에 정원 같은 동심원 무늬를 만든다.",
    palette: ["#74c08a", "#2e6a3e", "#1a3a26"],
    features: { continents: true, continentColor: "#1f4a28", maze: true, atmo: true } },
  { id: "mystic", rarity: "rare", name: "신비의 행성",
    desc: "관측될 때마다 미세하게 다른 무늬가 나타난다. 패턴은 알려진 바 없다.",
    palette: ["#8db5d8", "#36527a", "#101830"],
    features: { clouds: true, glow: true, atmo: true } },
  { id: "twilight", rarity: "rare", name: "황혼 행성",
    desc: "조석 고정. 한쪽은 영원한 노을, 반대쪽은 영원한 밤.",
    palette: ["#e89568", "#7a4628", "#3a1c10"],
    features: { terminator: true, nightColor: "#0a1428" } },
  { id: "nocturnal", rarity: "rare", name: "야행성 행성",
    desc: "표면 자체가 빛을 흡수하는 검은 본체. 작은 도시 불빛만이 위치를 알린다.",
    palette: ["#2a2e3a", "#0e1018", "#040508"],
    features: { cityLights: true } },
  { id: "multi_ocean", rarity: "rare", name: "다중해",
    desc: "서로 섞이지 않는 여러 액체가 층층이 흐른다. 색의 줄.",
    palette: ["#5fc7c0", "#1c4f4d", "#0a262e"],
    features: { bands: true, multiOcean: true, atmo: true } },

  // ────── Epic (5) — 8% ──────
  { id: "diamond", rarity: "epic", name: "다이아몬드",
    desc: "극압에서 형성된 단일 다이아몬드 본체. 별빛이 무지개로 흩어진다.",
    palette: ["#f0f4ff", "#8ca8c4", "#3a4a64"],
    features: { facets: true, sparkle: true, highlight: true, glow: true } },
  { id: "rainbow", rarity: "epic", name: "무지개 행성",
    desc: "대기층마다 다른 가스가 분리된 무지개 띠를 만든다.",
    palette: ["#feca57", "#7a78d8", "#3a1a4a"],
    features: { rainbow: true, glow: true, atmo: true } },
  { id: "mask", rarity: "epic", name: "가면 행성",
    desc: "낮과 밤이 가면처럼 갈라진 양면 행성. 경계엔 빛이 멈춰 있다.",
    palette: ["#e0d8c8", "#1a1828", "#040408"],
    features: { terminator: true, nightColor: "#0a0a1a", innerStars: true } },
  { id: "golden", rarity: "epic", name: "황금 행성",
    desc: "표면 전체가 정제된 금. 항성광에 녹아드는 빛 덩어리.",
    palette: ["#ffd700", "#a88820", "#5a4810"],
    features: { highlight: true, glow: true, sparkle: true } },
  { id: "grid", rarity: "epic", name: "격자 행성",
    desc: "정확히 같은 간격의 빛 격자가 행성을 감싼다. 누군가의 흔적.",
    palette: ["#4a6890", "#1a2848", "#08101c"],
    features: { grid: true, glow: true } },

  // ────── Legendary (2) — 1.9% ──────
  { id: "eye_world", rarity: "legendary", name: "눈동자 세계",
    desc: "행성 자체가 거대한 눈동자. 어디서나 그것이 본다는 느낌이 든다.",
    palette: ["#e8c89e", "#7a5028", "#1a1018"],
    features: { bigEye: true, glow: true } },
  { id: "ancient_civilization", rarity: "legendary", name: "고대 문명",
    desc: "오래된 도시가 표면을 덮었다. 거대 첨탑이 우주로 뻗어 있다.",
    palette: ["#c4ad75", "#5a4825", "#1a1208"],
    features: { structures: true, cityLights: true, atmo: true, rings: true } },

  // ────── Mythic (1) — 0.1% ──────
  { id: "dyson_sphere", rarity: "mythic", name: "다이슨 구체",
    desc: "별 하나를 완전히 감싼 거대 구조물. 모든 항성광이 안으로 흐른다.",
    palette: ["#ffd89a", "#f08c6d", "#5a2018"],
    features: { dyson: true } },
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
