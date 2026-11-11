import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getScanHistory, type ScanRecord } from "@/lib/index-scan-history";
import { INDEX_STRATEGIES } from "@/lib/index-signal-engine";
import { outcomeMetrics } from "@/lib/index-performance";
import { buildFollowUpReport, type FollowUpGroup } from "@/lib/signal-follow-up";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";
import { UserMenu } from "@/components/auth/UserMenu";
import { fetchCandlesRange } from "@/lib/candle-store";
import { isAbortError } from "@/lib/deriv-client";
import { EXPIRY_CANDLES, evaluateOutcome, isFinal, summarize, type TrackedSignal } from "@/lib/signal-tracker";
import { trackerStore } from "@/lib/tracker-store";
import { TF_SECONDS } from "@/lib/strategies/types";

export const Route = createFileRoute("/_authenticated/analysis")({
  head: () => ({
    meta: [
      { title: "Signal Analysis — TradePulse Tracked Results" },
      { name: "description", content: "Follow every tracked signal and see whether it hit take profit or stop loss on real Deriv prices." },
      { property: "og:title", content: "Signal Analysis — TradePulse Tracked Results" },
      { property: "og:description", content: "Won, lost and open results for your tracked trading signals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalysisPage,
});

const REFRESH_MS = 60_000;

/** Checks every unfinished tracked signal against real candles, now and every minute while the page is open. */
function useOutcomeChecker(list: TrackedSignal[]) {
  const pendingKey = list.filter((s) => !isFinal(s)).map((s) => s.id).join("|");
  useEffect(() => {
    if (!pendingKey) return;
    const ctrl = new AbortController();
    const run = async () => {
      for (const s of trackerStore.get().filter((x) => !isFinal(x))) {
        try {
          const end = s.signalTime + EXPIRY_CANDLES * TF_SECONDS[s.timeframe] * 1000;
          const candles = await fetchCandlesRange(s.derivSymbol, s.timeframe, s.signalTime, end, ctrl.signal);
          trackerStore.update(s.id, { ...evaluateOutcome(s, candles, Date.now()), checkedAt: Date.now() });
        } catch (e) {
          if (isAbortError(e)) return;
          // Keep the last known result; it is retried on the next refresh.
        }
      }
    };
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [pendingKey]);
}

const STATUS_CLASS: Record<TrackedSignal["status"], string> = { WON: "signal-buy", LOST: "signal-sell", OPEN: "signal-wait", EXPIRED: "signal-none" };

function AnalysisPage() {
  const list = useSyncExternalStore(trackerStore.subscribe, trackerStore.get, trackerStore.getServer);
  useOutcomeChecker(list);
  const sum = summarize(list);
  const followUp = buildFollowUpReport(list);
  const hasFinished = list.some(isFinal);
  const [scanHistory, setScanHistory] = useState<ScanRecord[]>([]);
  const [indexFilter, setIndexFilter] = useState("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL");
  const [timeframeFilter, setTimeframeFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  useEffect(() => { const refresh=()=>{ void getScanHistory().then(setScanHistory); }; refresh();window.addEventListener("tradepulse-scan-recorded",refresh);return ()=>window.removeEventListener("tradepulse-scan-recorded",refresh); }, []);
  const indexScans = scanHistory.filter(r=>r.category==="INDEX");
  const matches=(symbol:string,strategy:string|null,tf:string,at:number)=>
    (indexFilter==="ALL"||symbol===indexFilter)&&
    (strategyFilter==="ALL"||strategy===strategyFilter)&&
    (timeframeFilter==="ALL"||tf===timeframeFilter)&&
    (!dateFrom||at>=new Date(dateFrom+"T00:00:00").getTime())&&
    (!dateTo||at<=new Date(dateTo+"T23:59:59.999").getTime());
  const visibleScans = indexScans.filter(r=>matches(r.symbol,r.strategy,r.timeframe,r.at));
  const uniqueSessions = new Set(visibleScans.map(r=>r.scanId)).size;
  const buyCount = visibleScans.filter(r=>r.action==="BUY").length;
  const sellCount = visibleScans.filter(r=>r.action==="SELL").length;
  const noTradeCount = visibleScans.filter(r=>r.action==="WAIT"||r.action==="NO TRADE").length;
  const verifiedIndex = list.filter(s => INDEX_STRATEGIES.some(x => x.label===s.strategy));
  const filteredVerified = verifiedIndex.filter(s=>matches(s.symbol,s.strategy,s.timeframe,s.signalTime));
  const regimeFor=(s:typeof filteredVerified[number])=>indexScans.find(r=>r.symbol===s.symbol&&r.timeframe===s.timeframe&&r.candleTime===s.signalTime&&r.strategy===s.strategy)?.marketRegime??"UNKNOWN";
  const metrics=outcomeMetrics(filteredVerified);
  const resultsBy=(key:(s:typeof filteredVerified[number])=>string)=>{
    const groups = new Map<string, typeof filteredVerified>();
    for(const s of filteredVerified){const k=key(s);groups.set(k,[...(groups.get(k)??[]),s]);}
    return [...groups.entries()].map(([name,items])=>({name,metrics:outcomeMetrics(items)})).sort((a,b)=>b.metrics.resolved-a.metrics.resolved);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <NeuralCanvas className="pointer-events-none fixed inset-0 h-full w-full opacity-60" />
      <div className="hero-glow pointer-events-none fixed inset-0" />

      <main className="relative mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/tradepulse-mark.svg" alt="" className="h-10 w-10" />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">TRADE<span className="text-primary">PULSE</span></h1>
              <p className="font-mono text-xs text-muted-foreground">SIGNAL ANALYSIS</p>
            </div>
          </Link>
          <div className="flex items-center gap-2"><Link to="/" className="chip">← DASHBOARD</Link><UserMenu /></div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Tracked" value={sum.total} />
          <Stat label="Won" value={sum.won} tone="text-bull" />
          <Stat label="Lost" value={sum.lost} tone="text-bear" />
          <Stat label="Open" value={sum.open} tone="text-warn" />
          <Stat label="Win rate" value={sum.winRate === null ? "—" : `${sum.winRate}%`} tone="text-primary" />
        </section>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Win rate = won ÷ (won + lost) of your tracked signals only{sum.expired ? ` · ${sum.expired} expired not counted` : ""}. A small number of results says little about future performance.
        </p>

        <section className="mt-8 space-y-3 rounded-xl border border-border bg-card/60 p-4">
          <h2 className="font-display text-lg font-bold">INDEX SCAN HISTORY</h2>
          <p className="font-mono text-[11px] text-muted-foreground">Automatic per-account scan audit; browser fallback works now. Cross-device synchronization requires the managed database migration. Analyses are NOT resolved outcomes.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Scan sessions" value={uniqueSessions}/>
            <Stat label="Index analyses" value={visibleScans.length}/>
            <Stat label="BUY" value={buyCount}/>
            <Stat label="SELL" value={sellCount}/>
            <Stat label="WAIT / NO TRADE" value={noTradeCount}/>
          </div>
          <div className="flex flex-wrap items-end gap-3 font-mono text-xs">
            <label>Index <select value={indexFilter} onChange={e=>setIndexFilter(e.target.value)} className="mt-1 block rounded border border-border bg-background p-1.5">
              <option value="ALL">All indices</option>
              {[...new Set([...indexScans.map(r=>r.symbol),...verifiedIndex.map(r=>r.symbol)])].sort().map(x=><option key={x} value={x}>{x}</option>)}
            </select></label>
            <label>Strategy <select value={strategyFilter} onChange={e=>setStrategyFilter(e.target.value)} className="mt-1 block max-w-52 rounded border border-border bg-background p-1.5">
              <option value="ALL">All strategies</option>
              {INDEX_STRATEGIES.map(x=><option key={x.id} value={x.label}>{x.label}</option>)}
            </select></label>
            <label>Timeframe <select value={timeframeFilter} onChange={e=>setTimeframeFilter(e.target.value)} className="mt-1 block rounded border border-border bg-background p-1.5">
              <option value="ALL">All TFs</option>{["M5","M15","M30","H1","H4"].map(t=><option key={t} value={t}>{t}</option>)}
            </select></label>
            <label>From <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="mt-1 block rounded border border-border bg-background p-1.5"/></label>
            <label>To <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="mt-1 block rounded border border-border bg-background p-1.5"/></label>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {visibleScans.length===0?<p className="text-xs text-muted-foreground">No matching index scans yet.</p>:visibleScans.slice(0,100).map((r,i)=>(
              <div key={r.scanId+"-"+r.derivSymbol+"-"+i} className="rounded border border-border p-2 font-mono text-[11px]">
                <div className="flex flex-wrap items-center gap-2"><strong>{r.symbol}</strong><span>{r.timeframe}</span><span className="text-primary">{r.action}</span><span>{new Date(r.at).toLocaleString()}</span></div>
                <p className="text-muted-foreground">{r.strategy??"No strategy"}{r.error?" · "+r.error:""}</p>
                {r.entry!=null&&<p>Entry {r.entry} · SL {r.stopLoss} · TP1 {r.tp1} · TP2 {r.tp2}</p>}
              </div>
            ))}
          </div>
        </section>
        <section className="mt-5 rounded-xl border border-border bg-card/60 p-4">
          <h2 className="font-display text-lg font-bold">INDEX SIGNAL OUTCOME ANALYSIS</h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">Completed, candle-verified signal outcomes only. Hypothetical full TP1 exit or full stop; excludes spread, slippage and fees. No actual trade execution or guaranteed profitability. Historical backtests NOT included.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Resolved" value={metrics.resolved}/>
            <Stat label="Win rate" value={metrics.winRate==null?"—":metrics.winRate+"%"}/>
            <Stat label="Average R" value={metrics.avgR==null?"—":metrics.avgR.toFixed(2)}/>
            <Stat label="Gross profit factor" value={metrics.profitFactor==null?"—":metrics.profitFactor.toFixed(2)}/>
            <Stat label="Max drawdown (R)" value={metrics.maxDrawdownR==null?"—":metrics.maxDrawdownR.toFixed(2)}/>
          </div>
          {(["strategy","timeframe","index","month","regime"] as const).map(k=>{
            const groups=k==="strategy"?resultsBy(s=>s.strategy??"Unknown"):k==="timeframe"?resultsBy(s=>s.timeframe):k==="index"?resultsBy(s=>s.symbol):k==="month"?resultsBy(s=>new Date(s.signalTime).toISOString().slice(0,7)):resultsBy(regimeFor);
            return <details key={k} className="mt-3 rounded border border-border p-2">
              <summary className="cursor-pointer font-mono text-xs uppercase">Results by {k}</summary>
              {groups.length===0?<p className="mt-2 text-xs text-muted-foreground">No verified results.</p>:groups.map(g=><div key={g.name} className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[11px]"><span>{g.name}</span><span>{g.metrics.resolved} resolved · Win {g.metrics.winRate??"—"}% · Avg {g.metrics.avgR??"—"}R</span></div>)}
            </details>;
          })}
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">Market regime uses scan-time ADX when recorded; otherwise UNKNOWN. Costs and time-separated out-of-sample backtests remain pending.</p>
        </section>
        <section className="mt-6 space-y-4 rounded-xl border border-primary/30 bg-card/70 p-4 sm:p-5" aria-label="Signal win loss learning review">
          <div>
            <h2 className="font-display text-lg font-bold">SIGNAL FOLLOW-UP · WIN / LOSS LEARNING</h2>
            <p className="mt-1 text-xs text-muted-foreground">Historical evidence review for all account-tracked signals. Observes which setups tend to fail, without automatically changing production signal rules or treating hypothetical candle results as real trade profits.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Resolved" value={followUp.resolved}/>
            <Stat label="Open / in progress" value={followUp.stillOpen}/>
            <Stat label="Expired (no result)" value={followUp.expired}/>
            <Stat label="Evidence threshold" value={followUp.sampleReady?"30+ outcomes":"Not reached"}/>
          </div>
          {!followUp.sampleReady && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Do not auto-adjust strategies yet. At least 30 resolved outcomes are required for a first descriptive review per segment, and even 30 is not enough to prove a trading edge.
          </p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <FollowUpSummary group={followUp.prior}/>
            <FollowUpSummary group={followUp.recent}/>
          </div>
          <p className="text-xs text-muted-foreground">Earlier and later halves are separated by signal timestamp. This is a descriptive comparison, not independent out-of-sample validation.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            <FollowUpTable title="STRATEGY PERFORMANCE" groups={followUp.byStrategy}/>
            <FollowUpTable title="TIMEFRAME PERFORMANCE" groups={followUp.byTimeframe}/>
            <FollowUpTable title="INSTRUMENT PERFORMANCE" groups={followUp.bySymbol}/>
            <FollowUpTable title="SIGNAL SCORE BANDS" groups={followUp.byScoreBand}/>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <h3 className="font-semibold">Where losses cluster</h3>
            <p className="mt-1 text-xs text-muted-foreground">Largest historical loss counts, not proof that a setup will lose next time. Focus on clusters with adequate sample sizes.</p>
            {followUp.topLossClusters.length===0?<p className="mt-2 text-xs text-muted-foreground">No resolved losses recorded yet.</p>:
              <div className="mt-3 space-y-2">{followUp.topLossClusters.map(g=><div key={g.label} className="flex flex-wrap justify-between gap-2 border-b border-border/50 pb-2 text-xs">
                <span>{g.label}</span><span className="font-mono text-rose-500">{g.losses} lost / {g.resolved} resolved · {g.review==="INSUFFICIENT"?"Small sample":g.averageR===null?"No R data":g.averageR.toFixed(2)+" avg R"}</span>
              </div>)}</div>}
          </div>
          <div className="rounded-lg border border-border p-3">
            <h3 className="font-semibold">Follow-up recommendations</h3>
            <ul className="mt-2 list-inside list-disc space-y-2 text-xs text-muted-foreground">
              {followUp.lessons.map(x=><li key={x}>{x}</li>)}
            </ul>
            <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-300">Advisory only: changes to production signal selection require separate historical replay, transaction-cost modeling, forward testing and an explicit reviewed deployment.</p>
          </div>
        </section>
        {list.length === 0 ? (
          <div className="mt-12 rounded-xl border border-border bg-card/60 p-8 text-center backdrop-blur">
            <p className="font-display text-lg font-bold">No tracked signals yet</p>
            <p className="mt-2 text-sm text-muted-foreground">Run a scan on the dashboard and press <span className="text-primary">◎ TRACK SIGNAL</span> on any BUY or SELL signal. Its result will appear here.</p>
            <Link to="/" className="scan-btn mt-6 inline-block px-6 text-xs">GO TO DASHBOARD</Link>
          </div>
        ) : (
          <section className="mt-6 space-y-3">
            {hasFinished && (
              <div className="flex justify-end">
                <button onClick={() => trackerStore.clearFinished()} className="chip chip-sm">CLEAR FINISHED</button>
              </div>
            )}
            {list.map((s) => <TrackedCard key={s.id} s={s} />)}
          </section>
        )}

        <p className="mt-8 font-mono text-[10px] text-muted-foreground">
          Results are checked against real Deriv candles from the candle after the signal. WON = TP1 reached before the stop loss (TP2 shown if reached too). LOST = stop loss reached first; if both happen inside the same candle it counts as lost. EXPIRED = neither within {EXPIRY_CANDLES} candles. Spread is not included. Tracked signals are saved to your account. Not financial advice.
        </p>
      </main>
    </div>
  );
}

function TrackedCard({ s }: { s: TrackedSignal }) {
  const fmt = (v: number) => v.toFixed(s.decimals);
  const time = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const result = s.status === "WON" ? `Hit ${s.target}${isFinal(s) ? "" : " · watching TP2"}` : s.status === "LOST" ? "Hit stop loss" : s.status === "EXPIRED" ? "No result in time" : "Waiting for TP1 or stop";
  return (
    <article className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-bold">{s.symbol}</span>
            <span className={`font-mono text-xs font-bold ${s.action === "BUY" ? "text-bull" : "text-bear"}`}>{s.action === "BUY" ? "▲ BUY" : "▼ SELL"}</span>
          </div>
          <div className="truncate font-mono text-[10px] tracking-wider text-muted-foreground">{s.timeframe} · {s.strategy ?? "—"} · CONFLUENCE {s.score} · SIGNAL {time(s.signalTime)}</div>
        </div>
        <span className={`shrink-0 rounded-md px-3 py-1 font-display text-sm font-bold ${STATUS_CLASS[s.status]}`}>{s.status}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
        <Level label="ENTRY" value={fmt(s.entry)} tone="text-primary" />
        <Level label="STOP LOSS" value={fmt(s.stopLoss)} tone="text-bear" />
        <Level label="TP 1" value={fmt(s.takeProfit1)} tone="text-bull" />
        <Level label="TP 2" value={fmt(s.takeProfit2)} tone="text-bull" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span>
          <span className="text-foreground">{result}</span>
          {s.closedAt ? ` · ${time(s.closedAt)}` : ""}
          {s.checkedAt ? ` · checked ${time(s.checkedAt)}` : " · checking…"}
        </span>
        <button onClick={() => trackerStore.remove(s.id)} className="hover:text-foreground" aria-label={`Remove ${s.symbol} signal`}>✕ remove</button>
      </div>
    </article>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${tone}`}>{value}</div>
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

function FollowUpSummary({group}:{group:FollowUpGroup}) {
 return <div className="rounded-lg border border-border bg-background/50 p-3">
   <p className="font-mono text-[11px] uppercase text-muted-foreground">{group.label}</p>
   <p className="mt-2 font-display text-xl font-bold">{group.averageR===null?"—":group.averageR.toFixed(2)+" R"} <span className="text-xs font-normal text-muted-foreground">gross mean</span></p>
   <p className="mt-1 text-xs">{group.resolved} resolved · {group.wins} wins · {group.losses} losses · Win {group.winRate===null?"—":group.winRate.toFixed(1)+"%"}</p>
   <p className="mt-2 text-xs text-muted-foreground">{group.reason}</p>
 </div>;
}
function FollowUpTable({title,groups}:{title:string;groups:FollowUpGroup[]}) {
 return <details className="rounded-lg border border-border bg-background/40 p-3">
   <summary className="cursor-pointer font-display text-sm font-semibold">{title} ({groups.length})</summary>
   {!groups.length?<p className="mt-3 text-xs text-muted-foreground">No resolved signal history.</p>:
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
      {groups.map(g=><div key={g.label} className="rounded-lg border border-border/50 p-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{g.label}</strong><span className={g.review==="REVIEW LOSSES"?"text-rose-500":"text-muted-foreground"}>{g.review==="INSUFFICIENT"?"SMALL SAMPLE":g.review==="REVIEW LOSSES"?"REVIEW LOSSES":"MONITOR"}</span></div>
        <p className="mt-1 font-mono">{g.resolved} resolved · W {g.wins} / L {g.losses} · Win {g.winRate===null?"—":g.winRate.toFixed(1)+"%"} · Mean {g.averageR===null?"—":g.averageR.toFixed(2)+"R"}</p>
        <p className="mt-1 text-muted-foreground">{g.reason}</p>
      </div>)}
    </div>}
 </details>;
}
