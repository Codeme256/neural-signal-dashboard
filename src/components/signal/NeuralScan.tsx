import { useEffect, useRef } from "react";

const FILLERS = ["EUR", "USD", "GBP", "JPY", "AUD", "CHF", "CAD", "NZD", "XAU", "BTC"];

/**
 * Scan-in-progress animation: market symbols orbit an input layer, signals pulse through a
 * hidden layer into a core that shows scan progress, a radar sweep lights up nodes and a
 * price line scrolls underneath. Purely decorative — it never shows or invents prices.
 */
export function NeuralScan({ progress, symbols, active, className }: { progress: number; symbols: string[]; active: string[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ progress, symbols, active });
  live.current = { progress, symbols, active };

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const C = {
      node: v("--neural-node", "#3ef"), link: v("--neural-link", "#3ef"), primary: v("--primary", "#3ef"),
      bull: v("--bull", "#4f8"), bear: v("--bear", "#f55"), muted: v("--muted-foreground", "#889"), fg: v("--foreground", "#eee"),
    };
    const mono = css.getPropertyValue("--font-mono").trim() || "monospace";
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const speed = reduce ? 0.25 : 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, t = 0;
    let shown = 0; // eased progress for the core ring

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const HIDDEN = 8;
    const pulses: { from: number; hidden: number; t: number; color: string }[] = [];
    const glow = new Map<number, number>(); // outer node index -> highlight 0..1
    let line = Array.from({ length: 80 }, (_, i) => Math.sin(i / 6) * 0.3);

    const frame = () => {
      t += 0.016 * speed;
      const { symbols: syms, active: act, progress: prog } = live.current;
      const labels = syms.length >= 8 ? syms.slice(0, 14) : [...syms, ...FILLERS.filter((f) => !syms.includes(f))].slice(0, 8);
      const activeSet = new Set(act);
      const n = labels.length;
      const cx = w / 2, cy = h / 2 - 8;
      const rx = Math.min(w * 0.4, 260), ry = Math.min(h * 0.36, 90);
      const spin = t * 0.15;

      const outer = labels.map((_, i) => {
        const a = (i / n) * Math.PI * 2 + spin;
        return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a };
      });
      const hidden = Array.from({ length: HIDDEN }, (_, i) => {
        const a = (i / HIDDEN) * Math.PI * 2 - spin * 1.6 + Math.sin(t + i) * 0.08;
        return { x: cx + Math.cos(a) * rx * 0.52, y: cy + Math.sin(a) * ry * 0.52 };
      });
      const hiddenFor = (i: number) => Math.round((i / n) * HIDDEN) % HIDDEN;

      ctx.clearRect(0, 0, w, h);

      // Scrolling price line along the bottom.
      if (Math.random() < 0.5 * speed) {
        const last = line[line.length - 1]!;
        line = [...line.slice(1), Math.max(-1, Math.min(1, last + (Math.random() - 0.5) * 0.25))];
      }
      ctx.globalAlpha = 0.35; ctx.strokeStyle = C.primary; ctx.lineWidth = 1.2;
      ctx.beginPath();
      line.forEach((y, i) => { const px = (i / (line.length - 1)) * w, py = h - 18 + y * 10; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();

      // Radar sweep.
      const sweep = t * 1.4;
      for (let s = 0; s < 14; s++) {
        const a0 = sweep - s * 0.06;
        ctx.globalAlpha = 0.12 * (1 - s / 14);
        ctx.fillStyle = C.primary;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.ellipse(cx, cy, rx * 1.08, ry * 1.08, 0, a0 - 0.06, a0);
        ctx.closePath(); ctx.fill();
      }
      outer.forEach((o, i) => {
        const d = Math.atan2(Math.sin(sweep - o.a), Math.cos(sweep - o.a));
        if (d > 0 && d < 0.12) glow.set(i, 1);
      });

      // Links.
      ctx.lineWidth = 0.8; ctx.strokeStyle = C.link;
      outer.forEach((o, i) => {
        const hd = hidden[hiddenFor(i)]!, hd2 = hidden[(hiddenFor(i) + 1) % HIDDEN]!;
        ctx.globalAlpha = 0.18 + (glow.get(i) ?? 0) * 0.4;
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(hd.x, hd.y); ctx.moveTo(o.x, o.y); ctx.lineTo(hd2.x, hd2.y); ctx.stroke();
      });
      ctx.globalAlpha = 0.3;
      hidden.forEach((hd) => { ctx.beginPath(); ctx.moveTo(hd.x, hd.y); ctx.lineTo(cx, cy); ctx.stroke(); });

      // Spawn pulses, favouring the markets currently being analysed.
      if (Math.random() < 0.12 * speed) {
        const activeIdx = labels.map((l, i) => (activeSet.has(l) ? i : -1)).filter((i) => i >= 0);
        const from = activeIdx.length && Math.random() < 0.7 ? activeIdx[Math.floor(Math.random() * activeIdx.length)]! : Math.floor(Math.random() * n);
        pulses.push({ from, hidden: hiddenFor(from), t: 0, color: Math.random() < 0.5 ? C.bull : C.bear });
      }
      for (let p = pulses.length - 1; p >= 0; p--) {
        const s = pulses[p]!; s.t += 0.025 * speed;
        const o = outer[s.from], hd = hidden[s.hidden];
        if (s.t >= 2 || !o || !hd) { pulses.splice(p, 1); continue; }
        const [ax, ay, bx, by, k] = s.t < 1 ? [o.x, o.y, hd.x, hd.y, s.t] : [hd.x, hd.y, cx, cy, s.t - 1];
        ctx.globalAlpha = 1; ctx.fillStyle = s.color; ctx.shadowColor = s.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * k, ay + (by - ay) * k, 2.4, 0, Math.PI * 2); ctx.fill();
      }

      // Hidden nodes.
      ctx.fillStyle = C.node; ctx.shadowColor = C.node; ctx.shadowBlur = 8; ctx.globalAlpha = 0.8;
      hidden.forEach((hd, i) => { ctx.beginPath(); ctx.arc(hd.x, hd.y, 2 + Math.sin(t * 3 + i) * 0.6, 0, Math.PI * 2); ctx.fill(); });

      // Input nodes with market labels.
      ctx.font = `600 10px ${mono}`; ctx.textBaseline = "middle";
      outer.forEach((o, i) => {
        const on = activeSet.has(labels[i]!);
        const g = glow.get(i) ?? 0;
        const col = on ? C.bull : C.node;
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = on ? 16 : 6 + g * 10;
        ctx.beginPath(); ctx.arc(o.x, o.y, on ? 4.5 : 3 + g, 0, Math.PI * 2); ctx.fill();
        if (on) { ctx.globalAlpha = 0.5 + Math.sin(t * 8) * 0.3; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(o.x, o.y, 8, 0, Math.PI * 2); ctx.stroke(); }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = on ? 1 : 0.55 + g * 0.45;
        ctx.fillStyle = on ? C.fg : C.muted;
        const right = Math.cos(o.a) >= 0;
        ctx.textAlign = right ? "left" : "right";
        ctx.fillText(labels[i]!, o.x + (right ? 9 : -9), o.y);
        if (g) glow.set(i, Math.max(0, g - 0.02 * speed));
      });

      // Core with progress ring.
      shown += (prog - shown) * 0.08;
      const r = 22 + Math.sin(t * 4) * 1.5;
      ctx.globalAlpha = 0.25; ctx.fillStyle = C.primary; ctx.shadowColor = C.primary; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 0.3; ctx.strokeStyle = C.muted; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = C.bull; ctx.shadowColor = C.bull; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * shown) / 100); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = C.fg; ctx.textAlign = "center"; ctx.font = `700 11px ${mono}`;
      ctx.fillText(`${Math.round(shown)}%`, cx, cy);

      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
