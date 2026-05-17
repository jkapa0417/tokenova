// Procedural planet SVG renderer — ported from the design's `planet.jsx`.
// Returns an SVG string for embedding via innerHTML in Codex cards, modals,
// the discovery overlay, and (soon) pinned onto the universe canvas.
//
// Each PlanetSpec has a `features` map of flags; each enabled flag stacks
// SVG elements onto the planet disk in a fixed order so the same id always
// renders the same way.

import type { PlanetSpec } from "./catalog";
import { mulberry32 } from "./rng";

// ───────────────────────── color helpers ─────────────────────────

function parseHex(h: string): [number, number, number] {
  const x = h.replace("#", "");
  return [
    parseInt(x.slice(0, 2), 16),
    parseInt(x.slice(2, 4), 16),
    parseInt(x.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const bl = Math.round(ab * (1 - t) + bb * t);
  return `rgb(${r},${g},${bl})`;
}

function seedFromId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Numeric formatter — avoids `4.5e-9` etc. in SVG strings.
function n(v: number): string {
  return v.toFixed(2);
}

// ───────────────────────── feature ctx ─────────────────────────

interface FeatCtx {
  cx: number;
  cy: number;
  r: number;
  c1: string;
  c2: string;
  c3: string;
  rng: () => number;
  uid: string;
  continentColor?: string;
  nightColor?: string;
  multiOcean?: boolean;
}

type Renderer = (ctx: FeatCtx) => string[];

// ─────────── irregular blob path (for continents) ───────────

function blobPath(
  cx: number, cy: number, baseR: number,
  points: number, rng: () => number, irregularity = 0.35,
): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rad = baseR * (1 - irregularity + rng() * irregularity * 2);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  let d = `M ${n(pts[0][0])} ${n(pts[0][1])} `;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % pts.length];
    const mid: [number, number] = [(cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2];
    d += `Q ${n(cur[0])} ${n(cur[1])} ${n(mid[0])} ${n(mid[1])} `;
  }
  return d + "Z";
}

// ───────────────────── feature renderers ─────────────────────

