import { fetchEconomicCalendar, formatEventReminder } from "./news-calendar.mjs";
import { renderSignalBanner } from "./signal-banners.mjs";
/** Independent TradePulse Telegram notification Worker.
 * No Supabase, no TradePulse browser dependencies, no MT5/trade execution.
 * One shared bot; private /start & /stop subscriptions; optional channel broadcasting.
 * /publish accepts ONLY authenticated server-side sources. This Worker does not
 * generate signals; attach a verified scanner/publisher before expecting automatic alerts.
 */
const NEWS_SOURCE_TIMEOUT=10000;
const HEADER = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const respond = (payload, status=200) => new Response(JSON.stringify(payload), { status, headers: HEADER });
const botValid = token => typeof token === "string" && /^\d{5,15}:[A-Za-z0-9_-]{25,}$/.test(token);
const str = x => typeof x === "string" ? x : "";
const hasDb = env => env.TRADEPULSE_DB && typeof env.TRADEPULSE_DB.prepare === "function";

async function telegram(env, method, params) {
  if (!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)) throw new Error("Telegram bot is not configured as a secret");
  const response = await fetch(`https://api.telegram.org/bot${env.TRADEPULSE_TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error("Telegram API delivery rejected");
  return result.result;
}
async function telegramPhoto(env,chatId,card,caption,preparedPng=null) {
 if(!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))throw Error("Telegram bot unavailable");
 const png=preparedPng??await renderSignalBanner(card);
 const form=new FormData();
 form.set("chat_id",String(chatId));
 form.set("caption",String(caption).slice(0,1024));
 form.set("photo",new Blob([png],{type:"image/png"}),"apex-"+card.type.toLowerCase()+".png");
 const response=await fetch(`https://api.telegram.org/bot${env.TRADEPULSE_TELEGRAM_BOT_TOKEN}/sendPhoto`,{method:"POST",body:form});
 const json=await response.json().catch(()=>({}));
 if(!response.ok||json.ok!==true)throw Error("Telegram image upload rejected");
 return json.result;
}
async function verifySecret(provided, expected) {
  if (!provided || !expected || provided.length > 512) return false;
  const enc = new TextEncoder();
  const [a,b] = await Promise.all([provided, expected].map(x => crypto.subtle.digest("SHA-256",enc.encode(x))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff=0; for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
async function requestBody(request) {
  const text=await request.text();
  if(text.length>6000)throw Error("Payload too large");
  const value=JSON.parse(text);
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Expected JSON object");
  return value;
}
const COMMANDS = [
 ["start","Start APEX bot and subscribe to alerts"],["help","Commands and usage"],["menu","Open interactive signal menu"],
 ["status","View bot and signal-source status"],["signal","Latest confirmed index signal"],["analyze","Analyze last confirmed index setup"],
 ["price","Fetch a Deriv market price"],["watchlist","View monitored instruments"],["news","Economic news availability"],
 ["mode","View signal-only mode"],["account","Broker account availability"],["positions","Broker positions availability"],
 ["close","Broker order closure availability"],["risk","Signal risk safeguards"],["performance","Signal statistics"],
 ["history","Recent confirmed signals"],["dailypl","Broker P/L availability"],["drawdown","Broker drawdown availability"],
 ["pause","Pause personal Telegram alerts"],["resume","Resume personal Telegram alerts"],
 ["autotrading","Autotrading availability"],["alerts","Personal alert subscription"],["settings","Signal bot settings"],
 ["report","Recent signal activity report"],["confirm","Transaction confirmation availability"],
 ["cancel","Cancel pending requests"],["support","Help and diagnostics"],["stop","Unsubscribe from Telegram alerts"],
];
const COMMAND_MENU = {
 inline_keyboard:[
  [{text:"📊 Latest signal",callback_data:"cmd:signal"},{text:"💹 Price",callback_data:"cmd:price"}],
  [{text:"🔎 Analyze",callback_data:"cmd:analyze"},{text:"📋 Watchlist",callback_data:"cmd:watchlist"}],
  [{text:"🔔 Alerts",callback_data:"cmd:alerts"},{text:"📈 Report",callback_data:"cmd:report"}],
  [{text:"⚙️ Status",callback_data:"cmd:status"},{text:"❓ Help",callback_data:"cmd:help"}],
 ],
};
const HELP = "APEX TRADING BOT · Signal-only\n\n"+COMMANDS.map(([command,detail])=>"/"+command+" — "+detail).join("\n")+
 "\n\nExamples: /price EURUSD, /price XAUUSD, /signal, /history\nSignals are not trade orders. No broker account is connected to this Telegram Worker.";
const sendText = (env,chatId,text,menu=false) => telegram(env,"sendMessage",{
 chat_id:chatId,text,disable_web_page_preview:true,...(menu?{reply_markup:COMMAND_MENU}:{})
});
async function subscription(env,id) {
 const row=await env.TRADEPULSE_DB.prepare("SELECT enabled FROM telegram_subscriptions WHERE telegram_user_id=?")
  .bind(id).first();
 return row?.enabled===1;
}
async function setSubscription(env,id,chatId,on) {
 if(on) {
  await env.TRADEPULSE_DB.prepare("INSERT INTO telegram_subscriptions (user_id,telegram_chat_id,telegram_user_id,enabled,linked_at) VALUES (?,?,?,1,?) ON CONFLICT(telegram_user_id) DO UPDATE SET enabled=1,telegram_chat_id=excluded.telegram_chat_id,linked_at=excluded.linked_at")
   .bind("tg:"+id,chatId,id,new Date().toISOString()).run();
 } else {
  await env.TRADEPULSE_DB.prepare("UPDATE telegram_subscriptions SET enabled=0 WHERE telegram_user_id=?").bind(id).run();
 }
}
const FINANCE_UNAVAILABLE = "Broker functions are not connected to this signal-only Telegram service. No positions, account equity or execution credentials are available. Nothing was traded or changed.";
async function recentAlerts(env,limit=5) {
 const out=await env.TRADEPULSE_DB.prepare(
  "SELECT id,symbol,deriv_symbol,strategy,direction,timeframe,candle_time,created_at,expires_at,entry,stop_loss,tp1,tp2,rr,quality_score FROM index_alerts ORDER BY created_at DESC LIMIT ?"
 ).bind(limit).all();
 return out.results??[];
}
function alertDescription(a) {
 const time=Number(a.candle_time);
 const expiry=a.expires_at==null?null:Number(a.expires_at);
 const historical=expiry!=null && Date.now()>expiry || !Number.isFinite(time) || Date.now()-time>2*3600000;
 return (historical?"HISTORICAL — NOT ACTIONABLE\n":"")+
  a.symbol+" "+a.direction+" · "+a.timeframe+"\nStrategy: "+a.strategy+
  "\nEntry: "+a.entry+" | SL: "+a.stop_loss+
  "\nTP1: "+a.tp1+" | TP2: "+a.tp2+"\nR:R: "+Number(a.rr).toFixed(2)+
  " | Setup score: "+a.quality_score+" / 100 (not win probability)"+
  "\nCandle: "+new Date(time).toISOString();
}
const PRICE_SYMBOLS = Object.freeze({
 EURUSD:"frxEURUSD",GBPUSD:"frxGBPUSD",USDJPY:"frxUSDJPY",
 GBPJPY:"frxGBPJPY",XAUUSD:"frxXAUUSD",BTCUSD:"cryBTCUSD",
});
async function fetchDerivPrice(underlying) {
 // Public Deriv WebSocket market-data endpoint; no user API token.
 const res=await fetch("https://api.derivws.com/trading/v1/options/ws/public",{headers:{Upgrade:"websocket"}});
 const ws=res.webSocket;
 if(!ws) throw Error("Deriv price WebSocket unavailable");
 ws.accept();
 try {
  const received=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{cleanup();reject(Error("Price source timeout"));},9000);
   function cleanup(){clearTimeout(timeout);ws.removeEventListener("message",message);ws.removeEventListener("error",failure);ws.removeEventListener("close",failure);}
   function failure(){cleanup();reject(Error("Deriv price source disconnected"));}
   function message(event){
    try {
     const result=JSON.parse(String(event.data));
     if(result.req_id!==1)return;
     cleanup();
     if(result.error)return reject(Error("Deriv quote not available"));
     resolve(result);
    } catch {/* Reject malformed data only after timeout. */}
   }
   ws.addEventListener("message",message);
   ws.addEventListener("error",failure);
   ws.addEventListener("close",failure);
   ws.send(JSON.stringify({ticks_history:underlying,end:"latest",count:1,style:"ticks",req_id:1}));
  });
  const data=received;
  const price=Number(data.history?.prices?.at(-1));
  const time=Number(data.history?.times?.at(-1));
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(time)||Math.abs(Date.now()-time*1000)>180000)
   throw Error("No sufficiently fresh price is available");
  return {price,time};
 } finally {try{ws.close(1000,"Quote received");}catch{}}
}
async function fetchDerivCandles(underlying) {
 const res=await fetch("https://api.derivws.com/trading/v1/options/ws/public",{headers:{Upgrade:"websocket"}});
 const ws=res.webSocket;
 if(!ws)throw Error("Deriv candles unavailable");
 ws.accept();
 try{
  const raw=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error("Deriv candle request timeout"));},9000);
   function cleanup(){clearTimeout(timer);ws.removeEventListener("message",onMessage);ws.removeEventListener("error",onError);ws.removeEventListener("close",onError);}
   function onError(){cleanup();reject(Error("Deriv disconnected"));}
   function onMessage(event){
    try {
     const data=JSON.parse(String(event.data));
     if(data.req_id!==1)return;
     cleanup();
     if(data.error)return reject(Error("Deriv candle data refused"));
     resolve(data);
    }catch{/* Invalid or unrelated frame: request still times out safely. */}
   }
   ws.addEventListener("message",onMessage);
   ws.addEventListener("error",onError);
   ws.addEventListener("close",onError);
   ws.send(JSON.stringify({ticks_history:underlying,count:120,end:"latest",style:"candles",granularity:3600,req_id:1}));
  });
  const candles=raw.candles;
  if(!Array.isArray(candles))throw Error("No candles");
  const now=Date.now();
  const valid=candles.map(c=>({
   time:Number(c.epoch)*1000,open:Number(c.open),high:Number(c.high),
   low:Number(c.low),close:Number(c.close)
  })).filter(c=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)&&
   c.time>0&&c.low>0&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close)&&
   c.time+3600000<=now).sort((a,b)=>a.time-b.time);
  if(valid.length<60)throw Error("Not enough completed candles");
  const unique=valid.filter((c,i)=>i===0||c.time!==valid[i-1].time);
  if(unique.length<60||now-(unique.at(-1).time+3600000)>2*3600000)
   throw Error("Candle data unavailable or stale");
  return unique;
 }finally{try{ws.close(1000,"OHLC fetched");}catch{}}
}
function calculateEMA(values,period){
 let ema=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
 for(const x of values.slice(period))ema=x*(2/(period+1))+ema*(1-2/(period+1));
 return ema;
}
function analyzeCandles(symbol,candles){
 const latest=candles.at(-1);
 const closes=candles.map(c=>c.close);
 const ema20=calculateEMA(closes,20),ema50=calculateEMA(closes,50);
 const prior=candles.slice(-21,-1);
 const high=Math.max(...prior.map(c=>c.high)),low=Math.min(...prior.map(c=>c.low));
 const body=Math.abs(latest.close-latest.open);
 const range=latest.high-latest.low;
 const trend=latest.close>ema20&&ema20>ema50?"UPTREND":
  latest.close<ema20&&ema20<ema50?"DOWNTREND":"MIXED";
 const structure=latest.close>high?"Closed above 20-candle range high":
  latest.close<low?"Closed below 20-candle range low":"Inside previous 20-candle range";
 return "APEX On-Demand H1 Analysis · "+symbol+
  "\nLast confirmed close: "+latest.close+
  "\nCandle closed: "+new Date(latest.time+3600000).toISOString()+
  "\nEMA20: "+ema20.toFixed(5)+" | EMA50: "+ema50.toFixed(5)+
  "\nTrend classification: "+trend+
  "\n20-candle structure: "+structure+
  "\nLast candle: "+(latest.close>latest.open?"bullish":latest.close<latest.open?"bearish":"doji")+
  ", body "+(range>0?(body/range*100).toFixed(0):"0")+"% of range"+
  "\n\nTechnical context only — NOT a BUY/SELL signal or guarantee of profitability.";
}
async function commandReply(env,chatId,id,cmd,args) {
 const db=env.TRADEPULSE_DB;
 if(cmd==="start"||cmd==="resume") {
  await setSubscription(env,id,chatId,true);
  return sendText(env,chatId,"✅ APEX signal alerts enabled for this chat.\nUse /menu, /signal or /price EURUSD.\nTrading execution is not connected.",true);
 }
 if(cmd==="stop"||cmd==="pause") {
  await setSubscription(env,id,chatId,false);
  return sendText(env,chatId,"🔕 Personal Telegram alerts paused. Send /resume to enable again.\nChannel broadcasts are managed separately.");
 }
 if(cmd==="menu")return sendText(env,chatId,"APEX Signal Command Center\nChoose a function:",true);
 if(cmd==="help")return sendText(env,chatId,HELP);
 if(cmd==="status") {
  const enabled=await subscription(env,id);
  const latest=await recentAlerts(env,1).catch(()=>[]);
  return sendText(env,chatId,"APEX bot: online\nAlerts to this chat: "+(enabled?"enabled":"paused")+
    "\nIndex signal database: "+(latest?"accessible":"unavailable")+
    "\nLatest recorded index signal: "+(latest[0]?new Date(latest[0].created_at).toISOString():"none")+
    "\nBroker connection: not configured\nTrading mode: signal-only");
 }
 if(cmd==="alerts"||cmd==="settings") {
  const enabled=await subscription(env,id);
  return sendText(env,chatId,"Personal Telegram alerts: "+(enabled?"ON":"OFF")+
   "\n/start or /resume — enable\n/pause or /stop — disable\nChannel posts depend on the channel configuration and available confirmed signals.");
 }
 if(cmd==="analyze"){
  const symbol=(args[0]||"EURUSD").toUpperCase().replace("/","");
  const underlying=PRICE_SYMBOLS[symbol];
  if(!underlying)return sendText(env,chatId,"Unsupported analysis symbol. Try /analyze EURUSD, GBPUSD, USDJPY, GBPJPY, XAUUSD or BTCUSD.");
  try{return sendText(env,chatId,analyzeCandles(symbol,await fetchDerivCandles(underlying)));}
  catch{return sendText(env,chatId,"A current, valid H1 analysis is unavailable for "+symbol+". No trade signal was generated.");}
 }
 if(cmd==="signal"||cmd==="history"||cmd==="report"||cmd==="performance") {
  let rows;
  try {rows=await recentAlerts(env,cmd==="history"||cmd==="report"?5:1);}
  catch {return sendText(env,chatId,"Index alerts database is unavailable. No signal can be confirmed.");}
  if(!rows.length)return sendText(env,chatId,"No confirmed index signals have been recorded yet. Nothing to trade. /price EURUSD can check a fresh market quote.");
  if(cmd==="performance")return sendText(env,chatId,"Recorded index signals: historical entries are available, but verified trading outcomes, win rate and profitability statistics are NOT tracked by this bot. /history shows recent signals.");
  if(cmd==="report")return sendText(env,chatId,"APEX Index Signal Activity (last "+rows.length+" records)\n\n"+rows.map(a=>a.symbol+" "+a.direction+" "+a.timeframe+" · "+new Date(a.candle_time).toISOString()).join("\n")+"\n\nThese are alerts, not executed trades.");

  return sendText(env,chatId,(cmd==="history"?"Recent Index Signals\n\n":"Latest Index Signal\n\n")+rows.map(alertDescription).join("\n\n"));
 }
 if(cmd==="watchlist")return sendText(env,chatId,
  "Scheduled index scanner: open Deriv stock indices, M15 with higher-timeframe context.\nOn-demand prices: EURUSD, GBPUSD, USDJPY, GBPJPY, XAUUSD, BTCUSD.\nUse /price EURUSD.\nPrice symbols are not guaranteed to be open or available.");
 if(cmd==="price") {
  const symbol=(args[0]||"EURUSD").toUpperCase().replace("/","");
  const underlying=PRICE_SYMBOLS[symbol];
  if(!underlying)return sendText(env,chatId,"Unknown or unsupported price symbol. Try /price EURUSD, GBPUSD, USDJPY, GBPJPY, XAUUSD or BTCUSD.");
  try {
   const q=await fetchDerivPrice(underlying);
   return sendText(env,chatId,symbol+" · Deriv last available tick: "+q.price+
     "\nTime: "+new Date(q.time*1000).toISOString()+"\nIndicative historical tick, not a guaranteed executable bid/ask quote.");
  } catch {
   return sendText(env,chatId,"No verified fresh Deriv quote for "+symbol+" right now. Price unavailable; do not treat old quotes as live.");
  }
 }
 if(cmd==="risk")return sendText(env,chatId,
  "Index scanner quality gates: completed candles, regime and H1 direction checks, minimum stressed 1:2 reward/risk. Cost assumptions are estimates, not measured spreads.\nNo real-money account risk limits are enforced by this signal-only bot.");
 if(cmd==="mode"||cmd==="autotrading")return sendText(env,chatId,
  "Mode: SIGNALS ONLY. Auto-scanning may generate notifications, but automatic order placement is unavailable. No brokerage execution controls are connected.");
 if(cmd==="news") {
  try {
   const calendar=await fetchEconomicCalendar();
   if(calendar.stale)return sendText(env,chatId,"📰 Calendar source is stale. Release times unverified; reminders disabled.");
   const upcoming=calendar.events.filter(e=>Date.parse(e.scheduledAt)>Date.now()).slice(0,5);
   if(!upcoming.length)return sendText(env,chatId,"No upcoming verified high-impact events from "+calendar.source+". This does not cover all market news.");
   return sendText(env,chatId,"📰 Upcoming High-Impact Releases (EAT)\n\n"+
    upcoming.map(e=>e.currency+" · "+e.event+"\n"+
      new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",dateStyle:"medium",timeStyle:"short"}).format(new Date(e.scheduledAt))+
      " EAT\nAffected: "+e.affected.slice(0,6).join(", ")+
      "\nConsensus: "+(e.forecast??"Not available")+" · Previous: "+(e.previous??"Not available")+
      "\nDirection: UNKNOWN until actual data").join("\n\n")+
    "\n\nScenarios are conditional, not predictions. Source: "+calendar.source+" · "+calendar.sourceUrl);
  }catch{return sendText(env,chatId,"Economic calendar unavailable from both configured sources. News timings not verified. Check /news later.");}
 }
 if(["account","positions","close","dailypl","drawdown"].includes(cmd))return sendText(env,chatId,FINANCE_UNAVAILABLE);
 if(cmd==="confirm"||cmd==="cancel")return sendText(env,chatId,"No pending trade or account action exists. This service never executes trades.");
 if(cmd==="support")return sendText(env,chatId,
  "Commands: /help, /menu, /status, /signal, /price EURUSD, /alerts.\nIf the bot does not reply, confirm Telegram webhook points to /telegram/webhook and the webhook secret matches.\nNo API secrets should be sent in chat.");
 return sendText(env,chatId,"Unknown command. Send /help.");
}
async function privateMessage(message,env) {
 const chat=message.chat??{},from=message.from??{};
 if(chat.type!=="private"||!/^\d{2,20}$/.test(String(chat.id??""))||String(chat.id)!==String(from.id??""))return;
 const parts=str(message.text).trim().split(/\s+/);
 const cmd=parts[0]?.toLowerCase().replace(/@.*$/,"").replace(/^\//,"");
 if(!str(message.text).trim().startsWith("/")||!cmd)return;
 return commandReply(env,String(chat.id),String(from.id),cmd,parts.slice(1));
}
async function callbackMessage(callback,env) {
 const message=callback.message;
 const id=String(callback.from?.id??"");
 if(!/^cmd:[a-z]+$/.test(str(callback.data)))return;
 if(message?.chat?.type!=="private"||String(message.chat.id)!==id)return;
 await telegram(env,"answerCallbackQuery",{callback_query_id:callback.id});
 return commandReply(env,id,id,callback.data.slice(4),[]);
}

// Broker-specific OTC index levels must not be represented as verified
// exchange-market signals. Fail closed for unpriced, stale or OTC alerts.
function unsupportedOtcMarket(...values){
 return values.some(v=>typeof v==="string"&&/(?:^|[^A-Z])OTC(?:[_-]|\\b)/i.test(v));
}
function watchFrom(value){
 if(!value||typeof value!=="object"||Array.isArray(value)||value.type!=="WATCH")return null;
 const {id,symbol,strategy,timeframe,candleTime,bias,regime,createdAt}=value;
 if(![id,symbol,strategy,timeframe,bias,regime].every(x=>typeof x==="string"&&x.length>0&&x.length<=160))return null;
 if(timeframe!=="M15"||!["BULLISH","BEARISH"].includes(bias)||regime!=="TRENDING")return null;
 if(!Number.isFinite(candleTime)||!Number.isFinite(createdAt)||Math.abs(Date.now()-createdAt)>5*60*1000||Date.now()-candleTime>6*60*1000)return null;
 if(unsupportedOtcMarket(id,symbol,strategy))return null;
 const {entryZoneLow,entryZoneHigh,expiresAt,verifiedPrice,quoteTime,dataSource}=value;
 if(![entryZoneLow,entryZoneHigh,expiresAt,verifiedPrice,quoteTime].every(x=>
   typeof x==="number"&&Number.isFinite(x)))return null;
 if(!(entryZoneLow>0&&entryZoneLow<entryZoneHigh&&
  expiresAt>createdAt&&expiresAt>Date.now()&&
  verifiedPrice>0&&
  quoteTime<=Date.now()+10000&&Date.now()-quoteTime<=90000&&
  typeof dataSource==="string"&&dataSource.length>3&&dataSource.length<100))return null;
 return {type:"WATCH",id,symbol,strategy,timeframe,candleTime,bias,regime,createdAt,
   entryZoneLow,entryZoneHigh,expiresAt,verifiedPrice,quoteTime,dataSource};
}
function alertFrom(value) {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const {id,symbol,strategy,direction,timeframe,entry,stopLoss,tp1,tp2,rr,candleTime}=value;
 if(unsupportedOtcMarket(id,symbol,strategy))return null;
  if(![id,symbol,strategy,direction,timeframe].every(x=>typeof x==="string"&&x.length>0&&x.length<=160))return null;
  if(!["BUY","SELL"].includes(direction)||!["M1","M5","M15","M30","H1","H4"].includes(timeframe))return null;
  if(![entry,stopLoss,tp1,tp2,rr,candleTime].every(x=>typeof x==="number"&&Number.isFinite(x)))return null;
  if(rr<2||rr>100||Date.now()<candleTime||Date.now()-candleTime>5*60*1000)return null;
  const {verifiedAt,currentPrice,quoteTime}=value;
  if(![verifiedAt,currentPrice,quoteTime].every(x=>typeof x==="number"&&Number.isFinite(x)))return null;
  if(verifiedAt>Date.now()+10000||Date.now()-verifiedAt>30000||quoteTime>Date.now()+10000||Date.now()-quoteTime>120000)return null;
  const risk=Math.abs(entry-stopLoss);
  if(risk<=0||Math.abs(currentPrice-entry)>0.25*risk)return null;
  if(direction==="BUY"?(currentPrice>=tp1||currentPrice<=stopLoss):(currentPrice<=tp1||currentPrice>=stopLoss))return null;
  if(!(direction==="BUY"?stopLoss<entry&&tp1>entry&&tp2>=tp1:stopLoss>entry&&tp1<entry&&tp2<=tp1))return null;
  const setupScore=Number(value.setupScore);
  const score=Number.isFinite(setupScore)&&setupScore>=0&&setupScore<=100?Math.round(setupScore):null;
  const expiresAt=Number(value.expiresAt);
  return {type:"SIGNAL",id,symbol,strategy,direction,timeframe,entry,stopLoss,tp1,tp2,rr,candleTime,currentPrice,quoteTime,verifiedAt,
   score,expiresAt:Number.isFinite(expiresAt)&&expiresAt>verifiedAt?expiresAt:null};
}
function signalText(a) {
 if(a.type==="WATCH"){
  return "👀 APEX EARLY SETUP WATCH · "+a.symbol+
   "\nM15 candle: "+new Date(a.candleTime).toISOString()+
   "\nH1 trend context: "+a.bias+
   "\nRegime: "+a.regime+
   "\nVerified price: "+a.verifiedPrice+
   "\nQuote time: "+new Date(a.quoteTime).toISOString()+
   "\nPrice source: "+a.dataSource+
   (a.entryZoneLow!==undefined?
     "\n\nPULLBACK WATCH ZONE: "+a.entryZoneLow+" – "+a.entryZoneHigh+
     "\nSetup expires: "+new Date(a.expiresAt).toISOString()+
     "\nWait for a later completed M1 pullback rejection and fresh price inside this zone.":"")+
   "\n\nNO ENTRY YET. If TP or SL was reached before retest the setup is invalid; a confirmed trade alert may never occur.";
 }
  return `APEX SIGNAL TANK ${a.direction} · ${a.symbol}\nTimeframe: ${a.timeframe}\nStrategy: ${a.strategy}\nEntry: ${a.entry}\nSL: ${a.stopLoss}\nTP1: ${a.tp1}\nTP2: ${a.tp2}\nR:R: 1:${a.rr}\nCandle: ${new Date(a.candleTime).toISOString()}\nVerified market quote: ${a.currentPrice} at ${new Date(a.quoteTime).toISOString()}\n\nEntry was within 0.25R of the live quote when verified; recheck before acting. Technical signal only; not a guaranteed outcome or trade execution.`;
}
function alertCard(a){
 if(a.type==="WATCH")return {type:"WATCH",symbol:a.symbol,strategy:a.strategy,timeframe:a.timeframe,bias:a.bias,
  zoneLow:a.entryZoneLow,zoneHigh:a.entryZoneHigh,expiresAt:a.expiresAt,candleTime:a.candleTime,
  verifiedPrice:a.verifiedPrice,quoteTime:a.quoteTime,dataSource:a.dataSource};
 return {type:"SIGNAL",symbol:a.symbol,strategy:a.strategy,timeframe:a.timeframe,direction:a.direction,
  entry:a.entry,stopLoss:a.stopLoss,tp1:a.tp1,tp2:a.tp2,rr:a.rr,score:a.score,
  currentPrice:a.currentPrice,verifiedAt:a.verifiedAt};
}
async function broadcast(env, a) {
  const db=env.TRADEPULSE_DB;
  // The scanner records each confirmed index entry before publishing it.
  // Recover its factual setup score from D1 when an older scanner version omits it.
  if(a.type==="SIGNAL"&&a.score===null){
   try{
    const row=await db.prepare("SELECT quality_score FROM index_alerts WHERE id=? LIMIT 1").bind(a.id).first();
    if(Number.isFinite(Number(row?.quality_score)))a.score=Math.min(100,Math.max(0,Number(row.quality_score)));
   }catch{/* Present score as N/A rather than inventing confidence. */}
  }
  const channels=str(env.TRADEPULSE_TELEGRAM_CHANNEL_ID).trim();
  const subscribers=await db.prepare("SELECT user_id,telegram_chat_id FROM telegram_subscriptions WHERE enabled=1 LIMIT 100").all();
  const targets=[...(channels?[{user_id:"__broadcast_channel__",telegram_chat_id:channels}]:[]),...(subscribers.results??[])];
  let sent=0,failed=0,duplicate=0;
  let png=null;
  try{if(targets.length)png=await renderSignalBanner(alertCard(a));}
  catch(e){console.warn("Telegram signal card unavailable, retaining text delivery",e instanceof Error?e.message:"Unknown");}
  for(const target of targets){
    const userId=target.user_id,chatId=target.telegram_chat_id;
    const saved=await db.prepare("INSERT OR IGNORE INTO telegram_alert_delivery (user_id,signal_id,sent_at) VALUES (?,?,?)").bind(userId,a.id,new Date().toISOString()).run();
    if((saved.meta?.changes??0)===0){duplicate++;continue;}
    try {
      if(png){
       try{await telegramPhoto(env,chatId,alertCard(a),signalText(a),png);}
       catch(e){
        console.warn("Telegram image upload unavailable; sending factual text instead",e instanceof Error?e.message:"Unknown");
        await telegram(env,"sendMessage",{chat_id:chatId,text:signalText(a)+"\\n[Image banner unavailable]",disable_web_page_preview:true});
       }
      }else await telegram(env,"sendMessage",{chat_id:chatId,text:signalText(a)+"\\n[Image banner unavailable]",disable_web_page_preview:true});
      sent++;
    }catch{
      failed++;
      await db.prepare("DELETE FROM telegram_alert_delivery WHERE user_id=? AND signal_id=?").bind(userId,a.id).run();
    }
  }
  return {sent,failed,duplicate,recipients:targets.length,truncated:(subscribers.results??[]).length===100};
}

/**
 * Report only FINAL hypothetical OHLC results for alerts that were actually
 * published. No fabricated trade P/L or hindsight "reasons".
 * D1 primary key prevents repeated channel/subscriber outcome cards.
 */
export async function notifyFinalOutcomes(env){
 if(!hasDb(env)||!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))return;
 const now=Date.now();
 const results=await env.TRADEPULSE_DB.prepare(
  "SELECT o.alert_id,o.status,o.target,o.closed_at,a.symbol,a.strategy,a.direction,a.timeframe,"+
  "a.entry,a.stop_loss,a.tp1,a.tp2,a.created_at "+
  "FROM index_alert_outcomes o JOIN index_alerts a ON a.id=o.alert_id "+
  "WHERE o.status IN ('WON','LOST') AND o.closed_at IS NOT NULL "+
  "AND a.notification_status='SENT' AND a.created_at>? AND o.closed_at>? "+
  "ORDER BY o.closed_at DESC LIMIT 16"
 ).bind(now-48*3600000,now-48*3600000).all();
 const channel=str(env.TRADEPULSE_TELEGRAM_CHANNEL_ID).trim();
 const users=await env.TRADEPULSE_DB.prepare(
  "SELECT telegram_chat_id FROM telegram_subscriptions WHERE enabled=1 LIMIT 100"
 ).all();
 const targets=[...new Set([...(channel?[channel]:[]),...(users.results??[]).map(x=>String(x.telegram_chat_id))])];
 let sent=0,failed=0;
 for(const a of results.results??[]){
  const type=a.status==="WON"?"WON":"LOST";
  const target=a.status==="WON"?a.target:null;
  if(type==="WON"&&!["TP1","TP2"].includes(target))continue;
  const card={type,symbol:a.symbol,strategy:a.strategy,direction:a.direction,timeframe:a.timeframe,
   entry:Number(a.entry),stopLoss:Number(a.stop_loss),tp1:Number(a.tp1),tp2:Number(a.tp2),
   target,closedAt:Number(a.closed_at)};
  const caption="APEX SIGNAL TANK | "+(type==="WON"?"WIN":"LOSS")+
   "\n"+a.symbol+" "+a.direction+" / "+a.timeframe+
   "\nRecorded: "+(type==="WON"?target+" touched":"SL touched before TP1")+
   "\nEntry "+a.entry+" | SL "+a.stop_loss+" | TP1 "+a.tp1+" | TP2 "+a.tp2+
   "\nOutcome time is an approximate completed-candle window, not a tick fill."+
   "\nHYPOTHETICAL PRICE RESULT - NOT VERIFIED BROKER P/L. No fees/spreads included.";
  let png=null;
  try{if(targets.length)png=await renderSignalBanner(card);}
  catch(e){console.warn("Outcome PNG render unavailable, retaining text delivery",e instanceof Error?e.message:"Unknown");}
  for(const chatId of targets){
   if(!/^-?\d{3,20}$/.test(chatId))continue;
   const key=a.alert_id+":"+type+":"+(target??"SL");
   const claimed=await env.TRADEPULSE_DB.prepare(
    "INSERT OR IGNORE INTO telegram_outcome_delivery (recipient,alert_id,outcome_key,sent_at) VALUES (?,?,?,?)"
   ).bind(chatId,a.alert_id,key,new Date().toISOString()).run();
   if((claimed.meta?.changes??0)!==1)continue;
   try{
    if(png){
     try{await telegramPhoto(env,chatId,card,caption,png);}
     catch{await telegram(env,"sendMessage",{chat_id:chatId,text:caption+"\\n[Image banner unavailable]",disable_web_page_preview:true});}
    }else await telegram(env,"sendMessage",{chat_id:chatId,text:caption+"\\n[Image banner unavailable]",disable_web_page_preview:true});
    sent++;
   }
   catch(e){
    failed++;console.warn("Outcome banner failed",a.alert_id,e instanceof Error?e.message:"Unknown");
    await env.TRADEPULSE_DB.prepare(
     "DELETE FROM telegram_outcome_delivery WHERE recipient=? AND alert_id=? AND outcome_key=?"
    ).bind(chatId,a.alert_id,key).run();
   }
  }
 }
 console.log("APEX outcome banners",{checked:(results.results??[]).length,sent,failed});
}
/** D1 idempotency protects subscribers and channel from duplicate reminders across cron retries. */
async function ensureNewsTable(env) {
 await env.TRADEPULSE_DB.prepare(
  "CREATE TABLE IF NOT EXISTS news_alert_delivery (event_id TEXT NOT NULL,stage TEXT NOT NULL,recipient TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(event_id,stage,recipient))"
 ).run();
}
async function sendNewsReminder(env,event,stage,minutes) {
 const channel=str(env.TRADEPULSE_TELEGRAM_CHANNEL_ID).trim();
 const subscriberRows=await env.TRADEPULSE_DB.prepare(
  "SELECT telegram_chat_id FROM telegram_subscriptions WHERE enabled=1 LIMIT 100"
 ).all();
 const targets=[...new Set([...(channel?[channel]:[]),...(subscriberRows.results??[]).map(x=>String(x.telegram_chat_id))])];
 let sent=0,failed=0;
 for(const chatId of targets) {
  if(!/^-?\d{3,20}$/.test(chatId))continue;
  const saved=await env.TRADEPULSE_DB.prepare(
   "INSERT OR IGNORE INTO news_alert_delivery (event_id,stage,recipient,sent_at) VALUES (?,?,?,?)"
  ).bind(event.id,stage,chatId,new Date().toISOString()).run();
  if((saved.meta?.changes??0)!==1)continue;
  try {
   await telegram(env,"sendMessage",{chat_id:chatId,text:formatEventReminder(event,minutes),disable_web_page_preview:true});
   sent++;
  } catch {
   failed++;
   await env.TRADEPULSE_DB.prepare(
    "DELETE FROM news_alert_delivery WHERE event_id=? AND stage=? AND recipient=?"
   ).bind(event.id,stage,chatId).run();
  }
 }
 return {sent,failed};
}
// Daily overview means subscribers can see today's news even before T60/T15.
export async function sendDailyNewsOverview(env,calendar,now){
 const eatDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
 const eatClock=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(now));
 // Worker runs every five minutes; a 20-minute window tolerates scheduling delays.
 const [hour,minute]=eatClock.split(":").map(Number);
 if(hour!==7||minute>=20)return {sent:0,failed:0,matched:0};
 const today=calendar.events.filter(event=>
  new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(event.scheduledAt))===eatDay
  && Date.parse(event.scheduledAt)>now && event.actual==null);
 if(!today.length)return {sent:0,failed:0,matched:0};
 const dates=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",hour:"2-digit",minute:"2-digit",hour12:false});
 const digest="📰 APEX DAILY FOREX NEWS · "+eatDay+" (Uganda EAT)"+
  "\nHigh-impact releases scheduled for today ("+today.length+"):\n"+
  today.slice(0,18).map(e=>"• "+dates.format(new Date(e.scheduledAt))+" · "+e.currency+" · "+e.event).join("\n")+
  (today.length>18?"\n+ "+(today.length-18)+" further events in calendar":"")+
  "\n\nT60 and T15 reminders follow when the verified event approaches."+
  "\nDirections remain UNKNOWN before released data. Times may be revised."+
  "\nLive calendar sources: "+(calendar.sources??[calendar.source]).join(", ")+
  "\nFOREX.com weekly calendar cross-check: https://www.forex.com/en-uk/trading-platforms/economic-calendar/";
 const channel=str(env.TRADEPULSE_TELEGRAM_CHANNEL_ID).trim();
 const subs=await env.TRADEPULSE_DB.prepare("SELECT telegram_chat_id FROM telegram_subscriptions WHERE enabled=1 LIMIT 100").all();
 const targets=[...new Set([...(channel?[channel]:[]),...(subs.results??[]).map(r=>String(r.telegram_chat_id))])];
 let sent=0,failed=0;
 for(const chatId of targets){
  if(!/^-?\d{3,20}$/.test(chatId))continue;
  const saved=await env.TRADEPULSE_DB.prepare(
   "INSERT OR IGNORE INTO news_alert_delivery(event_id,stage,recipient,sent_at) VALUES(?,?,?,?)"
  ).bind("daily:"+eatDay,"DAILY",chatId,new Date(now).toISOString()).run();
  if((saved.meta?.changes??0)!==1)continue;
  try{await telegram(env,"sendMessage",{chat_id:chatId,text:digest,disable_web_page_preview:true});sent++;}
  catch(e){failed++;console.warn("Daily news Telegram failed",e instanceof Error?e.message:"unknown");
   await env.TRADEPULSE_DB.prepare("DELETE FROM news_alert_delivery WHERE event_id=? AND stage=? AND recipient=?")
    .bind("daily:"+eatDay,"DAILY",chatId).run();}
 }
 return {sent,failed,matched:today.length};
}
async function scanUpcomingNews(env) {
 if(!hasDb(env)||!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))
  throw Error("News reminders require Telegram bot and D1");
 const now=Date.now(),calendar=await fetchEconomicCalendar(now);
 if(calendar.stale) {
  console.warn("Pre-news calendar stale; no alerts sent",calendar.updatedAt);
  return;
 }
 await ensureNewsTable(env);
 const overview=await sendDailyNewsOverview(env,calendar,now);
 let matched=0,sent=0,failed=0;
 for(const event of calendar.events) {
  if(event.actual!==null)continue;
  const minutes=(Date.parse(event.scheduledAt)-now)/60000;
  const stage=minutes>50&&minutes<=65?"T60":minutes>5&&minutes<=20?"T15":null;
  if(!stage)continue;
  matched++;
  const result=await sendNewsReminder(env,event,stage,stage==="T60"?60:15);
  sent+=result.sent;failed+=result.failed;
 }
 const todayStart=Date.parse(new Date(now+3*3600000).toISOString().slice(0,10)+"T00:00:00+03:00");
 const todayEnd=todayStart+86400000;
 const todayHigh=calendar.events.filter(e=>Date.parse(e.scheduledAt)>=todayStart&&Date.parse(e.scheduledAt)<todayEnd).length;
 const nextTwoHours=calendar.events.filter(e=>Date.parse(e.scheduledAt)>now&&Date.parse(e.scheduledAt)<=now+2*3600000).length;
 console.log("Pre-news scheduled scan",{source:calendar.source,sources:calendar.sources??[calendar.source],
  checked:calendar.events.length,todayHigh,nextTwoHours,matched,sent,failed,
  overview:overview.matched,overviewSent:overview.sent,overviewFailed:overview.failed});
}

