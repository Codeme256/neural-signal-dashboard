import { describe, expect, it } from "vitest";
import { actionFor, analyze, closedCandles, DEFAULT_WEIGHTS, gradeFor, type AnalyzeInput } from "./signal-engine";
import { parseDerivOhlc } from "./deriv-data";
import { swings } from "./strategies/indicators";
import { after, fromCloses, H1, legs, mirror, repeat } from "@/test/fixtures/series";
import real from "@/test/fixtures/r100-h1.json";
import type { Ohlc } from "./strategies/types";

type L = [number, number][];
const H4 = 4 * H1;
const M15 = H1 / 4;
const uptrend: L = repeat(10, [[5, 1], [3, -0.6]] as L);
/** Uptrend, pullback, then a close above the last confirmed swing high (bullish BOS). */
const bull = fromCloses(legs([...uptrend, [5, 1], [3, -0.6], [2, 1.2]]));
const htfBull = fromCloses(legs(repeat(15, [[4, 2], [2, -1]] as L)), { tfMs: H4, start: bull.at(-1)!.time - 90 * H4 });
const now = after(bull);
const base = (o: Partial<AnalyzeInput> = {}): AnalyzeInput => ({ candles: bull, higher: htfBull, timeframe: "H1", now, open: true, decimals: 2, ...o });

const expectBuyLevels = (a: ReturnType<typeof analyze>) => {
  expect(a.stopLoss!).toBeLessThan(a.entry!);
  expect(a.takeProfit1!).toBeGreaterThan(a.entry!);
  expect(a.takeProfit2!).toBeGreaterThan(a.takeProfit1!);
};
const expectSellLevels = (a: ReturnType<typeof analyze>) => {
  expect(a.stopLoss!).toBeGreaterThan(a.entry!);
  expect(a.takeProfit1!).toBeLessThan(a.entry!);
  expect(a.takeProfit2!).toBeLessThan(a.takeProfit1!);
};

describe("confluence scoring rules", () => {
  it("weights total 100 with the agreed split", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ htf: 20, structure: 20, trigger: 20, momentum: 15, liquidity: 15, risk: 10 });
  });
  it("classifies 85+ high, 70–84 strong, 50–69 watchlist, below 50 no trade", () => {
    expect(gradeFor(85)).toBe("HIGH CONFLUENCE");
    expect(gradeFor(84)).toBe("STRONG SETUP");
    expect(gradeFor(70)).toBe("STRONG SETUP");
    expect(gradeFor(69)).toBe("MODERATE — WATCHLIST");
    expect(gradeFor(50)).toBe("MODERATE — WATCHLIST");
    expect(gradeFor(49)).toBe("WEAK — NO TRADE");
    expect(actionFor(70, 1)).toBe("BUY");
    expect(actionFor(70, -1)).toBe("SELL");
    expect(actionFor(69, 1)).toBe("WAIT");
    expect(actionFor(49, 1)).toBe("NO TRADE");
  });
});

describe("bullish / bearish scenarios", () => {
  it("bullish BOS aligned with the higher timeframe gives BUY with SL below and TPs above", () => {
    const a = analyze(base());
    expect(a.action).toBe("BUY");
    expect(a.strategyId).toBe("smc");
    expect(a.higherTrend).toBe("BULLISH");
    expect(a.score).toBeGreaterThanOrEqual(70);
    expectBuyLevels(a);
    expect(a.riskReward!).toBeGreaterThanOrEqual(2);
  });

  it("the mirrored (bearish) market gives SELL with SL above and TPs below, same score", () => {
    const buy = analyze(base());
    const a = analyze(base({ candles: mirror(bull), higher: mirror(htfBull) }));
    expect(a.action).toBe("SELL");
    expect(a.score).toBe(buy.score);
    expectSellLevels(a);
  });

  it("enforces minimum 1:2 risk/reward against the nearest opposing level", () => {
    // Pullback inside the trend: the prior swing high is too close to reach 2R.
    const c = fromCloses(legs([...uptrend, [3, -0.6], [3, 1]]));
    const a = analyze(base({ candles: c, now: after(c) }));
    expect(a.action).toBe("NO TRADE");
    expect(a.strategies.find((s) => s.id === "trend")?.note).toMatch(/leaves only 1:/);
  });
});

