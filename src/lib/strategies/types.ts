/** One OHLC candle. `time` is the candle OPEN time in ms (Deriv `epoch`). */
export type Ohlc = { time: number; open: number; high: number; low: number; close: number };

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export type AnyTimeframe = Timeframe | "D1";

export const TF_SECONDS: Record<AnyTimeframe, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400,
};

/** Higher timeframe used for trend context for each signal timeframe. */
export const HIGHER_TF: Record<Timeframe, AnyTimeframe> = {
  M1: "M5", M5: "M15", M15: "H1", M30: "H1", H1: "H4", H4: "D1",
};

/** Lower timeframe used to confirm the entry (same TF = confirmed by the signal candle itself). */
export const CONFIRM_TF: Record<Timeframe, Timeframe> = {
  M1: "M1", M5: "M5", M15: "M5", M30: "M15", H1: "M15", H4: "H1",
};

export type StrategyId = "trend" | "liquidity" | "smc" | "fvg" | "breakout" | "momentum";
export type StrategyFilter = StrategyId | "all";

export const STRATEGIES: { id: StrategyFilter; label: string }[] = [
  { id: "all", label: "All Strategies" },
  { id: "trend", label: "Trend Continuation" },
  { id: "liquidity", label: "Liquidity Sweep" },
  { id: "smc", label: "BOS/CHoCH" },
  { id: "fvg", label: "FVG" },
  { id: "breakout", label: "Breakout & Retest" },
  { id: "momentum", label: "Momentum" },
];

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  trend: "Trend Continuation",
  liquidity: "Liquidity Sweep & Reversal",
  smc: "Smart Money (BOS/CHoCH)",
  fvg: "Fair Value Gap",
  breakout: "Breakout & Retest",
  momentum: "Momentum Divergence",
};

export type Dir = 1 | -1;
export type Trend = "BULLISH" | "BEARISH" | "NEUTRAL";

/** A confirmed setup found by one strategy on completed candles. */
export type Setup = {
  id: StrategyId;
  dir: Dir;
  /** Structural price beyond which the idea is wrong (stop is placed past it with an ATR buffer). */
  stopRef: number;
  confirmation: string;
  reversal: boolean;
};

export type Action = "BUY" | "SELL" | "WAIT" | "NO TRADE";
export type Grade = "HIGH CONFLUENCE" | "STRONG SETUP" | "MODERATE — WATCHLIST" | "WEAK — NO TRADE";

export type Check = { label: string; value: string; ok: boolean | null };

export type StrategyResult = {
  id: StrategyId;
  name: string;
  dir: Dir | null;
  score: number | null;
  action: Action;
  note: string;
};

export type Analysis = {
  action: Action;
  score: number;
  grade: Grade;
  strategy: string | null;
  strategyId: StrategyId | null;
  timeframe: Timeframe;
  higherTimeframe: AnyTimeframe;
  confirmTimeframe: Timeframe;
  higherTrend: Trend;
  marketOpen: boolean;
  /** Close time (ms) of the last COMPLETED candle used. */
  lastCandleTime: number | null;
  entry: number | null;
  entryZone: [number, number] | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  invalidation: string | null;
  confirmation: string | null;
  reasons: string[];
  checks: Check[];
  breakdown: { label: string; points: number; max: number }[];
  strategies: StrategyResult[];
};
