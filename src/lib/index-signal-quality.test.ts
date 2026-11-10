import { describe, expect, it } from "vitest";
import { checkIndexCandles, evaluateIndexQuality } from "./index-signal-quality";
import type { Ohlc } from "./strategies/types";

const interval = 15 * 60 * 1000;
const now = Date.UTC(2026, 10, 10, 9, 0);
const candles: Ohlc[] = Array.from({ length: 80 }, (_, i) => ({
  time: now - (80 - i) * interval,
  open: 100 + i * 0.1,
  high: 101 + i * 0.1,
  low: 99 + i * 0.1,
  close: 100.5 + i * 0.1,
}));
describe("index signal data checks", () => {
  it("accepts ordered, closed candles", () => {
    expect(checkIndexCandles(candles, "M15", now)).toBeNull();
  });
  it("rejects duplicate candles", () => {
    const invalid = candles.map(c => ({ ...c }));
    invalid[79]!.time = invalid[78]!.time;
    expect(checkIndexCandles(invalid, "M15", now)).toMatch(/Duplicate/);
  });
  it("rejects impossible OHLC prices", () => {
    const invalid = candles.map(c => ({ ...c }));
    invalid[79]!.high = 1;
    expect(checkIndexCandles(invalid, "M15", now)).toMatch(/Invalid/);
  });
  it("rejects future candles", () => {
    const invalid = candles.map(c => ({ ...c }));
    invalid[79]!.time = now;
    expect(checkIndexCandles(invalid, "M15", now)).toMatch(/future/);
  });
});
const candidate = {
  strategy: "trend", direction: 1 as const, higherTrend: "BULLISH" as const,
  regime: "TRENDING" as const, rrGross: 2.5, entry: 100,
  stopLoss: 99, takeProfit2: 102.5, atr: 1, frictionAtrFraction: 0.1,
};
describe("index signal quality", () => {
  it("rejects conflicting higher timeframe", () => {
    expect(evaluateIndexQuality({ ...candidate, higherTrend: "BEARISH" }).pass).toBe(false);
  });
  it("rejects trend setup during range", () => {
    expect(evaluateIndexQuality({ ...candidate, regime: "RANGING" }).pass).toBe(false);
  });
  it("rejects inadequate net reward to risk after friction", () => {
    expect(evaluateIndexQuality({ ...candidate, takeProfit2: 102 }).pass).toBe(false);
  });
  it("returns a non-probabilistic quality score for valid setup", () => {
    const q = evaluateIndexQuality(candidate);
    expect(q.pass).toBe(true);
    expect(q.score).toBeLessThan(100);
  });
});
