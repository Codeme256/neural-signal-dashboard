/**
 * Standalone Cloudflare Worker: scheduled Deriv stock-index signal generation.
 * Additive D1 storage and trusted Telegram publishing. No trade execution.
 * Deploy independently of the existing website and Telegram Workers.
 */
import { parseDerivMarkets, parseDerivOhlc } from "../src/lib/deriv-data";
import { analyzeIndex } from "../src/lib/index-signal-engine";
import { TF_SECONDS, HIGHER_TF, type Timeframe } from "../src/lib/strategies/types";
import { evaluateOutcome } from "../src/lib/signal-tracker";
import { validateFreshEntry } from "./entry-freshness";
import { assessPullback, pullbackZone, type PullbackPlan } from "./pullback-policy";

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
  verified_at?: number; verified_quote?: number; verified_quote_time?: number;
  id: string; symbol: string; deriv_symbol: string; strategy: string;
  direction: "BUY" | "SELL"; timeframe: Timeframe;
  candle_time: number; created_at: number; expires_at: number | null;
  entry: number; stop_loss: number; tp1: number; tp2: number;
  rr: number; quality_score: number; data_source: string;
};
const PUBLIC_WS = "https://api.derivws.com/trading/v1/options/ws/public";
const MAX_MARKETS = 12;
const MAX_WATCHES_PER_SCAN=3;
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

type Watch={type:"WATCH";id:string;symbol:string;strategy:string;timeframe:Timeframe;
 candleTime:number;bias:"BULLISH"|"BEARISH";regime:string;createdAt:number;
 entryZoneLow?:number;entryZoneHigh?:number;expiresAt?:number};
