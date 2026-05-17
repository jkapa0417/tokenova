// Canvas2D renderer for the universe.
// Draw order (bottom → top):
//   background → mood tint → bg parallax stars → cosmic dust → nebulae →
//   shooting stars → constellation lines → stars (with halo, spike, hover) →
// Planets are NOT drawn on the canvas — they live as DOM `.planet-pin`
// overlays managed by today.ts so they can reuse the procedural SVG art.
//
// This renderer owns a continuous rAF loop so twinkle / dust drift / shooting
// stars stay alive without poke-the-clock calls. Scene mutation just sets the
// dirty flag — the next animation frame picks it up.

import { WORLD_TO_SCREEN_SCALE, worldToScreen, type View } from "./camera";
import {
  maybeSpawnShootingStar,
  stepDust,
  type EffectLayers,
} from "./effects";
import { drawStarBody, shapeForStar } from "./star-shapes";
import {
  DISPLAY_H,
  DISPLAY_W,
  type Constellation,
  type Nebula,
  type Star,
} from "./types";

export interface Scene {
  stars: Star[];
  nebulae: Nebula[];
  constellations: Constellation[];
  /** Star ids currently included in the in-progress constellation. */
  currentConstellation: { starIds: number[] } | null;
  hoveredStarId: number | null;
  /** Effect layers (parallax bg, dust, shooting stars, mood) for this universe. */
  effects: EffectLayers | null;
}

