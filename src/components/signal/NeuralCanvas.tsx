import { useEffect, useRef } from "react";

/** Animated neural network: drifting nodes, links and travelling pulses. */
export function NeuralCanvas({ intensity = 1, className }: { intensity?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const styles = getComputedStyle(canvas);
    const node = styles.getPropertyValue("--neural-node").trim() || "#3ef";
    const link = styles.getPropertyValue("--neural-link").trim() || "#3ef";
    const pulse = styles.getPropertyValue("--neural-pulse").trim() || "#7f7";
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    type N = { x: number; y: number; vx: number; vy: number; r: number };
    let nodes: N[] = [];
    const pulses: { a: number; b: number; t: number }[] = [];

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(90, (w * h) / 9000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35, r: 1 + Math.random() * 2,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const maxD = 130;

    const frame = () => {
      const k = intensityRef.current;
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x += n.vx * k; n.y += n.vy * k;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!, b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < maxD) {
            ctx.globalAlpha = (1 - d / maxD) * 0.35;
            ctx.strokeStyle = link; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            if (Math.random() < 0.0008 * k * k) pulses.push({ a: i, b: j, t: 0 });
          }
        }
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        ctx.fillStyle = node; ctx.shadowColor = node; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      for (let p = pulses.length - 1; p >= 0; p--) {
        const s = pulses[p]!; s.t += 0.02 * k;
        const a = nodes[s.a], b = nodes[s.b];
        if (s.t >= 1 || !a || !b) { pulses.splice(p, 1); continue; }
        ctx.fillStyle = pulse; ctx.shadowColor = pulse; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * s.t, a.y + (b.y - a.y) * s.t, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