const RENDERERS: Record<string, Renderer> = {
  bands(ctx) {
    const { cx, cy, r, c1, c2, c3, rng, multiOcean } = ctx;
    const out: string[] = [];
    const count = 6 + Math.floor(rng() * 2);
    const palette = multiOcean
      ? [c1, c3, mixHex(c1, "#ffffff", 0.3), c2]
      : null;
    for (let i = 0; i < count; i++) {
      const yOff = (i / count - 0.5) * r * 1.95;
      const w = palette ? 2.2 + rng() * 0.6 : 1.4 + rng() * 1.4;
      const fill = palette
        ? palette[i % palette.length]
        : i % 2 === 0
          ? mixHex(c2, "#000000", 0.5)
          : mixHex(c1, "#ffffff", 0.22);
      const rx = r * Math.sqrt(Math.max(0, 1 - Math.pow(yOff / r, 2))) * 0.99;
      const opacity = palette ? 0.85 : i % 2 === 0 ? 0.55 : 0.45;
      out.push(
        `<ellipse cx="${n(cx)}" cy="${n(cy + yOff)}" rx="${n(rx)}" ry="${n(w)}" fill="${fill}" opacity="${opacity}" />`,
      );
    }
    return out;
  },

  spot(ctx) {
    const { cx, cy, r, c1 } = ctx;
    const sx = cx + r * 0.32;
    const sy = cy + r * 0.18;
    return [
      `<ellipse cx="${n(sx)}" cy="${n(sy)}" rx="${n(r * 0.22)}" ry="${n(r * 0.14)}" fill="${mixHex(c1, "#aa3322", 0.7)}" opacity="0.9" />`,
      `<ellipse cx="${n(sx)}" cy="${n(sy)}" rx="${n(r * 0.13)}" ry="${n(r * 0.08)}" fill="${mixHex(c1, "#cc4422", 0.85)}" opacity="0.9" />`,
    ];
  },

  continents(ctx) {
    const { cx, cy, r, rng, continentColor: cc } = ctx;
    const continentColor = cc ?? "#3e7548";
    const out: string[] = [];
    const count = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.6;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      const blob = blobPath(bx, by, 5 + rng() * (r * 0.4), 7, rng, 0.5);
      out.push(
        `<path d="${blob}" fill="${mixHex(continentColor, "#000", 0.55)}" opacity="0.5" transform="translate(1 1)" />`,
        `<path d="${blob}" fill="${continentColor}" opacity="0.95" />`,
      );
    }
    return out;
  },

  clouds(ctx) {
    const { cx, cy, r, rng } = ctx;
    const out: string[] = [];
    const count = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.7;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      out.push(
        `<ellipse cx="${n(bx)}" cy="${n(by)}" rx="${n(r * (0.16 + rng() * 0.18))}" ry="${n(r * (0.05 + rng() * 0.06))}" fill="#ffffff" opacity="${(0.32 + rng() * 0.2).toFixed(2)}" />`,
      );
    }
    return out;
  },

  polar(ctx) {
    const { cx, cy, r } = ctx;
    return [
      `<ellipse cx="${n(cx)}" cy="${n(cy - r * 0.82)}" rx="${n(r * 0.5)}" ry="${n(r * 0.2)}" fill="#f4ede2" opacity="0.6" />`,
      `<ellipse cx="${n(cx)}" cy="${n(cy + r * 0.84)}" rx="${n(r * 0.4)}" ry="${n(r * 0.16)}" fill="#f4ede2" opacity="0.5" />`,
    ];
  },

  canyons(ctx) {
    const { cx, cy, r, c2 } = ctx;
    const path = `M ${n(cx - r * 0.6)} ${n(cy + r * 0.05)} Q ${n(cx)} ${n(cy - r * 0.1)} ${n(cx + r * 0.55)} ${n(cy + r * 0.18)}`;
    return [
      `<path d="${path}" stroke="${mixHex(c2, "#000", 0.5)}" stroke-width="${Math.max(0.7, r * 0.05).toFixed(2)}" fill="none" opacity="0.7" />`,
    ];
  },

  craters(ctx) {
    const { cx, cy, r, c2, rng } = ctx;
    const out: string[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.82;
      const cR = 1.3 + rng() * 3;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      out.push(
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(cR + 0.5)}" fill="${mixHex(c2, "#ffffff", 0.4)}" opacity="0.45" />`,
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(cR)}" fill="${mixHex(c2, "#000", 0.6)}" opacity="0.7" />`,
        `<circle cx="${n(x - cR * 0.32)}" cy="${n(y - cR * 0.32)}" r="${n(cR * 0.45)}" fill="#ffffff" opacity="0.22" />`,
      );
    }
    return out;
  },

  veins(ctx) {
    const { cx, cy, r, rng, uid } = ctx;
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a1 = rng() * Math.PI * 2;
      const a2 = a1 + (rng() - 0.5) * 0.9;
      const x1 = cx + Math.cos(a1) * r * 0.92;
      const y1 = cy + Math.sin(a1) * r * 0.92;
      const x2 = cx + Math.cos(a2) * r * 0.22;
      const y2 = cy + Math.sin(a2) * r * 0.22;
      const mx = cx + (rng() - 0.5) * r * 0.5;
      const my = cy + (rng() - 0.5) * r * 0.5;
      const d = `M ${n(x1)} ${n(y1)} Q ${n(mx)} ${n(my)} ${n(x2)} ${n(y2)}`;
      out.push(
        `<path d="${d}" stroke="#ff8a3a" stroke-width="2.4" fill="none" opacity="0.5" filter="url(#glow-veins-${uid})" />`,
        `<path d="${d}" stroke="#ffd460" stroke-width="0.9" fill="none" opacity="0.98" />`,
      );
    }
    return out;
  },

  hotspots(ctx) {
    const { cx, cy, r, rng } = ctx;
    const out: string[] = [];
    const count = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.7;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const sz = 1.8 + rng() * 1.8;
      out.push(
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(sz * 3.2)}" fill="#ff6a2a" opacity="0.28" />`,
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(sz * 1.5)}" fill="#ff9040" opacity="0.85" />`,
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(sz * 0.7)}" fill="#ffec90" opacity="1" />`,
      );
    }
    return out;
  },

  vortex(ctx) {
    const { cx, cy, r, c1, c2 } = ctx;
    const out: string[] = [];
    out.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.85)}" fill="${mixHex(c2, "#000", 0.4)}" opacity="0.55" />`,
    );
    const lines = 40;
    const turns = 2.0;
    for (let i = 0; i < lines; i++) {
      const t1 = i / lines;
      const t2 = (i + 1) / lines;
      const r1 = t1 * r * 0.82;
      const r2 = t2 * r * 0.82;
      const a1 = t1 * turns * Math.PI * 2;
      const a2 = t2 * turns * Math.PI * 2;
      const sw = 1 + (1 - t1) * 0.6;
      out.push(
        `<line x1="${n(cx + Math.cos(a1) * r1)}" y1="${n(cy + Math.sin(a1) * r1)}" x2="${n(cx + Math.cos(a2) * r2)}" y2="${n(cy + Math.sin(a2) * r2)}" stroke="${mixHex(c1, "#ffffff", 0.55)}" stroke-width="${sw.toFixed(2)}" opacity="${(0.5 + t1 * 0.3).toFixed(2)}" />`,
      );
    }
    out.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.1)}" fill="#ffffff" opacity="0.95" />`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.18)}" stroke="#ffffff" stroke-width="0.4" fill="none" opacity="0.5" />`,
    );
    return out;
  },

  dunes(ctx) {
    const { cx, cy, r, c1, c2 } = ctx;
    const out: string[] = [];
    const shadow = mixHex(c2, "#000", 0.4);
    const highlight = mixHex(c1, "#ffffff", 0.3);
    for (let i = -3; i <= 3; i++) {
      const yOff = i * r * 0.22;
      out.push(
        `<path d="M ${n(cx - r * 0.92)} ${n(cy + yOff)} Q ${n(cx - r * 0.45)} ${n(cy + yOff - r * 0.1)} ${n(cx)} ${n(cy + yOff)} T ${n(cx + r * 0.92)} ${n(cy + yOff)}" stroke="${shadow}" stroke-width="1.4" fill="none" opacity="0.75" />`,
        `<path d="M ${n(cx - r * 0.92)} ${n(cy + yOff - 1.6)} Q ${n(cx - r * 0.45)} ${n(cy + yOff - r * 0.1 - 1.6)} ${n(cx)} ${n(cy + yOff - 1.6)} T ${n(cx + r * 0.92)} ${n(cy + yOff - 1.6)}" stroke="${highlight}" stroke-width="0.6" fill="none" opacity="0.55" />`,
      );
    }
    return out;
  },

  cityLights(ctx) {
    const { cx, cy, r, rng } = ctx;
    const out: string[] = [];
    const clusters = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < clusters; k++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.75;
      const ccx = cx + Math.cos(a) * d;
      const ccy = cy + Math.sin(a) * d;
      out.push(
        `<circle cx="${n(ccx)}" cy="${n(ccy)}" r="${n(r * 0.18)}" fill="#ffd47a" opacity="0.18" />`,
      );
      const count = 6 + Math.floor(rng() * 5);
      for (let i = 0; i < count; i++) {
        const offA = rng() * Math.PI * 2;
        const offD = rng() * r * 0.14;
        out.push(
          `<circle cx="${n(ccx + Math.cos(offA) * offD)}" cy="${n(ccy + Math.sin(offA) * offD)}" r="${(0.7 + rng() * 0.7).toFixed(2)}" fill="#ffe49a" opacity="0.92" />`,
        );
      }
    }
    return out;
  },

  iridescent(ctx) {
    const { cx, cy, r, uid } = ctx;
    const gid = `irid-${uid}`;
    const gid2 = `irid2-${uid}`;
    return [
      `<defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffc6dc" stop-opacity="0.75" />
          <stop offset="30%" stop-color="#c0d4ff" stop-opacity="0.7" />
          <stop offset="55%" stop-color="#b8f0d6" stop-opacity="0.65" />
          <stop offset="80%" stop-color="#ffeaa8" stop-opacity="0.7" />
          <stop offset="100%" stop-color="#ffbcc6" stop-opacity="0.75" />
        </linearGradient>
        <radialGradient id="${gid2}" cx="35%" cy="30%" r="55%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5" />
          <stop offset="60%" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
      </defs>`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#${gid})" />`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#${gid2})" />`,
    ];
  },

  facets(ctx) {
    const { cx, cy, r, c1 } = ctx;
    const out: string[] = [
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.35)}" fill="${mixHex(c1, "#000", 0.25)}" opacity="0.45" />`,
    ];
    const angles = 8;
    for (let i = 0; i < angles; i++) {
      const a = (i / angles) * Math.PI * 2;
      out.push(
        `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx + Math.cos(a) * r * 0.95)}" y2="${n(cy + Math.sin(a) * r * 0.95)}" stroke="${mixHex(c1, "#ffffff", 0.7)}" stroke-width="0.7" opacity="0.55" />`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const a1 = (i / 4) * Math.PI * 2 + 0.18;
      const a2 = a1 + ((Math.PI * 2) / 4) * 0.32;
      const op = (0.2 + (i % 2) * 0.1).toFixed(2);
      out.push(
        `<path d="M ${n(cx)} ${n(cy)} L ${n(cx + Math.cos(a1) * r * 0.92)} ${n(cy + Math.sin(a1) * r * 0.92)} L ${n(cx + Math.cos(a2) * r * 0.92)} ${n(cy + Math.sin(a2) * r * 0.92)} Z" fill="#ffffff" opacity="${op}" />`,
      );
    }
    return out;
  },

  sparkle(ctx) {
    const { cx, cy, r, rng } = ctx;
    const out: string[] = [];
    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.75;
      const sx = cx + Math.cos(a) * d;
      const sy = cy + Math.sin(a) * d;
      const sz = 0.6 + rng() * 1.2;
      const rot = (rng() * 90).toFixed(2);
      out.push(
        `<g transform="translate(${n(sx)} ${n(sy)}) rotate(${rot})">
          <path d="M 0 ${n(-sz * 2.4)} L ${n(sz * 0.5)} 0 L 0 ${n(sz * 2.4)} L ${n(-sz * 0.5)} 0 Z" fill="#fff" opacity="0.85" />
          <path d="M ${n(-sz * 2.4)} 0 L 0 ${n(sz * 0.5)} L ${n(sz * 2.4)} 0 L 0 ${n(-sz * 0.5)} Z" fill="#fff" opacity="0.6" />
        </g>`,
      );
    }
    return out;
  },

  highlight(ctx) {
    const { cx, cy, r } = ctx;
    return [
      `<ellipse cx="${n(cx - r * 0.32)}" cy="${n(cy - r * 0.42)}" rx="${n(r * 0.2)}" ry="${n(r * 0.1)}" fill="#ffffff" opacity="0.55" />`,
      `<ellipse cx="${n(cx - r * 0.32)}" cy="${n(cy - r * 0.42)}" rx="${n(r * 0.4)}" ry="${n(r * 0.18)}" fill="#ffffff" opacity="0.15" />`,
    ];
  },

  grid(ctx) {
    const { cx, cy, r, uid } = ctx;
    const out: string[] = [];
    for (let i = -3; i <= 3; i++) {
      out.push(
        `<line x1="${n(cx - r)}" y1="${n(cy + i * r * 0.28)}" x2="${n(cx + r)}" y2="${n(cy + i * r * 0.28)}" stroke="#9be7ff" stroke-width="0.45" opacity="0.6" filter="url(#glow-grid-${uid})" />`,
        `<line x1="${n(cx + i * r * 0.28)}" y1="${n(cy - r)}" x2="${n(cx + i * r * 0.28)}" y2="${n(cy + r)}" stroke="#9be7ff" stroke-width="0.45" opacity="0.6" filter="url(#glow-grid-${uid})" />`,
      );
    }
    return out;
  },

  maze(ctx) {
    const { cx, cy, r } = ctx;
    const out: string[] = [];
    for (let i = 1; i <= 3; i++) {
      out.push(
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * (i / 3) * 0.85)}" stroke="#cfeac0" stroke-width="0.5" fill="none" opacity="0.55" stroke-dasharray="${4 + i} ${3 + i * 2}" />`,
      );
    }
    return out;
  },

  terminator(ctx) {
    const { cx, cy, r, c2, nightColor: nc } = ctx;
    const nightColor = nc ?? c2;
    return [
      `<path d="M ${n(cx)} ${n(cy - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(cx)} ${n(cy + r)} Z" fill="${nightColor}" opacity="0.92" />`,
    ];
  },

  innerStars(ctx) {
    const { cx, cy, r, rng } = ctx;
    const out: string[] = [];
    let placed = 0;
    let attempts = 0;
    while (placed < 7 && attempts < 30) {
      attempts++;
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.85;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (x < cx + r * 0.05) continue;
      out.push(
        `<circle cx="${n(x)}" cy="${n(y)}" r="${(0.5 + rng() * 0.6).toFixed(2)}" fill="#ffffff" opacity="${(0.7 + rng() * 0.3).toFixed(2)}" />`,
      );
      placed++;
    }
    return out;
  },

  rainbow(ctx) {
    const { cx, cy, r } = ctx;
    const colors = ["#e87b5f", "#e8a060", "#e8d068", "#88e088", "#5fbcd8", "#7a78d8", "#a868d8"];
    const out: string[] = [];
    colors.forEach((col, i) => {
      const yOff = (i - colors.length / 2 + 0.5) * (r * 1.7) / colors.length;
      const bandW = ((r * 1.7) / colors.length) * 0.7;
      const rx = r * Math.sqrt(Math.max(0, 1 - Math.pow(yOff / r, 2))) * 0.97;
      out.push(
        `<ellipse cx="${n(cx)}" cy="${n(cy + yOff)}" rx="${n(rx)}" ry="${n(bandW)}" fill="${col}" opacity="0.62" />`,
      );
    });
    return out;
  },

  bigEye(ctx) {
    const { cx, cy, r, c1, c2, uid } = ctx;
    const irid = `iris-rad-${uid}`;
    // Iris contents — wrapped in two animated groups: outer scaleY for blink,
    // inner translate for look-around. Origin pinned at the eye center.
    const eyeContents: string[] = [
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.6)}" fill="${mixHex(c1, "#dc9b3a", 0.5)}" />`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.6)}" fill="url(#${irid})" />`,
    ];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      eyeContents.push(
        `<line x1="${n(cx + Math.cos(a) * r * 0.18)}" y1="${n(cy + Math.sin(a) * r * 0.18)}" x2="${n(cx + Math.cos(a) * r * 0.56)}" y2="${n(cy + Math.sin(a) * r * 0.56)}" stroke="${mixHex(c2, "#000", 0.4)}" stroke-width="0.4" opacity="0.55" />`,
      );
    }
    eyeContents.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.22)}" fill="#0a0a14" />`,
      `<circle cx="${n(cx + r * 0.08)}" cy="${n(cy - r * 0.08)}" r="${n(r * 0.06)}" fill="#fff" opacity="0.95" />`,
      `<circle cx="${n(cx - r * 0.05)}" cy="${n(cy + r * 0.1)}" r="${n(r * 0.03)}" fill="#fff" opacity="0.6" />`,
    );

    const blink = ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: eye-blink 5.5s ease-in-out infinite;"`;
    const look = ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: eye-look 11s ease-in-out infinite;"`;
    return [
      `<defs>
        <radialGradient id="${irid}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffeaa0" stop-opacity="0.85" />
          <stop offset="60%" stop-color="#d4a857" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#5a4220" stop-opacity="0.9" />
        </radialGradient>
      </defs>`,
      `<g${blink}><g${look}>${eyeContents.join("")}</g></g>`,
    ];
  },

  structures(ctx) {
    const { cx, cy, r, rng, c1 } = ctx;
    const out: string[] = [];
    for (let i = -2; i <= 2; i++) {
      out.push(
        `<line x1="${n(cx - r * 0.85)}" y1="${n(cy + i * r * 0.32)}" x2="${n(cx + r * 0.85)}" y2="${n(cy + i * r * 0.32)}" stroke="${mixHex(c1, "#ffffff", 0.3)}" stroke-width="0.3" opacity="0.22" />`,
      );
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.65;
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d;
      const rot = (rng() * 30 - 15).toFixed(2);
      out.push(
        `<rect x="${n(px - 2)}" y="${n(py - 1.4)}" width="${(4 + rng() * 3).toFixed(2)}" height="${(2.6 + rng() * 1.5).toFixed(2)}" fill="${mixHex(c1, "#ffffff", 0.4)}" opacity="0.5" transform="rotate(${rot} ${n(px)} ${n(py)})" />`,
      );
    }
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r * 0.85;
      out.push(
        `<circle cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d)}" r="${(0.55 + rng() * 0.65).toFixed(2)}" fill="#ffe590" opacity="0.92" />`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.42;
      const baseX = cx + Math.cos(a) * r;
      const baseY = cy + Math.sin(a) * r;
      const tipR = r + 3.5 + rng() * 4;
      const tipX = cx + Math.cos(a) * tipR;
      const tipY = cy + Math.sin(a) * tipR;
      out.push(
        `<path d="M ${n(baseX - 1.6)} ${n(baseY)} L ${n(tipX)} ${n(tipY)} L ${n(baseX + 1.6)} ${n(baseY)} Z" fill="${mixHex(c1, "#000", 0.25)}" opacity="0.95" />`,
      );
    }
    return out;
  },
};

