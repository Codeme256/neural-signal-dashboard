/**
 * Multi-timeframe confluence engine.
 *
 * - Works on COMPLETED candles only (the forming candle is dropped by time), so a confirmed
 *   result never changes when the next tick arrives.
 * - Every strategy must produce a confirmed setup; the engine is allowed (and expected) to
 *   return NO TRADE. Scores are heuristic confluence points, not win probabilities.
 */
import { emaSeries } from "./strategies/indicators";
import { buildContext, DETECTORS, higherTrend, type Context } from "./strategies/detectors";
import {
  CONFIRM_TF, HIGHER_TF, STRATEGY_NAMES, TF_SECONDS,
  type Action, type Analysis, type AnyTimeframe, type Check, type Dir, type Grade, type Ohlc,
  type Setup, type StrategyFilter, type StrategyId, type StrategyResult, type Timeframe, type Trend,
} from "./strategies/types";

export type ScoreWeights = { htf: number; structure: number; trigger: number; momentum: number; liquidity: number; risk: number };
export const DEFAULT_WEIGHTS: ScoreWeights = { htf: 20, structure: 20, trigger: 20, momentum: 15, liquidity: 15, risk: 10 };
export const MIN_RR = 2;
export const MIN_CANDLES = 60;
const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  htf: "Higher-timeframe alignment",
  structure: "Market structure",
  trigger: "Confirmed entry trigger",
  momentum: "Momentum & trend strength",
  liquidity: "Liquidity / S&R context",
  risk: "Volatility & risk/reward",
};

export function gradeFor(score: number): Grade {
  if (score >= 85) return "HIGH CONFLUENCE";
  if (score >= 70) return "STRONG SETUP";
  if (score >= 50) return "MODERATE — WATCHLIST";
  return "WEAK — NO TRADE";
}

export function actionFor(score: number, dir: Dir): Action {
  if (score >= 70) return dir === 1 ? "BUY" : "SELL";
  if (score >= 50) return "WAIT";
  return "NO TRADE";
}

/** Drops the forming candle: a candle counts only once its full period has elapsed. */
export function closedCandles(c: Ohlc[], tf: AnyTimeframe, now: number) {
  const ms = TF_SECONDS[tf] * 1000;
  return c.filter((k) => k.time + ms <= now);
}

/** Last completed candle must have closed within two periods (+1 min grace). */
export function isStale(closed: Ohlc[], tf: AnyTimeframe, now: number) {
  const last = closed.at(-1);
  if (!last) return true;
  const ms = TF_SECONDS[tf] * 1000;
  return now - (last.time + ms) > 2 * ms + 60000;
}

const trendOf = (dir: Dir): Trend => (dir === 1 ? "BULLISH" : "BEARISH");
const opposite = (t: Trend, dir: Dir) => t === trendOf(-dir as Dir);

// ---------------------------------------------------------------- levels

export type Levels = { entry: number; stopLoss: number; takeProfit1: number; takeProfit2: number; riskReward: number; zone: [number, number] | null };

/**
 * Structural stop (setup's invalidation price) plus an ATR buffer, TP2 at the nearest opposing
 * liquidity (or 3R when the path is clear), TP1 halfway (min 1R). Rejects when the opposing level
 * leaves less than `minRR`, or when the stop is unrealistically wide.
 */
