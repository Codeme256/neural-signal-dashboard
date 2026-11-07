import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DerivMarket } from "@/lib/deriv-data";
import { formatMarketPrice } from "@/lib/deriv-data";
import { analyze } from "@/lib/signal-engine";
import { fetchCandles } from "@/lib/candle-store";
import { DerivError, isAbortError } from "@/lib/deriv-client";
import { CONFIRM_TF, HIGHER_TF, STRATEGIES, TIMEFRAMES, type Analysis, type StrategyFilter, type Timeframe } from "@/lib/strategies/types";
import { NeuralCanvas } from "./NeuralCanvas";

type Result = { market: DerivMarket; analysis: Analysis | null; error?: string };
const MIN_STRENGTH = 70;
/** Pairs analysed at once; the Deriv client additionally caps simultaneous requests. */
const BATCH = 3;
// Remember the user's last choice between scans.
const lastChoice: { tf: Timeframe; strategy: StrategyFilter } = { tf: "H1", strategy: "all" };

async function analyseMarket(m: DerivMarket, tf: Timeframe, strategy: StrategyFilter, signal: AbortSignal): Promise<Result> {
  try {
    return await analyseMarketUnsafe(m, tf, strategy, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { market: m, analysis: null, error: "Analysis failed for this market." };
  }
}

async function analyseMarketUnsafe(m: DerivMarket, tf: Timeframe, strategy: StrategyFilter, signal: AbortSignal): Promise<Result> {
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
  let analysis = analyze({ ...input, now: Date.now() });
  // Only fetch the lower confirmation timeframe when there is a setup worth confirming.
  if (CONFIRM_TF[tf] !== tf && analysis.entry !== null) {
    const confirm = await fetchCandles(m.derivSymbol, CONFIRM_TF[tf], signal).catch((e) => { if (isAbortError(e)) throw e; return null; });
    analysis = analyze({ ...input, confirm, now: Date.now() });
  }
  return { market: m, analysis };
}

export function ScanDialog({ open, markets, prices: _prices, onClose, label = "all open markets", section = "all", single = false }: { section?: string; open: boolean; markets: DerivMarket[]; prices: Map<string, number>; onClose: () => void; label?: string; single?: boolean | undefined }) {
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);
  const [tf, setTf] = useState<Timeframe>(lastChoice.tf);
  const [strategy, setStrategy] = useState<StrategyFilter>(lastChoice.strategy);

  useEffect(() => {
    if (!open) return;
    lastChoice.tf = tf; lastChoice.strategy = strategy;
    const ctrl = new AbortController();
    setProgress(0); setResults([]); setDone(false);
    (async () => {
      const targets = single ? markets : markets.filter((m) => m.open);
      const track = (found: number) => window.__lovableEvents?.track?.("project.market_scan_completed", { section, pairs_scanned: targets.length, signals_found: found, has_results: found > 0, timeframe: tf });
      if (!targets.length) { setDone(true); track(0); return; }
      const found: Result[] = [];
      try {
        for (let i = 0; i < targets.length; i += BATCH) {
          const batch = targets.slice(i, i + BATCH);
          setCurrent(batch.map((m) => m.symbol).join(" · "));
          found.push(...(await Promise.all(batch.map((m) => analyseMarket(m, tf, strategy, ctrl.signal)))));
          setProgress(Math.round(((i + batch.length) / targets.length) * 100));
          await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive between batches
        }
      } catch (e) {
        if (isAbortError(e)) return;
        throw e;
      }
      await new Promise((r) => setTimeout(r, 400));
      if (ctrl.signal.aborted) return;
      setResults(found);
      setDone(true);
      track(found.filter((r) => r.analysis && (r.analysis.action === "BUY" || r.analysis.action === "SELL")).length);
    })();
    return () => ctrl.abort(); // cancel queued requests when closed or settings change
  }, [open, tf, strategy]);

  const ranked = results.filter((r) => r.analysis).sort((a, b) => b.analysis!.score - a.analysis!.score);
  const strong = ranked.filter((r) => r.analysis!.action === "BUY" || r.analysis!.action === "SELL");
  const watch = ranked.filter((r) => r.analysis!.action === "WAIT");
  const unavailable = results.filter((r) => r.error);
  const one = single ? results[0] : undefined;
  const strategyLabel = STRATEGIES.find((s) => s.id === strategy)?.label ?? "All Strategies";

  const title = !done ? "NEURAL SCAN RUNNING"
    : single ? `${markets[0]?.symbol ?? ""} · ${one?.analysis?.action ?? "UNAVAILABLE"}`
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
            <Select value={strategy} onValueChange={(v) => setStrategy(v as StrategyFilter)}>
              <SelectTrigger aria-label="Strategy" className="h-8 w-auto min-w-40 border-border bg-card/60 font-mono text-xs sm:ml-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((s) => <SelectItem key={s.id} value={s.id} className="font-mono text-xs">{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {!done && (
            <div className="py-6 font-mono text-sm text-primary">
              <div className="mb-2 flex justify-between"><span className="animate-pulse">▸ Scanning {label} · {tf}</span><span>{progress}%</span></div>
              <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="strength-fill h-full" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {done && single && (
            one?.analysis ? <SignalCard market={one.market} analysis={one.analysis} detailed /> : <p className="py-8 text-center text-muted-foreground">{one?.error ?? "No data for this market."}</p>
          )}

          {done && !single && (
            <div className="space-y-3">
              {strong.length === 0 && <p className="py-6 text-center text-muted-foreground">No strong signals on {tf} right now. The engine only signals confirmed setups — try another timeframe or scan again later.</p>}
              {strong.map((r) => <SignalCard key={r.market.derivSymbol} market={r.market} analysis={r.analysis!} />)}
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
                Scanned {results.length} open market{results.length === 1 ? "" : "s"}{unavailable.length ? ` · ${unavailable.length} unavailable` : ""}. Scores are confluence points, not win probabilities. Technical indication from live Deriv data — not financial advice.
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

function SignalCard({ market, analysis: a, detailed = false }: { market: DerivMarket; analysis: Analysis; detailed?: boolean }) {
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

function Level({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2">
      <div className="text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
