import { describe, expect, it } from "vitest";
import { buildContext, fairValueGap, liquiditySetup } from "./detectors";
import { fromCloses, H1, legs, repeat } from "@/test/fixtures/series";
import { parseDerivOhlc } from "../deriv-data";
import type { Ohlc } from "./types";

type L = [number, number][];
const push = (c: Ohlc[], k: Omit<Ohlc, "time">) => [...c, { time: c.at(-1)!.time + H1, ...k }];

/** Sideways range: troughs at 100 (lows 99.7) are confirmed swing lows. */
const range = fromCloses(legs(repeat(12, [[3, 0.5], [3, -0.5]] as L), 100));

describe("liquidity sweep (false breakout)", () => {
  // Wick below the range lows, close back inside.
  const swept = push(range, { open: 100.4, high: 100.5, low: 99.2, close: 100.3 });

  it("a sweep alone does not trigger a trade", () => {
    const ctx = buildContext(swept)!;
    expect(ctx.sweep).toMatchObject({ dir: 1, confirmed: false });
    expect(liquiditySetup(ctx)).toBeNull();
  });

  it("needs a later close above the sweep candle to confirm the reversal", () => {
    const confirmed = push(swept, { open: 100.3, high: 100.9, low: 100.2, close: 100.8 });
    const setup = liquiditySetup(buildContext(confirmed)!);
    expect(setup?.dir).toBe(1);
    expect(setup?.stopRef).toBe(99.2);
  });
});

describe("fair value gap", () => {
  // Displacement up: candle A high < candle Z low.
  const withGap = [range, { open: 100, high: 100.2, low: 99.8, close: 100.1 }, { open: 100.1, high: 102.2, low: 100.0, close: 102.1 }, { open: 102.1, high: 102.6, low: 101.2, close: 102.4 }, { open: 102.4, high: 102.7, low: 102.0, close: 102.5 }]
    .reduce<Ohlc[]>((acc, k) => (Array.isArray(k) ? [...k] : push(acc, k)), []);

  it("detects an unfilled bullish gap from real highs/lows", () => {
    const f = fairValueGap(buildContext(withGap)!);
    expect(f).toMatchObject({ dir: 1, bottom: 100.2, top: 101.2, state: "UNFILLED" });
  });

  it("marks it partially filled when price trades into it", () => {
    const tapped = push(withGap, { open: 102.5, high: 102.6, low: 100.8, close: 101.5 });
    expect(fairValueGap(buildContext(tapped)!)?.state).toBe("PARTIAL");
  });

  it("invalidates the gap after a close below its bottom", () => {
    const broken = push(withGap, { open: 102.5, high: 102.6, low: 99.9, close: 100.0 });
    expect(fairValueGap(buildContext(broken)!)).toBeNull();
  });
});

describe("break of structure", () => {
  const bull = fromCloses(legs([...repeat(10, [[5, 1], [3, -0.6]] as L), [5, 1], [3, -0.6], [2, 1.2]]));

  it("confirms a bullish BOS on a candle close above the swing high", () => {
    const brk = buildContext(bull)!.brk;
    expect(brk).toMatchObject({ dir: 1, kind: "BOS" });
    expect(brk!.level).toBeCloseTo(137.3);
  });

  it("invalidates the BOS when a later candle closes back below the level", () => {
    const failed = push(bull, { open: 137.6, high: 137.7, low: 136.3, close: 136.4 });
    expect(buildContext(failed)!.brk).toBeNull();
  });
});

describe("Deriv candle parsing", () => {
  it("keeps real OHLC rows, drops malformed ones and never fills gaps", () => {
    const rows = [
      { epoch: 3600, open: 1, high: 2, low: 0.5, close: 1.5 },
      { epoch: 7200, open: 1, high: 0.9, low: 0.5, close: 1.5 }, // high below close: invalid
      { epoch: 14400, open: "1.5", high: "1.8", low: "1.4", close: "1.6" },
    ];
    expect(parseDerivOhlc(rows)).toEqual([
      { time: 3600000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 14400000, open: 1.5, high: 1.8, low: 1.4, close: 1.6 },
    ]);
  });
});