async function publishTelegram(env: Env, a: Alert|Watch): Promise<boolean> {
  if (!env.TELEGRAM_PUBLISH_URL || !env.TRADEPULSE_PUBLISH_SECRET) return false;
  const parsed = new URL(env.TELEGRAM_PUBLISH_URL);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/publish") throw Error("Invalid Telegram publish endpoint configuration");
  const result = await fetch(parsed.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.TRADEPULSE_PUBLISH_SECRET,
    },
    body: JSON.stringify("type" in a ? a : {
      id: a.id, symbol: a.symbol, strategy: a.strategy,
      direction: a.direction, timeframe: a.timeframe, entry: a.entry,
      stopLoss: a.stop_loss, tp1: a.tp1, tp2: a.tp2,
      rr: a.rr, candleTime: a.candle_time,
      verifiedAt: a.verified_at, currentPrice: a.verified_quote, quoteTime: a.verified_quote_time,
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

type FollowUpAlert=Alert & {status?:string;closed_at?:number|null};
const OUTCOME_LIMIT=12;
/**
 * Checks server-generated index alerts after the website is closed.
 * Uses only completed M15 candles, never extrapolates missing OHLC data.
 * Persisted outcomes are hypothetical candle touches, not actual broker fills.
 */
async function followUpIssuedAlerts(env:Env) {
 const pending=await env.TRADEPULSE_DB.prepare(
  "SELECT a.* FROM index_alerts a LEFT JOIN index_alert_outcomes o ON o.alert_id=a.id WHERE o.alert_id IS NULL OR o.closed_at IS NULL ORDER BY COALESCE(o.checked_at,0) ASC, a.candle_time DESC LIMIT ?"
 ).bind(OUTCOME_LIMIT).all<FollowUpAlert>();
 if(!(pending.results??[]).length)return;
 const ws=await connect(),request=makeRequester(ws);
 let updated=0;
 try{
  for(const a of pending.results??[]){
   try{
    if(a.timeframe!=="M15")continue;
    const now=Date.now(),step=TF_SECONDS.M15*1000;
    const until=Math.min(now,a.candle_time+48*step);
    const raw=await request({
     ticks_history:a.deriv_symbol,
     start:Math.floor(a.candle_time/1000),
     end:until>=now?"latest":Math.floor(until/1000),
     style:"candles",granularity:TF_SECONDS.M15,count:100,
    });
    const candles=parseDerivOhlc(raw.candles)
      .filter(c=>c.time>=a.candle_time&&c.time+step<=now);
    if(!candles.length||candles[0]!.time>a.candle_time)continue;
    // Missing middle candles hide unknown stop/target ordering: never issue a verified outcome.
    if(candles.some((c,i)=>i>0&&c.time-candles[i-1]!.time!==step))continue;
    // Do not mark EXPIRED without confirmed OHLC coverage through the 48-candle horizon.
    const expiry=a.candle_time+48*step;
    const lastClosed=candles[candles.length-1]!.time+step;
    const throughEnd=now>=expiry&&lastClosed>=expiry;
    const outcome=evaluateOutcome({
     action:a.direction,timeframe:"M15",stopLoss:a.stop_loss,
     takeProfit1:a.tp1,takeProfit2:a.tp2,signalTime:a.candle_time
    },candles,throughEnd?now:Math.min(now,expiry-1));
    // OPEN and TP1 provisional WIN remain pending for the next scheduled check.
    await env.TRADEPULSE_DB.prepare(
     "INSERT INTO index_alert_outcomes (alert_id,symbol,strategy,direction,timeframe,signal_time,status,target,closed_at,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?) "+
     "ON CONFLICT(alert_id) DO UPDATE SET status=excluded.status,target=excluded.target,closed_at=excluded.closed_at,checked_at=excluded.checked_at"
    ).bind(a.id,a.symbol,a.strategy,a.direction,a.timeframe,a.candle_time,
     outcome.status,outcome.target,outcome.closedAt,now).run();
    updated++;
   }catch(error){
    console.warn("Outcome follow-up skipped",a.symbol,error instanceof Error?error.message:"Unknown");
   }
  }
 }finally{try{ws.close(1000,"Outcome follow-up complete");}catch{}}
 console.log("Index alert server follow-up",{updated});
}

/** Retry alerts after temporary Telegram failure; publisher deduplicates per subscriber. */
async function retryPending(env: Env) {
  if (!env.TELEGRAM_PUBLISH_URL || !env.TRADEPULSE_PUBLISH_SECRET) return;
  const pending=await env.TRADEPULSE_DB.prepare(
    "SELECT * FROM index_alerts WHERE notification_status='PENDING' ORDER BY created_at DESC LIMIT 10"
  ).all<Alert>();
  if(!(pending.results??[]).length)return;
  const ws=await connect(),request=makeRequester(ws);
  try{
    for(const a of pending.results??[]){
      const now=Date.now();
      if(now-a.candle_time>5*60*1000 || (a.expires_at!==null&&now>=a.expires_at)){
        await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status='EXPIRED' WHERE id=?").bind(a.id).run();
        continue;
      }
      try {
        const raw=await request({ticks_history:a.deriv_symbol,count:1,end:"latest",style:"ticks"});
        const px=Number((raw.history as {prices?:unknown[]}|undefined)?.prices?.at(-1));
        const qt=Number((raw.history as {times?:unknown[]}|undefined)?.times?.at(-1))*1000;
        const check=validateFreshEntry({now:Date.now(),candleTime:a.candle_time,expiresAt:a.expires_at,
          quoteTime:qt,currentPrice:px,entry:a.entry,stopLoss:a.stop_loss,tp1:a.tp1,tp2:a.tp2,direction:a.direction});
        if(!check.ok){
          await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status='EXPIRED' WHERE id=?").bind(a.id).run();
          continue;
        }
        a.verified_at=Date.now();a.verified_quote=px;a.verified_quote_time=qt;
        if(await publishTelegram(env,a)){
          await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status='SENT' WHERE id=?").bind(a.id).run();
        }
      }catch{ /* Retain only until five-minute freshness deadline. */}
    }
  }finally{try{ws.close(1000,"Pending entries checked");}catch{}}
}

/** The only path from PENDING plan to confirmed BUY/SELL notification. */
async function monitorPullbacks(env:Env) {
 const pending=await env.TRADEPULSE_DB.prepare(
  "SELECT * FROM index_pullback_plans WHERE status='PENDING' ORDER BY created_at ASC LIMIT 8"
 ).all<PullbackPlan>();
 if(!(pending.results??[]).length)return;
 const ws=await connect(),request=makeRequester(ws);
 try{
  for(const p of pending.results??[]){
   try{
    const now=Date.now();
    if(now>=p.expires_at){
     await env.TRADEPULSE_DB.prepare("UPDATE index_pullback_plans SET status='EXPIRED',reason='Setup expired before pullback',checked_at=? WHERE id=? AND status='PENDING'").bind(now,p.id).run();
     continue;
    }
    const raw=await request({ticks_history:p.deriv_symbol,start:Math.floor(p.candle_time/1000),end:"latest",
      count:180,style:"candles",granularity:60});
    const candles=parseDerivOhlc(raw.candles).filter(c=>c.time>=p.candle_time&&c.time+60000<=now);
    const q=await request({ticks_history:p.deriv_symbol,count:1,end:"latest",style:"ticks"});
    const price=Number((q.history as {prices?:unknown[]}|undefined)?.prices?.at(-1));
    const time=Number((q.history as {times?:unknown[]}|undefined)?.times?.at(-1))*1000;
    const decision=assessPullback(p,candles,Date.now(),price,time);
    if(decision.state==="WAIT")continue;
    if(decision.state==="INVALIDATED"||decision.state==="EXPIRED"){
     await env.TRADEPULSE_DB.prepare("UPDATE index_pullback_plans SET status=?,reason=?,checked_at=? WHERE id=? AND status='PENDING'")
      .bind(decision.state,decision.reason,Date.now(),p.id).run();
     continue;
    }
    const verifiedAt=Date.now();
    // A retest is recent even when the original M15 setup is older than five minutes;
    // do NOT bypass publisher's freshness policy: send the M1 confirmation time as candleTime.
    const confirmationTime=candles[candles.length-1]!.time+60000;
    const confirmationCheck=validateFreshEntry({now:verifiedAt,candleTime:confirmationTime,expiresAt:p.expires_at,
      quoteTime:time,currentPrice:price,entry:p.entry,stopLoss:p.stop_loss,tp1:p.tp1,tp2:p.tp2,direction:p.direction});
    if(!confirmationCheck.ok){console.log("Pullback confirmed but no timely quote",p.symbol,confirmationCheck.reason);continue;}
    const alert:Alert={id:p.id,symbol:p.symbol,deriv_symbol:p.deriv_symbol,strategy:p.strategy+" · Confirmed pullback",
      direction:p.direction,timeframe:"M15",candle_time:confirmationTime,created_at:verifiedAt,
      expires_at:p.expires_at,entry:p.entry,stop_loss:p.stop_loss,tp1:p.tp1,tp2:p.tp2,
      rr:p.rr,quality_score:p.quality_score,data_source:"Deriv M15+M1 retest",
      verified_at:verifiedAt,verified_quote:price,verified_quote_time:time};
    await record(env,alert);
    const delivered=await publishTelegram(env,alert);
    await env.TRADEPULSE_DB.prepare("UPDATE index_alerts SET notification_status=? WHERE id=?")
      .bind(delivered?"SENT":"PENDING",p.id).run();
    await env.TRADEPULSE_DB.prepare("UPDATE index_pullback_plans SET status='CONFIRMED',reason=?,checked_at=? WHERE id=? AND status='PENDING'")
      .bind(decision.reason,Date.now(),p.id).run();
  }catch(error){console.warn("Pullback monitor skipped",p.symbol,error instanceof Error?error.message:"Unknown");}
  }
 }finally{try{ws.close(1000,"Pullback scan complete");}catch{}}
}

async function scheduledScan(env: Env) {
  if (!env.TRADEPULSE_DB) throw Error("Required index alert database binding is missing");
  const ws = await connect();
  let scanned=0,stored=0,deliveryFailures=0,watchSent=0,staleSuppressed=0;
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
        // Pre-confirmation WATCH: directional context on a completed M15 candle.
        // No entry/SL/TP and no implied order; recipients see a WATCH label.
        if(result.action==="WAIT" && result.lastCandleTime!==null &&
          result.higherTrend!=="NEUTRAL" && result.marketRegime==="TRENDING" &&
          now-result.lastCandleTime>=0 && now-result.lastCandleTime<=5*60*1000 &&
          watchSent<MAX_WATCHES_PER_SCAN){
          const closed=candles.filter(c=>c.time+TF_SECONDS.M15*1000<=now);
          const last=closed.at(-1);
          const aligned=last&&(result.higherTrend==="BULLISH"?last.close>last.open:last.close<last.open);
          if(aligned){
            const hour=Math.floor(result.lastCandleTime/(60*60*1000));
            const watch:Watch={type:"WATCH",id:[m.derivSymbol,"WATCH",hour].join(":"),
             symbol:m.symbol,strategy:"Higher-timeframe trend watch",timeframe:TF,
             candleTime:result.lastCandleTime,bias:result.higherTrend,
             regime:result.marketRegime??"UNKNOWN",createdAt:now};
            try{if(await publishTelegram(env,watch))watchSent++;}
            catch{deliveryFailures++;}
          }
        }
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
        // A newly confirmed setup is a PENDING pullback plan, never an instant entry.
        // Store separately so unfilled plans cannot enter win/loss statistics.
        if(a.expires_at===null||a.expires_at<=now)continue;
        const zone=pullbackZone({entry:a.entry,stop_loss:a.stop_loss});
        const insert=await env.TRADEPULSE_DB.prepare(
         "INSERT OR IGNORE INTO index_pullback_plans (id,symbol,deriv_symbol,strategy,direction,candle_time,created_at,expires_at,entry,stop_loss,tp1,tp2,rr,quality_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(a.id,a.symbol,a.deriv_symbol,a.strategy,a.direction,a.candle_time,a.created_at,a.expires_at,
          a.entry,a.stop_loss,a.tp1,a.tp2,a.rr,a.quality_score).run();
        if((insert.meta?.changes??0)!==1)continue;
        const watch:Watch={type:"WATCH",id:a.id+":PULLBACK",symbol:a.symbol,strategy:a.strategy,
          timeframe:TF,candleTime:a.candle_time,bias:a.direction==="BUY"?"BULLISH":"BEARISH",
          regime:"TRENDING",createdAt:now,entryZoneLow:Number(zone.low.toFixed(m.decimals)),
          entryZoneHigh:Number(zone.high.toFixed(m.decimals)),expiresAt:a.expires_at};
        try{if(await publishTelegram(env,watch))watchSent++;}
        catch{deliveryFailures++;}
        // Only monitorPullbacks() can issue confirmed entries after a fresh M1 retest.

      } catch (error) {
        console.warn("Index scan skipped:",m.symbol,error instanceof Error?error.message:"Unknown error");
      }
    }
  } finally {
    try { ws.close(1000,"Scan complete"); } catch { /* disconnected */ }
  }
  try { await monitorPullbacks(env); } catch (error) { console.warn("Pullback monitor unavailable",error instanceof Error?error.message:"Unknown"); }
  try { await retryPending(env); } catch { /* D1 unavailable; retry next run. */ }
  console.log("Index scheduled scan",{scanned,stored,watchSent,staleSuppressed,deliveryFailures});
}

