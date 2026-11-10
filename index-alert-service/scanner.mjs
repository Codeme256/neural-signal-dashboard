/** Price-only, completed-H1-candle continuation monitor. No orders or accounts. */
const HOUR = 3600_000;
const round = (x, d) => Number(x.toFixed(d));
const ema = (values, period) => {
  if (values.length < period) return [];
  const out = Array(values.length).fill(null);
  let previous = values.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i++) {
    previous = values[i] * (2 / (period + 1)) + previous * (1 - 2 / (period + 1));
    out[i] = previous;
  }
  return out;
};
export function normalizeCandles(raw, now, period = HOUR) {
  if (!Array.isArray(raw)) return [];
  const found = new Map();
  for (const item of raw) {
    const epoch = Number(item?.epoch);
    const c = { time: epoch * 1000, open: Number(item?.open), high: Number(item?.high),
      low: Number(item?.low), close: Number(item?.close) };
    if (!Object.values(c).every(Number.isFinite) || c.time <= 0 ||
        Math.min(c.open,c.close,c.high,c.low) <= 0 ||
        c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close) ||
        c.time + period > now || c.time > now + period) continue;
    found.set(c.time, c);
  }
  return [...found.values()].sort((a,b) => a.time - b.time);
}
export function computeIndexTrendSignal(candles, { symbol, now, decimals = 2 }) {
  if (!Array.isArray(candles) || candles.length < 80 || typeof symbol !== "string") return null;
  const current = candles.at(-1), previous = candles.at(-2);
  if (!current || !previous || now - (current.time + HOUR) > HOUR + 60_000 ||
      current.time + HOUR > now || current.time - previous.time !== HOUR) return null;
  const closes = candles.map(c => c.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21), e55 = ema(closes, 55);
  const n = candles.length - 1;
  const trueRanges = candles.slice(1).map((c,i) =>
    Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
  const atr = trueRanges.slice(-14).reduce((a,b) => a+b,0)/14;
  if (!(atr > 0)) return null;
  const a=e9[n],b=e21[n],c=e55[n], prevSlow=e55[n-4];
  if (![a,b,c,prevSlow].every(x => Number.isFinite(x))) return null;
  const up = a>b && b>c && c>prevSlow && current.close>previous.high && current.close>current.open;
  const down = a<b && b<c && c<prevSlow && current.close<previous.low && current.close<current.open;
  if (!up && !down) return null;
  const dir = up?1:-1;
  const pullback = candles.slice(-5,-1).some(k => up
    ? k.low<=b+0.25*atr && k.close>=c-0.25*atr
    : k.high>=b-0.25*atr && k.close<=c+0.25*atr);
  if (!pullback) return null;
  const recent = candles.slice(-5);
  const stopRef = up?Math.min(...recent.map(k=>k.low)):Math.max(...recent.map(k=>k.high));
  const entry = current.close;
  const stop = stopRef - dir*0.2*atr;
  const risk = dir*(entry-stop);
  if (risk < 0.5*atr || risk > 3*atr) return null;
  // Hypothetical 0.1 ATR per-trade friction. Not an observed executable spread.
  const friction = 0.1*atr;
  const grossTpDist = 2.75*risk;
  const netRR = (grossTpDist-friction)/(risk+friction);
  if (netRR < 2) return null;
  const d = Number.isInteger(decimals)?Math.max(0,Math.min(8,decimals)):2;
  const levels = {
    entry:round(entry,d), stopLoss:round(stop,d),
    tp1:round(entry + dir*risk,d), tp2:round(entry + dir*grossTpDist,d),
  };
  const roundedRisk=dir*(levels.entry-levels.stopLoss);
  const roundedReward=dir*(levels.tp2-levels.entry);
  if (!(roundedRisk>0 && roundedReward/roundedRisk>=2.0 &&
    dir*(levels.tp1-levels.entry)>0 && dir*(levels.tp2-levels.tp1)>0)) return null;
  return {
    id:[symbol,"H1",current.time+HOUR,dir===1?"BUY":"SELL","server-trend-v1"].join("|"),
    symbol, strategy:"Server H1 EMA Trend Continuation (experimental)",
    direction:dir===1?"BUY":"SELL",timeframe:"H1",
    ...levels, rr:round(roundedReward/roundedRisk,2), candleTime:current.time+HOUR,
  };
}
