// Visual atmosphere layers — ported from design's `starfield.jsx:170-209`.
// These layers are seeded per-universe and animated in a continuous rAF loop:
// background parallax stars, drifting cosmic dust, occasional shooting stars,
// and a barely-visible mood wash that gives each day a distinct identity.

import { mulberry32 } from "./rng";
import { UNIVERSE_H, UNIVERSE_W } from "./types";

export interface BgStar {
  x: number;
  y: number;
  r: number;
  opacity: number;
  twPhase: number;
  twSpeed: number;
}

export interface Dust {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  opacity: number;
}

export interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
}

export type MoodName = "WARM" | "COOL" | "NEUTRAL" | "AURORA" | "EMBER";

export interface Mood {
  name: MoodName;
  tint: string;
  /** Accent color used by the mood badge stroke + text. */
  accent: string;
}

const MOODS: Mood[] = [
  { name: "WARM",    tint: "rgba(255, 180, 130, 0.06)",  accent: "#ffd6a8" },
  { name: "COOL",    tint: "rgba(140, 180, 255, 0.05)",  accent: "#a8c8ff" },
  { name: "NEUTRAL", tint: "rgba(255, 255, 255, 0.0)",   accent: "#ffffff" },
  { name: "AURORA",  tint: "rgba(130, 220, 180, 0.045)", accent: "#a8f0d4" },
  { name: "EMBER",   tint: "rgba(255, 150, 110, 0.05)",  accent: "#ffc0a0" },
];

export interface EffectLayers {
  bgStars: BgStar[];
  dust: Dust[];
  /** Live list mutated by the renderer each frame. */
  shootingStars: ShootingStar[];
  mood: Mood;
  /** Seconds since this universe was last seeded — used for shooting-star pacing. */
  lastShootingSpawn: number;
}

const BG_DENSITY = 0.0028;          // matches design — `W*H*0.0028`
const DUST_MIN = 30;
const DUST_RANGE = 30;

/**
 * Build (or rebuild) the effect layers for a given universe seed. Called once
 * per universe load and again when the seed changes (i.e. day rollover).
 */
export function buildEffects(seed: number): EffectLayers {
  // Universe seeds from Rust can be negative (i64). Coerce to a positive u32
  // before threading into mulberry32 so we get the same sequence regardless of
  // sign.
  const rng = mulberry32((seed ^ 0xCAFE_F00D) >>> 0);

  const bgStars: BgStar[] = [];
  const bgCount = Math.floor(UNIVERSE_W * UNIVERSE_H * BG_DENSITY);
  for (let i = 0; i < bgCount; i++) {
    bgStars.push({
      x: rng() * UNIVERSE_W,
      y: rng() * UNIVERSE_H,
      r: 0.3 + rng() * 0.45,
      opacity: 0.18 + rng() * 0.32,
      twPhase: rng() * Math.PI * 2,
      twSpeed: 0.15 + rng() * 0.35,
    });
  }

  const dust: Dust[] = [];
  const dustCount = DUST_MIN + Math.floor(rng() * DUST_RANGE);
  for (let i = 0; i < dustCount; i++) {
    dust.push({
      x: rng() * UNIVERSE_W,
      y: rng() * UNIVERSE_H,
      r: 0.4 + rng() * 0.7,
      vx: (rng() - 0.5) * 0.06,    // world units / frame ≈ px @ zoom 1
      vy: (rng() - 0.5) * 0.04,
      opacity: 0.15 + rng() * 0.2,
    });
  }

  const mood = MOODS[Math.floor(rng() * MOODS.length)];

  return { bgStars, dust, shootingStars: [], mood, lastShootingSpawn: 0 };
}

/**
 * Spawn a new shooting star at most every 8-20 seconds. Mutates `layers` in
 * place. Returns true if a new star was created (for observability/testing).
 */
export function maybeSpawnShootingStar(
  layers: EffectLayers,
  tSeconds: number,
): boolean {
  // Match the design: pseudo-random gap so two universes feel different.
  if (tSeconds - layers.lastShootingSpawn < 8 + Math.random() * 12) return false;
  layers.lastShootingSpawn = tSeconds;

  const sx = Math.random() * UNIVERSE_W;
  const sy = Math.random() * UNIVERSE_H * 0.6; // mostly upper half
  const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.6;
  const speed = 300 + Math.random() * 200;
  layers.shootingStars.push({
    x: sx,
    y: sy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0,
    maxLife: 0.8 + Math.random() * 0.4,
    length: 28 + Math.random() * 18,
  });
  return true;
}

/** Advance dust drift by one frame, wrapping at world edges. */
export function stepDust(dust: Dust[]): void {
  for (const d of dust) {
    d.x += d.vx;
    d.y += d.vy;
    if (d.x < -5) d.x = UNIVERSE_W + 5;
    if (d.x > UNIVERSE_W + 5) d.x = -5;
    if (d.y < -5) d.y = UNIVERSE_H + 5;
    if (d.y > UNIVERSE_H + 5) d.y = -5;
  }
}
