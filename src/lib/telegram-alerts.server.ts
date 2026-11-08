/** Shared Telegram alerts backed by Cloudflare D1; authentication remains on existing Supabase.
 * Only private TradePulse accounts can link and send. No client-supplied bot tokens.
 */
import { createClient } from "@supabase/supabase-js";

type D1Statement={
 bind:(...params:(string|number|null)[])=>D1Statement;
 first:<T=Record<string,unknown>>()=>Promise<T|null>;
 run:()=>Promise<{success:boolean;meta?:{changes?:number}}>;
};
type D1Db={prepare:(query:string)=>D1Statement};
type Env={
 TRADEPULSE_DB?:D1Db;
 SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;SUPABASE_PUBLISHABLE_KEY?:string;
 TRADEPULSE_TELEGRAM_BOT_TOKEN?:string;TELEGRAM_WEBHOOK_SECRET?:string;
};
type Sub={user_id:string;telegram_chat_id:string;telegram_user_id:string;enabled:number};
type LinkRow={user_id:string;expires_at:string};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail=(message:string,status=400)=>json({error:message},status);
const tokenValid=(s:unknown):s is string=>typeof s==="string"&&/^\d{5,15}:[A-Za-z0-9_-]{25,}$/.test(s);
const bot=(env:Env)=>{if(!tokenValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))throw Error("Shared bot token missing from Cloudflare secrets");return env.TRADEPULSE_TELEGRAM_BOT_TOKEN;};
const db=(env:Env)=>{if(!env.TRADEPULSE_DB)throw Error("Bind D1 database as TRADEPULSE_DB in Cloudflare Worker settings");return env.TRADEPULSE_DB;};
async function telegram(token:string,method:string,body:Record<string,unknown>){
 const res=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const result=await res.json().catch(()=>({})) as {ok?:boolean;result?:{username?:string}};
 if(!res.ok||!result.ok)throw Error("Telegram request failed; confirm bot token, permissions and delivery");
 return result.result;
}
async function bodyObject(request:Request){
 const value=await request.text();if(value.length>6000)throw Error("Request too large");
 const result:unknown=JSON.parse(value);
 if(!result||typeof result!=="object"||Array.isArray(result))throw Error("Invalid JSON");
 return result as Record<string,unknown>;
}
const linkCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,"0")).join("");
const hashCode=async(code:string)=>{
 const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code));
 return Array.from(new Uint8Array(h),x=>x.toString(16).padStart(2,"0")).join("");
};
async function authenticatedUser(request:Request,env:Env):Promise<string|null>{
 const bearer=request.headers.get("Authorization");
 if(!bearer?.startsWith("Bearer ")||bearer.length>3000)return null;
 // Cloudflare separates build-time VITE_ config from Worker runtime bindings.
 // Reuse the same PUBLIC authentication URL/key already built into TradePulse;
 // never fall back to, embed, or expose a service-role secret.
 const runtime=typeof process!=="undefined"?process.env:{};
 const url=env.SUPABASE_URL||runtime["SUPABASE_URL"]||import.meta.env["VITE_SUPABASE_URL"];
 const key=env.SUPABASE_PUBLISHABLE_KEY||runtime["SUPABASE_PUBLISHABLE_KEY"]||import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
 if(!url||!key)throw Error("TradePulse auth configuration unavailable in this Worker build; redeploy with production VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY");
 const client=createClient(url,key,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(input,init)=>{
   const headers=new Headers(init?.headers);
   // Lovable Cloud's new sb_publishable_ keys are API keys, not bearer JWTs.
   if(key.startsWith("sb_publishable_")&&headers.get("Authorization")===`Bearer ${key}`)headers.delete("Authorization");
   headers.set("apikey",key);
   return fetch(input,{...init,headers});
  }},
 });
 const {data:{user},error}=await client.auth.getUser(bearer.slice(7));
 if(error)throw Error("TradePulse login verification failed; sign out and back in, then retry");
 return user?.id??null;
}
type ValidAlert={id:string;symbol:string;strategy:string;category:string;direction:"BUY"|"SELL";timeframe:string;entry:number;stop:number;tp1:number;tp2:number;rr:number;candleTime:number};
function parseAlert(a:unknown):ValidAlert|null{
 if(!a||typeof a!=="object"||Array.isArray(a))return null;
 const v=a as Record<string,unknown>;
 const direction=v["direction"],symbol=v["symbol"],strategy=v["strategy"],id=v["id"],
 category=v["category"],tf=v["timeframe"];
 const entry=Number(v["entry"]),stop=Number(v["stopLoss"]),tp1=Number(v["tp1"]),tp2=Number(v["tp2"]),rr=Number(v["rr"]),candleTime=Number(v["candleTime"]);
 if((direction!=="BUY"&&direction!=="SELL")||typeof symbol!=="string"||symbol.length>100||
 typeof strategy!=="string"||strategy.length>150||typeof id!=="string"||id.length>250||
 typeof category!=="string"||!["FOREX","CRYPTO","INDEX","VOLATILITY","METAL","SYNTHETIC"].includes(category)||
 typeof tf!=="string"||!["M1","M5","M15","M30","H1","H4"].includes(tf)||
 ![entry,stop,tp1,tp2,rr,candleTime].every(Number.isFinite)||rr<2||rr>100||
 Math.abs(Date.now()-candleTime)>2*60*60*1000||
 !(direction==="BUY"?stop<entry&&tp1>entry&&tp2>=tp1:stop>entry&&tp1<entry&&tp2<=tp1))return null;
 return {id,symbol,strategy,category,direction,timeframe:tf,entry,stop,tp1,tp2,rr,candleTime};
}

