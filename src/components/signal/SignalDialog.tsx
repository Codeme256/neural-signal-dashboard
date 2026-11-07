import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { DerivMarket } from "@/lib/deriv-data";
import { formatMarketPrice } from "@/lib/deriv-data";
import { buildSignal, type Signal } from "@/lib/signal-engine";
import { fetchHourlyCandles } from "@/hooks/use-deriv";
import { NeuralCanvas } from "./NeuralCanvas";

type Result = { market: DerivMarket; signal: Signal };
const MIN_STRENGTH = 70;

export function ScanDialog({ open, markets, prices, onClose }: { open: boolean; markets: DerivMarket[]; prices: Map<string, number>; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setProgress(0); setResults([]); setDone(false);
    (async () => {
      const targets = markets.filter((m) => m.open);
      const found: Result[] = [];
      for (let i = 0; i < targets.length; i += 4) {
        const batch = targets.slice(i, i + 4);
        if (alive) setCurrent(batch.map((m) => m.symbol).join(" · "));
        await Promise.all(batch.map(async (m) => {
          try {
            const s = buildSignal(await fetchHourlyCandles(m.derivSymbol), prices.get(m.symbol));
            if (s && s.strength >= MIN_STRENGTH) found.push({ market: m, signal: s });
          } catch { /* skip pair */ }
        }));
        if (!alive) return;
        setProgress(Math.round(((i + batch.length) / Math.max(1, targets.length)) * 100));
      }
      await new Promise((r) => setTimeout(r, 400));
      if (!alive) return;
      setResults(found.sort((a, b) => b.signal.strength - a.signal.strength));
      setDone(true);
    })();
    return () => { alive = false; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="signal-panel max-h-[90vh] max-w-2xl overflow-hidden border-primary/40 p-0">
        <div className="relative h-32 shrink-0 overflow-hidden border-b border-border">
          <NeuralCanvas intensity={done ? 0.6 : 3} className="absolute inset-0 h-full w-full" />
          <div className="relative flex h-full flex-col justify-end p-5">
            <DialogTitle className="font-display text-2xl font-bold tracking-tight">
              {done ? `${results.length} STRONG SIGNAL${results.length === 1 ? "" : "S"}` : "NEURAL SCAN RUNNING"}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {done ? `Strength ${MIN_STRENGTH}%+ · 1H timeframe` : `Analysing ${current}`}
            </DialogDescription>
          </div>
        </div>

        <div className="max-h-[calc(90vh-8rem)] overflow-y-auto p-5">
          {!done && (
            <div className="py-6 font-mono text-sm text-primary">
              <div className="mb-2 flex justify-between"><span className="animate-pulse">▸ Scanning all open markets</span><span>{progress}%</span></div>
              <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="strength-fill h-full" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          {done && results.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">No strong signals right now. Try scanning again later.</p>
          )}
          {done && (
            <div className="space-y-3">
              {results.map(({ market, signal }) => <SignalCard key={market.derivSymbol} market={market} signal={signal} />)}
              {results.length > 0 && <p className="text-[11px] text-muted-foreground">Technical indication from live Deriv data — not financial advice. Always manage your risk.</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignalCard({ market, signal }: Result) {
  const buy = signal.direction === "BUY";
  const fmt = (v: number) => formatMarketPrice(v, market);
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-muted/30 p-4 duration-500">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-xl font-bold">{market.symbol}</div>
          <div className="text-xs text-muted-foreground">{market.name}</div>
        </div>
        <span className={`rounded-md px-3 py-1 font-display text-lg font-bold ${buy ? "signal-buy" : "signal-sell"}`}>{buy ? "▲ BUY" : "▼ SELL"}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="strength-fill h-full rounded-full" style={{ width: `${signal.strength}%` }} /></div>
        <span className="font-mono text-sm font-bold text-bull">{signal.strength}% STRONG</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
        <Level label="ENTRY" value={fmt(signal.entry)} tone="text-primary" />
        <Level label="STOP LOSS" value={fmt(signal.stopLoss)} tone="text-bear" />
        <Level label="TP 1" value={fmt(signal.takeProfit1)} tone="text-bull" />
        <Level label="TP 2" value={fmt(signal.takeProfit2)} tone="text-bull" />
      </div>
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