export function buildLevels(setup: Setup, ctx: Context, opts: { decimals: number; spread?: number | undefined; minRR?: number | undefined }): { ok: true; levels: Levels } | { ok: false; reason: string } {
  const { atr, last } = ctx;
  const dir = setup.dir;
  const minRR = opts.minRR ?? MIN_RR;
  const spread = opts.spread ?? 0;
  const round = (v: number) => Number(v.toFixed(opts.decimals));
  const fmt = (v: number) => v.toFixed(opts.decimals);
  const entry = last.close;

  let stop = setup.stopRef - dir * (0.2 * atr + spread);
  let risk = dir * (entry - stop);
  if (!(risk > 0)) return { ok: false, reason: "Price is already beyond the setup's invalidation level" };
  if (risk < 0.5 * atr) { stop = entry - dir * 0.5 * atr; risk = 0.5 * atr; } // too tight = noise; use min ATR distance
  if (risk > 3 * atr) return { ok: false, reason: `Structural stop is ${(risk / atr).toFixed(1)}× ATR away — too wide` };

  const opp = dir === 1
    ? ctx.highs.map((s) => s.price).filter((p) => p > entry).sort((a, b) => a - b)[0]
    : ctx.lows.map((s) => s.price).filter((p) => p < entry).sort((a, b) => b - a)[0];
  const room = opp !== undefined ? dir * (opp - entry) : Infinity;
  if (room < minRR * risk) {
    return { ok: false, reason: `Nearest ${dir === 1 ? "resistance" : "support"} at ${fmt(opp!)} leaves only 1:${(room / risk).toFixed(1)} (min 1:${minRR})` };
  }
  const tp2Dist = room <= 4 * risk ? room : 3 * risk;
  const tp1Dist = Math.max(risk, tp2Dist / 2);

  const lv = { entry: round(entry), stopLoss: round(stop), takeProfit1: round(entry + dir * tp1Dist), takeProfit2: round(entry + dir * tp2Dist) };
  const r = dir * (lv.entry - lv.stopLoss);
  const t1 = dir * (lv.takeProfit1 - lv.entry);
  const t2 = dir * (lv.takeProfit2 - lv.entry);
  if (!(r > 0 && t1 > 0 && t2 > t1)) return { ok: false, reason: "Levels collapse at this instrument's price precision" };
  const rr = Math.round((t2 / r) * 10) / 10;
  if (rr < minRR) return { ok: false, reason: `Risk/reward 1:${rr} is below 1:${minRR}` };
  const zone: [number, number] | null = setup.id === "fvg" && ctx.fvg ? [round(ctx.fvg.bottom), round(ctx.fvg.top)] : null;
  return { ok: true, levels: { ...lv, riskReward: rr, zone } };
}

// ---------------------------------------------------------------- confirmation TF

/** Direction of the last completed confirmation candle, agreeing with EMA 9/21 on that timeframe. */
export function confirmDirection(c: Ohlc[]): Dir | 0 {
  if (c.length < 25) return 0;
  const closes = c.map((k) => k.close);
  const e9 = emaSeries(closes, 9).at(-1), e21 = emaSeries(closes, 21).at(-1);
  const last = c.at(-1)!;
  if (e9 == null || e21 == null) return 0;
  if (last.close > last.open && e9 > e21) return 1;
  if (last.close < last.open && e9 < e21) return -1;
  return 0;
}

// ---------------------------------------------------------------- scoring

