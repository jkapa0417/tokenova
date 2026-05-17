// 잠든 우주 — the "rest day" canvas shown when a day ends with zero tokens.
// Replaces the previous `.blackhole-day` CSS overlay (saturn-ring + dark
// sphere). The new aesthetic is a quiet purple/blue cosmic mist + drifting
// nebula wisps + 70 twinkling stars + breathing crescent moon + floating
// "Z" letters. Ported from the design's `RestDayCanvas` (app.jsx:272-422).
//
// Usage:
//   const handle = mountSleepingUniverse(wrapEl);
//   ... later
//   handle.dispose();

interface Star {
  x: number;
  y: number;
  rad: number;
  op: number;
  tw: number;
  twSpeed: number;
}

export interface SleepingHandle {
  dispose(): void;
}

export function mountSleepingUniverse(host: HTMLElement): SleepingHandle {
  // Replace any prior child with a fresh canvas — host may have held the
  // universe canvas plus planet overlay before. We expect the caller to
  // hide / remove those before mounting.
  const canvas = document.createElement("canvas");
  canvas.className = "sleeping-canvas";
  host.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dispose: () => canvas.remove() };
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // Re-seed stars only when the wrap size meaningfully changes — keeps the
  // field stable on resize ticks.
  let stars: Star[] = [];
  let cachedSize = { w: 0, h: 0 };

  function sizeCanvas() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === cachedSize.w && h === cachedSize.h) return { w, h };
    cachedSize = { w, h };
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    stars = [];
    for (let i = 0; i < 70; i++) {
      const r = Math.random();
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        rad: 0.4 + Math.pow(r, 3) * 1.6,
        op: 0.3 + Math.random() * 0.6,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.3 + Math.random() * 0.8,
      });
    }
    return { w, h };
  }

  const start = performance.now();
  let raf = 0;
  let running = true;

  function render() {
    if (!running || !ctx) return;
    const { w, h } = sizeCanvas();
    const cx = w / 2;
    const cy = h * 0.42;
    const t = (performance.now() - start) / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070912";
    ctx.fillRect(0, 0, w, h);

    // Cosmic mist behind the moon — purple/blue radial gradient.
    {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.55);
      g.addColorStop(0, "rgba(130, 150, 220, 0.18)");
      g.addColorStop(0.5, "rgba(110, 110, 180, 0.06)");
      g.addColorStop(1, "rgba(80, 60, 120, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Drifting nebula wisps (additive blending so they layer like real gas).
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const wt = t * 0.05 + i * 1.7;
      const wx = cx + Math.cos(wt) * 120;
      const wy = cy + Math.sin(wt * 0.7) * 60;
      const wr = 50 + i * 20;
      const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
      const tone = i % 2 === 0 ? "rgba(140,160,230," : "rgba(180,140,220,";
      wg.addColorStop(0, tone + "0.12)");
      wg.addColorStop(1, tone + "0)");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(wx, wy, wr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // Twinkling stars — combination of slow base twinkle + faster micro-flicker.
    for (const s of stars) {
      const tw = Math.sin(t * s.twSpeed + s.tw) * 0.35 + 0.65;
      const micro = Math.sin(t * s.twSpeed * 3 + s.tw * 2) * 0.18;
      const a = Math.max(0.05, s.op * (tw + micro));
      if (s.rad > 1.2) {
        const g2 = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.rad * 4);
        g2.addColorStop(0, `rgba(255,255,255,${a * 0.4})`);
        g2.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.rad * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Breathing crescent moon at center.
    const breath = Math.sin(t * 0.6) * 0.04 + 0.96;
    const moonR = 64 * breath;

    // Moon glow.
    {
      const mg = ctx.createRadialGradient(cx, cy, moonR, cx, cy, moonR * 2.4);
      mg.addColorStop(0, "rgba(255, 235, 200, 0.4)");
      mg.addColorStop(0.4, "rgba(255, 220, 180, 0.15)");
      mg.addColorStop(1, "rgba(255, 200, 150, 0)");
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(cx, cy, moonR * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Moon body, lit from top-left.
    {
      const bg = ctx.createRadialGradient(
        cx - moonR * 0.35, cy - moonR * 0.4, 0,
        cx, cy, moonR,
      );
      bg.addColorStop(0,    "#fff8e8");
      bg.addColorStop(0.4,  "#f4e8c8");
      bg.addColorStop(0.85, "#e0c89a");
      bg.addColorStop(1,    "#9a8060");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, moonR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crescent shadow — same color as the bg, offset right.
    ctx.fillStyle = "#070912";
    ctx.beginPath();
    ctx.arc(cx + moonR * 0.45, cy - moonR * 0.05, moonR * 0.94, 0, Math.PI * 2);
    ctx.fill();

    // Soft inner edge highlight along the crescent.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, moonR, 0, Math.PI * 2);
    ctx.clip();
    {
      const eg = ctx.createRadialGradient(
        cx + moonR * 0.45, cy - moonR * 0.05, moonR * 0.7,
        cx + moonR * 0.45, cy - moonR * 0.05, moonR * 1.1,
      );
      eg.addColorStop(0, "rgba(255,235,200,0)");
      eg.addColorStop(0.85, "rgba(255,235,200,0.18)");
      eg.addColorStop(1, "rgba(255,235,200,0)");
      ctx.fillStyle = eg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // Floating "Z" letters drifting upward from the moon's shoulder.
    ctx.textAlign = "center";
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.25 + i * 0.5) % 3;
      const op = phase < 0.3 ? phase / 0.3 : phase > 2.6 ? (3 - phase) / 0.4 : 1;
      const zy = cy - moonR - 18 - phase * 24;
      const zx = cx + moonR * 0.6 + Math.sin(phase * 2 + i) * 12;
      const sz = 16 + i * 6;
      ctx.font = `500 ${sz}px var(--font-mono, monospace)`;
      ctx.fillStyle = `rgba(255,235,200,${0.55 * op})`;
      ctx.fillText("Z", zx, zy);
    }

    raf = requestAnimationFrame(render);
  }

  raf = requestAnimationFrame(render);

  return {
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
