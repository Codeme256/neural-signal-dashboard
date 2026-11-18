import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { fetchHourlyCandles } from "@/hooks/use-deriv";
import { majorForex } from "@/lib/deriv-data";

const currencies = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
type Score = { currency: string; score: number };
async function loadStrength(): Promise<{ ranked: Score[]; asOf: number }> {
  const changes = await Promise.all(majorForex.map(async (symbol) => {
    try {
      const candles = await fetchHourlyCandles(`frx${symbol}`);
      const now = Date.now();
      const closed = candles.filter(c => c.time + 3600000 <= now && now - c.time <= 28 * 3600000);
      const end = closed.at(-1);
      if (!end || now - (end.time + 3600000) > 3 * 3600000) return null;
      const start = closed.find(c => c.time <= end.time - 24 * 3600000);
      if (!start || start.value <= 0) return null;
      return { symbol, pct: (end.value / start.value - 1) * 100 };
    } catch { return null; }
  }));
  if (changes.some(x => x === null)) throw new Error("Incomplete or stale 24-hour forex candles");
  // USD-relative scores: seven independent USD pairs provide a comparable baseline.
  const scores = new Map<string, number>();
  scores.set("USD", 0);
  for (const item of changes) {
    if (!item) continue;
    const base = item.symbol.slice(0, 3);
    const quote = item.symbol.slice(3);
    if (quote === "USD") scores.set(base, item.pct);
    else if (base === "USD") scores.set(quote, -item.pct);
  }
  if (scores.size !== currencies.length) throw new Error("Missing currency strength inputs");
  const mean = [...scores.values()].reduce((a, b) => a + b, 0) / currencies.length;
  return { ranked: currencies.map(currency => ({ currency, score: (scores.get(currency) ?? 0) - mean })).sort((a, b) => b.score - a.score), asOf: Date.now() };
}
export function CurrencyStrengthRanking() {
  const hydrated = useHydrated();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["currency-strength-usd-relative-24h"],
    queryFn: loadStrength,
    enabled: hydrated,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
  const fresh = !!data && Date.now() - data.asOf < 180000 && !error;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card/70 p-4 backdrop-blur sm:p-6" aria-label="Currency strength ranking">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">📊 LIVE CURRENCY STRENGTH</h2>
          <p className="font-mono text-[11px] text-muted-foreground">24H completed H1 candles · Deriv major FX · USD-relative ranking</p>
        </div>
        <button className="chip" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "UPDATING…" : "↻ REFRESH"}</button>
      </div>
      {!fresh ? (
        <p className="rounded-lg border border-border p-4 font-mono text-xs text-amber-400">
          Strength unavailable — waiting for complete, fresh market data. No ranking is assumed.
        </p>
      ) : (
        <>
          <p className="mb-3 font-mono text-[10px] text-emerald-400">DATA VERIFIED · {new Date(data.asOf).toLocaleTimeString()} · refreshed every 60s</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.ranked.map(({currency, score}, index) => (
              <div key={currency} className="rounded-xl border border-border bg-background/60 p-3">
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>#{index + 1}</span><span>{score >= 0 ? "STRONGER" : "WEAKER"}</span></div>
                <div className="mt-2 font-display text-xl font-bold">{currency}</div>
                <div className={`font-mono text-sm ${score > 0 ? "text-emerald-400" : score < 0 ? "text-rose-400" : "text-muted-foreground"}`}>{score >= 0 ? "+" : ""}{score.toFixed(3)}%</div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Strongest {data.ranked[0].currency} / Weakest {data.ranked.at(-1)?.currency}. Relative ranking only — not an entry signal or confirmed BOS.
          </p>
        </>
      )}
    </section>
  );
}