export function scoreSetup(setup: Setup, ctx: Context, htf: Trend, levels: Levels, confirm: Dir | 0 | null, w: ScoreWeights = DEFAULT_WEIGHTS) {
  const dir = setup.dir;
  const t = trendOf(dir);
  const n = ctx.n;

  const htfF = htf === t ? 1 : htf === "NEUTRAL" ? 0.5 : 0;

  let st = ctx.structure === t ? 0.6 : ctx.structure === "NEUTRAL" ? 0.3 : 0;
  if (ctx.brk?.dir === dir) st = Math.max(st, ctx.brk.kind === "BOS" ? 1 : 0.8);
  if (setup.reversal && st === 0) st = 0.3; // reversals form against the old structure

  const trig = confirm === null ? 1 : confirm === dir ? 1 : confirm === 0 ? 0.7 : 0.4;

  const rsi = ctx.rsi[n - 1] ?? 50;
  const rsiPrev = ctx.rsi[n - 2] ?? rsi;
  let mom: number;
  if (setup.reversal) {
    mom = (dir * (rsi - rsiPrev) > 0 ? 0.5 : 0.1) + 0.3;
  } else {
    const r = dir * (rsi - 50);
    const rsiF = r >= 0 && r < 20 ? 0.5 : r >= 20 && r < 30 ? 0.2 : 0;
    const adxF = ctx.adx == null ? 0.1 : ctx.adx >= 25 ? 0.5 : ctx.adx >= 20 ? 0.3 : 0.1;
    mom = rsiF + adxF;
  }

  let liq = 0;
  if (ctx.sweep?.dir === dir) liq += ctx.sweep.confirmed ? 0.6 : 0.3;
  if (ctx.fvg?.dir === dir) liq += 0.4;
  const near = dir === 1
    ? ctx.lows.map((s) => s.price).filter((p) => p <= levels.entry).sort((a, b) => b - a)[0]
    : ctx.highs.map((s) => s.price).filter((p) => p >= levels.entry).sort((a, b) => a - b)[0];
  if (near !== undefined && Math.abs(levels.entry - near) <= 1.5 * ctx.atr) liq += 0.3;
  liq = Math.min(1, liq);

  const volRatio = ctx.atr / ctx.atrAvg;
  const risk = (levels.riskReward >= 3 ? 0.6 : levels.riskReward >= 2 ? 0.4 : 0) + (volRatio >= 0.6 && volRatio <= 1.8 ? 0.4 : 0.1);

  const parts: Record<keyof ScoreWeights, number> = { htf: htfF, structure: st, trigger: trig, momentum: mom, liquidity: liq, risk };
  const breakdown = (Object.keys(w) as (keyof ScoreWeights)[]).map((k) => ({ label: WEIGHT_LABELS[k], points: Math.round(Math.min(1, parts[k]) * w[k]), max: w[k] }));
  return { score: Math.min(100, breakdown.reduce((a, b) => a + b.points, 0)), breakdown };
}

// ---------------------------------------------------------------- analysis

export type AnalyzeInput = {
  candles: Ohlc[];
  higher?: Ohlc[] | null;
  confirm?: Ohlc[] | null;
  timeframe: Timeframe;
  now: number;
  open: boolean;
  decimals: number;
  strategy?: StrategyFilter;
  spread?: number;
  minRR?: number;
  weights?: ScoreWeights;
  lookback?: number;
};

const ALL_IDS = Object.keys(DETECTORS) as StrategyId[];