export class UniverseRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private starById = new Map<number, Star>();
  private scene: Scene | null = null;
  private view: View | null = null;
  private rafId = 0;
  private running = false;
  private startTimeMs = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = DISPLAY_W * this.dpr;
    canvas.height = DISPLAY_H * this.dpr;
    canvas.style.width = `${DISPLAY_W}px`;
    canvas.style.height = `${DISPLAY_H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Update scene + view and ensure the rAF loop is running. */
  request(view: View, scene: Scene): void {
    this.view = view;
    this.scene = scene;
    this.starById.clear();
    for (const s of scene.stars) this.starById.set(s.id, s);
    this.start();
  }

  /** Stop the rAF loop. Called when Today view deactivates. */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.startTimeMs = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      if (this.scene && this.view) {
        this.render(this.view, this.scene, (now - this.startTimeMs) / 1000);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private render(view: View, scene: Scene, t: number): void {
    const { ctx } = this;

    // 1. Background.
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);

    // 2. Mood tint — barely-visible color wash so each day feels distinct.
    if (scene.effects?.mood && scene.effects.mood.tint) {
      ctx.fillStyle = scene.effects.mood.tint;
      ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
    }

    // 3. Background parallax stars (slower drift than foreground).
    if (scene.effects) this.drawBgStars(view, scene.effects, t);

    // 4. Cosmic dust drift.
    if (scene.effects) this.drawDust(view, scene.effects);

    // 5. Nebulae.
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

    // 6. Shooting stars — spawn occasionally, fade out.
    if (scene.effects) this.drawShootingStars(scene.effects, t);

    // 7. Constellation lines (below the stars they connect).
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

    // 8. Stars.
    const sizeBoost = Math.max(0.5, Math.sqrt(view.zoom));
    const constellationStarIds = collectConstellationStarIds(
      scene.constellations,
      scene.currentConstellation,
    );

    for (const star of scene.stars) {
      const s = worldToScreen(view, star.position_x, star.position_y);
      if (s.x < -20 || s.x > DISPLAY_W + 20 || s.y < -20 || s.y > DISPLAY_H + 20) continue;
      const r = star.radius * sizeBoost;
      const cr = star.color_r;
      const cg = star.color_g;
      const cb = star.color_b;
      // Per-star twinkle: stable phase from id, mild amplitude so the field
      // breathes rather than strobes.
      const phase = (star.id * 0.7) % (Math.PI * 2);
      const speed = 0.25 + ((star.id * 13) % 100) / 125;
      const twinkle = Math.sin(t * speed + phase) * 0.2 + 0.8;
      const op = Math.min(1, star.opacity * twinkle);

      if (star.is_big) {
        const isLargest = star.radius > 3.5;
        const haloR = r * (isLargest ? 4.5 : 3.2);
        const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${op * 0.55})`);
        glow.addColorStop(0.35, `rgba(${cr},${cg},${cb},${op * 0.18})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
        ctx.fill();

        // Diffraction spikes — only the very largest stars get a 4-point cross.
        if (star.radius > 3.6) {
          const spikeLen = r * 5.5 * (0.85 + twinkle * 0.3);
          const spikeAlpha = op * 0.7;
          ctx.lineCap = "round";
          ctx.lineWidth = 0.7;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const grad = ctx.createLinearGradient(
              s.x - dx * spikeLen, s.y - dy * spikeLen,
              s.x + dx * spikeLen, s.y + dy * spikeLen,
            );
            grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
            grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${spikeAlpha})`);
            grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(s.x - dx * spikeLen, s.y - dy * spikeLen);
            ctx.lineTo(s.x + dx * spikeLen, s.y + dy * spikeLen);
            ctx.stroke();
          }
        }

        // Bright core highlight for the largest stars.
        if (isLargest) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, op * 1.1)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
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

      // Body — use the star-shapes catalog so giants/rare stars get the
      // 5-point / starburst / pulsar / galaxy etc. silhouette they earned.
      // Tiny stars (r<2) always resolve to a plain circle so the field
      // doesn't visually noise out.
      drawStarBody(
        ctx,
        s.x, s.y, r,
        shapeForStar(star.id, star.radius),
        `rgba(${cr},${cg},${cb},${op})`,
      );

      // Constellation-member outline.
      if (constellationStarIds.has(star.id)) {
        ctx.strokeStyle = "rgba(200, 220, 255, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ─── Effect layer renderers ───

  private drawBgStars(view: View, effects: EffectLayers, t: number): void {
    const { ctx } = this;
    // Parallax: bg stars drift at 15% of the camera pan — sense of depth.
    // We render bg stars directly in display-space (no zoom) and wrap so they
    // fill the canvas regardless of camera position.
    const px = -view.x * WORLD_TO_SCREEN_SCALE * 0.15;
    const py = -view.y * WORLD_TO_SCREEN_SCALE * 0.15;
    for (const b of effects.bgStars) {
      const baseX = b.x * WORLD_TO_SCREEN_SCALE + px;
      const baseY = b.y * WORLD_TO_SCREEN_SCALE + py;
      const bx = ((baseX % DISPLAY_W) + DISPLAY_W) % DISPLAY_W;
      const by = ((baseY % DISPLAY_H) + DISPLAY_H) % DISPLAY_H;
      const tw = Math.sin(t * b.twSpeed + b.twPhase) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255,255,255,${b.opacity * tw})`;
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawDust(view: View, effects: EffectLayers): void {
    stepDust(effects.dust);
    const { ctx } = this;
    // Dust drifts in world space, parallax 0.3 of camera. Convert to display.
    for (const d of effects.dust) {
      const dx = (d.x - view.x * 0.3) * WORLD_TO_SCREEN_SCALE;
      const dy = (d.y - view.y * 0.3) * WORLD_TO_SCREEN_SCALE;
      if (dx < -10 || dx > DISPLAY_W + 10 || dy < -10 || dy > DISPLAY_H + 10) continue;
      ctx.fillStyle = `rgba(200,210,230,${d.opacity})`;
      ctx.beginPath();
      ctx.arc(dx, dy, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawShootingStars(effects: EffectLayers, t: number): void {
    maybeSpawnShootingStar(effects, t);
    const { ctx } = this;
    const dtClamp = 0.033;        // ≈ 30fps lower bound to avoid jumps on stalls
    // Render + advance — operate in world space then convert.
    for (let i = effects.shootingStars.length - 1; i >= 0; i--) {
      const s = effects.shootingStars[i];
      s.x += s.vx * dtClamp;
      s.y += s.vy * dtClamp;
      s.life += dtClamp;
      if (s.life > s.maxLife) {
        effects.shootingStars.splice(i, 1);
        continue;
      }
      const fade = 1 - s.life / s.maxLife;
      const norm = Math.hypot(s.vx, s.vy);
      const dxn = s.vx / norm;
      const dyn = s.vy / norm;
      // Shooting stars ignore zoom/pan — they fly across the canvas in
      // display-space so they don't feel locked to the world coordinate
      // system. Convert world → display once.
      const sx = s.x * WORLD_TO_SCREEN_SCALE;
      const sy = s.y * WORLD_TO_SCREEN_SCALE;
      const lenDisp = s.length * WORLD_TO_SCREEN_SCALE;
      const tailX = sx - dxn * lenDisp;
      const tailY = sy - dyn * lenDisp;
      const tailGrad = ctx.createLinearGradient(sx, sy, tailX, tailY);
      tailGrad.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
      tailGrad.addColorStop(0.4, `rgba(220,230,255,${0.5 * fade})`);
      tailGrad.addColorStop(1, "rgba(180,200,255,0)");
      ctx.strokeStyle = tailGrad;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      // Bright head.
      ctx.fillStyle = `rgba(255,255,255,${fade})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    void t;                                    // silence unused — kept for future ease
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
