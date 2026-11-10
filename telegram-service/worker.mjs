/** Independent TradePulse Telegram notification Worker.
 * No Supabase, no TradePulse browser dependencies, no MT5/trade execution.
 * One shared bot; private /start & /stop subscriptions; optional channel broadcasting.
 * /publish accepts ONLY authenticated server-side sources. This Worker does not
 * generate signals; attach a verified scanner/publisher before expecting automatic alerts.
 */
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
 if(cmd==="signal"||cmd==="history"||cmd==="analyze"||cmd==="report"||cmd==="performance") {
  let rows;
  try {rows=await recentAlerts(env,cmd==="history"||cmd==="report"?5:1);}
  catch {return sendText(env,chatId,"Index alerts database is unavailable. No signal can be confirmed.");}
  if(!rows.length)return sendText(env,chatId,"No confirmed index signals have been recorded yet. Nothing to trade. /price EURUSD can check a fresh market quote.");
  if(cmd==="performance")return sendText(env,chatId,"Recorded index signals: historical entries are available, but verified trading outcomes, win rate and profitability statistics are NOT tracked by this bot. /history shows recent signals.");
  if(cmd==="report")return sendText(env,chatId,"APEX Index Signal Activity (last "+rows.length+" records)\n\n"+rows.map(a=>a.symbol+" "+a.direction+" "+a.timeframe+" · "+new Date(a.candle_time).toISOString()).join("\n")+"\n\nThese are alerts, not executed trades.");
  if(cmd==="analyze")return sendText(env,chatId,"Latest validated index setup:\n"+alertDescription(rows[0])+"\n\nBased on recorded confirmed-candle strategy output, not a new on-demand analysis or prediction.");
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
 if(cmd==="news")return sendText(env,chatId,
  "Live economic news feed is not connected. No current economic-calendar events can be verified inside this bot. Do not interpret this as no upcoming news.");
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

function alertFrom(value) {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const {id,symbol,strategy,direction,timeframe,entry,stopLoss,tp1,tp2,rr,candleTime}=value;
  if(![id,symbol,strategy,direction,timeframe].every(x=>typeof x==="string"&&x.length>0&&x.length<=160))return null;
  if(!["BUY","SELL"].includes(direction)||!["M1","M5","M15","M30","H1","H4"].includes(timeframe))return null;
  if(![entry,stopLoss,tp1,tp2,rr,candleTime].every(x=>typeof x==="number"&&Number.isFinite(x)))return null;
  if(rr<2||rr>100||Math.abs(Date.now()-candleTime)>2*60*60*1000)return null;
  if(!(direction==="BUY"?stopLoss<entry&&tp1>entry&&tp2>=tp1:stopLoss>entry&&tp1<entry&&tp2<=tp1))return null;
  return {id,symbol,strategy,direction,timeframe,entry,stopLoss,tp1,tp2,rr,candleTime};
}
function signalText(a) {
  return `TradePulse ${a.direction} · ${a.symbol}\nTimeframe: ${a.timeframe}\nStrategy: ${a.strategy}\nEntry: ${a.entry}\nSL: ${a.stopLoss}\nTP1: ${a.tp1}\nTP2: ${a.tp2}\nR:R: 1:${a.rr}\nCandle: ${new Date(a.candleTime).toISOString()}\n\nTechnical signal only; not a guaranteed outcome or trade execution.`;
}
async function broadcast(env, a) {
  const db=env.TRADEPULSE_DB;
  const channels=str(env.TRADEPULSE_TELEGRAM_CHANNEL_ID).trim();
  const subscribers=await db.prepare("SELECT user_id,telegram_chat_id FROM telegram_subscriptions WHERE enabled=1 LIMIT 100").all();
  const targets=[...(channels?[{user_id:"__broadcast_channel__",telegram_chat_id:channels}]:[]),...(subscribers.results??[])];
  let sent=0,failed=0,duplicate=0;
  for(const target of targets){
    const userId=target.user_id,chatId=target.telegram_chat_id;
    const saved=await db.prepare("INSERT OR IGNORE INTO telegram_alert_delivery (user_id,signal_id,sent_at) VALUES (?,?,?)").bind(userId,a.id,new Date().toISOString()).run();
    if((saved.meta?.changes??0)===0){duplicate++;continue;}
    try {
      await telegram(env,"sendMessage",{chat_id:chatId,text:signalText(a),disable_web_page_preview:true});
      sent++;
    }catch{
      failed++;
      await db.prepare("DELETE FROM telegram_alert_delivery WHERE user_id=? AND signal_id=?").bind(userId,a.id).run();
    }
  }
  return {sent,failed,duplicate,recipients:targets.length,truncated:(subscribers.results??[]).length===100};
}
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/health"&&request.method==="GET")
    return respond({service:"tradepulse-telegram",ready:!!(hasDb(env)&&botValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)&&env.TELEGRAM_WEBHOOK_SECRET),mode:"standalone",signalSourceConnected:false});
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
      const raw=await requestBody(request),a=alertFrom(raw);
      if(!a)return respond({error:"Invalid signal; include confirmed timestamp and minimum 1:2 R:R"},400);
      return respond(await broadcast(env,a));
    }catch{return respond({error:"Delivery failed"},503);}
  }
  return respond({service:"TradePulse Telegram Service",message:"Use Telegram /start to subscribe, or GET /health."},200);
 }
};