export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/news/calendar") {
   if(request.method!=="GET")return respond({error:"Method not allowed"},405);
   const headers={...HEADER,"Access-Control-Allow-Origin":"*","Vary":"Origin","Cache-Control":"public, max-age=300, s-maxage=300"};
   try {
    const cache=typeof caches!=="undefined"?caches.default:null;
    const key=new Request(url.origin+"/news/calendar");
    if(cache) {
     const hit=await cache.match(key);
     if(hit)return hit;
    }
    const calendar=await fetchEconomicCalendar();
    const result=new Response(JSON.stringify(calendar),{status:200,headers});
    if(cache)await cache.put(key,result.clone());
    return result;
   }catch{return new Response(JSON.stringify({error:"Calendar source unavailable",events:[],stale:true}),
     {status:503,headers:{...HEADER,"Access-Control-Allow-Origin":"*"}});}
  }

  if(url.pathname==="/news/status"&&request.method==="GET"){
    const publicStatus=(value,status=200)=>{const response=respond(value,status);response.headers.set("Access-Control-Allow-Origin","*");return response;};
    if(!hasDb(env))return publicStatus({ready:false,error:"News notification storage unavailable"},503);
    try{
      const [subs,delivery]=await Promise.all([
       env.TRADEPULSE_DB.prepare("SELECT COUNT(*) AS total FROM telegram_subscriptions WHERE enabled=1").first(),
       env.TRADEPULSE_DB.prepare("SELECT COUNT(*) AS total, MAX(sent_at) AS latest FROM news_alert_delivery").first()
      ]);
      return publicStatus({ready:botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN),
       cron:"*/5 * * * *",timezone:"Africa/Kampala",
       activeSubscribers:subs?.total??0,recordedReminders:delivery?.total??0,
       lastDeliveryAt:delivery?.latest??null,
       alertStages:["07:00 EAT daily high-impact overview","60 minutes","15 minutes"],
       liveSource:"ShowMyTrades, Forex Factory or XOOMAR when available",
       forexComReference:"https://www.forex.com/en-uk/trading-platforms/economic-calendar/",
       note:"FOREX.com is a human-readable weekly cross-check, not an authenticated machine-readable calendar feed."});
    }catch{return publicStatus({ready:false,error:"News status unavailable"},503);}
  }
  if(url.pathname==="/health"&&request.method==="GET")
    return respond({service:"tradepulse-telegram",ready:!!(hasDb(env)&&botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)&&env.TELEGRAM_WEBHOOK_SECRET),mode:"standalone",signalSourceConnected:!!(hasDb(env)&&env.TRADEPULSE_PUBLISH_SECRET)});
  if(url.pathname==="/telegram/webhook"){
    if(request.method!=="POST")return respond({error:"Method not allowed"},405);
    if(!await verifySecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"),env.TELEGRAM_WEBHOOK_SECRET))
      return respond({error:"Unauthorized"},401);
    if(!hasDb(env))return respond({error:"D1 binding missing"},503);
    try {
      const update=await requestBody(request);
      if(update.message)await privateMessage(update.message,env);
      if(update.callback_query)await callbackMessage(update.callback_query,env);
      return respond({ok:true});
    }catch(e){return respond({error:"Telegram webhook handling failed"},503);}
  }
  if(url.pathname==="/admin/setup"||url.pathname==="/admin/webhook-status"){
    if(request.method!=="POST")return respond({error:"Method not allowed"},405);
    const authorization=request.headers.get("Authorization")??"";
    if(!await verifySecret(authorization.startsWith("Bearer ")?authorization.slice(7):"",env.TRADEPULSE_PUBLISH_SECRET))
      return respond({error:"Unauthorized"},401);
    if(!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)||!env.TELEGRAM_WEBHOOK_SECRET||!hasDb(env))
      return respond({error:"Bot, D1 or webhook secret missing"},503);
    try {
      if(url.pathname==="/admin/webhook-status"){
        const info=await telegram(env,"getWebhookInfo",{});
        return respond({
          url:info.url??null,pending_update_count:info.pending_update_count??0,
          last_error_message:info.last_error_message??null,last_error_date:info.last_error_date??null,
          expected_url:new URL("/telegram/webhook",url.origin).toString(),
          // The expected secret is deliberately not returned.
          webhook_matches:info.url===new URL("/telegram/webhook",url.origin).toString(),
        });
      }
      const destination=new URL("/telegram/webhook",url.origin);
      if(destination.protocol!=="https:"||!destination.hostname.endsWith(".workers.dev"))
        return respond({error:"Only HTTPS workers.dev webhook registration is supported"},400);
      await telegram(env,"setWebhook",{
        url:destination.toString(),
        secret_token:env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates:["message","callback_query"],
        drop_pending_updates:false,
      });
      await telegram(env,"setMyCommands",{
        commands:COMMANDS.filter(([c])=>c!=="stop").map(([command,description])=>({command,description:description.slice(0,100)})),
        scope:{type:"default"},
      });
      const info=await telegram(env,"getWebhookInfo",{});
      return respond({configured:true,webhook_matches:info.url===destination.toString(),pending_update_count:info.pending_update_count??0});
    }catch{return respond({error:"Telegram webhook or command registration failed"},503);}
  }
  if(url.pathname==="/publish"||url.pathname==="/admin/test"){
    if(request.method!=="POST")return respond({error:"Method not allowed"},405);
    const auth=request.headers.get("Authorization")??"";
    if(!await verifySecret(auth.startsWith("Bearer ")?auth.slice(7):"",env.TRADEPULSE_PUBLISH_SECRET))
      return respond({error:"Unauthorized"},401);
    if(!hasDb(env)||!botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))
      return respond({error:"Bot or D1 not configured"},503);
    try {
      if(url.pathname==="/admin/test"){
        if(!env.TRADEPULSE_TELEGRAM_CHANNEL_ID)return respond({error:"Configure channel ID first"},400);
        await telegram(env,"sendMessage",{chat_id:env.TRADEPULSE_TELEGRAM_CHANNEL_ID,text:"✅ Independent TradePulse Telegram service is connected. This is a test message, not a trading signal."});
        return respond({sent:true});
      }
      const raw=await requestBody(request),a=watchFrom(raw)??alertFrom(raw);
      if(!a)return respond({error:"Invalid watch or signal; confirmed entries require fresh timestamps and minimum 1:2 R:R"},400);
      return respond(await broadcast(env,a));
    }catch{return respond({error:"Delivery failed"},503);}
  }
  return respond({service:"TradePulse Telegram Service",message:"Use Telegram /start to subscribe, or GET /health."},200);
 },
 async scheduled(_controller,env,ctx) {
  ctx.waitUntil(scanUpcomingNews(env).catch(err=>console.error("Pre-news scan error:",err.message)));
  ctx.waitUntil(notifyFinalOutcomes(env).catch(err=>console.error("Outcome banner scan failed:",err.message)));
 },

};
