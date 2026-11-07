import { ADX, ATR, EMA, RSI } from "technicalindicators";
import type { Ohlc } from "./types";

/** Right-aligns an indicator series to the candle array (leading values = null). */
export function align(values: number[], length: number): (number | null)[] {
  return [...Array<null>(Math.max(0, length - values.length)).fill(null), ...values];
}

export const emaSeries = (closes: number[], period: number) =>
  closes.length >= period ? align(EMA.calculate({ period, values: closes }), closes.length) : align([], closes.length);

export const rsiSeries = (closes: number[], period = 14) =>
  closes.length > period ? align(RSI.calculate({ period, values: closes }), closes.length) : align([], closes.length);

/** Genuine Wilder ATR from OHLC True Range. */
export function atrSeries(c: Ohlc[], period = 14) {
  if (c.length <= period) return align([], c.length);
  return align(ATR.calculate({ period, high: c.map((k) => k.high), low: c.map((k) => k.low), close: c.map((k) => k.close) }), c.length);
}

export function adxLast(c: Ohlc[], period = 14): number | null {
  if (c.length < period * 2 + 1) return null;
  const out = ADX.calculate({ period, high: c.map((k) => k.high), low: c.map((k) => k.low), close: c.map((k) => k.close) });
  return out.at(-1)?.adx ?? null;
}

export type Swing = { i: number; price: number };

/**
 * Confirmed swing points: a pivot needs `lookback` completed candles on each side,
 * so a swing never appears or disappears once the candle `i + lookback` has closed.
 */
export function swings(c: Ohlc[], lookback = 3) {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - lookback; k <= i + lookback; k++) {
      if (k === i) continue;
      const o = c[k]!;
      if (k < i ? o.high >= c[i]!.high : o.high > c[i]!.high) isHigh = false;
      if (k < i ? o.low <= c[i]!.low : o.low < c[i]!.low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: c[i]!.high });
    if (isLow) lows.push({ i, price: c[i]!.low });
  }
  return { highs, lows };
}

/** HH+HL = bullish, LH+LL = bearish, anything else = neutral. */
export function structureTrend(highs: Swing[], lows: Swing[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const hh = highs.at(-1)!.price > highs.at(-2)!.price;
  const hl = lows.at(-1)!.price > lows.at(-2)!.price;
  if (hh && hl) return "BULLISH";
  if (!hh && !hl) return "BEARISH";
  return "NEUTRAL";
}
