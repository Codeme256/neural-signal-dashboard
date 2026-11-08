import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getScanHistory, type ScanRecord } from "@/lib/index-scan-history";
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
  const hasFinished = list.some(isFinal);
  const [scanHistory, setScanHistory] = useState<ScanRecord[]>([]);
  const [indexFilter, setIndexFilter] = useState("ALL");
  useEffect(() => { const refresh=()=>setScanHistory(getScanHistory()); refresh();window.addEventListener("tradepulse-scan-recorded",refresh);return ()=>window.removeEventListener("tradepulse-scan-recorded",refresh); }, []);
  const indexScans = scanHistory.filter(r=>r.category==="INDEX");
  const visibleScans = indexFilter==="ALL" ? indexScans : indexScans.filter(r=>r.symbol===indexFilter);
  const uniqueSessions = new Set(indexScans.map(r=>r.scanId)).size;
  const actionCount = indexScans.filter(r=>r.action==="BUY"||r.action==="SELL").length;
  const noTradeCount = indexScans.filter(r=>r.action==="WAIT"||r.action==="NO TRADE").length;

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
          <p className="font-mono text-[11px] text-muted-foreground">Automatic scan audit stored in this browser only. These are analyses, NOT completed trading outcomes; results are not shared across devices yet. No assumed profits.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Scan sessions" value={uniqueSessions}/>
            <Stat label="Index analyses" value={indexScans.length}/>
            <Stat label="BUY / SELL" value={actionCount}/>
            <Stat label="WAIT / NO TRADE" value={noTradeCount}/>
          </div>
          <label className="block text-xs">Filter index
            <select value={indexFilter} onChange={e=>setIndexFilter(e.target.value)} className="ml-2 rounded border border-border bg-background px-2 py-1">
              <option value="ALL">All indices</option>
              {[...new Set(indexScans.map(r=>r.symbol))].sort().map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {visibleScans.length===0?<p className="text-xs text-muted-foreground">No index scans saved on this browser yet.</p>:visibleScans.slice(0,100).map((r,i)=>(
              <div key={r.scanId+"-"+r.derivSymbol+"-"+i} className="rounded border border-border p-2 font-mono text-[11px]">
                <div className="flex flex-wrap items-center gap-2"><strong>{r.symbol}</strong><span>{r.timeframe}</span><span className="text-primary">{r.action}</span><span>{new Date(r.at).toLocaleString()}</span></div>
                <p className="text-muted-foreground">{r.strategy??"No strategy"}{r.error?" · "+r.error:""}</p>
                {r.entry!=null&&<p>Entry {r.entry} · SL {r.stopLoss} · TP1 {r.tp1} · TP2 {r.tp2}</p>}
              </div>
            ))}
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
