/** Shared TradePulse bot. Single token in Cloudflare secrets, per-user Telegram subscriptions.
 * No user-supplied bot tokens or self-asserted chat IDs are accepted.
 */
import { createClient } from "@supabase/supabase-js";

type Env={
 SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;
 TRADEPULSE_TELEGRAM_BOT_TOKEN?:string;TELEGRAM_WEBHOOK_SECRET?:string;
};
type Subscription={user_id:string;telegram_chat_id:string;telegram_user_id:string;enabled:boolean};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const safeError=(message:string,status=400)=>json({error:message},status);
const validToken=(v:unknown):v is string=>typeof v==="string"&&/^\d{5,15}:[A-Za-z0-9_-]{25,}$/.test(v);
const adminClient=(env:Env)=>{
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error("Supabase server secrets are not configured");
 return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
};
const tokenFor=(env:Env)=>{
 if(!validToken(env.TRADEPULSE_TELEGRAM_BOT_TOKEN))throw Error("Shared Telegram bot secret is not configured");
 return env.TRADEPULSE_TELEGRAM_BOT_TOKEN;
};
async function telegram(token:string,method:string,body:Record<string,unknown>){
 const res=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
 });
 const result=await res.json().catch(()=>({})) as {ok?:boolean;description?:string;result?:{username?:string}};
 if(!res.ok||!result.ok)throw Error("Telegram API request failed. Verify bot permissions and connection.");
 return result.result;
}
async function readBody(request:Request){
 const s=await request.text();if(s.length>6000)throw Error("Request too large");
 const parsed:unknown=JSON.parse(s);
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("Invalid body");
 return parsed as Record<string,unknown>;
}
const codeHash=async(code:string)=>{
 const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code));
 return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("");
};
const newCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,"0")).join("");
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
export async function handleTelegramApi(request:Request,unknownEnv:unknown):Promise<Response>{
 const env=(unknownEnv&&typeof unknownEnv==="object"?unknownEnv:{}) as Env;
 try{
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith("/api/signal-alerts/telegram"))return safeError("Not found",404);
  // Telegram's webhook is the only public endpoint; authenticity is its secret header.
  if(path==="/api/signal-alerts/telegram/webhook"){
   if(request.method!=="POST")return safeError("Method not allowed",405);
   if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.TELEGRAM_WEBHOOK_SECRET)
    return safeError("Unauthorized Telegram webhook",401);
   const b=await readBody(request);
   const msg=(b["message"]??{}) as Record<string,unknown>;
   const chat=(msg["chat"]??{}) as Record<string,unknown>;
   const from=(msg["from"]??{}) as Record<string,unknown>;
   const message=msg["text"];
   if(chat["type"]!=="private"||typeof message!=="string"||!/^\/start\s+[0-9a-f]{48}$/.test(message))return json({ok:true});
   const code=message.split(/\s+/)[1]!;
   const admin=adminClient(env);
   const hash=await codeHash(code);
   const {data:link,error:linkError}=await admin.from("telegram_link_codes").select("*").eq("code_hash",hash).maybeSingle();
   if(linkError||!link||Date.parse(String(link.expires_at))<Date.now())return json({ok:true});
   const chatId=String(chat["id"]??""),userId=String(from["id"]??"");
   if(!/^\d{2,20}$/.test(chatId)||!/^\d{2,20}$/.test(userId))return json({ok:true});
   // A linked Telegram identity must not be claimable by other TradePulse accounts.
   const {data:linked}=await admin.from("telegram_subscriptions").select("user_id").eq("telegram_user_id",userId).maybeSingle();
   if(linked&&linked.user_id!==link.user_id)return json({ok:true});
   const {error}=await admin.from("telegram_subscriptions").upsert({
    user_id:link.user_id,telegram_chat_id:chatId,telegram_user_id:userId,enabled:true,linked_at:new Date().toISOString(),
   },{onConflict:"user_id"});
   if(error)return json({ok:true});
   await admin.from("telegram_link_codes").delete().eq("user_id",link.user_id);
   // Best effort welcome; a delivery failure must not leak server details to Telegram.
   await telegram(tokenFor(env),"sendMessage",{chat_id:chatId,text:"✅ TradePulse linked! You will receive alerts when your TradePulse monitor detects a new strong signal. No trading orders are placed."}).catch(()=>{});
   return json({ok:true});
  }
  const origin=request.headers.get("Origin");
  if(origin&&origin!==url.origin)return safeError("Cross-origin request rejected",403);
  const bearer=request.headers.get("Authorization");
  if(!bearer?.startsWith("Bearer ")||bearer.length>3000)return safeError("Sign in to TradePulse",401);
  const admin=adminClient(env);
  const {data:{user},error}=await admin.auth.getUser(bearer.slice(7));
  if(error||!user)return safeError("Session expired. Sign in again.",401);
  const uid=user.id;
  const {data:row,error:readError}=await admin.from("telegram_subscriptions").select("*").eq("user_id",uid).maybeSingle();
  if(readError)throw Error("Apply the shared Telegram subscriptions database migration");
  const sub=row as Subscription|null;
  if(path==="/api/signal-alerts/telegram"&&request.method==="GET")
   return json({configured:!!sub,enabled:sub?.enabled??false,botAvailable:validToken(env.TRADEPULSE_TELEGRAM_BOT_TOKEN)});
  if(path==="/api/signal-alerts/telegram"&&request.method==="DELETE"){
   const {error:removeError}=await admin.from("telegram_subscriptions").delete().eq("user_id",uid);
   await admin.from("telegram_link_codes").delete().eq("user_id",uid);
   if(removeError)throw Error("Could not disconnect Telegram");
   return json({configured:false,enabled:false});
  }
  if(path==="/api/signal-alerts/telegram/connect"&&request.method==="POST"){
   const token=tokenFor(env);
   const info=await telegram(token,"getMe",{});
   const username=info?.username;
   if(!username||!/^[A-Za-z0-9_]{5,32}$/.test(username))throw Error("Telegram bot username is unavailable");
   const code=newCode(),hash=await codeHash(code),expires=new Date(Date.now()+10*60*1000).toISOString();
   const {error:saveError}=await admin.from("telegram_link_codes").upsert({user_id:uid,code_hash:hash,expires_at:expires,created_at:new Date().toISOString()},{onConflict:"user_id"});
   if(saveError)throw Error("Could not create private Telegram connection link");
   return json({url:`https://t.me/${username}?start=${code}`,expiresAt:expires});
  }
  if(path==="/api/signal-alerts/telegram/test"&&request.method==="POST"){
   if(!sub?.enabled)return safeError("Link Telegram first",400);
   await telegram(tokenFor(env),"sendMessage",{chat_id:sub.telegram_chat_id,text:"✅ TradePulse test notification. Your account is connected to the shared bot."});
   return json({sent:true});
  }
  if(path==="/api/signal-alerts/telegram/send"&&request.method==="POST"){
   if(!sub?.enabled)return safeError("Telegram is not linked",400);
   const b=await readBody(request),a=parseAlert(b["alert"]);
   if(!a)return safeError("Invalid or expired signal",400);
   const {data:prior}=await admin.from("telegram_alert_delivery").select("signal_id").eq("user_id",uid).eq("signal_id",a.id).maybeSingle();
   if(prior)return json({sent:false,duplicate:true});
   const {count}=await admin.from("telegram_alert_delivery").select("signal_id",{count:"exact",head:true}).eq("user_id",uid).gte("sent_at",new Date(Date.now()-60000).toISOString());
   if((count??0)>=3)return safeError("Telegram delivery rate limited",429);
   const {error:reserved}=await admin.from("telegram_alert_delivery").insert({user_id:uid,signal_id:a.id});
   if(reserved)return json({sent:false,duplicate:true});
   const text=`TradePulse ${a.direction} · ${a.symbol}\nStrategy: ${a.strategy}\n${a.category} · ${a.timeframe}\nEntry: ${a.entry}\nSL: ${a.stop}\nTP1: ${a.tp1}\nTP2: ${a.tp2}\nRisk/reward: 1:${a.rr}\nCandle: ${new Date(a.candleTime).toISOString()}\n\nUnverified browser-generated analysis, not a trade.`;
   try{await telegram(tokenFor(env),"sendMessage",{chat_id:sub.telegram_chat_id,text});}
   catch(e){await admin.from("telegram_alert_delivery").delete().eq("user_id",uid).eq("signal_id",a.id);throw e;}
   return json({sent:true});
  }
  return safeError("Unsupported method",405);
 }catch(e){
  return safeError(e instanceof Error?e.message:"Telegram is not yet configured",503);
 }
}
