/**
 * Standalone Cloudflare Worker: scheduled Deriv stock-index signal generation.
 * Additive D1 storage and trusted Telegram publishing. No trade execution.
 * Deploy independently of the existing website and Telegram Workers.
 */
import { parseDerivMarkets, parseDerivOhlc } from "../src/lib/deriv-data";
import { analyzeIndex } from "../src/lib/index-signal-engine";
import { TF_SECONDS, HIGHER_TF, type Timeframe } from "../src/lib/strategies/types";

type ScheduledController = { scheduledTime: number };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
interface Database {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      all<T>(): Promise<{ results?: T[] }>;
    };
    all<T>(): Promise<{ results?: T[] }>;
  };
}
interface Env {
  TRADEPULSE_DB: Database;
  TELEGRAM_PUBLISH_URL?: string;
  TRADEPULSE_PUBLISH_SECRET?: string;
  CORS_ORIGIN?: string;
}
type Alert = {
  id: string; symbol: string; deriv_symbol: string; strategy: string;
  direction: "BUY" | "SELL"; timeframe: Timeframe;
  candle_time: number; created_at: number; expires_at: number | null;
  entry: number; stop_loss: number; tp1: number; tp2: number;
  rr: number; quality_score: number; data_source: string;
};
const PUBLIC_WS = "https://api.derivws.com/trading/v1/options/ws/public";
const MAX_MARKETS = 12;
const MIN_QUALITY = 70;
const TF: Timeframe = "M15";
const HIGHER = HIGHER_TF[TF];
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const response = (data: unknown, status=200, origin?: string) => new Response(JSON.stringify(data), {
  status, headers: { ...RESPONSE_HEADERS, ...(origin ? { "access-control-allow-origin": origin, "vary": "Origin" } : {}) },
});

type CloudflareSocketResponse = Response & { webSocket?: WebSocket };
async function connect() {
  const res = await fetch(PUBLIC_WS, { headers: { Upgrade: "websocket" } }) as CloudflareSocketResponse;
  const ws = res.webSocket;
  if (!ws) throw Error("Deriv public WebSocket upgrade rejected");
  (ws as WebSocket & { accept(): void }).accept();
  return ws;
}

function makeRequester(ws: WebSocket) {
  let id = 0;
  return (payload: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((resolve,reject) => {
    const req_id = ++id;
    const timer = setTimeout(() => { cleanup(); reject(Error("Deriv request timed out")); }, 12000);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage as EventListener);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("error", onClose);
    };
    const onClose = () => { cleanup(); reject(Error("Deriv WebSocket disconnected")); };
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (data.req_id !== req_id) return;
        cleanup();
        if (data.error) { reject(Error("Deriv rejected the requested market data")); return; }
        resolve(data);
      } catch { /* malformed or unrelated frame is not market evidence */ }
    };
    ws.addEventListener("message", onMessage as EventListener);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
    try { ws.send(JSON.stringify({ ...payload, req_id })); }
    catch { cleanup(); reject(Error("Cannot send Deriv request")); }
  });
}

async function publishTelegram(env: Env, a: Alert): Promise<boolean> {
  if (!env.TELEGRAM_PUBLISH_URL || !env.TRADEPULSE_PUBLISH_SECRET) return false;
  const parsed = new URL(env.TELEGRAM_PUBLISH_URL);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/publish") throw Error("Invalid Telegram publish endpoint configuration");
  const result = await fetch(parsed.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.TRADEPULSE_PUBLISH_SECRET,
    },
    body: JSON.stringify({
      id: a.id, symbol: a.symbol, strategy: a.strategy,
      direction: a.direction, timeframe: a.timeframe, entry: a.entry,
      stopLoss: a.stop_loss, tp1: a.tp1, tp2: a.tp2,
      rr: a.rr, candleTime: a.candle_time,
    }),
  });
  if (!result.ok) return false;
  const data = await result.json() as { failed?: number };
  return (data.failed ?? 0) === 0;
}