const RENDER_ORDER = [
  "continents", "bands", "spot", "rainbow",
  "iridescent", "maze", "dunes", "canyons",
  "vortex", "craters", "polar", "veins",
  "hotspots", "cityLights", "grid", "clouds",
  "terminator", "innerStars", "bigEye", "structures",
  "facets", "sparkle", "highlight",
];

// Planets that should not spin — their identity comes from a fixed pose.
// `dyson_sphere` is handled by its dedicated renderer so it's not listed here.
const NO_ROTATE = new Set(["eye_world", "mask", "twilight"]);

/** Build the inline `style` for a continuous spin (or "" for no-rotate). */
function spinStyle(seed: number, cx: number, cy: number, animated: boolean, planetId: string): string {
  if (!animated || NO_ROTATE.has(planetId)) return "";
  const baseDur = 24 + (seed % 16);   // 24–40s, seed-stable
  return ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: planet-spin ${baseDur}s linear infinite;"`;
}

/** Counter-rotating ring style (used for ancient_civilization). */
function ringSpinStyle(seed: number, cx: number, cy: number, animated: boolean, planetId: string): string {
  if (!animated || planetId !== "ancient_civilization") return "";
  const baseDur = 24 + (seed % 16);
  return ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: planet-spin ${(baseDur * 1.8).toFixed(1)}s linear infinite reverse;"`;
}

