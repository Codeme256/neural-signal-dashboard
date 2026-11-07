import { TF_SECONDS, type Ohlc, type Timeframe } from "./strategies/types";

/** A tracked signal stops being followed after this many candles without hitting stop or TP1. */
export const EXPIRY_CANDLES = 48;

export type TrackStatus = "OPEN" | "WON" | "LOST" | "EXPIRED";

export type TrackedSignal = {
  id: string;
  derivSymbol: string;
  symbol: string;
  decimals: number;
  action: "BUY" | "SELL";
  timeframe: Timeframe;
  strategy: string | null;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  /** Close time (ms) of the signal candle — outcome is measured from the next candle on. */
  signalTime: number;
  trackedAt: number;
  status: TrackStatus;
  /** Best target reached: TP1 or TP2. */
  target: "TP1" | "TP2" | null;
  closedAt: number | null;
  checkedAt: number | null;
};

export type Outcome = Pick<TrackedSignal, "status" | "target" | "closedAt">;

export const signalId = (derivSymbol: string, tf: Timeframe, signalTime: number, action: string) => `${derivSymbol}:${tf}:${signalTime}:${action}`;

/**
 * Walks real candles after the signal and decides the result.
 * - Stop hit before TP1 = LOST. If stop and TP1 fall in the same candle, it counts as LOST (order inside a candle is unknown).
 * - TP1 hit first = WON; it keeps watching for TP2 until the stop or expiry.
 * - Neither within EXPIRY_CANDLES completed candles = EXPIRED.
 */
export function evaluateOutcome(s: Pick<TrackedSignal, "action" | "timeframe" | "stopLoss" | "takeProfit1" | "takeProfit2" | "signalTime">, candles: Ohlc[], now: number): Outcome {
  const tfMs = TF_SECONDS[s.timeframe] * 1000;
  const buy = s.action === "BUY";
  const end = s.signalTime + EXPIRY_CANDLES * tfMs;
  const after = candles.filter((c) => c.time >= s.signalTime && c.time < end).sort((a, b) => a.time - b.time);
  let tp1At: number | null = null;
  for (const c of after) {
    const hitSL = buy ? c.low <= s.stopLoss : c.high >= s.stopLoss;
    const hitTP1 = buy ? c.high >= s.takeProfit1 : c.low <= s.takeProfit1;
    const hitTP2 = buy ? c.high >= s.takeProfit2 : c.low <= s.takeProfit2;
    if (tp1At === null) {
      if (hitSL) return { status: "LOST", target: null, closedAt: c.time };
      if (hitTP2) return { status: "WON", target: "TP2", closedAt: c.time };
      if (hitTP1) tp1At = c.time;
    } else {
      if (hitSL) return { status: "WON", target: "TP1", closedAt: tp1At };
      if (hitTP2) return { status: "WON", target: "TP2", closedAt: c.time };
    }
  }
  if (now < end) return { status: tp1At !== null ? "WON" : "OPEN", target: tp1At !== null ? "TP1" : null, closedAt: null };
  return tp1At !== null ? { status: "WON", target: "TP1", closedAt: tp1At } : { status: "EXPIRED", target: null, closedAt: end };
}

/** True once nothing more can change (a TP1 win still waits for TP2 until it closes). */
export const isFinal = (s: Pick<TrackedSignal, "closedAt">) => s.closedAt !== null;

export function summarize(list: Pick<TrackedSignal, "status">[]) {
  const won = list.filter((s) => s.status === "WON").length;
  const lost = list.filter((s) => s.status === "LOST").length;
  const open = list.filter((s) => s.status === "OPEN").length;
  const expired = list.filter((s) => s.status === "EXPIRED").length;
  const decided = won + lost;
  return { total: list.length, won, lost, open, expired, winRate: decided ? Math.round((won / decided) * 100) : null };
}

// ---- account storage row mapping (store lives in tracker-store.ts) ----
export type TrackedRow = {
  id: string; deriv_symbol: string; symbol: string; decimals: number; action: string; timeframe: string; strategy: string | null;
  score: number; entry: number; stop_loss: number; take_profit1: number; take_profit2: number; signal_time: number; tracked_at: number;
  status: string; target: string | null; closed_at: number | null; checked_at: number | null;
};

export const rowToSignal = (r: TrackedRow): TrackedSignal => ({
  id: r.id, derivSymbol: r.deriv_symbol, symbol: r.symbol, decimals: r.decimals, action: r.action as TrackedSignal["action"],
  timeframe: r.timeframe as Timeframe, strategy: r.strategy, score: r.score, entry: r.entry, stopLoss: r.stop_loss,
  takeProfit1: r.take_profit1, takeProfit2: r.take_profit2, signalTime: Number(r.signal_time), trackedAt: Number(r.tracked_at),
  status: r.status as TrackStatus, target: r.target as TrackedSignal["target"],
  closedAt: r.closed_at === null ? null : Number(r.closed_at), checkedAt: r.checked_at === null ? null : Number(r.checked_at),
});

export const signalToRow = (s: TrackedSignal): TrackedRow => ({
  id: s.id, deriv_symbol: s.derivSymbol, symbol: s.symbol, decimals: s.decimals, action: s.action, timeframe: s.timeframe,
  strategy: s.strategy, score: Math.round(s.score), entry: s.entry, stop_loss: s.stopLoss, take_profit1: s.takeProfit1,
  take_profit2: s.takeProfit2, signal_time: s.signalTime, tracked_at: s.trackedAt, status: s.status, target: s.target,
  closed_at: s.closedAt, checked_at: s.checkedAt,
});

export const patchToRow = (p: Partial<TrackedSignal>): Partial<TrackedRow> => {
  const out: Partial<TrackedRow> = {};
  if (p.status !== undefined) out.status = p.status;
  if (p.target !== undefined) out.target = p.target;
  if (p.closedAt !== undefined) out.closed_at = p.closedAt;
  if (p.checkedAt !== undefined) out.checked_at = p.checkedAt;
  return out;
};
