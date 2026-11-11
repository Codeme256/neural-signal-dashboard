import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { signalId } from "@/lib/signal-tracker";
import { trackerStore } from "@/lib/tracker-store";
import { pairStrategyReviews, verdictFor, alternativesFor, type PairStrategyReview } from "@/lib/pair-strategy-policy";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DerivMarket } from "@/lib/deriv-data";
import { formatMarketPrice } from "@/lib/deriv-data";
import { analyze } from "@/lib/signal-engine";
import { analyzeIndex, INDEX_STRATEGIES, INDEX_DEFAULT_ENABLED, type IndexStrategyId, type IndexStrategySelection } from "@/lib/index-signal-engine";
import { analyzeBtc, isBitcoinMarket, BTC_STRATEGIES, BTC_DEFAULT_ENABLED, type BtcStrategyId, type BtcStrategySelection } from "@/lib/btc-signal-engine";
import { storeScanSession } from "@/lib/index-scan-history";
import { fetchCandles } from "@/lib/candle-store";
import { DerivError, isAbortError } from "@/lib/deriv-client";
import { CONFIRM_TF, HIGHER_TF, STRATEGIES, TIMEFRAMES, type Analysis, type StrategyFilter, type Timeframe } from "@/lib/strategies/types";
import { NeuralCanvas } from "./NeuralCanvas";
import { NeuralScan } from "./NeuralScan";

type Result = { market: DerivMarket; analysis: Analysis | null; error?: string };
const MIN_STRENGTH = 70;
/** Pairs analysed at once; the Deriv client additionally caps simultaneous requests. */
const BATCH = 3;
// Remember the user's last choice between scans.
const lastChoice: { tf: Timeframe; strategy: StrategyFilter } = { tf: "H1", strategy: "all" };
const readBtcEnabled = (): BtcStrategyId[] => { try { const data=JSON.parse(localStorage.getItem("tradepulse-btc-enabled-v1")??"null"); return Array.isArray(data)?BTC_STRATEGIES.filter(s=>data.includes(s.id)).map(s=>s.id):BTC_DEFAULT_ENABLED; }catch{return BTC_DEFAULT_ENABLED;} };
const readEnabled = (): IndexStrategyId[] => { try { const v = JSON.parse(localStorage.getItem("tradepulse-index-enabled-v1") || "null"); return Array.isArray(v) ? INDEX_STRATEGIES.filter(s => v.includes(s.id)).map(s => s.id) : INDEX_DEFAULT_ENABLED; } catch { return INDEX_DEFAULT_ENABLED; } };