// ─────────────────────── main entry point ───────────────────────

export function planetSvg(spec: PlanetSpec, size = 64, animated = true): string {
  if (spec.features.dyson) return dysonSphereSvg(spec.id, size, animated);

  const [c1, c2, c3] = spec.palette;
  const f = spec.features;
  const r = size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const seed = seedFromId(spec.id);
  const rng = mulberry32(seed);
  const uid = spec.id.replace(/_/g, "-");

  const ctx: FeatCtx = {
    cx, cy, r, rng, c1, c2, c3, uid,
    continentColor: f.continentColor,
    nightColor: f.nightColor,
    multiOcean: f.multiOcean,
  };

  const layers: string[] = [];
  for (const key of RENDER_ORDER) {
    if ((f as Record<string, unknown>)[key] && RENDERERS[key]) {
      layers.push(...RENDERERS[key](ctx));
    }
  }

  const ringEls = f.rings
    ? `
      <ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 1.36)}" ry="${n(r * 0.3)}" fill="none" stroke="${c1}" stroke-width="1.2" opacity="0.6" />
      <ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 1.18)}" ry="${n(r * 0.25)}" fill="none" stroke="${c1}" stroke-width="0.6" opacity="0.4" />
    `
    : "";

  const surfaceStyle = spinStyle(seed, cx, cy, animated, spec.id);
  const ringStyle = ringSpinStyle(seed, cx, cy, animated, spec.id);

  // `eye_world` uses its own blink + look-around animations on the bigEye
  // feature renderer (see RENDERERS.bigEye). The surface group must be
  // motionless so those animations aren't transformed twice.
  const isEyeWorld = spec.id === "eye_world";

  return `<svg viewBox="0 0 ${size} ${size}" class="planet-orb-svg" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g-${uid}" cx="35%" cy="32%" r="65%">
        <stop offset="0%" stop-color="${mixHex(c1, "#ffffff", 0.22)}" />
        <stop offset="35%" stop-color="${c1}" />
        <stop offset="75%" stop-color="${c2}" />
        <stop offset="100%" stop-color="${c3 || c2}" />
      </radialGradient>
      <radialGradient id="glow-${uid}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${c1}" stop-opacity="${f.glow ? 0.4 : 0.16}" />
        <stop offset="100%" stop-color="${c1}" stop-opacity="0" />
      </radialGradient>
      <filter id="glow-veins-${uid}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.8" />
      </filter>
      <filter id="glow-grid-${uid}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.6" />
      </filter>
      <radialGradient id="sphere-shadow-${uid}" cx="32%" cy="28%" r="85%">
        <stop offset="0%" stop-color="#000" stop-opacity="0" />
        <stop offset="55%" stop-color="#000" stop-opacity="0.05" />
        <stop offset="85%" stop-color="#000" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#000" stop-opacity="0.55" />
      </radialGradient>
      <linearGradient id="rim-${uid}" x1="30%" y1="30%" x2="70%" y2="70%">
        <stop offset="0%" stop-color="${mixHex(c1, "#ffffff", 0.4)}" stop-opacity="0.6" />
        <stop offset="55%" stop-color="${c1}" stop-opacity="0" />
        <stop offset="100%" stop-color="#000" stop-opacity="0" />
      </linearGradient>
      <clipPath id="clip-${uid}">
        <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r - 0.4)}" />
      </clipPath>
    </defs>

    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.45)}" fill="url(#glow-${uid})" />

    ${f.atmo ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.08)}" fill="none" stroke="${c1}" stroke-width="1.1" opacity="0.4" />` : ""}

    ${ringEls ? `<g${ringStyle}><g style="clip-path: inset(0 0 50% 0);">${ringEls}</g></g>` : ""}

    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#g-${uid})" />

    <g clip-path="url(#clip-${uid})"${isEyeWorld ? "" : surfaceStyle}>
      ${layers.join("\n")}
      <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#sphere-shadow-${uid})" />
      <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r - 0.5)}" fill="none" stroke="url(#rim-${uid})" stroke-width="1.2" opacity="0.55" />
    </g>

    ${ringEls ? `<g${ringStyle}>${ringEls}</g>` : ""}
  </svg>`;
}

// ─────────────────────── Dyson sphere ───────────────────────

function dysonSphereSvg(id: string, size: number, animated = true): string {
  const uid = id.replace(/_/g, "-");
  const r = size * 0.42;
  const cx = size / 2;
  const cy = size / 2;

  // Hex panels light up in a circular sequence — each panel offset by 2.4s / 8.
  const hexes: string[] = [];
  const hexRing = r * 0.75;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const hsize = Math.max(2.5, size * 0.05);
    const cxh = cx + Math.cos(a) * hexRing;
    const cyh = cy + Math.sin(a) * hexRing;
    const pts: string[] = [];
    for (let j = 0; j < 6; j++) {
      const ah = (j / 6) * Math.PI * 2 - Math.PI / 2;
      pts.push(`${n(cxh + Math.cos(ah) * hsize)},${n(cyh + Math.sin(ah) * hsize)}`);
    }
    const hexAnim = animated
      ? ` style="animation: hex-pulse 2.4s ease-in-out infinite; animation-delay: ${((i / 8) * 2.4).toFixed(2)}s;"`
      : "";
    hexes.push(
      `<polygon points="${pts.join(" ")}" fill="rgba(240,140,109,0.18)" stroke="#f08c6d" stroke-width="0.8"${hexAnim} />`,
    );
  }

  const beams: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    beams.push(
      `<line x1="${n(cx + Math.cos(a) * r * 0.35)}" y1="${n(cy + Math.sin(a) * r * 0.35)}" x2="${n(cx + Math.cos(a) * r * 0.7)}" y2="${n(cy + Math.sin(a) * r * 0.7)}" stroke="#f08c6d" stroke-width="0.4" opacity="0.4" />`,
    );
  }

  const beamsStyle = animated
    ? ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: planet-spin 36s linear infinite;"`
    : "";
  const hexStyle = animated
    ? ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: planet-spin 60s linear infinite reverse;"`
    : "";
  const coronaStyle = animated
    ? ` style="transform-origin: ${n(cx)}px ${n(cy)}px; animation: corona-pulse 4s ease-in-out infinite;"`
    : "";

  return `<svg viewBox="0 0 ${size} ${size}" class="planet-orb-svg" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="star-${uid}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fffce8" stop-opacity="1" />
        <stop offset="35%" stop-color="#ffd89a" stop-opacity="0.95" />
        <stop offset="100%" stop-color="#f0966a" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="coron-${uid}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffb070" stop-opacity="0.4" />
        <stop offset="100%" stop-color="#ffb070" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.5)}" fill="url(#coron-${uid})"${coronaStyle} />
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.42)}" fill="url(#star-${uid})" />
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.22)}" fill="#fffce8" opacity="0.95" />
    <g${beamsStyle}>${beams.join("\n")}</g>
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.92)}" fill="none" stroke="#f08c6d" stroke-width="0.6" opacity="0.5" />
    <g${hexStyle}>${hexes.join("\n")}</g>
  </svg>`;
}
