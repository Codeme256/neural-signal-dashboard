import { describe, expect, it } from "vitest";
import { EXPIRY_CANDLES, evaluateOutcome, summarize } from "./signal-tracker";
import type { Ohlc } from "./strategies/types";

const H = 3600_000;
const T0 = Date.UTC(2026, 0, 5, 10);
const buy = { action: "BUY" as const, timeframe: "H1" as const, stopLoss: 95, takeProfit1: 110, takeProfit2: 120, signalTime: T0 };
const sell = { action: "SELL" as const, timeframe: "H1" as const, stopLoss: 105, takeProfit1: 90, takeProfit2: 80, signalTime: T0 };
const bar = (i: number, low: number, high: number): Ohlc => ({ time: T0 + i * H, open: (low + high) / 2, high, low, close: (low + high) / 2 });
const later = T0 + 100 * H;

describe("tracked signal outcome", () => {
  it("BUY that reaches TP1 before the stop is WON", () => {
    const r = evaluateOutcome(buy, [bar(0, 98, 104), bar(1, 101, 111), bar(2, 94, 100)], later);
    expect(r).toEqual({ status: "WON", target: "TP1", closedAt: T0 + H });
  });

  it("BUY that hits the stop first is LOST", () => {
    expect(evaluateOutcome(buy, [bar(0, 97, 104), bar(1, 94, 100), bar(2, 100, 125)], later).status).toBe("LOST");
  });

  it("stop and TP1 in the same candle counts as LOST", () => {
    expect(evaluateOutcome(buy, [bar(0, 94, 112)], later).status).toBe("LOST");
  });

  it("reaching TP2 is recorded as a TP2 win", () => {
    expect(evaluateOutcome(buy, [bar(0, 99, 111), bar(1, 105, 121)], later)).toEqual({ status: "WON", target: "TP2", closedAt: T0 + H });
  });

  it("SELL mirrors the rules", () => {
    expect(evaluateOutcome(sell, [bar(0, 89, 103)], later).status).toBe("WON");
    expect(evaluateOutcome(sell, [bar(0, 96, 106)], later).status).toBe("LOST");
  });

  it("ignores candles before the signal closed", () => {
    expect(evaluateOutcome(buy, [bar(-1, 90, 100), bar(0, 98, 104)], T0 + 2 * H).status).toBe("OPEN");
  });

  it(`expires after ${EXPIRY_CANDLES} candles without stop or TP1`, () => {
    const flat = Array.from({ length: EXPIRY_CANDLES }, (_, i) => bar(i, 99, 105));
    expect(evaluateOutcome(buy, flat, T0 + (EXPIRY_CANDLES - 1) * H).status).toBe("OPEN");
    expect(evaluateOutcome(buy, flat, T0 + EXPIRY_CANDLES * H).status).toBe("EXPIRED");
  });

  it("win rate counts only won and lost signals", () => {
    const s = summarize([{ status: "WON" }, { status: "WON" }, { status: "LOST" }, { status: "OPEN" }, { status: "EXPIRED" }]);
    expect(s).toMatchObject({ won: 2, lost: 1, open: 1, expired: 1, winRate: 67 });
  });
});
