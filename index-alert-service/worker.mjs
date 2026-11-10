/**
 * Dedicated scheduled index-signal Worker. Signal-only, separate from the production
 * TradePulse website and existing Telegram webhook Worker.
 * Deploy ONLY after the D1 migration and secret bindings have been reviewed.
 */
import { computeIndexTrendSignal, normalizeCandles } from "./scanner.mjs";

const WS_HTTP = "https://api.derivws.com/trading/v1/options/ws/public";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function reply(body, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  } });
}
function permittedOrigin(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  return origin && origin === env.DASHBOARD_ORIGIN ? origin : "";
}
/** Cloudflare Workers outbound WebSocket handshake via fetch + Upgrade. */
async function connectDeriv() {
  const response = await fetch(WS_HTTP, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error("Deriv WebSocket upgrade failed");
  ws.accept();
  return ws;
}
async function requestSocket(ws, payload, reqId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Deriv data timeout")); }, 12000);
    function cleanup() { clearTimeout(timeout); ws.removeEventListener("message", receive); ws.removeEventListener("close", closed); }
    function closed() { cleanup(); reject(new Error("Deriv socket closed")); }
    function receive(event) {
      try {
        const message = JSON.parse(String(event.data));
        if (message.req_id !== reqId) return;
        cleanup();
        if (message.error) reject(new Error("Deriv rejected market data"));
        else resolve(message);
      } catch { cleanup(); reject(new Error("Invalid Deriv response")); }
    }
    ws.addEventListener("message", receive);
    ws.addEventListener("close", closed);
    try { ws.send(JSON.stringify({ ...payload, req_id: reqId })); }
    catch { cleanup(); reject(new Error("Could not request Deriv candles")); }
  });
}
async function publishTelegram(env, signal) {
  if (!env.TELEGRAM_SERVICE_URL || !env.TRADEPULSE_PUBLISH_SECRET) return { skipped: true };
  const url = new URL("/publish", env.TELEGRAM_SERVICE_URL).toString();
  const res = await fetch(url, { method: "POST", headers: {
    "content-type": "application/json",
    Authorization: `Bearer ${env.TRADEPULSE_PUBLISH_SECRET}`,
  }, body: JSON.stringify(signal) });
  if (!res.ok) throw new Error(`Telegram publisher returned ${res.status}`);
  return res.json();
}
async function monitor(env) {
  if (!env.TRADEPULSE_DB?.prepare) throw new Error("TRADEPULSE_DB binding missing");
  const ws = await connectDeriv();
  let req = 0, checked = 0, newSignals = 0, published = 0;
  try {
    const active = await requestSocket(ws, { active_symbols: "brief" }, ++req);
    const symbols = (Array.isArray(active.active_symbols) ? active.active_symbols : [])
      .filter(x => ["indices", "stock_index", "stock_indices", "stockindex"].includes(String(x.market).toLowerCase())
        && x.exchange_is_open === 1 && x.is_trading_suspended === 0)
      .filter(x => /tech 100|wall street 30|us 500|germany 40|uk 100/i.test(String(x.underlying_symbol_name)))
      .slice(0, 9);
    for (const item of symbols) {
      try {
        const symbol = item.underlying_symbol;
        const response = await requestSocket(ws, {
          ticks_history: symbol, count: 160, end: "latest", style: "candles", granularity: 3600,
        }, ++req);
        const candles = normalizeCandles(response.candles, Date.now(), 3600000);
        const alert = computeIndexTrendSignal(candles, {
          symbol, displayName: item.underlying_symbol_name, now: Date.now(),
          decimals: Math.max(0,Math.min(8,Math.round(-Math.log10(item.pip_size ?? 0.01)))),
        });
        checked++;
        if (!alert) continue;
        const inserted = await env.TRADEPULSE_DB.prepare(
          "INSERT OR IGNORE INTO index_signal_alerts (id,symbol,strategy,direction,timeframe,entry,stop_loss,tp1,tp2,rr,candle_time,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(alert.id, alert.symbol,alert.strategy,alert.direction,alert.timeframe,alert.entry,alert.stopLoss,
          alert.tp1,alert.tp2,alert.rr,alert.candleTime,new Date().toISOString()).run();
        if ((inserted.meta?.changes ?? 0) === 0) continue;
        newSignals++;
        try {
          await publishTelegram(env, alert);
          published++;
          await env.TRADEPULSE_DB.prepare("UPDATE index_signal_alerts SET telegram_sent=1 WHERE id=?").bind(alert.id).run();
        } catch (error) { console.warn("Telegram delivery pending", String(error)); }
      } catch (error) { console.warn("Index scan unavailable", String(error)); }
    }
    return { checked, newSignals, published };
  } finally { try { ws.close(1000, "Scan complete"); } catch {} }
}
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(monitor(env).then(
      outcome => console.log("Index scheduled scan", JSON.stringify(outcome)),
      error => { console.error("Index scheduled scan failed", String(error)); throw error; },
    ));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = permittedOrigin(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin",
    } });
    if (url.pathname === "/health" && request.method === "GET")
      return reply({ service: "index-signal-scanner", configured: !!env.TRADEPULSE_DB?.prepare, mode: "signal-only" }, 200, origin);
    if (url.pathname !== "/alerts" || request.method !== "GET") return reply({ error: "Not found" }, 404, origin);
    if (!origin) return reply({ error: "Origin not permitted" }, 403, origin);
    if (!env.TRADEPULSE_DB?.prepare) return reply({ error: "Database unavailable" }, 503, origin);
    try {
      const records = await env.TRADEPULSE_DB.prepare(
        "SELECT id,symbol,strategy,direction,timeframe,entry,stop_loss AS stopLoss,tp1,tp2,rr,candle_time AS candleTime,created_at AS createdAt FROM index_signal_alerts ORDER BY candle_time DESC LIMIT 50"
      ).all();
      return reply({ alerts: records.results ?? [], source: "Deriv public completed H1 candles", generated: new Date().toISOString() }, 200, origin);
    } catch { return reply({ error: "Alert feed unavailable" }, 503, origin); }
  },
};
