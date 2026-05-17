// Tokenova — canvas-based planet renderer (TypeScript port of planet-canvas.jsx).
// Replaces the SVG-stickers approach with proper sphere shading + procedural
// noise texturing + soft atmospheric halos. Cinematic feel.
//
// This module is a mechanical port of the React component. Instead of
// rendering through React it exposes a small mounting API:
//
//   const handle = mountPlanetCanvas(host, spec, { size: 72, animated: true });
//   handle.dispose();

import { mulberry32 } from "./rng";
import type { PlanetSpec } from "./catalog";
import { mountBlackholeCanvas } from "./blackhole-canvas";

// ─────────── public API ───────────

export interface PlanetCanvasOptions {
  size?: number;       // default 72
  animated?: boolean;  // default true
}

export interface PlanetCanvasHandle {
  dispose(): void;
}

// ─────────── shared helpers ───────────

type RGB = readonly [number, number, number];

function _mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

function _parseHex(h: string): RGB {
  h = h.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function _rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function _lighten(c: RGB, t: number): RGB {
  return _mix(c, [255, 255, 255], t);
}

function _darken(c: RGB, t: number): RGB {
  return _mix(c, [0, 0, 0], t);
}

// deterministic prng from id (djb2 hash, matches the JSX's `_seed`)
function seedFromId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h) + id.charCodeAt(i);
  return h >>> 0;
}

// ─────────── feature rendering ───────────
// All feature renderers take (ctx, p, opts) where p has {cx, cy, r, palette, rng}.
// Renderers assume clipping is already in place by caller.

interface P {
  cx: number;
  cy: number;
  r: number;
  palette: readonly string[];
  seedNum: number;
  shift: number;
}

// Soft continents (earth-like, jungle) — many soft radial blobs additive
function drawContinents(ctx: CanvasRenderingContext2D, p: P, color: string): void {
  const rng = mulberry32(p.seedNum + 17);
  ctx.globalCompositeOperation = 'source-over';
  const count = 14 + Math.floor(rng() * 8);
  const c = _parseHex(color);
  for (let i = 0; i < count; i++) {
    // spread across an extended x range so axial wrap looks natural
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.8;
    // axial wrap
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    if (x < p.cx - p.r * 1.3 || x > p.cx + p.r * 1.3) continue;
    const sz = p.r * (0.12 + rng() * 0.32);
    const op = 0.4 + rng() * 0.45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, sz);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${op})`);
    g.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},${op * 0.3})`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Surface mottling — subtle noise spots in the body color, gives the body texture
