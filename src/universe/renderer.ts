// Canvas2D renderer for the universe.
// Draw order (bottom → top): background → nebulae → constellation lines →
// stars → hover indicator → planets.

import { WORLD_TO_SCREEN_SCALE, worldToScreen, type View } from "./camera";
import { mulberry32 } from "./rng";
import {
  DISPLAY_H,
  DISPLAY_W,
  type Constellation,
  type Nebula,
  type Planet,
  type Star,
} from "./types";

export interface Scene {
  stars: Star[];
  planets: Planet[];
  nebulae: Nebula[];
  constellations: Constellation[];
  /** Star ids currently included in the in-progress constellation. */
  currentConstellation: { starIds: number[] } | null;
  hoveredStarId: number | null;
}

export class UniverseRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private needsRender = false;
  private starById = new Map<number, Star>();
  private cachedScene: Scene | null = null;
  private cachedView: View | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = DISPLAY_W * this.dpr;
    canvas.height = DISPLAY_H * this.dpr;
    canvas.style.width = `${DISPLAY_W}px`;
    canvas.style.height = `${DISPLAY_H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.ctx.scale(this.dpr, this.dpr);
  }

  /** Schedule a re-render on the next animation frame; idempotent within a frame. */
  request(view: View, scene: Scene): void {
    this.cachedView = view;
    this.cachedScene = scene;
    this.starById.clear();
    for (const s of scene.stars) this.starById.set(s.id, s);
    if (this.needsRender) return;
    this.needsRender = true;
    requestAnimationFrame(() => {
      this.needsRender = false;
      if (this.cachedScene && this.cachedView) {
        this.render(this.cachedView, this.cachedScene);
      }
    });
  }

  private render(view: View, scene: Scene): void {
    const { ctx } = this;

    // 1. Background.
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);

    // 2. Nebulae.
    for (const n of scene.nebulae) {
      const s = worldToScreen(view, n.position_x, n.position_y);
      const r = n.radius * WORLD_TO_SCREEN_SCALE * view.zoom;
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, `${n.color} ${n.opacity})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Constellation lines (below the stars they connect).
    for (const c of scene.constellations) {
      this.drawConstellationLines(view, c.star_ids, mainColorFor(c.color), glowColorFor(c.color));
    }
    if (scene.currentConstellation && scene.currentConstellation.starIds.length > 0) {
      this.drawConstellationLines(
        view,
        scene.currentConstellation.starIds,
        "rgba(180, 220, 255, 0.95)",
        "rgba(120, 180, 255, 0.4)",
      );
    }

    // 4. Stars.
    const sizeBoost = Math.max(0.5, Math.sqrt(view.zoom));
    const constellationStarIds = collectConstellationStarIds(
      scene.constellations,
      scene.currentConstellation,
    );

    for (const star of scene.stars) {
      const s = worldToScreen(view, star.position_x, star.position_y);
      if (s.x < -20 || s.x > DISPLAY_W + 20 || s.y < -20 || s.y > DISPLAY_H + 20) continue;
      const r = star.radius * sizeBoost;
      const { color_r: cr, color_g: cg, color_b: cb, opacity: op } = star;

      // Big-star halo.
      if (star.is_big) {
        const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3);
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${op * 0.4})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hover ring.
      if (scene.hoveredStarId === star.id) {
        const ring = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, r * 4);
        ring.addColorStop(0, "rgba(255, 220, 100, 0.6)");
        ring.addColorStop(1, "rgba(255, 220, 100, 0)");
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Body.
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${op})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Constellation-member outline.
      if (constellationStarIds.has(star.id)) {
        ctx.strokeStyle = "rgba(200, 220, 255, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 5. Planets (topmost layer).
    for (const p of scene.planets) {
      const s = worldToScreen(view, p.position_x, p.position_y);
      // Procedural radius derived from seed — keep stable per planet.
      const r = procRadius(p.seed) * WORLD_TO_SCREEN_SCALE * view.zoom;
      if (s.x < -r * 2 || s.x > DISPLAY_W + r * 2 || s.y < -r * 2 || s.y > DISPLAY_H + r * 2)
        continue;
      drawPlanet(ctx, s.x, s.y, r, p);
    }
  }

  private drawConstellationLines(
    view: View,
    starIds: number[],
    mainColor: string,
    glowColor: string,
  ): void {
    if (starIds.length < 2) return;
    const { ctx } = this;

    const stroke = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < starIds.length; i++) {
        const star = this.starById.get(starIds[i]);
        if (!star) continue;
        const p = worldToScreen(view, star.position_x, star.position_y);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    };

    stroke(glowColor, 6);
    stroke(mainColor, 2);
  }
}

