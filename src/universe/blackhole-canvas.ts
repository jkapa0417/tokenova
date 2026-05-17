// Tokenova — animated black hole canvas component.
// Renders the event horizon + photon ring + accretion disk + light-bending arc.
//
// Ported from the design's `blackhole.jsx`. Mounted as a regular DOM canvas
// (not React) so it slots into the codex card / discovery overlay / inline
// universe pin layers without React's reconciliation overhead.

export interface BlackholeCanvasOptions {
  size?: number;
  particles?: number;
  /** When false the surrounding starfield is skipped — codex cards omit it. */
  bgStars?: boolean;
  animated?: boolean;
}

export interface BlackholeHandle {
  dispose(): void;
}

export function mountBlackholeCanvas(
  host: HTMLElement,
  opts: BlackholeCanvasOptions = {},
): BlackholeHandle {
  const size = opts.size ?? 280;
  const particleCount = opts.particles ?? 320;
  const showBgStars = opts.bgStars ?? false;
  const animated = opts.animated ?? true;

  const canvas = document.createElement("canvas");
  canvas.className = "planet-orb-canvas";
  host.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dispose: () => canvas.remove() };
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const cx = size / 2;
  const cy = size / 2;
  const horizonR = size * 0.16;
  const photonR = size * 0.20;
  const diskInner = size * 0.22;
  const diskOuter = size * 0.46;
  const tilt = 0.32;

  interface Particle {
    r: number;
    a: number;
    v: number;
    b: number;
    twPhase: number;
  }
  const parts: Particle[] = [];
  for (let i = 0; i < particleCount; i++) {
    const r = diskInner + Math.pow(Math.random(), 0.7) * (diskOuter - diskInner);
    const v = 0.018 / Math.sqrt(r / diskInner);
    parts.push({
      r,
      a: Math.random() * Math.PI * 2,
      v,
      b: 0.45 + Math.random() * 0.55,
      twPhase: Math.random() * Math.PI * 2,
    });
  }

  interface BgStar { x: number; y: number; r: number; o: number }
  const bgStars: BgStar[] = [];
  if (showBgStars) {
    for (let i = 0; i < 48; i++) {
      bgStars.push({
        x: Math.random() * size,
        y: Math.random() * size,
        r: 0.3 + Math.random() * 0.7,
        o: 0.25 + Math.random() * 0.4,
      });
    }
  }

  const start = performance.now();
  let raf = 0;
  let running = true;

  function drawParticle(p: Particle, t: number) {
    if (!ctx) return;
    const x = cx + Math.cos(p.a) * p.r;
    const y = cy + Math.sin(p.a) * p.r * tilt;
    const closeness = 1 - (p.r - diskInner) / (diskOuter - diskInner);
    const tw = Math.sin(t * 2.5 + p.twPhase) * 0.15 + 0.85;
    const alpha = p.b * tw * (0.65 + closeness * 0.35);
    const r = 230 - Math.round(closeness * 30);
    const g = 170 + Math.round(closeness * 60);
    const b = 90 + Math.round(closeness * 100);
    const sz = 0.4 + closeness * 1.3 + tw * 0.3;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    if (!ctx || !running) return;
    const t = (performance.now() - start) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (showBgStars) {
      for (const s of bgStars) {
        ctx.fillStyle = `rgba(255,255,255,${s.o})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Outer warm halo — soft glow around the disk.
    {
      const halo = ctx.createRadialGradient(cx, cy, horizonR, cx, cy, size * 0.55);
      halo.addColorStop(0, "rgba(255,180,100,0.0)");
      halo.addColorStop(0.5, "rgba(255,170,90,0.05)");
      halo.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Split particles into back/front of the horizon plane.
    const back: Particle[] = [];
    const front: Particle[] = [];
    for (const p of parts) {
      if (Math.sin(p.a) < 0) back.push(p);
      else front.push(p);
    }

    // Back half — drawn before the horizon so the event horizon occludes it.
    ctx.globalCompositeOperation = "lighter";
    for (const p of back) drawParticle(p, t);
    ctx.globalCompositeOperation = "source-over";

    // Photon ring (pulsing) just outside the horizon.
    const ringPulse = Math.sin(t * 1.3) * 0.04;
    const ringR = photonR * (1 + ringPulse);
    {
      const ringGrad = ctx.createRadialGradient(cx, cy, horizonR, cx, cy, ringR + 2);
      ringGrad.addColorStop(0, "rgba(0,0,0,0)");
      ringGrad.addColorStop(0.65, "rgba(255,210,150,0.3)");
      ringGrad.addColorStop(0.9, "rgba(255,230,170,0.85)");
      ringGrad.addColorStop(1, "rgba(255,230,170,0)");
      ctx.fillStyle = ringGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Event horizon — pitch black core.
    {
      const hG = ctx.createRadialGradient(cx, cy, 0, cx, cy, horizonR + 0.5);
      hG.addColorStop(0, "#000");
      hG.addColorStop(0.9, "#000");
      hG.addColorStop(1, "#020205");
      ctx.fillStyle = hG;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gravitational lensing crescent — light from the back of the disk bent
    // over the top of the event horizon. Three stacked strokes give it depth.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let pass = 0; pass < 3; pass++) {
      const w = [2.8, 1.4, 0.7][pass];
      const o = [0.18, 0.42, 0.95][pass];
      ctx.strokeStyle = `rgba(255,225,170,${o * (0.9 + Math.sin(t * 1.1) * 0.08)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.ellipse(cx, cy - horizonR * 0.32, horizonR * 1.08, horizonR * 0.18, 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Front half of the disk — sits on top of the horizon.
    ctx.globalCompositeOperation = "lighter";
    for (const p of front) drawParticle(p, t);
    ctx.globalCompositeOperation = "source-over";

    // Crisp thin photon ring stroke.
    ctx.strokeStyle = `rgba(255,230,180,${0.55 + Math.sin(t * 1.3) * 0.15})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, photonR * (1 + ringPulse * 0.5), 0, Math.PI * 2);
    ctx.stroke();

    // Advance orbits.
    for (const p of parts) p.a += p.v;

    if (animated) raf = requestAnimationFrame(render);
  }
  render();

  return {
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
