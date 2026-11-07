import { adxLast, atrSeries, emaSeries, rsiSeries, structureTrend, swings, type Swing } from "./indicators";
import type { Dir, Ohlc, Setup, Trend } from "./types";

/** Recent window (in candles) in which a trigger must have happened to count as current. */
const FRESH = 6;

export type StructureBreak = { dir: Dir; j: number; level: number; swingI: number; kind: "BOS" | "CHoCH" };
export type Fvg = { dir: Dir; i: number; top: number; bottom: number; state: "UNFILLED" | "PARTIAL" };
export type Sweep = { dir: Dir; k: number; level: number; extreme: number; confirmed: boolean };

export type Context = {
  c: Ohlc[];
  n: number;
  last: Ohlc;
  atr: number;
  atrAvg: number;
  ema9: (number | null)[];
  ema21: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  rsi: (number | null)[];
  adx: number | null;
  highs: Swing[];
  lows: Swing[];
  lookback: number;
  structure: Trend;
  brk: StructureBreak | null;
  sweep: Sweep | null;
  fvg: Fvg | null;
};

/** Builds the analysis context from COMPLETED candles only. */
export function buildContext(c: Ohlc[], lookback = 3): Context | null {
  if (c.length < 60) return null;
  const closes = c.map((k) => k.close);
  const atrS = atrSeries(c);
  const atr = atrS.at(-1);
  if (!atr || !(atr > 0)) return null;
  const recentAtr = atrS.slice(-50).filter((v): v is number => v !== null);
  const { highs, lows } = swings(c, lookback);
  const ctx: Context = {
    c, n: c.length, last: c.at(-1)!, atr,
    atrAvg: recentAtr.reduce((a, b) => a + b, 0) / recentAtr.length,
    ema9: emaSeries(closes, 9), ema21: emaSeries(closes, 21), ema50: emaSeries(closes, 50), ema200: emaSeries(closes, 200),
    rsi: rsiSeries(closes), adx: adxLast(c), highs, lows, lookback,
    structure: structureTrend(highs, lows), brk: null, sweep: null, fvg: null,
  };
  ctx.brk = structureBreak(ctx);
  ctx.sweep = liquiditySweep(ctx);
  ctx.fvg = fairValueGap(ctx);
  return ctx;
}

/** Most recent close beyond one of the last confirmed swings (BOS, or CHoCH when it flips prior structure). */
export function structureBreak(ctx: Context): StructureBreak | null {
  const { c, n, highs, lows, lookback } = ctx;
  let best: StructureBreak | null = null;
  const scan = (list: Swing[], dir: Dir) => {
    for (const s of list.slice(-3)) {
      for (let j = s.i + lookback + 1; j < n; j++) {
        if (dir === 1 ? c[j]!.close > s.price : c[j]!.close < s.price) {
          // A later close back through the broken level (beyond a small ATR tolerance) invalidates the break.
          const tol = 0.25 * ctx.atr;
          const invalidated = c.slice(j + 1).some((k) => (dir === 1 ? k.close < s.price - tol : k.close > s.price + tol));
          if (!invalidated && (!best || j > best.j)) {
            const prior = structureTrend(highs.filter((h) => h.i < j - lookback), lows.filter((l) => l.i < j - lookback));
            const kind = (dir === 1 && prior === "BEARISH") || (dir === -1 && prior === "BULLISH") ? "CHoCH" : "BOS";
            best = { dir, j, level: s.price, swingI: s.i, kind };
          }
          break;
        }
      }
    }
  };
  scan(highs, 1);
  scan(lows, -1);
  const b = best as StructureBreak | null;
  return b && b.j >= n - FRESH ? b : null;
}

/** Wick through a confirmed swing that closes back inside (swing failure pattern). */
export function liquiditySweep(ctx: Context): Sweep | null {
  const { c, n, highs, lows, lookback } = ctx;
  for (let k = n - 1; k >= n - FRESH; k--) {
    const candle = c[k]!;
    const low = lows.filter((s) => s.i + lookback < k).at(-1);
    const high = highs.filter((s) => s.i + lookback < k).at(-1);
    const after = c.slice(k + 1);
    if (low && candle.low < low.price && candle.close > low.price) {
      const confirmed = after.some((x) => x.close > candle.high) && after.every((x) => x.close > candle.low);
      return { dir: 1, k, level: low.price, extreme: candle.low, confirmed };
    }
    if (high && candle.high > high.price && candle.close < high.price) {
      const confirmed = after.some((x) => x.close < candle.low) && after.every((x) => x.close < candle.high);
      return { dir: -1, k, level: high.price, extreme: candle.high, confirmed };
    }
  }
  return null;
}

