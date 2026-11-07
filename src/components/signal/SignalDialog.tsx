import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { DerivMarket } from "@/lib/deriv-data";
import { formatMarketPrice } from "@/lib/deriv-data";
import { buildSignal, type Signal } from "@/lib/signal-engine";
import { fetchHourlyCandles } from "@/hooks/use-deriv";
import { NeuralCanvas } from "./NeuralCanvas";

const steps = ["Connecting to live feed", "Loading 100 hourly candles", "Running EMA 9 / 21 crossover", "Measuring RSI momentum", "Calculating volatility & levels"];

export function SignalDialog({ market, livePrice, onClose }: { market: DerivMarket | null; livePrice?: number; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!market) return;
    setStep(0); setSignal(null); setError(null); setDone(false);
    let alive = true;
    const timer = setInterval(() => setStep((s) => Math.min(steps.length - 1, s + 1)), 450);
    const minDelay = new Promise((r) => setTimeout(r, 2400));
    Promise.all([fetchHourlyCandles(market.derivSymbol), minDelay])
      .then(([candles]) => {
        if (!alive) return;
        const s = buildSignal(candles, livePrice);
        if (!s) setError("Not enough market history to build a signal.");
        setSignal(s);
      })
      .catch(() => alive && setError("Could not reach the live market feed. Try again."))
      .finally(() => { if (alive) { clearInterval(timer); setDone(true); } });
    return () => { alive = false; clearInterval(timer); };
  }, [market?.derivSymbol]);

  const fmt = (v: number) => (market ? formatMarketPrice(v, market) : "");
  const buy = signal?.direction === "BUY";

  return (
    <Dialog open={!!market} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="signal-panel max-w-lg overflow-hidden border-primary/40 p-0">
        <div className="relative h-36 overflow-hidden border-b border-border">
          <NeuralCanvas intensity={done ? 0.6 : 3} className="absolute inset-0 h-full w-full" />
          <div className="relative flex h-full flex-col justify-end p-5">
            <DialogTitle className="font-display text-3xl font-bold tracking-tight">{market?.symbol}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">{market?.name} · 1H neural scan</DialogDescription>
          </div>
        </div>

        <div className="p-5">
          {!done && (
            <div className="space-y-2 font-mono text-sm">
              {steps.map((s, i) => (
                <div key={s} className={i <= step ? "text-primary" : "text-muted-foreground/40"}>
                  {i < step ? "✓" : i === step ? <span className="animate-pulse">▸</span> : "·"} {s}
                </div>
              ))}
              <div className="mt-4 h-1 overflow-hidden rounded bg-muted"><div className="scan-bar h-full" /></div>
            </div>
          )}

          {done && error && <p className="py-6 text-center text-destructive">{error}</p>}

          {done && signal && (
            <div className="animate-in fade-in zoom-in-95 space-y-4 duration-500">
              <div className="flex items-center justify-between">
                <span className={`rounded-md px-4 py-1.5 font-display text-2xl font-bold ${buy ? "signal-buy" : "signal-sell"}`}>
                  {buy ? "▲ BUY" : "▼ SELL"}
                </span>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">STRENGTH</div>
                  <div className={`font-display text-2xl font-bold ${signal.strengthLabel === "STRONG" ? "text-bull" : signal.strengthLabel === "MODERATE" ? "text-warn" : "text-muted-foreground"}`}>
                    {signal.strength}% · {signal.strengthLabel}
                  </div>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="strength-fill h-full rounded-full" style={{ width: `${signal.strength}%` }} />
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono">
                <Level label="ENTRY" value={fmt(signal.entry)} tone="text-primary" />
                <Level label="STOP LOSS" value={fmt(signal.stopLoss)} tone="text-bear" />
                <Level label="TAKE PROFIT 1" value={fmt(signal.takeProfit1)} tone="text-bull" />
                <Level label="TAKE PROFIT 2" value={fmt(signal.takeProfit2)} tone="text-bull" />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs text-muted-foreground">
                <div className="rounded border border-border p-2">RSI<br /><b className="text-foreground">{signal.rsi.toFixed(1)}</b></div>
                <div className="rounded border border-border p-2">EMA 9/21<br /><b className="text-foreground">{signal.ema9 > signal.ema21 ? "Bull cross" : "Bear cross"}</b></div>
                <div className="rounded border border-border p-2">R:R<br /><b className="text-foreground">1 : {signal.riskReward}</b></div>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Technical indication from live Deriv data — not financial advice. Always manage your risk.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
