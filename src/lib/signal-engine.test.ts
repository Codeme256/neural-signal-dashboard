import { describe, expect, it } from "vitest";
import { buildSignal } from "./signal-engine";

const series = (step: number) =>
  Array.from({ length: 60 }, (_, i) => ({ time: i * 3600000, value: 100 + i * step + (i % 2 ? 0.2 : -0.2) }));

describe("buildSignal", () => {
  it("uptrend gives BUY with SL below entry and TP above", () => {
    const s = buildSignal(series(0.5))!;
    expect(s.direction).toBe("BUY");
    expect(s.stopLoss).toBeLessThan(s.entry);
    expect(s.takeProfit1).toBeGreaterThan(s.entry);
    expect(s.entry - s.stopLoss).toBeCloseTo(s.atr * 1.5);
    expect(s.takeProfit2 - s.entry).toBeCloseTo(s.atr * 4.5);
  });
  it("downtrend gives SELL with SL above entry", () => {
    const s = buildSignal(series(-0.5))!;
    expect(s.direction).toBe("SELL");
    expect(s.stopLoss).toBeGreaterThan(s.entry);
    expect(s.takeProfit1).toBeLessThan(s.entry);
  });
  it("needs 30 candles", () => {
    expect(buildSignal(series(1).slice(0, 20))).toBeNull();
  });
});