function collectConstellationStarIds(
  constellations: Constellation[],
  current: { starIds: number[] } | null,
): Set<number> {
  const set = new Set<number>();
  for (const c of constellations) for (const id of c.star_ids) set.add(id);
  if (current) for (const id of current.starIds) set.add(id);
  return set;
}

function mainColorFor(stored: string): string {
  // Stored colour is already RGBA — render as-is for main stroke.
  return stored;
}

function glowColorFor(stored: string): string {
  // Lower-alpha glow derived from the same hue. Replace the trailing alpha.
  return stored.replace(/,\s*([0-9.]+)\)\s*$/, ", 0.35)");
}

// Lightweight deterministic noise so the same seed produces the same radius
// without pulling rand into the frontend.
function procRadius(seed: number): number {
  const v = mulberry32(seed)();
  return 12 + v * 18;
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  planet: Planet,
): void {
  const palette = PLANET_PALETTES[planet.planet_type] ?? PLANET_PALETTES.default;
  const rng = mulberry32(planet.seed + 1);
  const base = palette[Math.floor(rng() * palette.length)];

  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Surface shadow.
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.beginPath();
  ctx.arc(cx + r * 0.3, cy + r * 0.2, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Rarity ring (subtle, ≥ rare only).
  const rarityRing = RARITY_RING[planet.rarity];
  if (rarityRing) {
    ctx.strokeStyle = rarityRing;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const RARITY_RING: Record<Rarity, string | null> = {
  common: null,
  rare: "rgba(140, 200, 255, 0.7)",
  epic: "rgba(220, 160, 255, 0.7)",
  legendary: "rgba(255, 200, 130, 0.85)",
  mythic: "rgba(255, 170, 200, 0.95)",
};

type Rarity = Planet["rarity"];

const PLANET_PALETTES: Record<string, string[]> = {
  // Common
  earth_like: ["#5a8fbf", "#6a9d70", "#2d6a4f"],
  gas_giant: ["#d4a574", "#c98765", "#a06243"],
  mars_like: ["#cd5c3a", "#993c1d", "#7a2e16"],
  ice_giant: ["#a8d0e6", "#7fb3d5", "#5499c7"],
  dead_world: ["#5a5a6e", "#3b3b4a", "#2a2a35"],
  lava_world: ["#ff5733", "#c70039", "#8b0000"],
  crystal: ["#9d4edd", "#c77dff", "#7b2cbf"],
  ocean_world: ["#185fa5", "#1e88e5", "#0d47a1"],
  desert_world: ["#d4a04b", "#b8862e", "#8b5a00"],
  mist_world: ["#9fa8b8", "#7a8595", "#5d6975"],
  volcanic: ["#993c1d", "#d85a30", "#6b1f0f"],
  jungle: ["#3b6d11", "#5a8a1f", "#234d0a"],
  // Rare
  storm: ["#534ab7", "#3d348b", "#7159c9"],
  pearl: ["#f4ecf7", "#e8e0ed", "#cfc4d4"],
  amethyst: ["#9b59b6", "#7d3c98", "#a569bd"],
  emerald: ["#0f6e56", "#1b8a64", "#27ae60"],
  mirror: ["#bdc3c7", "#85929e", "#5d6d7e"],
  botanical: ["#27ae60", "#1e8449", "#196f3d"],
  mystic: ["#854f0b", "#a0651a", "#6e3d05"],
  twilight: ["#7e57c2", "#5e35b1", "#9575cd"],
  nocturnal: ["#1a237e", "#283593", "#3949ab"],
  multi_ocean: ["#0277bd", "#0288d1", "#039be5"],
  // Epic
  diamond: ["#e8f4ff", "#b3e5fc", "#81d4fa"],
  rainbow: ["#ff6b6b", "#feca57", "#48dbfb"],
  mask: ["#212121", "#424242", "#616161"],
  golden: ["#ffd700", "#daa520", "#b8860b"],
  grid: ["#2c3e50", "#34495e", "#4a6378"],
  // Legendary
  eye_world: ["#1c1c2e", "#2a2a44", "#3b3b5a"],
  ancient_civilization: ["#7d6608", "#9c7a14", "#b9990f"],
  // Mythic
  dyson_sphere: ["#ffd700", "#ff9a4d", "#ff4d4d"],
  default: ["#666666"],
};
