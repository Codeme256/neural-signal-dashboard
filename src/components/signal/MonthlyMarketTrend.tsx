import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCandles } from "@/lib/candle-store";
import { formatMarketPrice, type DerivMarket } from "@/lib/deriv-data";
import { monthlyTrend } from "@/lib/market-trends";

const signedPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

export function MonthlyMarketTrend({ markets }: { markets: DerivMarket[] }) {
  const [selected, setSelected] = useState("frxXAUUSD");
  const market = markets.find((item) => item.derivSymbol === selected);
  const history = useQuery({
    queryKey: ["monthly-market-trend", selected],
    queryFn: ({ signal }) => fetchCandles(selected, "D1", signal),
    enabled: !!market,
    staleTime: 300_000,
    refetchInterval: 300_000,
    retry: 1,
  });
  const trend = history.data && !history.isError ? monthlyTrend(history.data, Date.now()) : null;

  return (
    <section aria-label="Monthly market trend" className="mt-8 rounded-2xl border border-border bg-card/70 p-4 backdrop-blur sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">MONTHLY MARKET TREND</h2>
        <select aria-label="Monthly trend market" className="chip max-w-full" value={selected} onChange={(event) => setSelected(event.target.value)}>
          {!markets.some((item) => item.derivSymbol === "frxXAUUSD") && <option value="frxXAUUSD">XAUUSD · Gold</option>}
          {markets.map((item) => <option key={item.derivSymbol} value={item.derivSymbol}>{item.symbol} · {item.name}</option>)}
        </select>
      </div>
      {trend && market ? (
        <>
          <p className="mt-3 font-mono text-sm">
            {monthLabel.format(trend.latest.time)} closed · <strong>{trend.direction}</strong> · {signedPercent(trend.closedChange)}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Previous month low {formatMarketPrice(trend.latest.low, market)} · high {formatMarketPrice(trend.latest.high, market)}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Current month · {trend.developingChange === null ? "Awaiting a daily close" : `${signedPercent(trend.developingChange)} through the latest daily close · developing`}
          </p>
        </>
      ) : (
        <p className="mt-3 font-mono text-sm text-muted-foreground">
          {market && history.isPending ? "Loading Deriv daily candles…" : "Monthly trend unavailable. Two completed months of data are required."}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Calendar months are built from completed Deriv daily candles in UTC. Bias compares monthly highs, lows and closes.</p>
    </section>
  );
}