async function analyseMarket(m: DerivMarket, tf: Timeframe, strategy: StrategyFilter, indexStrategy: IndexStrategySelection, enabled: IndexStrategyId[], breakoutThreshold: number, btcStrategy:BtcStrategySelection, btcEnabled:BtcStrategyId[], signal: AbortSignal): Promise<Result> {
  try {
    return await analyseMarketUnsafe(m, tf, strategy, indexStrategy, enabled, breakoutThreshold, btcStrategy, btcEnabled, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { market: m, analysis: null, error: "Analysis failed for this market." };
  }
}

async function analyseMarketUnsafe(m: DerivMarket, tf: Timeframe, strategy: StrategyFilter, indexStrategy: IndexStrategySelection, enabled: IndexStrategyId[], breakoutThreshold: number, btcStrategy:BtcStrategySelection, btcEnabled:BtcStrategyId[], signal: AbortSignal): Promise<Result> {
  let candles;
  try {
    candles = await fetchCandles(m.derivSymbol, tf, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    const unsupported = e instanceof DerivError && !e.disconnected && e.code !== "Timeout";
    return { market: m, analysis: null, error: unsupported ? `Deriv does not provide ${tf} candles for ${m.symbol}.` : "Live data unavailable for this market right now." };
  }
  const higher = await fetchCandles(m.derivSymbol, HIGHER_TF[tf], signal).catch((e) => { if (isAbortError(e)) throw e; return null; });
  const input = { candles, higher, timeframe: tf, open: m.open, decimals: m.decimals, strategy };
  const btc = isBitcoinMarket(m.derivSymbol,m.category);
  let analysis = btc
    ? analyzeBtc({ candles, higher, timeframe: tf, open: m.open, decimals: m.decimals, strategy: btcStrategy, enabled: btcEnabled, now: Date.now() })
    : m.category === "INDEX"
      ? analyzeIndex({ candles, higher, timeframe: tf, open: m.open, decimals: m.decimals, strategy: indexStrategy, enabled, breakoutAtrThreshold: breakoutThreshold, now: Date.now() })
      : analyze({ ...input, now: Date.now() });
  // Only fetch the lower confirmation timeframe when there is a setup worth confirming.
  if (!btc && m.category !== "INDEX" && CONFIRM_TF[tf] !== tf && analysis.entry !== null) {
    const confirm = await fetchCandles(m.derivSymbol, CONFIRM_TF[tf], signal).catch((e) => { if (isAbortError(e)) throw e; return null; });
    analysis = analyze({ ...input, confirm, now: Date.now() });
  }
  return { market: m, analysis };
}

export function ScanDialog({ open, markets, prices: _prices, onClose, label = "all open markets", section = "all", single = false }: { section?: string; open: boolean; markets: DerivMarket[]; prices: Map<string, number>; onClose: () => void; label?: string; single?: boolean | undefined }) {
  const trackedSignals = useSyncExternalStore(trackerStore.subscribe, trackerStore.get, trackerStore.getServer);
  const reviews = pairStrategyReviews(trackedSignals);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);
  const [tf, setTf] = useState<Timeframe>(lastChoice.tf);
  const [strategy, setStrategy] = useState<StrategyFilter>(lastChoice.strategy);
  const [indexStrategy, setIndexStrategy] = useState<IndexStrategySelection>("all");
  const [btcStrategy, setBtcStrategy] = useState<BtcStrategySelection>("all");
  const [btcEnabled, setBtcEnabled] = useState<BtcStrategyId[]>(readBtcEnabled);
  const [indexEnabled, setIndexEnabled] = useState<IndexStrategyId[]>(readEnabled);
  const [breakoutThreshold, setBreakoutThreshold] = useState(0.25);
  const onlyIndex = section === "index" || (markets.length > 0 && markets.every(m => m.category === "INDEX"));
  const onlyBtc = section === "btcusd" || (markets.length > 0 && markets.every(m=>isBitcoinMarket(m.derivSymbol,m.category)));

  useEffect(() => {
    if (!open) return;
    lastChoice.tf = tf; lastChoice.strategy = strategy;
    const ctrl = new AbortController();
    setProgress(0); setResults([]); setDone(false);
    const started = performance.now();
    (async () => {
      // For index scans, include weekend-closed instruments as NO TRADE analyses instead of reporting 0 scans.
      // All other asset classes preserve the prior open-market-only behavior.
      const targets = single || onlyIndex ? markets : markets.filter((m) => m.open);
      const track = (found: number) => window.__lovableEvents?.track?.("project.market_scan_completed", { section, pairs_scanned: targets.length, signals_found: found, has_results: found > 0, timeframe: tf });
      if (!targets.length) { setDone(true); track(0); return; }
      const found: Result[] = [];
      try {
        for (let i = 0; i < targets.length; i += BATCH) {
          const batch = targets.slice(i, i + BATCH);
          setCurrent(batch.map((m) => m.symbol).join(" · "));
          found.push(...(await Promise.all(batch.map((m) => analyseMarket(m, tf, strategy, indexStrategy, indexEnabled, breakoutThreshold, btcStrategy, btcEnabled, ctrl.signal)))));
          setProgress(Math.round(((i + batch.length) / targets.length) * 100));
          await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive between batches
        }
      } catch (e) {
        if (isAbortError(e)) return;
        throw e;
      }
      // Let the scan animation play for at least ~2s, even when candles come from cache.
      await new Promise((r) => setTimeout(r, Math.max(400, 2000 - (performance.now() - started))));
      if (ctrl.signal.aborted) return;
      setResults(found);
      setDone(true);
      void storeScanSession(found.map(r => ({ symbol: r.market.symbol, derivSymbol: r.market.derivSymbol, category: r.market.category, timeframe: tf, strategy: r.analysis?.strategy ?? (r.market.category === "INDEX" ? indexStrategy : strategy), action: r.analysis?.action ?? "UNAVAILABLE", at: Date.now(), candleTime: r.analysis?.lastCandleTime ?? null, entry: r.analysis?.entry ?? null, stopLoss: r.analysis?.stopLoss ?? null, tp1: r.analysis?.takeProfit1 ?? null, tp2: r.analysis?.takeProfit2 ?? null, error: r.error ?? r.analysis?.reasons.join("; ") ?? null, indicatorSnapshot: r.analysis?.checks ?? [], marketRegime: r.analysis?.marketRegime ?? null, dataStatus: r.error ? "UNAVAILABLE" as const : r.analysis?.reasons.some(x=>/stale/i.test(x)) ? "STALE" as const : r.analysis?.marketOpen ? "FRESH" as const : "CLOSED" as const }))).catch(console.error);
      for (const r of found) if ((r.market.category === "INDEX" || isBitcoinMarket(r.market.derivSymbol,r.market.category)) && r.analysis && (r.analysis.action === "BUY" || r.analysis.action === "SELL")) {
        const a = r.analysis;
        if (a.lastCandleTime != null && a.entry != null && a.stopLoss != null && a.takeProfit1 != null && a.takeProfit2 != null) {
          const id = signalId(r.market.derivSymbol, tf, a.lastCandleTime, a.action);
          const policy=verdictFor(pairStrategyReviews(trackerStore.get()),r.market.symbol,a.strategy);
          if (policy?.verdict==="AVOID") continue;
          if (!trackerStore.has(id)) void trackerStore.add({ id, derivSymbol: r.market.derivSymbol, symbol: r.market.symbol, decimals: r.market.decimals, action: a.action as "BUY" | "SELL", timeframe: tf, strategy: a.strategy, score: a.score, entry: a.entry, stopLoss: a.stopLoss, takeProfit1: a.takeProfit1, takeProfit2: a.takeProfit2, signalTime: a.lastCandleTime }).catch(console.error);
        }
      }
      track(found.filter((r) => r.analysis && (r.analysis.action === "BUY" || r.analysis.action === "SELL")).length);
    })();
    return () => ctrl.abort(); // cancel queued requests when closed or settings change
  }, [open, tf, strategy, indexStrategy, indexEnabled, breakoutThreshold, btcStrategy, btcEnabled]);

  const ranked = results.filter((r) => r.analysis).sort((a, b) => b.analysis!.score - a.analysis!.score);
  const strongAll = ranked.filter((r) => r.analysis!.action === "BUY" || r.analysis!.action === "SELL");
  const avoided = strongAll.filter(r=>verdictFor(reviews,r.market.symbol,r.analysis!.strategy)?.verdict==="AVOID");
  const strong = strongAll.filter(r=>verdictFor(reviews,r.market.symbol,r.analysis!.strategy)?.verdict!=="AVOID");
  const watch = ranked.filter((r) => r.analysis!.action === "WAIT");
  const unavailable = results.filter((r) => r.error);
  const noTrade = results.filter((r) => r.analysis?.action === "NO TRADE");
  const closed = results.filter(r => !r.market.open);
  const totalIndex = onlyIndex ? markets.length : 0;
  const one = single ? results[0] : undefined;
  const strategyLabel = onlyBtc ? (BTC_STRATEGIES.find(s=>s.id===btcStrategy)?.label??"Enabled BTC strategies") : onlyIndex ? (INDEX_STRATEGIES.find(s => s.id === indexStrategy)?.label ?? "Enabled Index Strategies") : (STRATEGIES.find((s) => s.id === strategy)?.label ?? "All Strategies");

  const title = !done ? "NEURAL SCAN RUNNING"
    : single ? `${markets[0]?.symbol ?? ""} · ${one?.analysis?.action ?? "UNAVAILABLE"}`
    : onlyIndex && markets.length === 0 ? "INDEX FEED UNAVAILABLE"
    : onlyIndex && markets.every(m=>!m.open) ? "INDEX MARKETS CLOSED"
    : `${strong.length} STRONG SIGNAL${strong.length === 1 ? "" : "S"}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="signal-panel max-h-[90vh] max-w-2xl overflow-hidden border-primary/40 p-0">
        <div className="relative h-32 shrink-0 overflow-hidden border-b border-border">
          <NeuralCanvas intensity={done ? 0.6 : 3} className="absolute inset-0 h-full w-full" />
          <div className="relative flex h-full flex-col justify-end p-5">
            <DialogTitle className="font-display text-2xl font-bold tracking-tight">{title}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {done ? `${single ? "Full analysis" : `Confluence ${MIN_STRENGTH}+`} · ${tf} timeframe · ${strategyLabel}` : `Analysing ${current}`}
            </DialogDescription>
          </div>
        </div>

        <div className="max-h-[calc(90vh-8rem)] overflow-y-auto p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button key={t} onClick={() => setTf(t)} aria-pressed={tf === t} className={`chip chip-sm ${tf === t ? "chip-active" : ""}`}>{t}</button>
              ))}
            </div>
            {onlyBtc ? (
              <Select value={btcStrategy} onValueChange={(v)=>setBtcStrategy(v as BtcStrategySelection)}>
                <SelectTrigger aria-label="BTC strategy" className="h-8 w-auto min-w-40 border-border bg-card/60 font-mono text-xs sm:ml-auto"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All enabled BTC strategies</SelectItem>
                  {BTC_STRATEGIES.filter(st=>st.timeframes.some(t=>t===tf)).map(st=><SelectItem key={st.id} value={st.id}>{st.label} · experimental</SelectItem>)}
                </SelectContent>
              </Select>
            ) : onlyIndex ? (
              <Select value={indexStrategy} onValueChange={(v) => setIndexStrategy(v as IndexStrategySelection)}>
                <SelectTrigger aria-label="Index strategy" className="h-8 w-auto min-w-40 border-border bg-card/60 font-mono text-xs sm:ml-auto"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All enabled index strategies</SelectItem>
                  {INDEX_STRATEGIES.filter(s => s.timeframes.some(t => t === tf)).map(s => <SelectItem key={s.id} value={s.id}>{s.label}{s.experimental ? " · experimental" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Select value={strategy} onValueChange={(v) => setStrategy(v as StrategyFilter)}>
                <SelectTrigger aria-label="Forex strategy" className="h-8 w-auto min-w-40 border-border bg-card/60 font-mono text-xs sm:ml-auto"><SelectValue /></SelectTrigger>
                <SelectContent>{STRATEGIES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>

          {onlyBtc && <div className="mb-3 rounded-lg border border-border p-3">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">BTCUSD-ONLY QUANT STRATEGIES · FOREX & INDICES UNAFFECTED</p>
            <div className="mt-2 flex flex-wrap gap-2">{BTC_STRATEGIES.map(item=><label key={item.id} className="flex items-center gap-1.5 font-mono text-[11px]">
              <input type="checkbox" checked={btcEnabled.includes(item.id)} onChange={e=>{
                const next=e.target.checked?[...btcEnabled,item.id]:btcEnabled.filter(x=>x!==item.id);
                setBtcEnabled(next);try{localStorage.setItem("tradepulse-btc-enabled-v1",JSON.stringify(next));}catch{}
              }}/>{item.label} · experimental
            </label>)}</div>
            <p className="mt-2 text-[10px] text-muted-foreground">Signals are based on completed Deriv BTCUSD candles. These rules are testable, not proven profitable. No orders are placed.</p>
          </div>}
          {onlyIndex && <div className="mb-3 rounded-lg border border-border p-3">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">INDEX-ONLY STRATEGIES · ENABLE/DISABLE (FOREX UNAFFECTED)</p>
            <div className="mt-2 flex flex-wrap gap-2">{INDEX_STRATEGIES.map(item => (
              <label key={item.id} className="flex items-center gap-1.5 font-mono text-[11px]">
                <input type="checkbox" checked={indexEnabled.includes(item.id)} onChange={e => {
                  const next = e.target.checked ? [...indexEnabled, item.id] : indexEnabled.filter(x => x !== item.id);
                  setIndexEnabled(next); try { localStorage.setItem("tradepulse-index-enabled-v1", JSON.stringify(next)); } catch {}
                }}/>
                {item.label}{item.experimental ? " (experimental)" : ""}
              </label>
            ))}</div>
            <label className="mt-2 flex items-center gap-2 font-mono text-[11px]">ATR breakout threshold <input type="number" min="0.1" max="2" step="0.05" value={breakoutThreshold} onChange={e=>setBreakoutThreshold(Math.min(2,Math.max(0.1,Number(e.target.value)||0.25)))} className="w-20 rounded border border-border bg-background p-1"/> × ATR</label>
            <p className="mt-1 text-[10px] text-muted-foreground">Benchmark enabled by default; experimental strategies require opt-in. Index results use completed Deriv OHLC candles only.</p>
          </div>}
          {!done && (
            <div className="py-2 font-mono text-sm text-primary">
              <NeuralScan
                progress={progress}
                symbols={(single || onlyIndex ? markets : markets.filter((m) => m.open)).map((m) => m.symbol)}
                active={current.split(" · ")}
                className="mb-3 h-52 w-full"
              />
              <div className="mb-2 flex justify-between"><span className="animate-pulse">▸ Scanning {label} · {tf}</span><span>{progress}%</span></div>
              <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="strength-fill h-full" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {done && single && (
            one?.analysis ? <div className="space-y-3">
              {verdictFor(reviews,one.market.symbol,one.analysis.strategy)?.verdict==="AVOID"&&
               <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-400">
                <strong>HISTORICALLY WEAK PAIR / STRATEGY — NEW SIGNAL AVOIDED</strong>
                <p className="mt-2">{verdictFor(reviews,one.market.symbol,one.analysis.strategy)?.message}</p>
               </div>}
              <SignalCard market={one.market} analysis={one.analysis} detailed blocked={verdictFor(reviews,one.market.symbol,one.analysis.strategy)?.verdict==="AVOID"}/>
            </div> : <p className="py-8 text-center text-muted-foreground">{one?.error ?? "No data for this market."}</p>
          )}

          {done && !single && (
            <div className="space-y-3">
              {onlyIndex && markets.length === 0 && (
                <div role="status" className="rounded-lg border border-warn/40 bg-background/60 p-4 text-sm text-muted-foreground">
                  <p className="font-display text-base font-semibold text-foreground">No Deriv stock-index symbols returned</p>
                  <p className="mt-2">The connected public Deriv symbols feed has not supplied any stock indices. No signal can be calculated without a real market-data feed. This is a feed-availability problem, not confirmation that all six strategies failed.</p>
                </div>
              )}
              {onlyIndex && closed.length > 0 && (
                <div role="status" className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">{closed.length} index market{closed.length===1?" is":"s are"} closed</p>
                  <p className="mt-1">Stock indices normally close on weekends. Last completed candles, if available, are for reference only; no live BUY or SELL signals are issued while the market is closed.</p>
                </div>
              )}
              {strong.length === 0 && !onlyIndex && <p className="py-6 text-center text-muted-foreground">No strong signals on {tf} right now. The engine only signals confirmed setups — try another timeframe or scan again later.</p>}
              {strong.length === 0 && onlyIndex && markets.some(m=>m.open) && <p className="py-2 text-center text-muted-foreground">No fully confirmed index signals on {tf}. See NO TRADE / WAIT results below for the specific reason.</p>}
              {strong.map((r) => <SignalCard key={r.market.derivSymbol} market={r.market} analysis={r.analysis!} />)}
              {onlyIndex && [...noTrade,...results.filter(r=>r.analysis?.action==="WAIT")].map(r=>(
                <div key={r.market.derivSymbol} className="rounded-lg border border-border bg-background/40 p-3 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display text-base font-semibold">{r.market.name}</span>
                    <span className="text-warn">{r.analysis?.action} · {r.market.open?"OPEN":"CLOSED"}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{r.analysis?.reasons.join(" · ") || "No confirmed setup"}</p>
                  {r.analysis?.lastCandleTime && <p className="mt-1 text-muted-foreground">Last completed candle: {new Date(r.analysis.lastCandleTime).toLocaleString()}</p>}
                </div>
              ))}
              {onlyIndex && unavailable.map(r=>(
                <div key={r.market.derivSymbol} className="rounded-lg border border-border bg-background/40 p-3 font-mono text-xs">
                  <strong>{r.market.name}</strong><p className="mt-1 text-muted-foreground">DATA UNAVAILABLE · {r.error}</p>
                </div>
              ))}
              {watch.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground">WATCHLIST · CONFLUENCE 50–69</div>
                  <div className="space-y-1.5">
                    {watch.map((r) => (
                      <div key={r.market.derivSymbol} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-xs">
                        <span className="font-display text-sm font-bold">{r.market.symbol}</span>
                        <span className="truncate text-muted-foreground">{r.analysis!.strategy}</span>
                        <span className="text-warn">{r.analysis!.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {onlyIndex ? `Checked ${results.length}/${totalIndex} index markets · ${closed.length} closed · ${unavailable.length} data unavailable` : `Scanned ${results.length} open market${results.length === 1 ? "" : "s"}${unavailable.length ? ` · ${unavailable.length} unavailable` : ""}`}. Scores are confluence points, not win probabilities. Technical indication from live Deriv data — not financial advice.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_CLASS: Record<Analysis["action"], string> = { BUY: "signal-buy", SELL: "signal-sell", WAIT: "signal-wait", "NO TRADE": "signal-none" };
const ACTION_TEXT: Record<Analysis["action"], string> = { BUY: "▲ BUY", SELL: "▼ SELL", WAIT: "◷ WAIT", "NO TRADE": "■ NO TRADE" };

function timeAgo(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

function SignalCard({ market, analysis: a, detailed = false, blocked = false }: { market: DerivMarket; analysis: Analysis; detailed?: boolean; blocked?: boolean }) {
  const fmt = (v: number | null) => formatMarketPrice(v, market);
  const hasLevels = a.entry !== null;
  const tone = a.score >= 70 ? "text-bull" : a.score >= 50 ? "text-warn" : "text-muted-foreground";
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-muted/30 p-4 duration-500">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-xl font-bold">{market.symbol}</div>
          <div className="truncate text-xs text-muted-foreground">{market.name}</div>
        </div>
        <span className={`shrink-0 rounded-md px-3 py-1 font-display text-lg font-bold ${ACTION_CLASS[a.action]}`}>{ACTION_TEXT[a.action]}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] tracking-wider text-muted-foreground">
        <span>{market.category}</span>
        <span>{a.timeframe}</span>
        <span>{a.higherTimeframe} {a.higherTrend}</span>
        <span className={a.marketOpen ? "text-bull" : ""}>{a.marketOpen ? "OPEN" : "CLOSED"}</span>
        {a.lastCandleTime && <span title={new Date(a.lastCandleTime).toUTCString()}>CANDLE {new Date(a.lastCandleTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {timeAgo(a.lastCandleTime)}</span>}
        {a.expiresAt && <span>EXPIRES {new Date(a.expiresAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>}
        {market.category === "INDEX" && <span>DERIV OHLC · PRICE-ONLY</span> }
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="strength-fill h-full rounded-full" style={{ width: `${a.score}%` }} /></div>
        <span className={`font-mono text-sm font-bold ${tone}`}>{a.score} · {a.grade}</span>
      </div>
      {a.strategy && <div className="mt-1 font-mono text-[11px] text-primary">{a.strategy}</div>}

      {hasLevels && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
            <Level label={a.entryZone ? "ENTRY ZONE" : "ENTRY"} value={a.entryZone ? `${fmt(a.entryZone[0])}–${fmt(a.entryZone[1])}` : fmt(a.entry)} tone="text-primary" />
            <Level label="STOP LOSS" value={fmt(a.stopLoss)} tone="text-bear" />
            <Level label="TP 1" value={fmt(a.takeProfit1)} tone="text-bull" />
            <Level label="TP 2" value={fmt(a.takeProfit2)} tone="text-bull" />
          </div>
          <div className="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
            <span><span className="text-foreground">R:R 1:{a.riskReward}</span>{a.entryZone ? ` · ref. entry ${fmt(a.entry)}` : ""}</span>
            {a.confirmation && <span>✓ {a.confirmation}</span>}
            {a.invalidation && <span>✕ {a.invalidation}</span>}
          </div>
          {(a.action === "BUY" || a.action === "SELL") && !blocked && <TrackButton market={market} analysis={a} />}
        </>
      )}
      {a.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {a.reasons.slice(0, detailed ? 6 : 2).map((r) => <li key={r}>• {r}</li>)}
        </ul>
      )}

      {(a.checks.length > 0 || detailed) && (
        <Collapsible defaultOpen={false} className="mt-3">
          <CollapsibleTrigger className="group flex w-full items-center justify-between font-mono text-[10px] tracking-widest text-muted-foreground hover:text-foreground">
            <span>TECHNICAL BREAKDOWN</span><span className="transition-transform group-data-[state=open]:rotate-180">▾</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3">
            {a.checks.length > 0 && (
              <div className="grid gap-1">
                {a.checks.map((c) => (
                  <div key={c.label} className="flex gap-2 font-mono text-[11px]">
                    <span className={c.ok === true ? "text-bull" : c.ok === false ? "text-bear" : "text-warn"}>{c.ok === true ? "●" : c.ok === false ? "○" : "◐"}</span>
                    <span className="w-28 shrink-0 text-muted-foreground">{c.label}</span>
                    <span className="min-w-0">{c.value}</span>
                  </div>
                ))}
              </div>
            )}
            {a.breakdown.length > 0 && (
              <div className="grid gap-1 font-mono text-[11px]">
                {a.breakdown.map((b) => (
                  <div key={b.label} className="flex justify-between text-muted-foreground"><span>{b.label}</span><span className="text-foreground">{b.points}/{b.max}</span></div>
                ))}
              </div>
            )}
            {detailed && (
              <div className="grid gap-1">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">STRATEGIES · {a.timeframe}</div>
                {a.strategies.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 font-mono text-[11px]">
                    <span className="shrink-0">{s.name}</span>
                    <span className="text-right text-muted-foreground">{s.score !== null ? <span className={s.score >= 70 ? "text-bull" : "text-warn"}>{s.dir === 1 ? "▲" : "▼"} {s.score} · </span> : null}{s.note}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="font-mono text-[10px] text-muted-foreground">Completed candles only. Spread is not included (not provided by the public Deriv feed).</p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function TrackButton({ market, analysis: a }: { market: DerivMarket; analysis: Analysis }) {
  const list = useSyncExternalStore(trackerStore.subscribe, trackerStore.get, trackerStore.getServer);
  if (a.lastCandleTime === null || a.entry === null || a.stopLoss === null || a.takeProfit1 === null || a.takeProfit2 === null) return null;
  const action = a.action as "BUY" | "SELL";
  const id = signalId(market.derivSymbol, a.timeframe, a.lastCandleTime, action);
  const tracked = list.some((s) => s.id === id);
  const reviewed = verdictFor(pairStrategyReviews(list),market.symbol,a.strategy);
  const avoided = reviewed?.verdict === "AVOID";
  const track = () => {
    if (avoided) return;
    trackerStore.add({
      id, derivSymbol: market.derivSymbol, symbol: market.symbol, decimals: market.decimals, action, timeframe: a.timeframe,
      strategy: a.strategy, score: a.score, entry: a.entry!, stopLoss: a.stopLoss!, takeProfit1: a.takeProfit1!, takeProfit2: a.takeProfit2!,
      signalTime: a.lastCandleTime!,
    });
    window.__lovableEvents?.track?.("project.signal_tracked", { action, timeframe: a.timeframe, score: a.score });
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button onClick={track} disabled={tracked||avoided} aria-pressed={tracked} className={`chip chip-sm ${tracked ? "chip-active" : ""}`}>
        {tracked ? "✓ TRACKING" : avoided ? "⛔ AVOID — HISTORIC LOSS PATTERN" : "◎ TRACK SIGNAL"}
      </button>
      {tracked && <Link to="/analysis" className="font-mono text-[11px] text-primary hover:underline">See result in Analysis →</Link>}
    </div>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2">
      <div className="text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
