import { EMA, RSI } from 'technicalindicators';
import { z } from 'zod';

export const majorForex = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD'];
const syntheticSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'BOOM500', 'BOOM1000', 'CRASH500', 'CRASH1000', 'stpRNG'];
const number = z.number().finite().positive();
const symbolSchema = z.object({ underlying_symbol: z.string(), underlying_symbol_name: z.string(), market: z.string(), pip_size: number, exchange_is_open: z.number(), is_trading_suspended: z.number() });
export type DerivMarket = { symbol: string; ticker: string; name: string; category: string; derivSymbol: string; decimals: number; open: boolean; change: number; volatility: number; confidence: number; bias: string; horizon: string; note: string };
export type DerivQuote = { symbol: string; price: number; epoch: number; retrievedAt: number; open: boolean; source: string; change: number | null; volume: null; error: null };
export type Candle = { time: number; value: number };

export function parseDerivMarkets(raw: unknown): DerivMarket[] {
  return z.array(symbolSchema).parse(raw).filter(item => item.underlying_symbol === 'frxXAUUSD' || majorForex.some(pair => item.underlying_symbol === `frx${pair}`) || item.market === 'indices' || syntheticSymbols.includes(item.underlying_symbol)).map(item => {
    const symbol = item.underlying_symbol.replace(/^frx/, '');
    return { symbol, ticker: symbol, name: item.underlying_symbol_name, category: item.market === 'forex' ? 'FOREX' : item.market === 'commodities' ? 'METALS' : item.market === 'indices' ? 'STOCK INDICES' : 'SYNTHETIC', derivSymbol: item.underlying_symbol, decimals: Math.max(0, Math.round(-Math.log10(item.pip_size))), open: item.exchange_is_open === 1 && item.is_trading_suspended === 0, change: 0, volatility: 0, confidence: 0, bias: 'WAIT', horizon: '1H candles', note: '' };
  }).sort((a, b) => (a.symbol === 'XAUUSD' ? -1 : b.symbol === 'XAUUSD' ? 1 : a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
}

export function parseDerivQuote(market: DerivMarket, raw: unknown, retrievedAt: number): DerivQuote {
  const history = z.object({ prices: z.array(z.coerce.number().finite().positive()).min(1), times: z.array(number).min(1) }).parse(raw);
  if (history.prices.length !== history.times.length) throw new Error('Mismatched tick records');
  const price = history.prices.at(-1);
  const time = history.times.at(-1);
  if (price === undefined || time === undefined || time * 1000 > retrievedAt + 30000) throw new Error('Invalid tick time');
  return { symbol: market.symbol, price, epoch: time * 1000, retrievedAt, open: market.open, source: 'Deriv', change: null, volume: null, error: null };
}

export function derivQuoteStatus(quote: DerivQuote | undefined, now: number): 'LIVE' | 'CLOSED' | 'STALE' | 'UNAVAILABLE' {
  if (!quote) return 'UNAVAILABLE';
  if (now - quote.retrievedAt > 120000) return 'STALE';
  if (!quote.open) return 'CLOSED';
  return now - quote.epoch <= 120000 && quote.epoch <= now + 30000 ? 'LIVE' : 'STALE';
}

export function parseDerivCandles(raw: unknown): Candle[] {
  return z.array(z.object({ epoch: number, close: number })).parse(raw).map(row => ({ time: row.epoch * 1000, value: row.close })).sort((a,b) => a.time-b.time);
}

export function deriveSignal(points: Candle[], now: number, open: boolean) {
  // Signals use completed hourly candles only, never the currently forming bar.
  const closed = points.filter(point => point.time + 3600000 <= now);
  const values = closed.map(point => point.value);
  const last = closed.at(-1);
  if (values.length < 30 || !last) return { direction: 'WAIT', ema9: null, ema21: null, rsi: null, time: null, change: null, actionable: false, note: 'Waiting for at least 30 completed hourly candles.' };
  const ema9 = EMA.calculate({ period: 9, values }).at(-1) ?? null;
  const ema21 = EMA.calculate({ period: 21, values }).at(-1) ?? null;
  const rsi = RSI.calculate({ period: 14, values }).at(-1) ?? null;
  const current = open && now - (last.time + 3600000) <= 7200000;
  const direction = current && ema9 !== null && ema21 !== null && rsi !== null ? ema9 > ema21 && rsi >= 50 && rsi < 70 ? 'BULLISH' : ema9 < ema21 && rsi > 30 && rsi < 50 ? 'BEARISH' : 'WAIT' : 'WAIT';
  const first = closed.at(-25) ?? closed[0];
  return { direction, ema9, ema21, rsi, time: last.time + 3600000, change: first ? (last.value / first.value - 1) * 100 : null, actionable: current, note: !open ? 'Market closed. Indicators show the last completed session; no active signal.' : !current ? 'Candle data is stale. No active signal.' : direction === 'WAIT' ? 'Indicators are mixed or RSI is extended. No directional setup.' : `${direction === 'BULLISH' ? 'EMA 9 is above EMA 21 with RSI between 50 and 70.' : 'EMA 9 is below EMA 21 with RSI between 30 and 50.'} Technical indication only, not a Deriv recommendation.` };
}

export function formatMarketPrice(value: number | null | undefined, market: { derivSymbol?: string; decimals?: number }) {
  if (value == null) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: market.decimals ?? 2, maximumFractionDigits: market.decimals ?? 2 });
}