export default {
  async scheduled(_event: ScheduledController,env: Env,ctx: ExecutionContext) {
    ctx.waitUntil(scheduledScan(env));
    ctx.waitUntil(followUpIssuedAlerts(env).catch(e=>console.warn("Scheduled index follow-up unavailable",e instanceof Error?e.message:"Unknown")));
  },
  async fetch(request: Request,env: Env) {
    const url=new URL(request.url);
    if(url.pathname==="/health") return response({
      service:"tradepulse-index-alert-service",
      scheduled:true,source:"Deriv public market data",
      telegramPublisherConfigured:!!(env.TELEGRAM_PUBLISH_URL&&env.TRADEPULSE_PUBLISH_SECRET),
      dbConfigured:!!env.TRADEPULSE_DB,
    });
    if (request.method!=="GET"||(url.pathname!=="/alerts"&&url.pathname!=="/outcomes")) return response({error:"Not found"},404);
    const origin=request.headers.get("Origin");
    const allowed = env.CORS_ORIGIN?.replace(/\/$/,"");
    const cors = origin && allowed && origin===allowed ? origin : undefined;
    if (origin && !cors) return response({error:"Origin not allowed"},403);
    if (!env.TRADEPULSE_DB) return response({error:"Market alert storage unavailable"},503,cors);
    if(url.pathname==="/outcomes"){
      try{
       const rows=await env.TRADEPULSE_DB.prepare(
        "SELECT o.alert_id,o.symbol,o.strategy,o.direction,o.timeframe,o.signal_time,o.status,o.target,o.closed_at,o.checked_at, a.entry,a.stop_loss,a.tp1,a.tp2 "+
        "FROM index_alert_outcomes o JOIN index_alerts a ON a.id=o.alert_id ORDER BY o.signal_time DESC LIMIT 200"
       ).all();
       return response({outcomes:rows.results??[],source:"Deriv completed M15 candles",kind:"hypothetical_signal_outcomes",feesIncluded:false},200,cors);
      }catch{return response({error:"Outcome database migration not yet applied"},503,cors);}
    }
    try {
      const rows=await env.TRADEPULSE_DB.prepare(
        "SELECT id,symbol,strategy,direction,timeframe,candle_time,created_at,expires_at,entry,stop_loss,tp1,tp2,quality_score FROM index_alerts ORDER BY created_at DESC LIMIT 50"
      ).all();
      return response({alerts:rows.results??[],source:"Deriv",live: true},200,cors);
    } catch { return response({error:"Index alert storage not initialized"},503,cors); }
  },
};
