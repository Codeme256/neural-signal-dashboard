import type { Ohlc, Timeframe, Trend } from "./strategies/types";
import { TF_SECONDS } from "./strategies/types";

/** Market-data sanity checks; never interpolate missing candles or repair invalid prices. */
export function checkIndexCandles(candles: Ohlc[], tf: Timeframe, now: number): string | null {
  if (candles.length < 70) return "Insufficient completed candles for index indicators.";
  const period = TF_SECONDS[tf] * 1000;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
        c.time <= 0 || c.open <= 0 || c.low <= 0 || c.close <= 0 ||
        c.high < Math.max(c.open, c.close, c.low) ||
        c.low > Math.min(c.open, c.close) ||
        c.time + period > now) return "Invalid, unclosed or future index candle.";
    if (i && c.time <= candles[i - 1]!.time) return "Duplicate or out-of-order index candles.";
  }
  // Recent incomplete bars can corrupt momentum signals. Overnight gaps on stock indices
  // are tolerated here; other continuity checks belong in provider-specific session logic.
  const last = candles.at(-1)!;
  if (now - (last.time + period) > 2 * period + 60000)
    return "Index candle feed is stale.";
  return null;
}

export type IndexRegime = "TRENDING" | "RANGING" | "TRANSITION" | "UNKNOWN";
export type IndexQualityInputs = {
  strategy: string;
  direction: 1 | -1;
  higherTrend: Trend;
  regime: IndexRegime;
  rrGross: number;
  entry: number;
  stopLoss: number;
  takeProfit2: number;
  atr: number;
  frictionAtrFraction: number;
};

/** Conservative stress test, NOT observed bid/ask spread. */
export function evaluateIndexQuality(i: IndexQualityInputs) {
  const trendFollowing = ["trend", "macd", "ribbon", "atrbreak"].includes(i.strategy);
  const meanReverting = i.strategy === "snapback";
  const aligned = i.higherTrend === (i.direction === 1 ? "BULLISH" : "BEARISH");
  const opposed = i.higherTrend === (i.direction === 1 ? "BEARISH" : "BULLISH");
  if (trendFollowing && opposed) return { pass: false, score: 0, reason: "Opposes higher-timeframe trend." };
  if (meanReverting && i.regime !== "RANGING") return { pass: false, score: 0, reason: "Mean reversion requires ranging regime." };
  if ((i.strategy === "trend" || i.strategy === "ribbon") && i.regime !== "TRENDING")
    return { pass: false, score: 0, reason: "Trend continuation requires trending regime." };
  if (i.strategy === "atrbreak" && i.regime === "RANGING")
    return { pass: false, score: 0, reason: "ATR breakout lacks directional confirmation." };
  const friction = Math.max(0, i.atr * i.frictionAtrFraction);
  const risk = Math.abs(i.entry - i.stopLoss);
  const reward = Math.abs(i.takeProfit2 - i.entry);
  const netRR = risk + friction > 0 ? (reward - friction) / (risk + friction) : 0;
  if (!Number.isFinite(netRR) || netRR < 2)
    return { pass: false, score: 0, reason: "Estimated cost-stressed reward/risk below 2:1." };
  // Heuristic confirmation grade, not a win probability.
  const score = Math.min(90, Math.round(
    40 + (aligned ? 20 : i.higherTrend === "NEUTRAL" ? 5 : 0) +
    (i.regime === "TRENDING" && trendFollowing || i.regime === "RANGING" && meanReverting ? 15 : 5) +
    Math.min(15, Math.max(0, (netRR - 2) * 10))
  ));
  return { pass: true, score, netRR, reason: "Rules validated with hypothetical friction; not a probability of winning." };
}
