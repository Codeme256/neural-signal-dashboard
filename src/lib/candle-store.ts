import { derivRequest } from "./deriv-client";
import { parseDerivOhlc } from "./deriv-data";
import { TF_SECONDS, type AnyTimeframe, type Ohlc } from "./strategies/types";

/** Enough history for EMA 200 plus warm-up. */
export const CANDLE_COUNT = 300;
const MAX_ENTRIES = 150;

type Entry = { at: number; candles: Ohlc[] };
/** One shared request per key; it is cancelled only when every caller waiting on it has aborted. */
type Flight = { promise: Promise<Ohlc[]>; ctrl: AbortController; users: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Flight>();

/** Re-fetch a quarter of a candle period later (15 s – 5 min), so new closes show up without hammering the API. */
export function cacheTtl(tf: AnyTimeframe) {
  return Math.min(Math.max((TF_SECONDS[tf] * 1000) / 4, 15000), 300000);
}

function store(key: string, candles: Ohlc[]) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), candles });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

const abortError = () => new DOMException("Request cancelled", "AbortError");

function join(key: string, flight: Flight, signal?: AbortSignal): Promise<Ohlc[]> {
  if (signal?.aborted) return Promise.reject(abortError());
  flight.users++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const leave = () => { settled = true; flight.users--; signal?.removeEventListener("abort", onAbort); };
    const onAbort = () => {
      if (settled) return;
      leave();
      if (flight.users === 0) { flight.ctrl.abort(); if (inflight.get(key) === flight) inflight.delete(key); }
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    flight.promise.then(
      (v) => { if (!settled) { leave(); resolve(v); } },
      (e) => { if (!settled) { leave(); reject(e); } },
    );
  });
}

/** Real Deriv OHLC candles for a symbol + timeframe, cached and de-duplicated. */
export async function fetchCandles(derivSymbol: string, tf: AnyTimeframe, signal?: AbortSignal): Promise<Ohlc[]> {
  const key = `${derivSymbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheTtl(tf)) return hit.candles;
  let flight = inflight.get(key);
  if (!flight) {
    const ctrl = new AbortController();
    const f: Flight = { ctrl, users: 0, promise: Promise.resolve([]) };
    f.promise = derivRequest(
      { ticks_history: derivSymbol, count: CANDLE_COUNT, end: "latest", style: "candles", granularity: TF_SECONDS[tf] },
      { signal: ctrl.signal },
    )
      .then((r) => {
        const candles = parseDerivOhlc(r["candles"]);
        store(key, candles);
        return candles;
      })
      .finally(() => { if (inflight.get(key) === f) inflight.delete(key); });
    f.promise.catch(() => {}); // rejection is delivered to joined callers
    inflight.set(key, f);
    flight = f;
  }
  return join(key, flight, signal);
}

/** Real Deriv candles from `startMs` up to `endMs` (or now), used to check tracked signal outcomes. Cached per range. */
export async function fetchCandlesRange(derivSymbol: string, tf: AnyTimeframe, startMs: number, endMs: number, signal?: AbortSignal): Promise<Ohlc[]> {
  const key = `${derivSymbol}:${tf}:${startMs}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheTtl(tf)) return hit.candles;
  const end = endMs >= Date.now() ? "latest" : Math.floor(endMs / 1000);
  const r = await derivRequest(
    { ticks_history: derivSymbol, start: Math.floor(startMs / 1000), end, count: 5000, style: "candles", granularity: TF_SECONDS[tf] },
    { signal },
  );
  const candles = parseDerivOhlc(r["candles"]);
  store(key, candles);
  return candles;
}

export function clearCandleCache() {
  cache.clear();
}