function drawMottling(ctx: CanvasRenderingContext2D, p: P, count: number = 22): void {
  const rng = mulberry32(p.seedNum + 7);
  const c2 = _parseHex(p.palette[1]);
  const cd = _darken(c2, 0.25);
  const cl = _lighten(c2, 0.18);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < count; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.85;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const sz = p.r * (0.08 + rng() * 0.18);
    const tone = rng() > 0.5 ? cd : cl;
    const op = 0.08 + rng() * 0.12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, sz);
    g.addColorStop(0, `rgba(${tone[0]},${tone[1]},${tone[2]},${op})`);
    g.addColorStop(1, `rgba(${tone[0]},${tone[1]},${tone[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Clouds — wispy white blobs, soft edges, low alpha
function drawClouds(ctx: CanvasRenderingContext2D, p: P): void {
  const rng = mulberry32(p.seedNum + 23);
  ctx.globalCompositeOperation = 'lighter';
  const count = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < count; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.9;
    // Clouds drift slightly faster than land
    x = p.cx - p.r + (((x - p.shift * 1.15) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const rx = p.r * (0.18 + rng() * 0.22);
    const ry = p.r * (0.04 + rng() * 0.07);
    const angle = (rng() - 0.5) * 0.5;
    const op = 0.12 + rng() * 0.13;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${op})`);
    g.addColorStop(0.7, `rgba(255,255,255,${op * 0.35})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Bands — gas giant horizontal stripes with feathered edges + turbulence noise
function drawBands(ctx: CanvasRenderingContext2D, p: P): void {
  const rng = mulberry32(p.seedNum + 41);
  const c1 = _parseHex(p.palette[0]);
  const c2 = _parseHex(p.palette[1]);
  const count = 8 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const ti = (i + 0.5) / count;
    const yOff = (ti - 0.5) * p.r * 2;
    const ry = (p.r * 2 / count) * 0.55;
    const dark = i % 2 === 0;
    const base = dark ? _darken(c2, 0.18) : _lighten(c1, 0.10);
    const op = dark ? 0.55 : 0.4;
    // chord half-width at this y
    const dy = yOff / p.r;
    const chord = p.r * Math.sqrt(Math.max(0, 1 - dy * dy));
    const y = p.cy + yOff;
    const grad = ctx.createLinearGradient(p.cx, y - ry, p.cx, y + ry);
    grad.addColorStop(0,   _rgba(base, 0));
    grad.addColorStop(0.5, _rgba(base, op));
    grad.addColorStop(1,   _rgba(base, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(p.cx - chord, y - ry, chord * 2, ry * 2);
  }
  // mid-bands turbulence — soft horizontal smears
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const y = p.cy + (rng() - 0.5) * p.r * 1.8;
    const dy = (y - p.cy) / p.r;
    const chord = p.r * Math.sqrt(Math.max(0, 1 - dy * dy)) * 0.95;
    const rx = chord * (0.2 + rng() * 0.4);
    let x = p.cx + (rng() - 0.5) * chord * 1.5;
    // axial wrap
    x = p.cx + ((((x - p.cx) - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4) - p.r * 2;
    const tone = _lighten(c1, 0.25);
    const op = 0.06 + rng() * 0.09;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, _rgba(tone, op));
    g.addColorStop(1, _rgba(tone, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Great spot — Jupiter-style
function drawSpot(ctx: CanvasRenderingContext2D, p: P): void {
  let x = p.cx + p.r * 0.32;
  const y = p.cy + p.r * 0.18;
  x = p.cx + ((((x - p.cx) - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4) - p.r * 2;
  if (x < p.cx - p.r * 1.1 || x > p.cx + p.r * 1.1) return;
  const c1 = _parseHex(p.palette[0]);
  const spotCol = _mix(c1, [200, 70, 40], 0.55);
  const rx = p.r * 0.24, ry = p.r * 0.15;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, _rgba(_lighten(spotCol, 0.2), 0.95));
  g.addColorStop(0.6, _rgba(spotCol, 0.7));
  g.addColorStop(1, _rgba(spotCol, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Polar caps (axis-locked, don't rotate)
function drawPolar(ctx: CanvasRenderingContext2D, p: P): void {
  // north
  let g = ctx.createRadialGradient(p.cx, p.cy - p.r * 0.85, 0, p.cx, p.cy - p.r * 0.85, p.r * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(248,242,232,0.45)');
  g.addColorStop(1, 'rgba(248,242,232,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.cx, p.cy - p.r * 0.86, p.r * 0.55, p.r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // south
  g = ctx.createRadialGradient(p.cx, p.cy + p.r * 0.88, 0, p.cx, p.cy + p.r * 0.88, p.r * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(248,242,232,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.cx, p.cy + p.r * 0.88, p.r * 0.42, p.r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Lava veins — bright glowing cracks
function drawVeins(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 71);
  ctx.globalCompositeOperation = 'lighter';
  const count = 7;
  for (let i = 0; i < count; i++) {
    const pulse = Math.sin(t * 1.5 + i * 1.3) * 0.18 + 0.82;
    const a1 = rng() * Math.PI * 2;
    const a2 = a1 + (rng() - 0.5) * 1.1;
    const x1 = p.cx + Math.cos(a1) * p.r * 0.95;
    const y1 = p.cy + Math.sin(a1) * p.r * 0.95;
    const x2 = p.cx + Math.cos(a2) * p.r * 0.2;
    const y2 = p.cy + Math.sin(a2) * p.r * 0.2;
    const mx = p.cx + (rng() - 0.5) * p.r * 0.6;
    const my = p.cy + (rng() - 0.5) * p.r * 0.6;
    // glow halo pass
    ctx.shadowColor = 'rgba(255,160,80,0.9)';
    ctx.shadowBlur = 4 * pulse;
    ctx.strokeStyle = `rgba(255,200,90,${0.85 * pulse})`;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
    // bright core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,240,180,${pulse})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-over';
}

// Volcano hotspots — pulsing magma blobs
function drawHotspots(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 83);
  ctx.globalCompositeOperation = 'lighter';
  const count = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const pulse = Math.sin(t * 1.8 + i * 1.7) * 0.25 + 0.75;
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.7;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    if (x < p.cx - p.r * 1.1 || x > p.cx + p.r * 1.1) continue;
    const sz = p.r * (0.06 + rng() * 0.08);
    // outer warm halo
    let g = ctx.createRadialGradient(x, y, 0, x, y, sz * 3);
    g.addColorStop(0, `rgba(255,150,60,${0.5 * pulse})`);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz * 3, 0, Math.PI * 2);
    ctx.fill();
    // hot core
    g = ctx.createRadialGradient(x, y, 0, x, y, sz);
    g.addColorStop(0, `rgba(255,240,180,${0.95 * pulse})`);
    g.addColorStop(0.5, `rgba(255,180,80,${0.85 * pulse})`);
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// City lights for nocturnal — clusters of small yellow dots with glow
function drawCityLights(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 97);
  ctx.globalCompositeOperation = 'lighter';
  const clusters = 3 + Math.floor(rng() * 2);
  for (let k = 0; k < clusters; k++) {
    const tw = Math.sin(t * 1.5 + k * 1.7) * 0.2 + 0.8;
    let cx2 = -p.r + rng() * p.r * 4;
    const cy2 = p.cy + (rng() * 2 - 1) * p.r * 0.75;
    cx2 = p.cx - p.r + (((cx2 - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    if (cx2 < p.cx - p.r * 1.1 || cx2 > p.cx + p.r * 1.1) continue;
    // cluster halo
    const g = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, p.r * 0.2);
    g.addColorStop(0, `rgba(255,225,140,${0.22 * tw})`);
    g.addColorStop(1, 'rgba(255,225,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx2, cy2, p.r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // dots
    const dots = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < dots; i++) {
      const dx = (rng() - 0.5) * p.r * 0.28;
      const dy = (rng() - 0.5) * p.r * 0.16;
      const sz = 0.6 + rng() * 0.8;
      ctx.fillStyle = `rgba(255,235,160,${(0.7 + rng() * 0.3) * tw})`;
      ctx.beginPath();
      ctx.arc(cx2 + dx, cy2 + dy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Iridescent shimmer for pearl — multi-hue overlay, slowly drifting
function drawIridescent(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const ang = t * 0.18;
  const g = ctx.createLinearGradient(
    p.cx + Math.cos(ang) * p.r * 1.4, p.cy + Math.sin(ang) * p.r * 1.4,
    p.cx - Math.cos(ang) * p.r * 1.4, p.cy - Math.sin(ang) * p.r * 1.4
  );
  g.addColorStop(0,   'rgba(255,198,220,0.55)');
  g.addColorStop(0.3, 'rgba(192,212,255,0.5)');
  g.addColorStop(0.55,'rgba(184,240,214,0.5)');
  g.addColorStop(0.8, 'rgba(255,234,168,0.5)');
  g.addColorStop(1,   'rgba(255,188,198,0.55)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
  ctx.fill();
  // soft highlight on top-left
  const h = ctx.createRadialGradient(
    p.cx - p.r * 0.3, p.cy - p.r * 0.3, 0,
    p.cx - p.r * 0.3, p.cy - p.r * 0.3, p.r * 0.6
  );
  h.addColorStop(0, 'rgba(255,255,255,0.45)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
  ctx.fill();
}

// Crystal facets — bold radial cuts
function drawFacets(ctx: CanvasRenderingContext2D, p: P): void {
  const c1 = _parseHex(p.palette[0]);
  // dark inner core
  let g = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, p.r * 0.4);
  g.addColorStop(0, _rgba(_darken(c1, 0.25), 0.55));
  g.addColorStop(1, _rgba(_darken(c1, 0.25), 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  // radial cuts
  ctx.strokeStyle = _rgba(_lighten(c1, 0.55), 0.45);
  ctx.lineWidth = 0.6;
  const angles = 8;
  for (let i = 0; i < angles; i++) {
    const a = (i / angles) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(p.cx, p.cy);
    ctx.lineTo(p.cx + Math.cos(a) * p.r * 0.95, p.cy + Math.sin(a) * p.r * 0.95);
    ctx.stroke();
  }
  // bright facet wedges (alternate)
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const a1 = (i / 4) * Math.PI * 2 + 0.18;
    const a2 = a1 + (Math.PI * 2 / 4) * 0.3;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(p.cx, p.cy);
    ctx.lineTo(p.cx + Math.cos(a1) * p.r * 0.92, p.cy + Math.sin(a1) * p.r * 0.92);
    ctx.lineTo(p.cx + Math.cos(a2) * p.r * 0.92, p.cy + Math.sin(a2) * p.r * 0.92);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Sparkle — small twinkling stars on the surface
function drawSparkle(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 113);
  ctx.globalCompositeOperation = 'lighter';
  const count = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * p.r * 0.85;
    const x = p.cx + Math.cos(a) * d;
    const y = p.cy + Math.sin(a) * d;
    const tw = Math.sin(t * 2.5 + i * 1.7) * 0.5 + 0.5;
    const sz = (0.5 + rng() * 1.2) * (0.7 + tw * 0.6);
    // cross
    ctx.strokeStyle = `rgba(255,255,255,${0.4 + tw * 0.55})`;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(x - sz * 2, y); ctx.lineTo(x + sz * 2, y);
    ctx.moveTo(x, y - sz * 2); ctx.lineTo(x, y + sz * 2);
    ctx.stroke();
    // center bright
    ctx.fillStyle = `rgba(255,255,255,${0.7 + tw * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Rainbow bands — for rainbow planet (static, doesn't rotate)
function drawRainbow(ctx: CanvasRenderingContext2D, p: P): void {
  const colors = ['#e87b5f','#e8a060','#e8d068','#88e088','#5fbcd8','#7a78d8','#a868d8'];
  const count = colors.length;
  for (let i = 0; i < count; i++) {
    const ti = (i + 0.5) / count;
    const yOff = (ti - 0.5) * p.r * 2;
    const ry = (p.r * 2 / count) * 0.55;
    const dy = yOff / p.r;
    const chord = p.r * Math.sqrt(Math.max(0, 1 - dy * dy));
    const y = p.cy + yOff;
    const c = _parseHex(colors[i]);
    const grad = ctx.createLinearGradient(p.cx, y - ry, p.cx, y + ry);
    grad.addColorStop(0,   _rgba(c, 0));
    grad.addColorStop(0.5, _rgba(c, 0.78));
    grad.addColorStop(1,   _rgba(c, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(p.cx - chord, y - ry, chord * 2, ry * 2);
  }
}

// Grid — for grid planet
function drawGrid(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const pulse = Math.sin(t * 1.2) * 0.15 + 0.85;
  ctx.strokeStyle = `rgba(155,231,255,${0.55 * pulse})`;
  ctx.lineWidth = 0.4;
  ctx.shadowColor = `rgba(95,200,240,${0.7 * pulse})`;
  ctx.shadowBlur = 2;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(p.cx - p.r * 0.95, p.cy + i * p.r * 0.27);
    ctx.lineTo(p.cx + p.r * 0.95, p.cy + i * p.r * 0.27);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.cx + i * p.r * 0.27, p.cy - p.r * 0.95);
    ctx.lineTo(p.cx + i * p.r * 0.27, p.cy + p.r * 0.95);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// Maze — concentric organic rings (botanical)
function drawMaze(ctx: CanvasRenderingContext2D, p: P): void {
  ctx.strokeStyle = 'rgba(207,234,192,0.5)';
  for (let i = 1; i <= 4; i++) {
    ctx.lineWidth = 0.4 + i * 0.15;
    ctx.setLineDash([3 + i * 2, 2 + i]);
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.r * (i / 4) * 0.88, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Dunes — desert wavy ridges
function drawDunes(ctx: CanvasRenderingContext2D, p: P): void {
  const c1 = _parseHex(p.palette[0]);
  const c2 = _parseHex(p.palette[1]);
  const shadow = _rgba(_darken(c2, 0.35), 0.5);
  const highlight = _rgba(_lighten(c1, 0.3), 0.4);
  for (let i = -3; i <= 3; i++) {
    const yOff = i * p.r * 0.22;
    // shadow trough
    ctx.strokeStyle = shadow;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.cx - p.r * 0.95, p.cy + yOff);
    ctx.quadraticCurveTo(p.cx - p.r * 0.5, p.cy + yOff - p.r * 0.08, p.cx, p.cy + yOff);
    ctx.quadraticCurveTo(p.cx + p.r * 0.5, p.cy + yOff + p.r * 0.08, p.cx + p.r * 0.95, p.cy + yOff);
    ctx.stroke();
    // highlight above
    ctx.strokeStyle = highlight;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(p.cx - p.r * 0.95, p.cy + yOff - 1.4);
    ctx.quadraticCurveTo(p.cx - p.r * 0.5, p.cy + yOff - p.r * 0.08 - 1.4, p.cx, p.cy + yOff - 1.4);
    ctx.quadraticCurveTo(p.cx + p.r * 0.5, p.cy + yOff + p.r * 0.08 - 1.4, p.cx + p.r * 0.95, p.cy + yOff - 1.4);
    ctx.stroke();
  }
}

// Craters — moon-like, with rim highlight + soft inner shadow + edge fade
// (eliminates "pop in/out" flicker at the planet's limb)
function drawCraters(ctx: CanvasRenderingContext2D, p: P): void {
  const rng = mulberry32(p.seedNum + 59);
  const c2 = _parseHex(p.palette[1]);
  const count = 14;
  const prevAlpha = ctx.globalAlpha;
  for (let i = 0; i < count; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.85;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    // Only draw within an extended visible range; fade smoothly near the
    // planet's left/right limb so craters dissolve in/out instead of popping.
    const edgeDist = Math.abs(x - p.cx) / p.r; // 0=center, 1=limb
    if (edgeDist > 1.05) continue;
    const fade = Math.max(0, 1 - Math.pow(edgeDist, 3));
    ctx.globalAlpha = prevAlpha * fade;
    const cR = 1 + rng() * 2.5;
    ctx.fillStyle = _rgba(_lighten(c2, 0.5), 0.45);
    ctx.beginPath();
    ctx.arc(x + cR * 0.12, y + cR * 0.12, cR + 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = _rgba(_darken(c2, 0.5), 0.55);
    ctx.beginPath();
    ctx.arc(x, y, cR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = prevAlpha;
}

// Lava world dense veins — many more glowing cracks for a cracked-crust look
function drawDenseVeins(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 73);
  ctx.globalCompositeOperation = 'lighter';
  const count = 14;
  for (let i = 0; i < count; i++) {
    const pulse = Math.sin(t * 1.5 + i * 1.3) * 0.18 + 0.82;
    const a1 = rng() * Math.PI * 2;
    const a2 = a1 + (rng() - 0.5) * 1.1;
    const x1 = p.cx + Math.cos(a1) * p.r * 0.95;
    const y1 = p.cy + Math.sin(a1) * p.r * 0.95;
    const x2 = p.cx + Math.cos(a2) * p.r * 0.2;
    const y2 = p.cy + Math.sin(a2) * p.r * 0.2;
    const mx = p.cx + (rng() - 0.5) * p.r * 0.6;
    const my = p.cy + (rng() - 0.5) * p.r * 0.6;
    ctx.shadowColor = 'rgba(255,160,80,0.9)';
    ctx.shadowBlur = 3 * pulse;
    ctx.strokeStyle = `rgba(255,200,90,${0.7 * pulse})`;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,235,170,${0.85 * pulse})`;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Mega-volcano — 2-3 large erupting cones with bright lava + smoke plume
function drawMegaVolcano(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 89);
  const count = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    let baseX = -p.r + rng() * p.r * 4;
    const baseY = p.cy + (rng() * 2 - 1) * p.r * 0.6;
    baseX = p.cx - p.r + (((baseX - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const edgeDist = Math.abs(baseX - p.cx) / p.r;
    if (edgeDist > 1.0) continue;
    const fade = Math.max(0, 1 - Math.pow(edgeDist, 2.5));
    const coneH = p.r * (0.16 + rng() * 0.08);
    const coneW = coneH * 0.9;
    // dark volcano cone silhouette
    ctx.fillStyle = `rgba(40,15,10,${0.85 * fade})`;
    ctx.beginPath();
    ctx.moveTo(baseX - coneW, baseY);
    ctx.lineTo(baseX, baseY - coneH);
    ctx.lineTo(baseX + coneW, baseY);
    ctx.closePath();
    ctx.fill();
    // glowing crater rim + lava
    const pulse = Math.sin(t * 2 + i * 1.7) * 0.25 + 0.75;
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(baseX, baseY - coneH * 0.85, 0, baseX, baseY - coneH * 0.85, coneH * 1.4);
    gr.addColorStop(0, `rgba(255,240,180,${0.95 * pulse * fade})`);
    gr.addColorStop(0.4, `rgba(255,150,60,${0.8 * pulse * fade})`);
    gr.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(baseX, baseY - coneH * 0.85, coneH * 1.4, 0, Math.PI * 2);
    ctx.fill();
    // smoke plume going up
    for (let k = 0; k < 4; k++) {
      const py = baseY - coneH - k * coneH * 0.45;
      const px = baseX + Math.sin(t * 0.4 + k * 0.8 + i) * 2;
      const psize = coneH * (0.45 + k * 0.18);
      const sg = ctx.createRadialGradient(px, py, 0, px, py, psize);
      sg.addColorStop(0, `rgba(180,160,150,${(0.4 - k * 0.07) * fade})`);
      sg.addColorStop(1, 'rgba(180,160,150,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(px, py, psize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Dense city lights for nocturnal — lots of small lit dots scattered across
// the dark planet, with constellation-style faint connecting lines.
function drawDenseCities(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 137);
  ctx.globalCompositeOperation = 'lighter';
  // 6-8 big clusters
  const clusters = 7;
  const clusterPositions: Array<[number, number, number]> = [];
  for (let k = 0; k < clusters; k++) {
    let cx2 = -p.r + rng() * p.r * 4;
    const cy2 = p.cy + (rng() * 2 - 1) * p.r * 0.78;
    cx2 = p.cx - p.r + (((cx2 - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const edgeDist = Math.abs(cx2 - p.cx) / p.r;
    if (edgeDist > 1.0) continue;
    const fade = Math.max(0, 1 - Math.pow(edgeDist, 3));
    clusterPositions.push([cx2, cy2, fade]);
    // halo
    const g = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, p.r * 0.22);
    g.addColorStop(0, `rgba(255,225,140,${0.22 * fade})`);
    g.addColorStop(1, 'rgba(255,225,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx2, cy2, p.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // dots within cluster
    const dots = 10 + Math.floor(rng() * 8);
    const tw = Math.sin(t * 1.5 + k * 1.7) * 0.15 + 0.85;
    for (let i = 0; i < dots; i++) {
      const dx = (rng() - 0.5) * p.r * 0.34;
      const dy = (rng() - 0.5) * p.r * 0.2;
      const sz = 0.55 + rng() * 0.8;
      ctx.fillStyle = `rgba(255,235,160,${(0.75 + rng() * 0.25) * tw * fade})`;
      ctx.beginPath();
      ctx.arc(cx2 + dx, cy2 + dy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // light line connectors between near clusters (highways)
  ctx.strokeStyle = 'rgba(255,225,140,0.18)';
  ctx.lineWidth = 0.4;
  for (let i = 0; i < clusterPositions.length; i++) {
    for (let j = i + 1; j < clusterPositions.length; j++) {
      const [ax, ay, af] = clusterPositions[i];
      const [bx, by, bf] = clusterPositions[j];
      const d = Math.hypot(ax - bx, ay - by);
      if (d < p.r * 0.45) {
        ctx.globalAlpha = 0.6 * af * bf;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Mystic aura — swirling violet wisps, glowing runes
function drawMysticAura(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  ctx.globalCompositeOperation = 'lighter';
  // Several violet/cyan wisps drifting + rotating
  const wisps = 5;
  for (let i = 0; i < wisps; i++) {
    const baseA = (i / wisps) * Math.PI * 2;
    const a = baseA + t * 0.15;
    const r = p.r * (0.45 + Math.sin(t * 0.4 + i) * 0.15);
    const wx = p.cx + Math.cos(a) * r;
    const wy = p.cy + Math.sin(a) * r;
    const ws = p.r * 0.35;
    const hue = (i % 3 === 0) ? 'rgba(190,140,255,' : (i % 3 === 1) ? 'rgba(140,200,255,' : 'rgba(230,180,255,';
    const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, ws);
    g.addColorStop(0, hue + '0.35)');
    g.addColorStop(0.5, hue + '0.12)');
    g.addColorStop(1, hue + '0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(wx, wy, ws, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Runes — glowing arcane symbols rotating slowly, on the planet face
function drawRunes(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate(t * 0.08);
  ctx.strokeStyle = 'rgba(220,200,255,0.55)';
  ctx.lineWidth = 0.6;
  ctx.globalCompositeOperation = 'lighter';
  // 3 concentric circles with rune marks
  for (let ring = 1; ring <= 3; ring++) {
    const rad = p.r * (0.28 + ring * 0.18);
    ctx.globalAlpha = 0.4 - ring * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.stroke();
    // tick marks (runic symbols)
    const ticks = 6 + ring * 2;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 + ring * 0.3;
      const x1 = Math.cos(a) * rad;
      const y1 = Math.sin(a) * rad;
      const tickLen = 3;
      const x2 = Math.cos(a) * (rad + tickLen);
      const y2 = Math.sin(a) * (rad + tickLen);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // small dot
      if (i % 3 === 0) {
        ctx.fillStyle = `rgba(230,210,255,${0.6 - ring * 0.1})`;
        ctx.beginPath();
        ctx.arc(x2, y2, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// Dusk terminator — soft warm-to-cool gradient (not a hard split)
function drawDuskTerminator(ctx: CanvasRenderingContext2D, p: P, _t: number): void {
  // warm gradient on the lit side, cool dark on the night side, smooth blend
  const dayWarm  = _parseHex('#f0a880');
  const dayHot   = _parseHex('#ffcc88');
  const nightCol = _parseHex('#0c0a18');
  const dawnPurp = _parseHex('#6a3460');
  // Full body recolored as a horizontal gradient
  const g = ctx.createLinearGradient(p.cx - p.r * 0.7, 0, p.cx + p.r * 0.7, 0);
  g.addColorStop(0,    _rgba(dayHot, 0.0));   // far lit side: stays the body
  g.addColorStop(0.35, _rgba(dayWarm, 0.55));
  g.addColorStop(0.55, _rgba(dawnPurp, 0.85));
  g.addColorStop(0.78, _rgba(nightCol, 0.95));
  g.addColorStop(1,    _rgba(nightCol, 1));
  ctx.fillStyle = g;
  ctx.fillRect(p.cx - p.r * 1.05, p.cy - p.r * 1.05, p.r * 2.1, p.r * 2.1);
  // bright dawn band — narrow vertical glow at the dusk line
  ctx.globalCompositeOperation = 'lighter';
  const dawnG = ctx.createLinearGradient(p.cx + p.r * 0.05, 0, p.cx + p.r * 0.35, 0);
  dawnG.addColorStop(0,   'rgba(255,200,140,0)');
  dawnG.addColorStop(0.5, 'rgba(255,200,140,0.55)');
  dawnG.addColorStop(1,   'rgba(255,200,140,0)');
  ctx.fillStyle = dawnG;
  ctx.fillRect(p.cx + p.r * 0.05, p.cy - p.r * 1.05, p.r * 0.3, p.r * 2.1);
  ctx.globalCompositeOperation = 'source-over';
}

// Night-side city lights for twilight — small lights on the dark hemisphere
function drawNightLights(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 181);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 28; i++) {
    // only on night side (right half)
    const x = p.cx + 0.2 * p.r + rng() * p.r * 0.7;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.85;
    const dx = (x - p.cx) / p.r;
    const dy = (y - p.cy) / p.r;
    if (dx * dx + dy * dy > 0.95) continue; // outside planet
    const tw = Math.sin(t * 1.5 + i * 0.7) * 0.3 + 0.7;
    const sz = 0.55 + rng() * 0.6;
    ctx.fillStyle = `rgba(255,225,150,${(0.7 + rng() * 0.3) * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Lava world surface — a couple of bright magma rivers + dark crust + glow
function drawLavaSurface(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 211);
  // dark cooled crust patches (mostly static positions)
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * p.r * 0.75;
    const x = p.cx + Math.cos(a) * d;
    const y = p.cy + Math.sin(a) * d;
    const sz = p.r * (0.14 + rng() * 0.28);
    const g = ctx.createRadialGradient(x, y, 0, x, y, sz);
    g.addColorStop(0,   'rgba(40,12,6,0.78)');
    g.addColorStop(0.6, 'rgba(60,18,10,0.5)');
    g.addColorStop(1,   'rgba(40,12,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // 2 prominent magma rivers — fixed paths derived from seed, pulse only
  ctx.globalCompositeOperation = 'lighter';
  const rivers = 2;
  for (let i = 0; i < rivers; i++) {
    const pulse = Math.sin(t * 1.2 + i * 1.3) * 0.12 + 0.88;
    const a1 = rng() * Math.PI * 2;
    const a2 = a1 + (rng() - 0.5) * 1.4;
    const x1 = p.cx + Math.cos(a1) * p.r * 0.95;
    const y1 = p.cy + Math.sin(a1) * p.r * 0.95;
    const x2 = p.cx + Math.cos(a2) * p.r * 0.2;
    const y2 = p.cy + Math.sin(a2) * p.r * 0.2;
    const mx1 = p.cx + (rng() - 0.5) * p.r * 0.7;
    const my1 = p.cy + (rng() - 0.5) * p.r * 0.7;
    const mx2 = p.cx + (rng() - 0.5) * p.r * 0.5;
    const my2 = p.cy + (rng() - 0.5) * p.r * 0.5;
    ctx.shadowColor = 'rgba(255,140,40,0.9)';
    ctx.shadowBlur = 6 * pulse;
    ctx.strokeStyle = `rgba(255,170,60,${0.55 * pulse})`;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(mx1, my1, mx2, my2, x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,210,90,${0.9 * pulse})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(mx1, my1, mx2, my2, x2, y2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,250,210,${pulse})`;
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(mx1, my1, mx2, my2, x2, y2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Io-style volcanic spots — many small yellow/white hotspots scattered
function drawIoSpots(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 227);
  ctx.globalCompositeOperation = 'lighter';
  const count = 56;
  for (let i = 0; i < count; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.95;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    // distance from center within the body — fade near limb
    const dx = (x - p.cx) / p.r;
    const dy = (y - p.cy) / p.r;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.96) continue;
    const fade = Math.max(0, 1 - Math.pow(dist, 4));
    const tw = Math.sin(t * 1.8 + i * 1.3) * 0.2 + 0.8;
    // Choose between small bright dot and medium glowing one
    const big = rng() > 0.72;
    const sz = big ? 1.1 + rng() * 1.6 : 0.4 + rng() * 0.7;
    // halo for bigger spots
    if (big) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 3.4);
      g.addColorStop(0, `rgba(255,220,140,${0.5 * tw * fade})`);
      g.addColorStop(0.5, `rgba(255,170,80,${0.25 * tw * fade})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, sz * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // bright core
    ctx.fillStyle = big
      ? `rgba(255,250,210,${0.95 * tw * fade})`
      : `rgba(255,210,110,${0.85 * tw * fade})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Slow surface scroll — subtle bright/dark flecks that scroll axially,
// giving "no-feature" planets a visible rotation cue (like nocturnal cities).
function drawSlowSurface(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 233);
  const count = 18;
  const c1 = _parseHex(p.palette[0]);
  const tone = _lighten(c1, 0.25);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.88;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const dx = (x - p.cx) / p.r;
    const dy = (y - p.cy) / p.r;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.96) continue;
    const fade = Math.max(0, 1 - Math.pow(dist, 4));
    const tw = Math.sin(t * 0.9 + i * 0.5) * 0.2 + 0.8;
    const sz = p.r * (0.06 + rng() * 0.10);
    const g = ctx.createRadialGradient(x, y, 0, x, y, sz);
    g.addColorStop(0, _rgba(tone, 0.18 * tw * fade));
    g.addColorStop(1, _rgba(tone, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Storm planet — cinematic hurricane: turbulent spiral bands, mini eddies,
// bright eyewall, calm dark eye, occasional lightning flash inside.
function drawVortex(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const c1 = _parseHex(p.palette[0]);
  const c2 = _parseHex(p.palette[1]);
  const cx = p.cx, cy = p.cy, R = p.r;
  const phase = -t * 0.4;

  // helper: one spiral arm rendered as several thin parallel cloud strokes
  function drawSpiralArm(
    armPhase: number,
    rIn: number,
    rOut: number,
    turns: number,
    brightness: number,
    strokeCount: number = 5,
  ): void {
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < strokeCount; s++) {
      const offset = (s - (strokeCount - 1) / 2) * 0.045;
      const tone = _lighten(c1, 0.45 + (s / strokeCount) * 0.25);
      const op = brightness * (0.32 + (s / strokeCount) * 0.18);
      ctx.strokeStyle = _rgba(tone, op);
      ctx.lineWidth = 0.7 + s * 0.18;
      ctx.beginPath();
      const steps = 26;
      for (let i = 0; i <= steps; i++) {
        const tt = i / steps;
        const rr = rIn + tt * (rOut - rIn);
        const a = armPhase + tt * turns * Math.PI * 2 + offset;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // helper: small swirl (mini eddy)
  function drawMiniSwirl(ex: number, ey: number, er: number, eph: number): void {
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < 3; s++) {
      const offset = (s - 1) * 0.18;
      ctx.strokeStyle = _rgba(_lighten(c1, 0.5), 0.32);
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const tt = i / steps;
        const rr = tt * er;
        const a = eph + tt * 1.6 * Math.PI * 2 + offset;
        const px = ex + Math.cos(a) * rr;
        const py = ey + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 1. Dark turbulent backdrop — chaos at low alpha
  ctx.fillStyle = _rgba(_darken(c2, 0.45), 0.45);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
  ctx.fill();

  // 2. Mini eddies — peripheral storms spinning at their own rate
  const eddies = [
    { x: cx - R * 0.45, y: cy - R * 0.32, r: R * 0.16, ph: phase * 1.7 },
    { x: cx + R * 0.50, y: cy + R * 0.18, r: R * 0.20, ph: phase * 1.3 },
    { x: cx + R * 0.18, y: cy - R * 0.55, r: R * 0.12, ph: -phase * 1.9 },
    { x: cx - R * 0.55, y: cy + R * 0.30, r: R * 0.14, ph: -phase * 1.5 },
  ];
  for (const e of eddies) drawMiniSwirl(e.x, e.y, e.r, e.ph);

  // 3. Main spiral arms — 4 arms at different brightness levels
  const arms = 4;
  for (let a = 0; a < arms; a++) {
    const armPhase = phase + (a / arms) * Math.PI * 2;
    // outer wisp arms (faint, long)
    drawSpiralArm(armPhase, R * 0.22, R * 0.92, 1.9, 0.45, 4);
    // bright tighter arms closer to the eye
    drawSpiralArm(armPhase + 0.18, R * 0.18, R * 0.55, 1.4, 0.9, 5);
  }

  // 4. Eyewall — bright ring around the eye (the most intense band)
  const ewR = R * 0.19;
  const ewG = ctx.createRadialGradient(cx, cy, ewR * 0.6, cx, cy, ewR * 1.4);
  ewG.addColorStop(0,   _rgba(_lighten(c1, 0.55), 0));
  ewG.addColorStop(0.5, _rgba(_lighten(c1, 0.55), 0.85));
  ewG.addColorStop(1,   _rgba(_lighten(c1, 0.55), 0));
  ctx.fillStyle = ewG;
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(cx, cy, ewR * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // 5. Calm dark eye — punches a hole through everything above
  const eyeG = ctx.createRadialGradient(cx, cy, 0, cx, cy, ewR * 0.95);
  eyeG.addColorStop(0,   _rgba(_darken(c2, 0.7), 1));
  eyeG.addColorStop(0.6, _rgba(_darken(c2, 0.55), 0.85));
  eyeG.addColorStop(1,   _rgba(_darken(c2, 0.4), 0));
  ctx.fillStyle = eyeG;
  ctx.beginPath();
  ctx.arc(cx, cy, ewR * 0.95, 0, Math.PI * 2);
  ctx.fill();

  // 6. Lightning flash — irregular, brief, every ~3-6s
  // Use sin-based deterministic trigger; flash peaks then decays.
  const lFlash = Math.sin(t * 0.7) * Math.sin(t * 0.33);
  if (lFlash > 0.85) {
    const intensity = (lFlash - 0.85) / 0.15;
    // pick a random-ish position in the storm wall
    const seedT = Math.floor(t * 0.7);
    const ang = seedT * 1.731;
    const lx = cx + Math.cos(ang) * R * 0.4;
    const ly = cy + Math.sin(ang) * R * 0.4;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.35);
    lg.addColorStop(0, `rgba(220,235,255,${intensity * 0.85})`);
    lg.addColorStop(0.5, `rgba(180,200,255,${intensity * 0.4})`);
    lg.addColorStop(1, 'rgba(180,200,255,0)');
    ctx.fillStyle = lg;
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(lx, ly, R * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // bright zigzag bolt
    ctx.strokeStyle = `rgba(240,250,255,${intensity})`;
    ctx.lineWidth = 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const segs = 4;
    let px = lx, py = ly;
    ctx.moveTo(px, py);
    for (let i = 0; i < segs; i++) {
      const jitter = (Math.sin(seedT * 13 + i * 7) * 0.5) * R * 0.08;
      px += Math.cos(ang + i * 0.4) * R * 0.04 + jitter;
      py += Math.sin(ang + i * 0.4) * R * 0.04 + jitter * 0.5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Eye world — entire body is an eye, blinks
function drawEyeWorld(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const c1 = _parseHex(p.palette[0]);
  const c2 = _parseHex(p.palette[1]);
  // blink: scaleY 1 → 0.05 → 1 every 5.5s, only for ~0.25s window
  const cyc = (t % 5.5) / 5.5;
  let scaleY = 1;
  if (cyc > 0.94 && cyc < 0.98) {
    const local = (cyc - 0.94) / 0.04;
    scaleY = local < 0.5 ? 1 - local * 2 * 0.95 : 0.05 + (local - 0.5) * 2 * 0.95;
  }
  // look around — slight offset
  const lookX = Math.sin(t * 0.6) * p.r * 0.05;
  const lookY = Math.cos(t * 0.7) * p.r * 0.03;
  ctx.save();
  ctx.translate(p.cx + lookX, p.cy + lookY);
  ctx.scale(1, scaleY);
  // iris
  let g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r * 0.6);
  g.addColorStop(0, _rgba(_lighten(c1, 0.3), 0.95));
  g.addColorStop(0.6, _rgba(_mix(c1, [212, 168, 87], 0.4), 0.85));
  g.addColorStop(1, _rgba(_darken(c2, 0.3), 0.95));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, p.r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  // iris fibers
  ctx.strokeStyle = _rgba(_darken(c2, 0.4), 0.55);
  ctx.lineWidth = 0.35;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * p.r * 0.18, Math.sin(a) * p.r * 0.18);
    ctx.lineTo(Math.cos(a) * p.r * 0.55, Math.sin(a) * p.r * 0.55);
    ctx.stroke();
  }
  // pupil
  ctx.fillStyle = '#0a0a14';
  ctx.beginPath();
  ctx.arc(0, 0, p.r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // catchlights
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(p.r * 0.08, -p.r * 0.08, p.r * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(-p.r * 0.05, p.r * 0.1, p.r * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Ancient civilization — surface structures
function drawStructures(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const rng = mulberry32(p.seedNum + 131);
  // grid lines (subtle)
  ctx.strokeStyle = 'rgba(220,200,170,0.18)';
  ctx.lineWidth = 0.3;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(p.cx - p.r * 0.85, p.cy + i * p.r * 0.32);
    ctx.lineTo(p.cx + p.r * 0.85, p.cy + i * p.r * 0.32);
    ctx.stroke();
  }
  // city pads
  for (let i = 0; i < 6; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.65;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    if (x < p.cx - p.r * 1.0 || x > p.cx + p.r * 1.0) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rng() - 0.5) * 0.5);
    ctx.fillStyle = 'rgba(255,225,160,0.45)';
    ctx.fillRect(-2, -1.4, 4 + rng() * 3, 2.6 + rng() * 1.5);
    ctx.restore();
  }
  // building lights
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    let x = -p.r + rng() * p.r * 4;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.85;
    x = p.cx - p.r + (((x - p.shift) % (p.r * 4)) + p.r * 4) % (p.r * 4);
    const tw = Math.sin(t * 1.5 + i * 0.7) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255,229,144,${0.85 * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.55 + rng() * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Terminator — sharp day/night divide (mask/twilight)
function drawTerminator(ctx: CanvasRenderingContext2D, p: P, nightColor: RGB): void {
  ctx.fillStyle = `rgba(${nightColor[0]},${nightColor[1]},${nightColor[2]},0.92)`;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  // soft transition strip near the terminator
  const g = ctx.createLinearGradient(p.cx - 1, 0, p.cx + 4, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(${nightColor[0]},${nightColor[1]},${nightColor[2]},0.4)`);
  ctx.fillStyle = g;
  ctx.fillRect(p.cx - 1, p.cy - p.r, 5, p.r * 2);
}

// Inner stars (visible on the dark side of mask/twilight)
function drawInnerStars(ctx: CanvasRenderingContext2D, p: P): void {
  const rng = mulberry32(p.seedNum + 149);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) {
    let x = p.cx + rng() * p.r * 0.85;
    const y = p.cy + (rng() * 2 - 1) * p.r * 0.85;
    if (x < p.cx + 1) x = p.cx + 1 + rng() * p.r * 0.7;
    ctx.globalAlpha = 0.6 + rng() * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rng() * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Dyson sphere — special render
function drawDyson(
  ctx: CanvasRenderingContext2D,
  p: { cx: number; cy: number },
  t: number,
  size: number,
): void {
  const cx = p.cx, cy = p.cy;
  const r = size * 0.42;
  // corona pulse
  const cp = 1 + Math.sin(t * 1.2) * 0.08;
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5 * cp);
  g.addColorStop(0, 'rgba(255,176,112,0.42)');
  g.addColorStop(0.5, 'rgba(255,140,80,0.12)');
  g.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.5 * cp, 0, Math.PI * 2);
  ctx.fill();
  // central star
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5);
  g.addColorStop(0, '#fffce8');
  g.addColorStop(0.4, '#ffd89a');
  g.addColorStop(1, 'rgba(240,150,106,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // bright core
  ctx.fillStyle = '#fffce8';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // rotating beams
  const beamPhase = t * 0.18;
  ctx.strokeStyle = 'rgba(240,140,109,0.5)';
  ctx.lineWidth = 0.4;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + beamPhase;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35);
    ctx.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
    ctx.stroke();
  }
  // outer ring
  ctx.strokeStyle = 'rgba(240,140,109,0.6)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  // hex panels — staggered glow
  const hexPhase = -t * 0.06;
  const hexRing = r * 0.75;
  const hsize = Math.max(2.5, size * 0.05);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + hexPhase;
    const x = cx + Math.cos(a) * hexRing;
    const y = cy + Math.sin(a) * hexRing;
    const glow = Math.sin(t * 2.6 + i * (Math.PI * 2 / 8)) * 0.5 + 0.5;
    const op = 0.4 + glow * 0.6;
    ctx.fillStyle = `rgba(240,140,109,${0.16 + op * 0.18})`;
    ctx.strokeStyle = `rgba(240,140,109,${0.7 + op * 0.3})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ha = (k / 6) * Math.PI * 2 - Math.PI / 2;
      const hx = x + Math.cos(ha) * hsize;
      const hy = y + Math.sin(ha) * hsize;
      if (k === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ─────────── ring system (saturn-style) ───────────
function drawRings(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
  animated: boolean,
  ringPhase: number,
): void {
  const f = planet.features as Record<string, any>;
  const ringConf = f && f.rings;
  if (!ringConf || ringConf === true) return;
  const baseTilt = ringConf.tilt || 0.32;
  const color = _parseHex(ringConf.color || '#d8b078');
  const count = ringConf.count || 2;
  const radii: number[] = ringConf.radii || [1.4, 1.7];
  const thin = !!ringConf.thin;
  // Spinning ring: rotate freely around the planet, and wobble its tilt
  // so it tumbles (up/down/left/right) rather than just spinning in 2D.
  const spin = !!ringConf.spin;
  const wobble = !!ringConf.wobble;
  const rot = spin && animated ? t * 0.35 : ringPhase * 0.05;
  const tilt = wobble && animated
    ? baseTilt + Math.sin(t * 0.6) * 0.18 * baseTilt + Math.cos(t * 0.4) * 0.12 * baseTilt
    : baseTilt;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  for (let i = 0; i < count; i++) {
    const rad = (radii[i] || (1.4 + i * 0.2)) * r;
    const fade = i / count;
    const alpha = thin ? 0.45 : (0.6 - fade * 0.15);
    ctx.strokeStyle = _rgba(color, alpha);
    ctx.lineWidth = thin ? 1.4 : (2.0 - i * 0.25);
    ctx.beginPath();
    ctx.ellipse(0, 0, rad, rad * tilt, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (!thin) {
      ctx.strokeStyle = _rgba(_lighten(color, 0.3), alpha * 0.5);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, rad * 1.06, rad * 1.06 * tilt, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Orbiting moon — hidden when it passes behind the planet
function drawMoon(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
  animated: boolean,
): void {
  const f = planet.features as Record<string, any>;
  const mc = f && f.moon;
  if (!mc) return;
  const dist = r * (mc.distance || 1.6);
  const moonR = r * (mc.size || 0.14);
  const speed = mc.speed || 0.4;
  const angle = (animated ? t * speed : 0) + (planet.id.length * 0.7);
  const mx = cx + Math.cos(angle) * dist;
  const my = cy + Math.sin(angle) * dist * 0.4;
  const mColor = _parseHex(mc.color || '#bbbbbb');
  const isBehind = Math.sin(angle) < 0;

  // When the moon is on the far side of its orbit, clip to OUTSIDE the
  // planet so the body occludes the moon naturally.
  ctx.save();
  if (isBehind) {
    const cv = ctx.canvas;
    // Use full canvas rect minus the planet circle (evenodd) as clip.
    ctx.beginPath();
    ctx.rect(0, 0, cv.width, cv.height);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip('evenodd');
  }
  const g = ctx.createRadialGradient(
    mx - moonR * 0.35, my - moonR * 0.35, 0,
    mx, my, moonR
  );
  g.addColorStop(0, _rgba(_lighten(mColor, 0.45), 1));
  g.addColorStop(0.5, _rgba(mColor, 1));
  g.addColorStop(1, _rgba(_darken(mColor, 0.4), 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(mx, my, moonR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  ctx.arc(mx + moonR * 0.32, my + moonR * 0.32, moonR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// Star reflections on mirror planet surface
function drawReflections(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
): void {
  const rng = mulberry32(seedFromId(planet.id) + 211);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.85;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const tw = Math.sin(t * 2 + i) * 0.4 + 0.6;
    const sz = (0.4 + rng() * 1.2) * tw;
    ctx.fillStyle = `rgba(255,255,255,${(0.55 + rng() * 0.35) * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// Dust storm for desert worlds — large swirling tan cloud
function drawDustStorm(ctx: CanvasRenderingContext2D, p: P, t: number): void {
  const phase = t * 0.25;
  const sx = p.cx + p.r * 0.28;
  const sy = p.cy + p.r * 0.15;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(phase);
  const c1 = _parseHex(p.palette[0]);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r * 0.4);
  g.addColorStop(0, _rgba(_lighten(c1, 0.5), 0.55));
  g.addColorStop(0.6, _rgba(c1, 0.3));
  g.addColorStop(1, _rgba(c1, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, p.r * 0.32, p.r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = _rgba(_lighten(c1, 0.35), 0.5);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 8; i++) {
    const a1 = (i / 8) * Math.PI * 2;
    const a2 = a1 + 0.6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a1) * p.r * 0.32, Math.sin(a1) * p.r * 0.16);
    ctx.quadraticCurveTo(
      Math.cos((a1 + a2) / 2) * p.r * 0.2, Math.sin((a1 + a2) / 2) * p.r * 0.1,
      Math.cos(a2) * p.r * 0.1, Math.sin(a2) * p.r * 0.05
    );
    ctx.stroke();
  }
  ctx.restore();
}

// ─────────── special planet shape renderers ───────────

// Gem planet — faceted polyhedron silhouette
function drawGemPlanet(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
  size: number,
  animated: boolean,
): void {
  const f = (planet.features || {}) as Record<string, any>;
  const c1 = _parseHex(planet.palette[0]);
  const c2 = _parseHex(planet.palette[1]);
  // (c3 derived but unused in original; preserved for parity)
  const sides: number = f.gemSides || 6;
  const gemR = r * 1.06;
  const phase = animated ? t * 0.18 : 0;
  let g;
  // outer glow
  g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.7);
  g.addColorStop(0, _rgba(c1, f.glow ? 0.42 : 0.2));
  g.addColorStop(1, _rgba(c1, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
  ctx.fill();
  // polygon corners
  const corners: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2 + phase;
    corners.push([cx + Math.cos(a) * gemR, cy + Math.sin(a) * gemR]);
  }
  function polyPath(): void {
    ctx.beginPath();
    corners.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.closePath();
  }
  // body radial gradient
  g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.32, 0, cx, cy, gemR * 1.1);
  g.addColorStop(0,    _rgba(_lighten(c1, 0.6), 1));
  g.addColorStop(0.18, _rgba(_lighten(c1, 0.28), 1));
  g.addColorStop(0.4,  _rgba(c1, 1));
  g.addColorStop(0.72, _rgba(_mix(c1, c2, 0.55), 1));
  g.addColorStop(1,    _rgba(_darken(c2, 0.2), 1));
  ctx.fillStyle = g;
  polyPath();
  ctx.fill();
  // facet wedges (alternating bright/dark)
  ctx.save();
  polyPath();
  ctx.clip();
  for (let i = 0; i < sides; i++) {
    const a1 = (i / sides) * Math.PI * 2 - Math.PI / 2 + phase;
    const a2 = ((i + 1) / sides) * Math.PI * 2 - Math.PI / 2 + phase;
    const x1 = cx + Math.cos(a1) * gemR;
    const y1 = cy + Math.sin(a1) * gemR;
    const x2 = cx + Math.cos(a2) * gemR;
    const y2 = cy + Math.sin(a2) * gemR;
    const isBright = i % 2 === 0;
    const tone = isBright ? _lighten(c1, 0.28) : _darken(c2, 0.15);
    const mid: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const wg = ctx.createLinearGradient(cx, cy, mid[0], mid[1]);
    wg.addColorStop(0, _rgba(tone, 0));
    wg.addColorStop(1, _rgba(tone, isBright ? 0.4 : 0.32));
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  }
  // facet edge lines
  ctx.strokeStyle = _rgba(_lighten(c1, 0.7), 0.45);
  ctx.lineWidth = 0.55;
  for (const [x, y] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  // inner darker core
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gemR * 0.45);
  g.addColorStop(0, _rgba(_darken(c2, 0.4), 0.45));
  g.addColorStop(1, _rgba(_darken(c2, 0.4), 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, gemR * 0.45, 0, Math.PI * 2);
  ctx.fill();
  // top-left specular
  g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.45);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  // silhouette stroke
  ctx.strokeStyle = _rgba(_lighten(c1, 0.65), 0.7);
  ctx.lineWidth = 0.9;
  polyPath();
  ctx.stroke();
  // sparkle
  if (f.sparkle) {
    const rng = mulberry32(seedFromId(planet.id) + 113);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const tw = Math.sin(t * 2.5 + i * 1.7) * 0.5 + 0.5;
      const sx = cx + (rng() - 0.5) * r * 1.2;
      const sy = cy + (rng() - 0.5) * r * 1.2;
      const sz = (0.6 + rng() * 1.0) * (0.5 + tw);
      ctx.strokeStyle = `rgba(255,255,255,${0.45 + tw * 0.5})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(sx - sz * 2.5, sy); ctx.lineTo(sx + sz * 2.5, sy);
      ctx.moveTo(sx, sy - sz * 2.5); ctx.lineTo(sx, sy + sz * 2.5);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.7 + tw * 0.3})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sz * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // prism halo for diamond
  if (f.prism) {
    ctx.globalCompositeOperation = 'lighter';
    const colors = ['#ff8a8a', '#ffd28a', '#ffe88a', '#8aff8a', '#8acaff', '#a08aff'];
    for (let i = 0; i < colors.length; i++) {
      const ang = (i / colors.length) * Math.PI * 2 + t * 0.1;
      const px = cx + Math.cos(ang) * r * 1.25;
      const py = cy + Math.sin(ang) * r * 1.25;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, r * 0.4);
      pg.addColorStop(0, _rgba(_parseHex(colors[i]), 0.55));
      pg.addColorStop(1, _rgba(_parseHex(colors[i]), 0));
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Split planet — half day, half night. The body rotates so the terminator
// (day/night divide) spins around the planet over time.
function drawSplitPlanet(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
  _size: number,
  animated: boolean,
): void {
  const f = (planet.features || {}) as Record<string, any>;
  const dayColor = _parseHex(f.dayColor || planet.palette[0]);
  const nightColor = _parseHex(f.nightColor || planet.palette[1]);
  const rng = mulberry32(seedFromId(planet.id));
  const axisDur = 14 + (seedFromId(planet.id) % 8); // 14-22s for visible rotation
  const phase = animated ? (t / axisDur) * Math.PI * 2 : 0;
  let g;
  // outer glow
  g = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.6);
  g.addColorStop(0, _rgba(dayColor, 0.3));
  g.addColorStop(1, _rgba(dayColor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  // body — clipped to circle, contents rotated by phase
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(phase);
  ctx.translate(-cx, -cy);
  // day side (left half within rotated frame)
  g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.3, 0, cx - r * 0.4, cy, r * 1.3);
  g.addColorStop(0, _rgba(_lighten(dayColor, 0.4), 1));
  g.addColorStop(0.4, _rgba(dayColor, 1));
  g.addColorStop(1, _rgba(_darken(dayColor, 0.45), 1));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 1.2, cy - r * 1.2, r * 1.2, r * 2.4);
  // night side (right half within rotated frame)
  g = ctx.createRadialGradient(cx + r * 0.5, cy, 0, cx + r * 0.5, cy, r * 1.3);
  g.addColorStop(0, _rgba(_lighten(nightColor, 0.1), 1));
  g.addColorStop(0.6, _rgba(nightColor, 1));
  g.addColorStop(1, _rgba(_darken(nightColor, 0.5), 1));
  ctx.fillStyle = g;
  ctx.fillRect(cx, cy - r * 1.2, r * 1.2, r * 2.4);
  // night-side small lights
  if (f.nightStars || f.nightLights) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      const sx = cx + 0.15 * r + rng() * r * 0.78;
      const sy = cy + (rng() * 2 - 1) * r * 0.88;
      const dx = (sx - cx) / r, dy = (sy - cy) / r;
      if (dx * dx + dy * dy > 0.94) continue;
      const tw = Math.sin(t * 1.5 + i * 0.7) * 0.3 + 0.7;
      const sz = 0.5 + rng() * 0.7;
      ctx.fillStyle = `rgba(255,225,160,${(0.7 + rng() * 0.3) * tw})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // day-side highlight
  if (f.dayHighlight) {
    g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 1.2, cy - r * 1.2, r * 1.2, r * 2.4);
  }
  // bright filament along the terminator (vertical line at cx in body frame)
  ctx.strokeStyle = _rgba(_lighten(dayColor, 0.6), 0.65);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.99);
  ctx.lineTo(cx, cy + r * 0.99);
  ctx.stroke();
  ctx.restore();
  // limb darkening — drawn in screen space (not rotated)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  g = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.85, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

// Flower planet — 6-petal silhouette (botanical)
function drawFlowerPlanet(
  ctx: CanvasRenderingContext2D,
  planet: PlanetSpec,
  t: number,
  cx: number,
  cy: number,
  r: number,
  _size: number,
  animated: boolean,
): void {
  const c1 = _parseHex(planet.palette[0]);
  const c2 = _parseHex(planet.palette[1]);
  const phase = animated ? t * 0.12 : 0;
  let g;
  g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.8);
  g.addColorStop(0, _rgba(c1, 0.32));
  g.addColorStop(1, _rgba(c1, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    const ang = (i / petals) * Math.PI * 2 + phase;
    const px = cx + Math.cos(ang) * r * 0.5;
    const py = cy + Math.sin(ang) * r * 0.5;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang + Math.PI / 2);
    const pg = ctx.createRadialGradient(0, -r * 0.35, 0, 0, 0, r * 0.55);
    pg.addColorStop(0, _rgba(_lighten(c1, 0.35), 1));
    pg.addColorStop(0.6, _rgba(c1, 1));
    pg.addColorStop(1, _rgba(_darken(c2, 0.1), 0));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.42, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = _rgba(_darken(c2, 0.3), 0.35);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.6);
    ctx.lineTo(0, r * 0.4);
    ctx.stroke();
    ctx.restore();
  }
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.45);
  g.addColorStop(0, 'rgba(255,232,160,1)');
  g.addColorStop(0.55, _rgba(_lighten(c1, 0.45), 0.9));
  g.addColorStop(1, _rgba(c1, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + phase * 2;
    const dr = r * 0.18;
    ctx.fillStyle = 'rgba(255,235,140,0.95)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * dr, cy + Math.sin(a) * dr, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ─────────── main mount function ───────────

export function mountPlanetCanvas(
  host: HTMLElement,
  spec: PlanetSpec,
  opts: PlanetCanvasOptions = {},
): PlanetCanvasHandle {
  const size = opts.size ?? 72;
  const animated = opts.animated ?? true;
  const f = (spec.features || {}) as Record<string, any>;

  // Black hole dispatch — delegate to the dedicated module.
  if (f.shape === 'blackhole') {
    return mountBlackholeCanvas(host, {
      size,
      particles: Math.max(80, Math.floor(size * 1.4)),
      animated,
      bgStars: false,
    });
  }

  const cv = document.createElement('canvas');
  cv.className = 'planet-orb-canvas';
  const ctx = cv.getContext('2d');
  if (!ctx) {
    // No 2D context available; return a no-op handle.
    host.appendChild(cv);
    return { dispose() { if (cv.parentNode === host) host.removeChild(cv); } };
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = size * dpr;
  cv.height = size * dpr;
  cv.style.width = size + 'px';
  cv.style.height = size + 'px';
  host.appendChild(cv);

  const cx = size / 2;
  const cy = size / 2;
  // Shrink body when the planet has features that extend outside it (rings,
  // moon) — otherwise they get clipped at the canvas edge.
  const hasExternals = !!(f.rings || f.moon);
  const r = size * (hasExternals ? 0.28 : 0.36);
  const seedNum = seedFromId(spec.id);
  const rotDur = 22 + (seedNum % 18); // 22–40s

  const NO_AXIS = new Set<string>(['eye_world', 'dyson_sphere', 'mask']);

  function render(t: number): void {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Dyson sphere is fully custom
    if (f.dyson) {
      drawDyson(ctx, { cx, cy }, t, size);
      return;
    }

    // Gemstone planets — faceted polyhedron silhouette, no sphere
    if (f.shape === 'gem') {
      drawGemPlanet(ctx, spec, t, cx, cy, r, size, animated);
      return;
    }

    // Split-face planets (mask) — half day / half night
    if (f.shape === 'split') {
      drawSplitPlanet(ctx, spec, t, cx, cy, r, size, animated);
      return;
    }

    // Flower planet (botanical) — pearl-petal silhouette
    if (f.shape === 'flower') {
      drawFlowerPlanet(ctx, spec, t, cx, cy, r, size, animated);
      return;
    }

    const c1 = _parseHex(spec.palette[0]);
    const c2 = _parseHex(spec.palette[1]);
    const c3 = _parseHex(spec.palette[2] || spec.palette[1]);

    // outer glow (atmospheric scatter)
    const glowR = r * 1.5;
    let g = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, glowR);
    g.addColorStop(0, _rgba(c1, f.glow ? 0.38 : 0.16));
    g.addColorStop(1, _rgba(c1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // atmospheric halo (cyan ring outside body)
    if (f.atmo) {
      const ar = r * 1.08;
      g = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, ar);
      const atmo = _lighten(c1, 0.5);
      g.addColorStop(0, _rgba(atmo, 0));
      g.addColorStop(0.5, _rgba(atmo, 0.55));
      g.addColorStop(1, _rgba(atmo, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, ar, 0, Math.PI * 2);
      ctx.fill();
    }

    // body — rich multi-stop radial gradient (sphere shading from top-left light)
    g = ctx.createRadialGradient(
      cx - r * 0.32, cy - r * 0.36, 0,
      cx, cy, r * 1.05
    );
    g.addColorStop(0,    _rgba(_lighten(c1, 0.45), 1));
    g.addColorStop(0.15, _rgba(_lighten(c1, 0.18), 1));
    g.addColorStop(0.38, _rgba(c1, 1));
    g.addColorStop(0.65, _rgba(_mix(c1, c2, 0.5), 1));
    g.addColorStop(0.88, _rgba(c2, 1));
    g.addColorStop(1,    _rgba(_mix(c2, c3, 0.55), 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // surface (clipped to body)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.3, 0, Math.PI * 2);
    ctx.clip();

    // axial rotation phase (fraction of full rotation 0..1) → shift in px
    const shift = (animated && !NO_AXIS.has(spec.id))
      ? ((t / rotDur) % 1) * r * 4
      : 0;
    const p: P = { cx, cy, r, palette: spec.palette, seedNum, shift };

    // base mottling — subtle color variation on body
    drawMottling(ctx, p, 18);

    // feature passes (axial-aware)
    if (f.bands) drawBands(ctx, p);
    if (f.spot) drawSpot(ctx, p);
    if (f.rainbow) drawRainbow(ctx, p);
    if (f.iridescent) drawIridescent(ctx, p, t);
    if (f.continents) drawContinents(ctx, p, f.continentColor || '#3a7a4a');
    if (f.dunes) drawDunes(ctx, p);
    if (f.dustStorm) drawDustStorm(ctx, p, t);
    if (f.maze) drawMaze(ctx, p);
    if (f.craters) drawCraters(ctx, p);
    if (f.veins && !f.dense_veins) drawVeins(ctx, p, t);
    if (f.dense_veins) drawDenseVeins(ctx, p, t);
    if (f.lavaSurface) drawLavaSurface(ctx, p, t);
    if (f.hotspots) drawHotspots(ctx, p, t);
    if (f.megaVolcano) drawMegaVolcano(ctx, p, t);
    if (f.ioSpots) drawIoSpots(ctx, p, t);
    if (f.cityLights && !f.denseCities) drawCityLights(ctx, p, t);
    if (f.denseCities) drawDenseCities(ctx, p, t);
    if (f.structures) drawStructures(ctx, p, t);
    if (f.clouds) drawClouds(ctx, p);
    if (f.grid) drawGrid(ctx, p, t);
    if (f.mysticAura) drawMysticAura(ctx, p, t);
    if (f.runes) drawRunes(ctx, p, t);
    if (f.duskTerminator) drawDuskTerminator(ctx, p, t);
    if (f.nightLights) drawNightLights(ctx, p, t);
    if (f.slowSurface) drawSlowSurface(ctx, p, t);

    // night-side rendering
    if (f.terminator) {
      const nightColor: RGB = f.nightColor ? _parseHex(f.nightColor) : _darken(c2, 0.5);
      drawTerminator(ctx, p, nightColor);
    }
    if (f.innerStars) drawInnerStars(ctx, p);

    // bigEye — replaces normal body face
    if (f.bigEye) drawEyeWorld(ctx, p, t);

    // vortex — replaces normal body face
    if (f.vortex) drawVortex(ctx, p, t);

    // facets / sparkle (static-ish)
    if (f.facets) drawFacets(ctx, p);
    if (f.sparkle) drawSparkle(ctx, p, t);

    // polar caps (axis-locked, not affected by rotation)
    if (f.polar) drawPolar(ctx, p);

    ctx.restore();

    // sphere shadow (gives the body 3D feel)
    g = ctx.createRadialGradient(
      cx + r * 0.45, cy + r * 0.45, r * 0.2,
      cx, cy, r * 1.1
    );
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // limb darkening — dark ring around the edge
    g = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.85, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // rim light on the lit side
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    g = ctx.createRadialGradient(
      cx - r * 0.7, cy - r * 0.6, 0,
      cx - r * 0.7, cy - r * 0.6, r * 1.4
    );
    g.addColorStop(0, _rgba(_lighten(c1, 0.6), f.glow ? 0.45 : 0.25));
    g.addColorStop(0.4, _rgba(_lighten(c1, 0.3), 0));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // specular gleam (top-left)
    g = ctx.createRadialGradient(
      cx - r * 0.42, cy - r * 0.42, 0,
      cx - r * 0.42, cy - r * 0.42, r * 0.45
    );
    g.addColorStop(0, _rgba(_lighten(c1, 0.6), f.highlight ? 0.6 : 0.3));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // ring (richer, object-form)
    if (f.rings) {
      const ringPhase = animated ? t / (rotDur * 1.8) : 0;
      drawRings(ctx, spec, t, cx, cy, r, animated, ringPhase);
    }

    // moon orbits — outside the body
    if (f.moon) {
      drawMoon(ctx, spec, t, cx, cy, r, animated);
    }

    // mirror reflections (star pattern on surface)
    if (f.reflections) {
      drawReflections(ctx, spec, t, cx, cy, r);
    }
  }

  const start = performance.now();
  let raf = 0;
  let disposed = false;

  function loop(): void {
    if (disposed) return;
    const t = (performance.now() - start) / 1000;
    render(t);
    if (animated) raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    dispose(): void {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (cv.parentNode === host) host.removeChild(cv);
    },
  };
}
