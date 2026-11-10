import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, RefreshCw } from "lucide-react";
import { fetchCandles } from "@/lib/candle-store";
import { analyzeIndex, INDEX_DEFAULT_ENABLED, INDEX_STRATEGIES, type IndexStrategyId } from "@/lib/index-signal-engine";
import { HIGHER_TF, type Timeframe } from "@/lib/strategies/types";
import type { DerivMarket } from "@/lib/deriv-data";

type Alert = {
  id: string; symbol: string; name: string; action: "BUY" | "SELL";
  strategy: string; timeframe: Timeframe; at: number; expiresAt: number | null;
  entry: number; stopLoss: number; tp1: number; tp2: number;
  read: boolean;
};
const STORE_KEY = "tradepulse-index-notifications-v1";
const ENABLED_KEY = "tradepulse-index-enabled-v1";
const INTERVAL_MS = 5 * 60 * 1000;
const MAX_ALERTS = 100;
const SCAN_TIMEFRAME: Timeframe = "M15";

function readAlerts(): Alert[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is Alert => v && typeof v.id === "string" && typeof v.symbol === "string" && (v.action === "BUY" || v.action === "SELL")).slice(0, MAX_ALERTS);
  } catch { return []; }
}
function selectedStrategies(): IndexStrategyId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ENABLED_KEY) ?? "null");
    return Array.isArray(value)
      ? INDEX_STRATEGIES.filter((s) => value.includes(s.id)).map((s) => s.id)
      : INDEX_DEFAULT_ENABLED;
  } catch { return INDEX_DEFAULT_ENABLED; }
}