/** Most recent valid (not invalidated, not fully filled) fair value gap with a displacement candle. */
export function fairValueGap(ctx: Context): Fvg | null {
  const { c, n, atr } = ctx;
  for (let i = n - 2; i >= Math.max(2, n - 30); i--) {
    const a = c[i - 2]!;
    const mid = c[i - 1]!;
    const z = c[i]!;
    const body = Math.abs(mid.close - mid.open);
    if (body < 0.6 * atr) continue;
    const after = c.slice(i + 1);
    if (z.low > a.high && z.low - a.high >= 0.25 * atr && mid.close > mid.open) {
      const top = z.low, bottom = a.high;
      if (after.some((x) => x.close < bottom)) continue; // invalidated
      const minLow = Math.min(...after.map((x) => x.low), Infinity);
      return { dir: 1, i, top, bottom, state: minLow > top ? "UNFILLED" : "PARTIAL" };
    }
    if (z.high < a.low && a.low - z.high >= 0.25 * atr && mid.close < mid.open) {
      const top = a.low, bottom = z.high;
      if (after.some((x) => x.close > top)) continue;
      const maxHigh = Math.max(...after.map((x) => x.high), -Infinity);
      return { dir: -1, i, top, bottom, state: maxHigh < bottom ? "UNFILLED" : "PARTIAL" };
    }
  }
  return null;
}

// ---------- Strategies (each returns a confirmed setup or null) ----------

export function smcSetup(ctx: Context): Setup | null {
  const b = ctx.brk;
  if (!b) return null;
  // Protected extreme of the leg that produced the break (from the broken swing up to the break candle).
  // Uses only candles that closed before/at the break, so it never repaints.
  const leg = ctx.c.slice(b.swingI, b.j + 1);
  const ref = b.dir === 1 ? Math.min(...leg.map((k) => k.low)) : Math.max(...leg.map((k) => k.high));
  return { id: "smc", dir: b.dir, stopRef: ref, reversal: b.kind === "CHoCH", confirmation: `${b.kind} — candle closed ${b.dir === 1 ? "above" : "below"} swing ${b.dir === 1 ? "high" : "low"}` };
}

export function liquiditySetup(ctx: Context): Setup | null {
  const s = ctx.sweep;
  if (!s || !s.confirmed) return null; // a sweep alone never triggers a trade
  return { id: "liquidity", dir: s.dir, stopRef: s.extreme, reversal: true, confirmation: `${s.dir === 1 ? "Sell" : "Buy"}-side liquidity swept, then a close beyond the sweep candle` };
}

export function fvgSetup(ctx: Context): Setup | null {
  const f = ctx.fvg;
  const { last, atr } = ctx;
  if (!f || f.i >= ctx.n - 2) return null;
  const tapped = f.dir === 1
    ? last.low <= f.top && last.low >= f.bottom - 0.1 * atr && last.close > last.open && last.close > f.bottom
    : last.high >= f.bottom && last.high <= f.top + 0.1 * atr && last.close < last.open && last.close < f.top;
  if (!tapped) return null;
  return { id: "fvg", dir: f.dir, stopRef: f.dir === 1 ? f.bottom : f.top, reversal: false, confirmation: `Price retested ${f.state.toLowerCase()} ${f.dir === 1 ? "bullish" : "bearish"} FVG and rejected it` };
}

export function trendSetup(ctx: Context): Setup | null {
  const { c, n, last, adx } = ctx;
  const e9 = ctx.ema9.at(-1), e21 = ctx.ema21.at(-1), e50 = ctx.ema50.at(-1), e200 = ctx.ema200.at(-1) ?? null, rsi = ctx.rsi.at(-1);
  if (e9 == null || e21 == null || e50 == null || rsi == null || adx == null || adx < 20) return null;
  const prev = c[n - 2]!;
  const pulledBack = (dir: Dir) => c.slice(n - 5, n - 1).some((k, idx) => {
    const e = ctx.ema21[n - 5 + idx];
    return e != null && (dir === 1 ? k.low <= e : k.high >= e);
  });
  if (e9 > e21 && e21 > e50 && (e200 === null || last.close > e200) && rsi >= 50 && rsi < 70 && ctx.structure !== "BEARISH" && pulledBack(1) && last.close > prev.high) {
    return { id: "trend", dir: 1, stopRef: Math.min(...c.slice(n - 5).map((k) => k.low)), reversal: false, confirmation: "Pullback to EMA 21, then close above prior candle high" };
  }
  if (e9 < e21 && e21 < e50 && (e200 === null || last.close < e200) && rsi <= 50 && rsi > 30 && ctx.structure !== "BULLISH" && pulledBack(-1) && last.close < prev.low) {
    return { id: "trend", dir: -1, stopRef: Math.max(...c.slice(n - 5).map((k) => k.high)), reversal: false, confirmation: "Pullback to EMA 21, then close below prior candle low" };
  }
  return null;
}