export async function handleTelegramApi(request:Request,rawEnv:unknown):Promise<Response>{
 const env=(rawEnv&&typeof rawEnv==="object"?rawEnv:{}) as Env;
 try{
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith("/api/signal-alerts/telegram"))return fail("Not found",404);
  if(path==="/api/signal-alerts/telegram/webhook"){
   if(request.method!=="POST")return fail("Unsupported method",405);
   if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.TELEGRAM_WEBHOOK_SECRET)return fail("Unauthorized webhook",401);
   const payload=await bodyObject(request);
   const msg=(payload["message"]??{}) as Record<string,unknown>;
   const chat=(msg["chat"]??{}) as Record<string,unknown>;
   const from=(msg["from"]??{}) as Record<string,unknown>;
   const text=msg["text"];
   if(chat["type"]!=="private"||typeof text!=="string"||!/^\/start\s+[0-9a-f]{48}$/.test(text))return json({ok:true});
   const hash=await hashCode(text.split(/\s+/)[1]!);
   const link=await db(env).prepare("SELECT user_id,expires_at FROM telegram_link_codes WHERE code_hash=?").bind(hash).first<LinkRow>();
   if(!link||Date.parse(link.expires_at)<=Date.now())return json({ok:true});
   const user=String(from["id"]??""),chatId=String(chat["id"]??"");
   if(!/^\d{2,20}$/.test(user)||!/^\d{2,20}$/.test(chatId)||user!==chatId)return json({ok:true});
   const existing=await db(env).prepare("SELECT user_id FROM telegram_subscriptions WHERE telegram_user_id=?").bind(user).first<{user_id:string}>();
   if(existing&&existing.user_id!==link.user_id)return json({ok:true});
   try{
    await db(env).prepare("INSERT INTO telegram_subscriptions (user_id,telegram_chat_id,telegram_user_id,enabled,linked_at) VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,telegram_user_id=excluded.telegram_user_id,enabled=1,linked_at=excluded.linked_at")
       .bind(link.user_id,chatId,user,new Date().toISOString()).run();
   }catch{return json({ok:true});}
   await db(env).prepare("DELETE FROM telegram_link_codes WHERE user_id=?").bind(link.user_id).run();
   await telegram(bot(env),"sendMessage",{chat_id:chatId,text:"✅ TradePulse connected. Signal alerts will arrive here when your dashboard monitor detects a strong setup."}).catch(()=>{});
   return json({ok:true});
  }
  const origin=request.headers.get("Origin");
  if(origin&&origin!==url.origin)return fail("Cross-origin request rejected",403);
  const uid=await authenticatedUser(request,env);
  if(!uid)return fail("Sign in again",401);
  const d=db(env);
  const sub=await d.prepare("SELECT user_id,telegram_chat_id,telegram_user_id,enabled FROM telegram_subscriptions WHERE user_id=?").bind(uid).first<Sub>();
  if(path==="/api/signal-alerts/telegram"&&request.method==="GET")
   return json({configured:!!sub,enabled:sub?.enabled===1,botAvailable:tokenValid(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)});
  if(path==="/api/signal-alerts/telegram"&&request.method==="DELETE"){
   await d.prepare("DELETE FROM telegram_subscriptions WHERE user_id=?").bind(uid).run();
   await d.prepare("DELETE FROM telegram_link_codes WHERE user_id=?").bind(uid).run();
   return json({configured:false,enabled:false});
  }
  if(path==="/api/signal-alerts/telegram/connect"&&request.method==="POST"){
   const result=await telegram(bot(env),"getMe",{}),username=result?.username;
   if(!username||!/^[A-Za-z0-9_]{5,32}$/.test(username))throw Error("Bot username unavailable");
   const code=linkCode(),hash=await hashCode(code),expiresAt=new Date(Date.now()+10*60*1000).toISOString();
   await d.prepare("INSERT INTO telegram_link_codes (user_id,code_hash,expires_at,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=excluded.created_at")
      .bind(uid,hash,expiresAt,new Date().toISOString()).run();
   return json({url:`https://t.me/${username}?start=${code}`,expiresAt});
  }
  if(path==="/api/signal-alerts/telegram/test"&&request.method==="POST"){
   if(!sub||sub.enabled!==1)return fail("Connect Telegram first",400);
   await telegram(bot(env),"sendMessage",{chat_id:sub.telegram_chat_id,text:"✅ TradePulse test notification. Your Telegram account is connected."});
   return json({sent:true});
  }
  if(path==="/api/signal-alerts/telegram/send"&&request.method==="POST"){
   if(!sub||sub.enabled!==1)return fail("Connect Telegram first",400);
   const body=await bodyObject(request),a=parseAlert(body["alert"]);
   if(!a)return fail("Invalid or expired signal",400);
   const recent=await d.prepare("SELECT COUNT(*) AS count FROM telegram_alert_delivery WHERE user_id=? AND sent_at>=?").bind(uid,new Date(Date.now()-60000).toISOString()).first<{count:number}>();
   if((recent?.count??0)>=3)return fail("Telegram alerts rate limited",429);
   const reserved=await d.prepare("INSERT OR IGNORE INTO telegram_alert_delivery (user_id,signal_id,sent_at) VALUES (?,?,?)")
      .bind(uid,a.id,new Date().toISOString()).run();
   if((reserved.meta?.changes??0)===0)return json({sent:false,duplicate:true});
   const message=`TradePulse ${a.direction} · ${a.symbol}\nStrategy: ${a.strategy}\n${a.category} · ${a.timeframe}\nEntry: ${a.entry}\nSL: ${a.stop}\nTP1: ${a.tp1}\nTP2: ${a.tp2}\nRisk/reward: 1:${a.rr}\nCandle: ${new Date(a.candleTime).toISOString()}\n\nBrowser-generated technical signal. No trade is executed or guaranteed.`;
   try{await telegram(bot(env),"sendMessage",{chat_id:sub.telegram_chat_id,text:message});}
   catch(e){await d.prepare("DELETE FROM telegram_alert_delivery WHERE user_id=? AND signal_id=?").bind(uid,a.id).run();throw e;}
   return json({sent:true});
  }
  return fail("Unsupported method",405);
 }catch(e){
  // Do not log request bodies or any secret values.
  return fail(e instanceof Error?e.message:"Telegram service unavailable",503);
 }
}