export function analyze(input: AnalyzeInput): Analysis {
  const { timeframe: tf, now, decimals } = input;
  const htfTf = HIGHER_TF[tf];
  const confTf = CONFIRM_TF[tf];
  const filter = input.strategy ?? "all";
  const ids = filter === "all" ? ALL_IDS : [filter];
  const fmt = (v: number) => v.toFixed(decimals);
  const closed = closedCandles(input.candles, tf, now);
  const lastClose = closed.at(-1) ? closed.at(-1)!.time + TF_SECONDS[tf] * 1000 : null;
  const higherClosed = input.higher ? closedCandles(input.higher, htfTf, now) : null;
  const htf: Trend = higherClosed && !isStale(higherClosed, htfTf, now) ? higherTrend(higherClosed) : "NEUTRAL";

  const base: Analysis = {
    action: "NO TRADE", score: 0, grade: "WEAK — NO TRADE", strategy: null, strategyId: null,
    timeframe: tf, higherTimeframe: htfTf, confirmTimeframe: confTf, higherTrend: htf, marketOpen: input.open,
    lastCandleTime: lastClose, entry: null, entryZone: null, stopLoss: null, takeProfit1: null, takeProfit2: null,
    riskReward: null, invalidation: null, confirmation: null, reasons: [], checks: [], breakdown: [],
    strategies: ids.map((id) => ({ id, name: STRATEGY_NAMES[id], dir: null, score: null, action: "NO TRADE", note: "Not evaluated" })),
  };
  const reject = (reason: string, extra: Partial<Analysis> = {}): Analysis => ({ ...base, ...extra, reasons: [reason, ...(extra.reasons ?? [])] });

  // Hard rejections on data quality / market state.
  if (!input.open) return reject("Market closed — no active signal.");
  if (closed.length < MIN_CANDLES) return reject(`Insufficient history: ${closed.length} completed ${tf} candles (need ${MIN_CANDLES}).`);
  if (isStale(closed, tf, now)) return reject(`Candle data is stale — last ${tf} candle closed ${new Date(lastClose!).toUTCString()}.`);
  const ctx = buildContext(closed, input.lookback ?? 3);
  if (!ctx) return reject("Could not compute indicators from the available candles.");

  const checks = buildChecks(ctx, htf, htfTf, fmt);
  const confirmClosed = confTf !== tf && input.confirm ? closedCandles(input.confirm, confTf, now) : null;
  const confirm: Dir | 0 | null = confTf === tf ? null : confirmClosed && !isStale(confirmClosed, confTf, now) ? confirmDirection(confirmClosed) : 0;
  checks.push({
    label: `${confTf} entry confirmation`,
    value: confirm === null ? `Confirmed on the ${tf} close` : confirm === 0 ? (confirmClosed ? "Not aligned yet" : "Data not loaded") : confirm === 1 ? "Bullish close, EMA 9 > 21" : "Bearish close, EMA 9 < 21",
    ok: confirm === null ? true : confirm === 0 ? null : true,
  });

  type Candidate = { setup: Setup; levels: Levels; score: number; breakdown: Analysis["breakdown"] };
  const candidates: Candidate[] = [];
  const strategies: StrategyResult[] = ids.map((id) => {
    const setup = DETECTORS[id](ctx);
    const name = STRATEGY_NAMES[id];
    if (!setup) return { id, name, dir: null, score: null, action: "NO TRADE", note: "No confirmed setup" };
    if (!setup.reversal && opposite(htf, setup.dir)) {
      return { id, name, dir: setup.dir, score: null, action: "NO TRADE", note: `Suppressed — against ${htfTf} ${htf.toLowerCase()} trend` };
    }
    const lv = buildLevels(setup, ctx, { decimals, spread: input.spread, minRR: input.minRR });
    if (!lv.ok) return { id, name, dir: setup.dir, score: null, action: "NO TRADE", note: lv.reason };
    const s = scoreSetup(setup, ctx, htf, lv.levels, confirm, input.weights);
    candidates.push({ setup, levels: lv.levels, ...s });
    return { id, name, dir: setup.dir, score: s.score, action: actionFor(s.score, setup.dir), note: setup.confirmation };
  });
  base.strategies = strategies;
  base.checks = checks;

  const dirs = new Set(candidates.map((c) => c.setup.dir));
  if (dirs.size > 1) {
    const b = candidates.filter((c) => c.setup.dir === 1).map((c) => STRATEGY_NAMES[c.setup.id]).join(", ");
    const s = candidates.filter((c) => c.setup.dir === -1).map((c) => STRATEGY_NAMES[c.setup.id]).join(", ");
    return reject(`Contradictory strategy conditions: ${b} bullish vs ${s} bearish.`);
  }
  if (!candidates.length) {
    const notes = strategies.filter((s) => s.dir !== null).map((s) => `${s.name}: ${s.note}`);
    return reject(filter === "all" ? "No strategy has a confirmed setup on completed candles." : `${STRATEGY_NAMES[filter]}: no tradeable setup.`, { reasons: notes });
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0]!;
  const { setup, levels } = best;
  const action = actionFor(best.score, setup.dir);
  const agree = candidates.length > 1 ? [`${candidates.length} strategies agree on ${setup.dir === 1 ? "bullish" : "bearish"} direction.`] : [];
  return {
    ...base,
    action,
    score: best.score,
    grade: gradeFor(best.score),
    strategy: STRATEGY_NAMES[setup.id],
    strategyId: setup.id,
    entry: levels.entry,
    entryZone: levels.zone,
    stopLoss: levels.stopLoss,
    takeProfit1: levels.takeProfit1,
    takeProfit2: levels.takeProfit2,
    riskReward: levels.riskReward,
    invalidation: `${setup.dir === 1 ? "Candle close below" : "Candle close above"} ${fmt(setup.stopRef)} invalidates the setup.`,
    confirmation: action === "WAIT" ? `${setup.confirmation} — watchlist, confluence below 70.` : `${setup.confirmation} (${tf} close).`,
    breakdown: best.breakdown,
    reasons: [...agree, ...(opposite(htf, setup.dir) ? [`Counter-trend vs ${htfTf} — higher-timeframe points withheld.`] : [])],
  };
}