export function IndexNotificationCenter({ markets }: { markets: DerivMarket[] }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const knownIds = useRef<Set<string>>(new Set());
  const scanning = useRef(false);
  const [opened, setOpened] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = useState(false);
  const indices = useMemo(() => markets.filter((m) => m.category === "INDEX" && m.open), [markets]);
  const unread = alerts.filter((a) => !a.read).length;

  useEffect(() => {
    const existing = readAlerts();
    knownIds.current = new Set(existing.map((a) => a.id));
    setAlerts(existing);
    try { setEnabled(localStorage.getItem("tradepulse-index-auto-alerts-v1") === "on"); } catch { /* browser blocked storage */ }
  }, []);
  const save = useCallback((transform: (prev: Alert[]) => Alert[]) => {
    setAlerts((prev) => {
      const next = transform(prev);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const scan = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted || !indices.length || scanning.current) return;
    scanning.current = true;
    setBusy(true); setError(null);
    try {
      const fresh: Alert[] = [];
      const strategyIds = selectedStrategies().filter((id) =>
        INDEX_STRATEGIES.some((s) => s.id === id && s.timeframes.some((t) => t === SCAN_TIMEFRAME)));
      for (const market of indices) {
        if (signal.aborted) return;
        try {
          const candles = await fetchCandles(market.derivSymbol, SCAN_TIMEFRAME, signal);
          const higher = await fetchCandles(market.derivSymbol, HIGHER_TF[SCAN_TIMEFRAME], signal).catch(() => null);
          if (signal.aborted) return;
          const analysis = analyzeIndex({
            candles, higher, timeframe: SCAN_TIMEFRAME, now: Date.now(),
            open: market.open, decimals: market.decimals, strategy: "all", enabled: strategyIds,
          });
          if ((analysis.action !== "BUY" && analysis.action !== "SELL") ||
            analysis.lastCandleTime == null || analysis.entry == null ||
            analysis.stopLoss == null || analysis.takeProfit1 == null || analysis.takeProfit2 == null) continue;
          fresh.push({
            id: [market.derivSymbol, SCAN_TIMEFRAME, analysis.lastCandleTime, analysis.action, analysis.strategy ?? ""].join(":"),
            symbol: market.symbol, name: market.name, action: analysis.action,
            strategy: analysis.strategy ?? "Index strategy", timeframe: SCAN_TIMEFRAME,
            at: analysis.lastCandleTime, expiresAt: analysis.expiresAt ?? null,
            entry: analysis.entry, stopLoss: analysis.stopLoss,
            tp1: analysis.takeProfit1, tp2: analysis.takeProfit2, read: false,
          });
        } catch (e) {
          if (signal.aborted) return;
          // Continue monitoring other markets; never manufacture a signal on data errors.
          console.warn("Automatic index scan skipped", market.symbol, e);
        }
      }
      if (signal.aborted) return;
      const newAlerts = fresh.filter((a) => !knownIds.current.has(a.id));
      newAlerts.forEach((a) => knownIds.current.add(a.id));
      if (newAlerts.length) save((prev) => [...newAlerts, ...prev].slice(0, MAX_ALERTS));
      setLastChecked(Date.now());
      if (newAlerts.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const latest = newAlerts[0]!;
        new Notification("TradePulse · Index signal", {
          body: `${latest.symbol} ${latest.action} · ${latest.timeframe} · ${latest.strategy}`,
          tag: latest.id,
        });
      }
    } catch {
      if (!signal.aborted) setError("Automatic monitoring could not complete. Try again when the feed is available.");
    } finally {
      scanning.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }, [indices, save]);

  useEffect(() => {
    if (!enabled || !indices.length) return;
    const controller = new AbortController();
    void scan(controller.signal);
    const timer = window.setInterval(() => { void scan(controller.signal); }, INTERVAL_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [enabled, indices, scan]); // automatic monitoring is active only while this page remains open

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem("tradepulse-index-auto-alerts-v1", next ? "on" : "off"); } catch { /* ignore */ }
  };
  const requestBrowser = async () => {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setBrowserPermission(permission === "granted");
  };

  return (
    <div className="relative">
      <button type="button" className="chip relative inline-flex items-center gap-2"
        aria-label={`Notifications, ${unread} unread`} onClick={() => setOpened((v) => !v)}>
        {unread ? <BellRing size={15} /> : <Bell size={15} />} ALERTS
        {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{unread}</span>}
      </button>
      {opened && <section className="absolute right-0 top-full z-50 mt-2 max-h-[75vh] w-[min(90vw,400px)] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-2xl"
        aria-label="Index signal notifications">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-bold">INDEX SIGNAL ALERTS</h2>
          <button className="text-xs text-muted-foreground" onClick={() => setOpened(false)} aria-label="Close notifications">✕</button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Automatic M15 index checks every 5 minutes while this dashboard is open. Confirmed signals only; no trade execution.</p>
        <label className="mt-4 flex items-center justify-between gap-2 text-xs">
          <span>Automatic monitoring {enabled ? "ON" : "OFF"}</span>
          <input type="checkbox" checked={enabled} onChange={toggle} aria-label="Enable automatic index alerts" />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="chip chip-sm" disabled={busy || indices.length === 0} onClick={() => {
            const controller = new AbortController(); void scan(controller.signal);
          }}><RefreshCw size={12} className="inline" /> {busy ? "Checking…" : "Check now"}</button>
          <button className="chip chip-sm" onClick={() => save((prev) => prev.map((a) => ({ ...a, read: true })))}>
            <CheckCheck size={12} className="inline" /> Mark read
          </button>
          {typeof Notification !== "undefined" && Notification.permission !== "granted" &&
            <button className="chip chip-sm" onClick={() => { void requestBrowser(); }}>Enable desktop alerts</button>}
        </div>
        {browserPermission && <p className="mt-2 text-xs text-primary">Browser notifications enabled.</p>}
        {lastChecked && <p className="mt-2 text-[10px] text-muted-foreground">Last checked: {new Date(lastChecked).toLocaleString()}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        {indices.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No open stock indices currently available from the market feed.</p>}
        <div className="mt-4 space-y-2">
          {alerts.length === 0 && <p className="text-xs text-muted-foreground">No confirmed automatic index signals yet.</p>}
          {alerts.map((a) => <article key={a.id} className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="flex justify-between gap-2">
              <strong>{a.symbol} · <span className={a.action === "BUY" ? "text-bull" : "text-bear"}>{a.action}</span></strong>
              {!a.read && <span className="text-primary">● NEW</span>}
            </div>
            <p className="mt-1 text-muted-foreground">{a.strategy} · {a.timeframe} · {new Date(a.at).toLocaleString()}</p>
            <p className="mt-2 font-mono">Entry {a.entry} · SL {a.stopLoss}</p>
            <p className="font-mono">TP1 {a.tp1} · TP2 {a.tp2}</p>
            {a.expiresAt != null && <p className="mt-1 text-muted-foreground">Expires: {new Date(a.expiresAt).toLocaleTimeString()}</p>}
            {!a.read && <button className="mt-2 underline" onClick={() => save((prev) => prev.map((x) => x.id === a.id ? { ...x, read: true } : x))}>Mark as read</button>}
          </article>)}
        </div>
      </section>}
    </div>
  );
}
