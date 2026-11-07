import type { Ohlc } from "@/lib/strategies/types";

export const H1 = 3600000;
export const T0 = Date.UTC(2026, 9, 1); // fixed epoch so fixtures are deterministic

/** Deterministic OHLC from closes: open = previous close, wicks extend `wick` beyond the body. */
export function fromCloses(closes: number[], { start = T0, tfMs = H1, wick = 0.3, first = closes[0]! } = {}): Ohlc[] {
  return closes.map((close, i) => {
    const open = i === 0 ? first : closes[i - 1]!;
    return { time: start + i * tfMs, open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick };
  });
}

/** Piecewise path: each leg = [candles, step per candle]. */
export function legs(parts: [number, number][], start = 100): number[] {
  const out: number[] = [];
  let p = start;
  for (const [count, step] of parts) for (let i = 0; i < count; i++) out.push((p += step));
  return out;
}

export const repeat = <T,>(n: number, xs: T[]): T[] => Array.from({ length: n }, () => xs).flat();

/** Price-mirror around `pivot` (bullish ⇄ bearish), keeping times. */
export function mirror(c: Ohlc[], pivot = 200): Ohlc[] {
  return c.map((k) => ({ time: k.time, open: pivot - k.open, close: pivot - k.close, high: pivot - k.low, low: pivot - k.high }));
}

/** `now` just after candle `i` (0-based) has closed. */
export const after = (c: Ohlc[], i = c.length - 1, tfMs = H1) => c[i]!.time + tfMs + 1000;
