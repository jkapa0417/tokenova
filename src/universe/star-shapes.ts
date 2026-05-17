// Tokenova — star shape rendering. Ported from the design's `star-shapes.jsx`.
//
// 12 procedurally drawn shapes ranging from a simple circle to a mini spiral
// galaxy. `pickStarShape(rng, radius)` chooses one per-star from a tiered
// distribution; `drawStarBody(ctx, x, y, r, shape, fill)` rasterizes it onto a
// canvas. The fill is passed in as a single rgba string so the caller keeps
// control of color + twinkle alpha — we don't carry per-shape palettes.
//
// IMPORTANT: per user instruction we ignore the design's 3-color star scheme
// (`STAR_COLOR_VARIANTS`). Stars keep their existing `Star.color_r/g/b/opacity`
// flow from the engine; this module only varies SHAPE, not color.

export type StarShape =
  | "circle"
  | "spike4"
  | "star5"
  | "hexagram"
  | "star7"
  | "spike8"
  | "starburst"
  | "binary"
  | "ringedStar"
  | "pulsar"
  | "comet"
  | "galaxy"
  // Legacy — kept so old generators that emit these strings still draw.
  | "diamond"
  | "triangle";

export type StarRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

/**
 * Tier classification for the Star Codex. A given shape belongs to a single
 * rarity — used to group cards in the codex grid.
 */
export const STAR_SHAPE_RARITY: Record<StarShape, StarRarity> = {
  // common (small / standard)
  circle: "common",
  spike4: "common",
  star5: "common",
  hexagram: "common",
  // rare
  star7: "rare",
  spike8: "rare",
  // epic
  starburst: "epic",
  binary: "epic",
  // legendary
  ringedStar: "legendary",
  pulsar: "legendary",
  // mythic
  galaxy: "mythic",
  // legacy (kept renderable, not surfaced in the codex tiers)
  comet: "rare",
  diamond: "common",
  triangle: "common",
};

// Display strings now live in the i18n dictionary under `star_shape.<key>`.
// These Proxies preserve the original `STAR_SHAPE_NAME[shape]` access pattern
// in the views while making lookups locale-aware at access time.
import { t } from "../i18n";

export const STAR_SHAPE_NAME: Record<StarShape, string> = new Proxy(
  {} as Record<StarShape, string>,
  {
    get(_target, prop: string) {
      const key = `star_shape.${prop}.name`;
      const v = t(key);
      return v === key ? prop : v;
    },
  },
);

export const STAR_SHAPE_DESC: Record<StarShape, string> = new Proxy(
  {} as Record<StarShape, string>,
  {
    get(_target, prop: string) {
      const key = `star_shape.${prop}.desc`;
      const v = t(key);
      return v === key ? "" : v;
    },
  },
);

const TIER_ORDER: StarRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

/** All shapes grouped by rarity in the order used by the codex grid. */
export const STAR_SHAPES_BY_TIER: Record<StarRarity, StarShape[]> = {
  common: ["circle", "spike4", "star5", "hexagram"],
  rare: ["star7", "spike8", "comet"],
  epic: ["starburst", "binary"],
  legendary: ["ringedStar", "pulsar"],
  mythic: ["galaxy"],
};

export function listStarTiers(): StarRarity[] {
  return TIER_ORDER;
}

/**
 * Choose a shape for a star at generation time. Matches the design's
 * distribution (`star-shapes.jsx:6-35`). Caller should pass a deterministic
 * rng seeded from the star's id so the same star always renders the same.
 */
export function pickStarShape(rng: () => number, radius: number): StarShape {
  if (radius < 2) return "circle";
  if (radius < 3.2) {
    const r = rng();
    if (r < 0.12) return "spike4";
    if (r < 0.18) return "star5";
    return "circle";
  }
  const r = rng();
  // mythic — exceedingly rare; only on giants
  if (r < 0.0006 && radius >= 4.7) return "galaxy";
  // legendary — ~2.5%
  if (r < 0.026 && radius >= 4.3) {
    return rng() < 0.5 ? "ringedStar" : "pulsar";
  }
  // epic — ~7%
  if (r < 0.095 && radius >= 4.0) {
    return rng() < 0.5 ? "starburst" : "binary";
  }
  // rare — ~18%
  if (r < 0.275) {
    return rng() < 0.5 ? "star7" : "spike8";
  }
  // common multi-point distribution
  if (r < 0.45) return "spike4";
  if (r < 0.60) return "star5";
  if (r < 0.70) return "hexagram";
  return "circle";
}

// ─────────── drawing ───────────

function nPointStar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  points: number,
  rOuter: number, rInner: number,
  rotOffset = -Math.PI / 2,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + rotOffset;
    const rr = (i % 2 === 0) ? rOuter : rInner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Rasterize a star body. `fill` should be a single rgba string — the caller
 * is responsible for color + twinkle alpha; we don't synthesize them here.
 */
