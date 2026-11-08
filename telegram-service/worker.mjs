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
async function privateMessage(message, env) {
  const chat=message.chat??{}, from=message.from??{};
  if(chat.type!=="private" || !/^\d{2,20}$/.test(String(chat.id??""))
      || String(chat.id)!==String(from.id??""))return;
  const chatId=String(chat.id), telegramId=String(from.id);
  const input=str(message.text).split(/\s+/)[0].toLowerCase().replace(/@.*$/,"");
  if(!["/start","/stop","/status","/help"].includes(input))return;
  if(input==="/help"){
    await telegram(env,"sendMessage",{chat_id:chatId,text:"TradePulse alerts bot\n/start — subscribe\n/stop — unsubscribe\n/status — check subscription\nAlerts are informational, not trade orders."});
    return;
  }
  const db=env.TRADEPULSE_DB;
  if(input==="/start"){
    // Existing website-based subscriber rows may already contain the same Telegram ID.
    // Preserve their user_id and activate rather than claiming another identity.
    await db.prepare("INSERT INTO telegram_subscriptions (user_id, telegram_chat_id, telegram_user_id, enabled, linked_at) VALUES (?,?,?,1,?) ON CONFLICT(telegram_user_id) DO UPDATE SET enabled=1, telegram_chat_id=excluded.telegram_chat_id, linked_at=excluded.linked_at")
      .bind("tg:"+telegramId,chatId,telegramId,new Date().toISOString()).run();
    await telegram(env,"sendMessage",{chat_id:chatId,text:"✅ Subscribed to TradePulse Telegram alerts. No API token or website login required. Send /stop anytime. Alerts will start when the external signal publisher is activated."});
  }else if(input==="/stop"){
    await db.prepare("UPDATE telegram_subscriptions SET enabled=0 WHERE telegram_user_id=?").bind(telegramId).run();
    await telegram(env,"sendMessage",{chat_id:chatId,text:"TradePulse alerts stopped. Send /start to subscribe again."});
  }else{
    const r=await db.prepare("SELECT enabled FROM telegram_subscriptions WHERE telegram_user_id=?").bind(telegramId).first();
    await telegram(env,"sendMessage",{chat_id:chatId,text:r?.enabled===1?"✅ Your TradePulse alerts subscription is active.":"You are not subscribed. Send /start to join."});
  }
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
      return respond({ok:true});
    }catch(e){return respond({error:"Telegram webhook handling failed"},503);}
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
