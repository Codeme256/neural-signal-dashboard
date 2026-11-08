import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDerivMarkets, useDerivQuotes } from "@/hooks/use-deriv";
import { derivQuoteStatus, formatMarketPrice, type DerivMarket } from "@/lib/deriv-data";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";
import { ScanDialog } from "@/components/signal/SignalDialog";
import { SignalAlertCenter } from "@/components/signal/SignalAlertCenter";
import { UserMenu } from "@/components/auth/UserMenu";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "TradePulse — Neural Signal Dashboard" },
      { name: "description", content: "Scan forex, index, crypto (BTCUSD), metal and synthetic pairs for entry, stop loss, take profit and signal strength." },
      { property: "og:title", content: "TradePulse — Neural Signal Dashboard" },
      { property: "og:description", content: "Live pair scanning with entry, SL, TP and strength." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const categories = ["ALL", "FOREX", "INDEX", "VOLATILITY", "CRYPTO", "METAL", "SYNTHETIC"];
const groups = [
  { id: "FOREX", icon: "€$", label: "Forex" },
  { id: "INDEX", icon: "▤", label: "Index" },
  { id: "VOLATILITY", icon: "〽", label: "Volatility Indices" },
  { id: "CRYPTO", icon: "₿", label: "Crypto" },
  { id: "METAL", icon: "◆", label: "Metal" },
];
type ScanTarget = { section: string; label: string; filter: (m: DerivMarket) => boolean; single?: boolean };

function Dashboard() {
  const marketsQ = useDerivMarkets();
  const markets = marketsQ.data ?? [];
  const quotesQ = useDerivQuotes(markets);
  const quotes = useMemo(() => new Map((quotesQ.data ?? []).map((q) => [q.symbol, q])), [quotesQ.data]);
  const [cat, setCat] = useState("ALL");
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState<ScanTarget | null>(null);
  const scanMarkets = useMemo(() => (scan ? markets.filter(scan.filter) : []), [scan, markets]);
  const btc = markets.find((m) => m.symbol === "BTCUSD");
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
          <div className="flex items-center gap-2">
            <Link to="/analysis" className="chip">📊 ANALYSIS</Link>
            <UserMenu />
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 font-mono text-xs backdrop-blur">
              <span className="live-dot" /> {live} LIVE / {markets.length} MARKETS
            </div>
          </div>
        </header>

        <section className="mt-10 flex flex-col items-center">
          <button onClick={() => setScan({ section: "all", label: "all open markets", filter: () => true })} disabled={!markets.length} className="scan-btn scan-main">
            ⚡ SCAN ALL MARKETS
          </button>
          <p className="mt-3 font-mono text-xs text-muted-foreground">Finds confirmed signals across open markets · includes available Deriv Volatility Indices</p>
          <button
            onClick={() => setScan({ section: "btcusd", label: "BTCUSD", filter: (m) => m.symbol === "BTCUSD", single: true })}
            disabled={!btc}
            className="scan-btn mt-6 px-8"
          >
            ₿ SCAN BTCUSD {btc ? `· ${formatMarketPrice(quotes.get("BTCUSD")?.price, btc)}` : ""}
          </button>
        </section>

        <SignalAlertCenter markets={markets} />

        <section className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {groups.map((g) => {
            const inGroup = markets.filter((m) => m.category === g.id);
            const open = inGroup.filter((m) => m.open).length;
            return (
              <div key={g.id} className="pair-card flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl text-primary">{g.icon}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{open}/{inGroup.length} OPEN</span>
                </div>
                <h3 className="mt-2 font-display text-lg font-bold uppercase">{g.label}</h3>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{inGroup.slice(0, 4).map((m) => m.category === "VOLATILITY" ? m.name : m.symbol).join(" · ") || "No symbols supplied by Deriv"}</p>
                <button
                  onClick={() => setScan({ section: g.id.toLowerCase(), label: `${g.label} markets`, filter: (m) => m.category === g.id })}
                  disabled={!inGroup.length}
                  className="scan-btn mt-4 text-xs"
                >
                  SCAN {g.label.toUpperCase()}
                </button>
              </div>
            );
          })}
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <Stat label="Markets tracked" value={markets.length || "—"} />
          <Stat label="Live feeds" value={live || "—"} accent />
          <Stat label="Engine" value="MTF · SMC · ATR" />
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
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{m.category}</span>
                  <button
                    onClick={() => setScan({ section: "pair", label: m.symbol, filter: (x) => x.derivSymbol === m.derivSymbol, single: true })}
                    aria-label={`Scan ${m.symbol}`}
                    className="chip chip-sm"
                  >
                    SCAN
                  </button>
                </div>

              </article>
            );
          })}
        </section>
      </main>

      <ScanDialog key={scan?.label} section={scan?.section ?? "all"} single={scan?.single} open={!!scan} label={scan?.label ?? "markets"} markets={scanMarkets} prices={prices} onClose={() => setScan(null)} />
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