export function drawStarBody(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  shape: StarShape,
  fill: string,
): void {
  ctx.fillStyle = fill;
  switch (shape) {
    case "circle": {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "spike4": {
      nPointStar(ctx, x, y, 4, r * 1.15, r * 0.25);
      ctx.fill();
      return;
    }
    case "star5": {
      nPointStar(ctx, x, y, 5, r, r * 0.42);
      ctx.fill();
      return;
    }
    case "hexagram": {
      nPointStar(ctx, x, y, 6, r, r * 0.5);
      ctx.fill();
      return;
    }
    case "star7": {
      nPointStar(ctx, x, y, 7, r, r * 0.5);
      ctx.fill();
      return;
    }
    case "spike8": {
      nPointStar(ctx, x, y, 8, r * 1.08, r * 0.32);
      ctx.fill();
      return;
    }
    case "starburst": {
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(0.5, r * 0.16);
      ctx.lineCap = "round";
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const len = (i % 2 === 0) ? r * 1.4 : r * 0.85;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "binary": {
      const dx = Math.cos(-0.35) * r * 0.55;
      const dy = Math.sin(-0.35) * r * 0.55;
      nPointStar(ctx, x - dx, y - dy, 5, r * 0.62, r * 0.28);
      ctx.fill();
      nPointStar(ctx, x + dx, y + dy, 5, r * 0.72, r * 0.32);
      ctx.fill();
      return;
    }
    case "ringedStar": {
      nPointStar(ctx, x, y, 5, r * 0.85, r * 0.35);
      ctx.fill();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(0.4, r * 0.06);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.25, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case "pulsar": {
      const transparent = fill.replace(/[\d.]+\)$/, "0)");
      const beamLen = r * 1.7;
      const beamHalfW = r * 0.32;
      const g1 = ctx.createLinearGradient(x, y, x, y - beamLen);
      g1.addColorStop(0, fill);
      g1.addColorStop(1, transparent);
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.moveTo(x - beamHalfW, y);
      ctx.lineTo(x, y - beamLen);
      ctx.lineTo(x + beamHalfW, y);
      ctx.closePath();
      ctx.fill();

      const g2 = ctx.createLinearGradient(x, y, x, y + beamLen);
      g2.addColorStop(0, fill);
      g2.addColorStop(1, transparent);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(x - beamHalfW, y);
      ctx.lineTo(x, y + beamLen);
      ctx.lineTo(x + beamHalfW, y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(0.5, r * 0.1);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.15, r * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "comet": {
      const tailLen = r * 3.2;
      const ang = Math.PI * 1.18;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const tipX = x + dx * tailLen;
      const tipY = y + dy * tailLen;
      const perp = ang + Math.PI / 2;
      const px = Math.cos(perp), py = Math.sin(perp);
      const headW = r * 0.95;
      const midW  = r * 0.42;
      const transparent = fill.replace(/[\d.]+\)$/, "0)");
      const grad = ctx.createLinearGradient(x, y, tipX, tipY);
      grad.addColorStop(0,    fill);
      grad.addColorStop(0.35, fill);
      grad.addColorStop(1,    transparent);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x + px * headW, y + py * headW);
      ctx.arc(x, y, headW, perp, perp + Math.PI, false);
      ctx.quadraticCurveTo(
        x + dx * tailLen * 0.45 - px * midW,
        y + dy * tailLen * 0.45 - py * midW,
        tipX, tipY,
      );
      ctx.quadraticCurveTo(
        x + dx * tailLen * 0.45 + px * midW,
        y + dy * tailLen * 0.45 + py * midW,
        x + px * headW, y + py * headW,
      );
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "galaxy": {
      // Mini spiral galaxy — central bright bulge + two curving arms.
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(0.5, r * 0.16);
      ctx.lineCap = "round";
      for (const armOffset of [0, Math.PI]) {
        ctx.beginPath();
        const turns = 1.4;
        const steps = 18;
        for (let i = 0; i <= steps; i++) {
          const tt = i / steps;
          const a = armOffset + tt * turns * Math.PI * 2;
          const rr = r * 0.3 + tt * r * 0.85;
          const sx = x + Math.cos(a) * rr;
          const sy = y + Math.sin(a) * rr * 0.55;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      return;
    }
    case "diamond": {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.866, y + r * 0.5);
      ctx.lineTo(x - r * 0.866, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      return;
    }
    default: {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Deterministic shape lookup for a star — keyed by star id. */
export function shapeForStar(id: number, radius: number): StarShape {
  // Seed an rng from the id so the same star always picks the same shape.
  let s = (id ^ 0x9e3771b9) >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return pickStarShape(rng, radius);
}
