import { EMA, RSI } from "technicalindicators";
import type { Candle } from "./deriv-data";

export type Signal = {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  strength: number; // 0-100
  strengthLabel: "WEAK" | "MODERATE" | "STRONG";
  rsi: number;
  ema9: number;
  ema21: number;
  atr: number;
  riskReward: number;
};

/** Average absolute move between consecutive closes (close-only ATR proxy). */
export function closeAtr(values: number[], period = 14) {
  const diffs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const recent = diffs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
}

/**
 * Builds a trade setup from candle closes.
 * SL = 1.5 x ATR from entry; TP1 = 1.5R, TP2 = 3R.
 */
export function buildSignal(points: Candle[], livePrice?: number): Signal | null {
  const values = points.map((p) => p.value);
  if (values.length < 30) return null;
  const ema9 = EMA.calculate({ period: 9, values }).at(-1)!;
  const ema21 = EMA.calculate({ period: 21, values }).at(-1)!;
  const rsi = RSI.calculate({ period: 14, values }).at(-1)!;
  const atr = closeAtr(values);
  if (!atr) return null;
  const entry = livePrice ?? values.at(-1)!;
  const direction: Signal["direction"] = ema9 >= ema21 ? "BUY" : "SELL";
  const sign = direction === "BUY" ? 1 : -1;
  const risk = atr * 1.5;

  const emaScore = Math.min(1, Math.abs(ema9 - ema21) / (atr * 2)) * 45;
  const rsiAligned = sign * (rsi - 50);
  const rsiScore = rsiAligned > 0 ? Math.min(1, rsiAligned / 20) * 35 : 0;
  const ref = values.at(-25) ?? values[0];
  const momentumScore = sign * (values.at(-1)! - ref) > 0 ? 20 : 0;
  const overextended = rsi > 75 || rsi < 25 ? 15 : 0;
  const strength = Math.round(Math.max(5, Math.min(99, emaScore + rsiScore + momentumScore - overextended)));

  return {
    direction,
    entry,
    stopLoss: entry - sign * risk,
    takeProfit1: entry + sign * risk * 1.5,
    takeProfit2: entry + sign * risk * 3,
    strength,
    strengthLabel: strength >= 70 ? "STRONG" : strength >= 45 ? "MODERATE" : "WEAK",
    rsi,
    ema9,
    ema21,
    atr,
    riskReward: 3,
  };
}
