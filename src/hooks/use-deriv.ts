import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { derivRequest } from "@/lib/deriv-client";
import { parseDerivCandles, parseDerivMarkets, parseDerivQuote, type DerivMarket } from "@/lib/deriv-data";

export function useDerivMarkets() {
  const hydrated = useHydrated();
  return useQuery({
    queryKey: ["deriv-markets"],
    enabled: hydrated,
    queryFn: async () => parseDerivMarkets((await derivRequest({ active_symbols: "brief" }))["active_symbols"]),
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
}

export function useDerivQuotes(markets: DerivMarket[]) {
  return useQuery({
    queryKey: ["deriv-quotes", markets.map((m) => m.symbol).join(",")],
    enabled: markets.length > 0,
    queryFn: async () => {
      const out = [];
      for (let i = 0; i < markets.length; i += 5) {
        out.push(
          ...(await Promise.all(
            markets.slice(i, i + 5).map(async (m) => {
              try {
                const r = await derivRequest({ ticks_history: m.derivSymbol, count: 2, end: "latest", style: "ticks" });
                return parseDerivQuote(m, r["history"], Date.now());
              } catch {
                return null;
              }
            }),
          )),
        );
      }
      return out.filter((q) => q !== null);
    },
    staleTime: 15000,
    refetchInterval: 15000,
    retry: 1,
  });
}

export async function fetchHourlyCandles(derivSymbol: string) {
  const r = await derivRequest({ ticks_history: derivSymbol, count: 100, end: "latest", style: "candles", granularity: 3600 });
  return parseDerivCandles(r["candles"]);
}