async function record(env: Env, a: Alert): Promise<boolean> {
  const result = await env.TRADEPULSE_DB.prepare(
    "INSERT OR IGNORE INTO index_alerts (id,symbol,deriv_symbol,strategy,direction,timeframe,candle_time,created_at,expires_at,entry,stop_loss,tp1,tp2,rr,quality_score,data_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(a.id,a.symbol,a.deriv_symbol,a.strategy,a.direction,a.timeframe,
    a.candle_time,a.created_at,a.expires_at,a.entry,a.stop_loss,a.tp1,a.tp2,
    a.rr,a.quality_score,a.data_source).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Retry alerts after temporary Telegram failure; publisher deduplicates per subscriber. */
async function retryPending(env: Env) {
  if (!env.TELEGRAM_PUBLISH_URL || !env.TRADEPULSE_PUBLISH_SECRET) return;
  const recent = Date.now() - 90 * 60 * 1000;
  const pending = await env.TRADEPULSE_DB.prepare(
    "SELECT * FROM index_alerts WHERE notification_status='PENDING' AND candle_time>? ORDER BY created_at ASC LIMIT 10"
  ).bind(recent).all<Alert>();
  for(const a of pending.results??[]) {
    try {
      if (await publishTelegram(env,a)) {
        await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status='SENT' WHERE id=?")
          .bind(a.id).run();
      }
    } catch { /* Retain as pending for the next scheduled invocation. */ }
  }
}

async function scheduledScan(env: Env) {
  if (!env.TRADEPULSE_DB) throw Error("Required index alert database binding is missing");
  const ws = await connect();
  let scanned=0,stored=0,deliveryFailures=0;
  const request=makeRequester(ws);
  try {
    const active=await request({active_symbols:"brief"});
    const markets=parseDerivMarkets(active.active_symbols).filter(m=>m.category==="INDEX"&&m.open).slice(0,MAX_MARKETS);
    for (const m of markets) {
      try {
        const raw = await request({
          ticks_history:m.derivSymbol, count:300, end:"latest", style:"candles", granularity:TF_SECONDS[TF]
        });
        const higherRaw = await request({
          ticks_history:m.derivSymbol, count:300, end:"latest", style:"candles", granularity:TF_SECONDS[HIGHER]
        });
        const candles=parseDerivOhlc(raw.candles);
        const higher=parseDerivOhlc(higherRaw.candles);
        const now=Date.now();
        const result=analyzeIndex({
          candles,higher,timeframe:TF,open:true,decimals:m.decimals,
          strategy:"all",enabled:["trend"],now,
        });
        scanned++;
        if (result.action!=="BUY"&&result.action!=="SELL") continue;
        if (result.score<MIN_QUALITY||result.lastCandleTime===null||
            result.entry===null||result.stopLoss===null||
            result.takeProfit1===null||result.takeProfit2===null||
            result.riskReward===null||!result.strategy) continue;
        const id=[m.derivSymbol,TF,result.lastCandleTime,result.action,result.strategy].join(":");
        const a:Alert={
          id,symbol:m.symbol,deriv_symbol:m.derivSymbol,
          strategy:result.strategy,direction:result.action,
          timeframe:TF,candle_time:result.lastCandleTime,
          created_at:now,expires_at:result.expiresAt??null,
          entry:result.entry,stop_loss:result.stopLoss,
          tp1:result.takeProfit1,tp2:result.takeProfit2,
          rr:result.riskReward,quality_score:result.score,
          data_source:"Deriv",
        };
        if (!await record(env,a)) continue; // idempotent across scheduled invocations
        stored++;
        try {
          const delivered=await publishTelegram(env,a);
          await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status=? WHERE id=?")
            .bind(delivered?"SENT":"PENDING",a.id).run();
          if (!delivered) deliveryFailures++;
        } catch {
          deliveryFailures++;
          // Persist signal even when Telegram is unavailable, never expose private secrets.
        }
      } catch (error) {
        console.warn("Index scan skipped:",m.symbol,error instanceof Error?error.message:"Unknown error");
      }
    }
  } finally {
    try { ws.close(1000,"Scan complete"); } catch { /* disconnected */ }
  }
  try { await retryPending(env); } catch { /* D1 unavailable; retry next run. */ }
  console.log("Index scheduled scan",{scanned,stored,deliveryFailures});
}

export default {
  async scheduled(_event: ScheduledController,env: Env,ctx: ExecutionContext) {
    ctx.waitUntil(scheduledScan(env));
  },
  async fetch(request: Request,env: Env) {
    const url=new URL(request.url);
    if(url.pathname==="/health") return response({
      service:"tradepulse-index-alert-service",
      scheduled:true,source:"Deriv public market data",
      telegramPublisherConfigured:!!(env.TELEGRAM_PUBLISH_URL&&env.TRADEPULSE_PUBLISH_SECRET),
      dbConfigured:!!env.TRADEPULSE_DB,
    });
    if (request.method!=="GET"||url.pathname!=="/alerts") return response({error:"Not found"},404);
    const origin=request.headers.get("Origin");
    const allowed = env.CORS_ORIGIN?.replace(/\/$/,"");
    const cors = origin && allowed && origin===allowed ? origin : undefined;
    if (origin && !cors) return response({error:"Origin not allowed"},403);
    if (!env.TRADEPULSE_DB) return response({error:"Market alert storage unavailable"},503,cors);
    try {
      const rows=await env.TRADEPULSE_DB.prepare(
        "SELECT id,symbol,strategy,direction,timeframe,candle_time,created_at,expires_at,entry,stop_loss,tp1,tp2,quality_score FROM index_alerts ORDER BY created_at DESC LIMIT 50"
      ).all();
      return response({alerts:rows.results??[],source:"Deriv",live: true},200,cors);
    } catch { return response({error:"Index alert storage not initialized"},503,cors); }
  },
};
