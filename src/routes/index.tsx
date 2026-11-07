import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDerivMarkets, useDerivQuotes } from "@/hooks/use-deriv";
import { derivQuoteStatus, formatMarketPrice, } from "@/lib/deriv-data";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";
import { ScanDialog } from "@/components/signal/SignalDialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TradePulse — Neural Signal Dashboard" },
      { name: "description", content: "Scan any forex, gold or synthetic pair for entry, stop loss, take profit and signal strength." },
      { property: "og:title", content: "TradePulse — Neural Signal Dashboard" },
      { property: "og:description", content: "Live pair scanning with entry, SL, TP and strength." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const categories = ["ALL", "FOREX", "METALS", "SYNTHETIC", "STOCK INDICES"];

function Dashboard() {
  const marketsQ = useDerivMarkets();
  const markets = marketsQ.data ?? [];
  const quotesQ = useDerivQuotes(markets);
  const quotes = useMemo(() => new Map((quotesQ.data ?? []).map((q) => [q.symbol, q])), [quotesQ.data]);
  const [cat, setCat] = useState("ALL");
  const [query, setQuery] = useState("");
  const [scanSymbol, setScanSymbol] = useState<string | null>(null);
  const prices = useMemo(() => new Map((quotesQ.data ?? []).map((q) => [q.symbol, q.price])), [quotesQ.data]);
  const now = Date.now();

  const list = markets.filter(
    (m) => (cat === "ALL" || m.category === cat) && (m.symbol + m.name).toLowerCase().includes(query.toLowerCase()),
  );
  const live = markets.filter((m) => derivQuoteStatus(quotes.get(m.symbol), now) === "LIVE").length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <NeuralCanvas className="pointer-events-none fixed inset-0 h-full w-full opacity-60" />
      <div className="hero-glow pointer-events-none fixed inset-0" />

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/tradepulse-mark.svg" alt="" className="h-10 w-10" />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">TRADE<span className="text-primary">PULSE</span></h1>
              <p className="font-mono text-xs text-muted-foreground">NEURAL SIGNAL ENGINE</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 font-mono text-xs backdrop-blur">
            <span className="live-dot" /> {live} LIVE / {markets.length} MARKETS
          </div>
        </header>

        <section className="mt-10 flex flex-col items-center">
          <button onClick={() => setScanSymbol("ALL")} disabled={!markets.length} className="scan-btn scan-main">
            ⚡ SCAN ALL MARKETS
          </button>
          <p className="mt-3 font-mono text-xs text-muted-foreground">Finds every strong signal across open pairs</p>
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <Stat label="Markets tracked" value={markets.length || "—"} />
          <Stat label="Live feeds" value={live || "—"} accent />
          <Stat label="Engine" value="EMA · RSI · ATR" />
        </section>

        <section className="mt-8 flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`chip ${cat === c ? "chip-active" : ""}`}>{c}</button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pair…"
            className="ml-auto w-full rounded-lg border border-border bg-card/60 px-4 py-2 font-mono text-sm backdrop-blur outline-none focus:border-primary sm:w-60"
          />
        </section>

        {marketsQ.isPending && <p className="mt-16 text-center font-mono text-muted-foreground animate-pulse">Connecting to live markets…</p>}
        {marketsQ.isError && <p className="mt-16 text-center text-destructive">Live market feed unavailable. Retrying…</p>}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => {
            const q = quotes.get(m.symbol);
            const status = derivQuoteStatus(q, now);
            return (
              <article key={m.derivSymbol} className="pair-card group">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display text-xl font-bold">{m.symbol}</h3>
                    <p className="truncate text-xs text-muted-foreground">{m.name}</p>
                  </div>
                  <span className={`status status-${status.toLowerCase()}`}>{status}</span>
                </div>
                <div className="mt-4 font-mono text-2xl font-semibold">{q ? formatMarketPrice(q.price, m) : "—"}</div>
                <div className="mt-1 flex items-center justify-between gap-2"><span className="font-mono text-[10px] tracking-widest text-muted-foreground">{m.category}</span><button className="chip chip-sm" onClick={() => setScanSymbol(m.derivSymbol)} aria-label={`Scan ${m.symbol}`}>SCAN</button></div>

              </article>
            );
          })}
        </section>
      </main>

      <ScanDialog key={scanSymbol ?? "closed"} open={scanSymbol !== null} markets={scanSymbol === "ALL" ? markets : markets.filter(m => m.derivSymbol === scanSymbol)} prices={prices} onClose={() => setScanSymbol(null)} single={scanSymbol !== "ALL"} label={scanSymbol === "ALL" ? "all open markets" : scanSymbol ?? "markets"} section={scanSymbol === "ALL" ? "all" : "pair"} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 backdrop-blur">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</div>
      <div className={`mt-2 font-display text-3xl font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