export function breakoutSetup(ctx: Context): Setup | null {
  const { c, n, atr } = ctx;
  const tryLevel = (level: number, si: number, dir: Dir): Setup | null => {
    let j = -1;
    for (let k = si + ctx.lookback + 1; k < n; k++) if (dir === 1 ? c[k]!.close > level : c[k]!.close < level) { j = k; break; }
    if (j < 0 || j < n - 15 || j > n - 2) return null;
    const bo = c[j]!;
    if (dir * (bo.close - bo.open) < 0.5 * atr) return null; // weak breakout candle
    const range = c.slice(Math.max(0, j - 10), j);
    if (Math.max(...range.map((k) => k.high)) - Math.min(...range.map((k) => k.low)) > 5 * atr) return null; // not from consolidation
    const after = c.slice(j + 1);
    if (after.some((k) => (dir === 1 ? k.close < level - 0.2 * atr : k.close > level + 0.2 * atr))) return null; // failed breakout
    const r = after.findIndex((k) => (dir === 1 ? k.low <= level + 0.25 * atr : k.high >= level - 0.25 * atr));
    if (r < 0) return null;
    const ri = j + 1 + r;
    if (ri < n - 4) return null;
    const last = c[n - 1]!;
    if (!(dir === 1 ? last.close > last.open && last.close > level : last.close < last.open && last.close < level)) return null;
    const seg = c.slice(ri);
    return { id: "breakout", dir, reversal: false, stopRef: dir === 1 ? Math.min(...seg.map((k) => k.low)) : Math.max(...seg.map((k) => k.high)), confirmation: `Breakout of ${dir === 1 ? "resistance" : "support"} retested and held` };
  };
  const h = ctx.highs.at(-1), l = ctx.lows.at(-1);
  return (h && tryLevel(h.price, h.i, 1)) || (l && tryLevel(l.price, l.i, -1)) || null;
}

export function momentumSetup(ctx: Context): Setup | null {
  const { c, n, rsi } = ctx;
  const last = c[n - 1]!, prev = c[n - 2]!;
  const [la, lb] = ctx.lows.slice(-2);
  if (la && lb && lb.i >= n - 12) {
    const ra = rsi[la.i], rb = rsi[lb.i];
    if (ra != null && rb != null && lb.price < la.price && rb > ra && ra < 40 && last.close > prev.high && last.close > c[lb.i]!.high) {
      return { id: "momentum", dir: 1, stopRef: lb.price, reversal: true, confirmation: "Bullish RSI divergence confirmed by close above divergence candle" };
    }
  }
  const [ha, hb] = ctx.highs.slice(-2);
  if (ha && hb && hb.i >= n - 12) {
    const ra = rsi[ha.i], rb = rsi[hb.i];
    if (ra != null && rb != null && hb.price > ha.price && rb < ra && ra > 60 && last.close < prev.low && last.close < c[hb.i]!.low) {
      return { id: "momentum", dir: -1, stopRef: hb.price, reversal: true, confirmation: "Bearish RSI divergence confirmed by close below divergence candle" };
    }
  }
  return null;
}

export const DETECTORS = { trend: trendSetup, liquidity: liquiditySetup, smc: smcSetup, fvg: fvgSetup, breakout: breakoutSetup, momentum: momentumSetup } as const;

/** Higher-timeframe bias from EMA 21/50 and market structure. */
export function higherTrend(c: Ohlc[]): Trend {
  if (c.length < 55) return "NEUTRAL";
  const closes = c.map((k) => k.close);
  const e21 = emaSeries(closes, 21).at(-1), e50 = emaSeries(closes, 50).at(-1);
  const last = closes.at(-1)!;
  const { highs, lows } = swings(c, 3);
  const st = structureTrend(highs, lows);
  if (e21 == null || e50 == null) return "NEUTRAL";
  if (e21 > e50 && last > e50 && st !== "BEARISH") return "BULLISH";
  if (e21 < e50 && last < e50 && st !== "BULLISH") return "BEARISH";
  return "NEUTRAL";
}