describe("multi-timeframe alignment", () => {
  it("suppresses a continuation setup that fights the higher-timeframe trend", () => {
    const a = analyze(base({ higher: mirror(htfBull) }));
    expect(a.higherTrend).toBe("BEARISH");
    expect(a.action).toBe("NO TRADE");
    expect(a.strategies.find((s) => s.id === "smc")?.note).toMatch(/Suppressed/);
  });

  it("missing higher-timeframe data lowers the score instead of inventing a trend", () => {
    const aligned = analyze(base());
    const unknown = analyze(base({ higher: null }));
    expect(unknown.higherTrend).toBe("NEUTRAL");
    expect(unknown.score).toBe(aligned.score - 10);
  });

  it("a disagreeing lower-timeframe confirmation reduces the trigger points", () => {
    const closes = legs([...repeat(10, [[4, 0.3], [2, -0.2]] as L), [2, 0.3]]);
    const start = bull.at(-1)!.time + H1 - closes.length * M15; // last M15 candle closes with the H1 candle
    const confUp = fromCloses(closes, { tfMs: M15, start, wick: 0.05 });
    const agree = analyze(base({ confirm: confUp }));
    const disagree = analyze(base({ confirm: mirror(confUp) }));
    expect(agree.breakdown.find((b) => b.label === "Confirmed entry trigger")?.points).toBe(20);
    expect(disagree.breakdown.find((b) => b.label === "Confirmed entry trigger")?.points).toBe(8);
    expect(agree.score - disagree.score).toBe(12);
  });
});

describe("hard rejections", () => {
  it("sideways market returns NO TRADE", () => {
    const c = fromCloses(legs(repeat(20, [[2, 0.5], [2, -0.5]] as L)));
    const a = analyze(base({ candles: c, now: after(c), higher: null }));
    expect(a.action).toBe("NO TRADE");
    expect(a.entry).toBeNull();
  });
  it("stale candles return NO TRADE", () => {
    const a = analyze(base({ now: now + 5 * H1 }));
    expect(a.action).toBe("NO TRADE");
    expect(a.reasons[0]).toMatch(/stale/);
  });
  it("insufficient history returns NO TRADE", () => {
    const a = analyze(base({ candles: bull.slice(-40) }));
    expect(a.action).toBe("NO TRADE");
    expect(a.reasons[0]).toMatch(/Insufficient history/);
  });
  it("closed market returns NO TRADE", () => {
    const a = analyze(base({ open: false }));
    expect(a.action).toBe("NO TRADE");
    expect(a.reasons[0]).toMatch(/Market closed/);
  });
});

describe("completed candles only (non-repainting)", () => {
  it("ignores the forming candle even when it spikes", () => {
    const forming: Ohlc = { time: bull.at(-1)!.time + H1, open: 137.6, high: 160, low: 120, close: 125 };
    expect(closedCandles([...bull, forming], "H1", now)).toHaveLength(bull.length);
    expect(analyze(base({ candles: [...bull, forming] }))).toEqual(analyze(base()));
  });

  const c = parseDerivOhlc(real.candles);

  it("confirmed swing points never disappear when later real candles arrive", () => {
    const full = swings(c, 3);
    for (let k = 60; k < c.length; k += 7) {
      const part = swings(c.slice(0, k), 3);
      for (const s of part.highs) expect(full.highs).toContainEqual(s);
      for (const s of part.lows) expect(full.lows).toContainEqual(s);
    }
  });

  it("result at each hour is identical whether or not future real candles are present", () => {
    for (let k = 100; k < c.length - 1; k += 5) {
      const t = after(c, k);
      const opts = { timeframe: "H1" as const, now: t, open: true, decimals: 2 };
      expect(analyze({ ...opts, candles: c })).toEqual(analyze({ ...opts, candles: c.slice(0, k + 1) }));
    }
  });

  it("every directional result on real Deriv history has SL/TP on the correct side", () => {
    let directional = 0;
    for (let k = 100; k < c.length - 1; k++) {
      const a = analyze({ candles: c.slice(0, k + 1), timeframe: "H1", now: after(c, k), open: true, decimals: 2 });
      if (a.entry === null) continue;
      directional++;
      const dir = a.strategies.find((s) => s.id === a.strategyId)!.dir;
      if (dir === 1) expectBuyLevels(a);
      else expectSellLevels(a);
      expect(a.riskReward!).toBeGreaterThanOrEqual(2);
    }
    expect(directional).toBeGreaterThan(0);
  });
});