function buildChecks(ctx: Context, htf: Trend, htfTf: AnyTimeframe, fmt: (v: number) => string): Check[] {
  const n = ctx.n;
  const e9 = ctx.ema9[n - 1], e21 = ctx.ema21[n - 1], e50 = ctx.ema50[n - 1], e200 = ctx.ema200[n - 1];
  const rsi = ctx.rsi[n - 1];
  const b = ctx.brk;
  const ema = e9 == null || e21 == null || e50 == null ? "Not enough data"
    : e9 > e21 && e21 > e50 ? "Bullish stack 9 > 21 > 50" : e9 < e21 && e21 < e50 ? "Bearish stack 9 < 21 < 50" : "Mixed — no clean stack";
  const ema200 = e200 == null ? " · EMA 200 n/a" : ` · price ${ctx.last.close > e200 ? "above" : "below"} EMA 200`;
  const ratio = ctx.atr / ctx.atrAvg;
  return [
    { label: "BOS", value: b?.kind === "BOS" ? `Confirmed ${b.dir === 1 ? "bullish" : "bearish"} close beyond ${fmt(b.level)}` : "Missing", ok: b?.kind === "BOS" ? true : false },
    { label: "CHoCH", value: b?.kind === "CHoCH" ? `Confirmed ${b.dir === 1 ? "bullish" : "bearish"} change of character at ${fmt(b.level)}` : "Missing", ok: b?.kind === "CHoCH" ? true : false },
    { label: "Market structure", value: ctx.structure === "NEUTRAL" ? "Neutral / ranging" : ctx.structure === "BULLISH" ? "Higher highs & higher lows" : "Lower highs & lower lows", ok: ctx.structure === "NEUTRAL" ? null : true },
    { label: "Liquidity sweep", value: ctx.sweep ? `${ctx.sweep.dir === 1 ? "Sell" : "Buy"}-side sweep of ${fmt(ctx.sweep.level)} — ${ctx.sweep.confirmed ? "reversal confirmed" : "awaiting confirmation"}` : "Absent", ok: ctx.sweep ? ctx.sweep.confirmed : false },
    { label: "Fair value gap", value: ctx.fvg ? `${ctx.fvg.dir === 1 ? "Bullish" : "Bearish"} ${ctx.fvg.state.toLowerCase()} ${fmt(ctx.fvg.bottom)}–${fmt(ctx.fvg.top)}` : "Absent", ok: ctx.fvg ? true : false },
    { label: "EMA alignment", value: ema + ema200, ok: ema.startsWith("Mixed") || ema.startsWith("Not") ? null : true },
    { label: "RSI 14", value: rsi == null ? "n/a" : `${rsi.toFixed(1)} — ${rsi >= 70 ? "overbought context" : rsi <= 30 ? "oversold context" : rsi >= 50 ? "bullish momentum" : "bearish momentum"}`, ok: rsi == null ? null : rsi < 70 && rsi > 30 },
    { label: "ADX 14", value: ctx.adx == null ? "n/a" : `${ctx.adx.toFixed(1)} — ${ctx.adx >= 25 ? "trending" : ctx.adx >= 20 ? "developing trend" : "weak / ranging"}`, ok: ctx.adx == null ? null : ctx.adx >= 20 },
    { label: "ATR 14", value: `${fmt(ctx.atr)} — ${ratio > 1.8 ? "elevated" : ratio < 0.6 ? "compressed" : "normal"} volatility (${ratio.toFixed(2)}× avg)`, ok: ratio >= 0.6 && ratio <= 1.8 },
    { label: `${htfTf} trend`, value: htf === "NEUTRAL" ? "Neutral / unavailable" : htf === "BULLISH" ? "Bullish" : "Bearish", ok: htf === "NEUTRAL" ? null : true },
  ];
}
