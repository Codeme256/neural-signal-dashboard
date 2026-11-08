/** Server-only Telegram API. Requires Supabase service role + AES-GCM key as Worker secrets.
 * Never import this module into a client route or component.
 */
import { createClient } from "@supabase/supabase-js";

type Env={SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;TELEGRAM_CONFIG_KEY?:string};
type Config={user_id:string;encrypted_bot_token:string;token_iv:string;chat_id:string;enabled:boolean};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function fromBase64(s:string):Uint8Array {
 const str=atob(s);
 return Uint8Array.from(str,c=>c.charCodeAt(0));
}
function toBase64(bytes:Uint8Array):string {let s="";for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);}
async function secretKey(env:Env):Promise<CryptoKey> {
 const raw=env.TELEGRAM_CONFIG_KEY;
 if(!raw)throw Error("Telegram encryption key is not configured on the server");
 const decoded=fromBase64(raw);
 if(decoded.length!==32)throw Error("Telegram encryption key must be 32 random bytes encoded in Base64");
 return crypto.subtle.importKey("raw",decoded as BufferSource,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encrypt(token:string,env:Env){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},await secretKey(env),new TextEncoder().encode(token));
 return {encrypted_bot_token:toBase64(new Uint8Array(cipher)),token_iv:toBase64(iv)};
}
async function decrypt(config:Config,env:Env):Promise<string>{
 const iv=fromBase64(config.token_iv),cipher=fromBase64(config.encrypted_bot_token);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:iv as BufferSource},await secretKey(env),cipher as BufferSource));
}
async function readBody(request:Request):Promise<Record<string,unknown>>{
 const text=await request.text();
 if(text.length>6500)throw Error("Request too large");
 const value=JSON.parse(text) as unknown;
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid request");
 return value as Record<string,unknown>;
}
function isToken(s:unknown):s is string{return typeof s==="string"&&/^\d{5,15}:[a-zA-Z0-9_-]{25,}$/.test(s)&&s.length<160;}
function isChat(s:unknown):s is string{return typeof s==="string"&&s.length<=110&&(/^-?\d{5,24}$/.test(s)||/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s));}
function clean(s:unknown):string {return typeof s==="string"?s.slice(0,280):"";}
async function telegramSend(token:string,chatId:string,text:string){
 const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true}),
 });
 const payload=await response.json().catch(()=>({})) as {ok?:boolean;description?:string};
 if(!response.ok||payload.ok!==true)throw Error(payload.description?.slice(0,180)||"Telegram rejected the message. Confirm bot administrator privileges and channel ID.");
}
async function getAdmin(env:Env){
 if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)throw Error("Telegram backend needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets");
 return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
}
export async function handleTelegramApi(request:Request,env:unknown):Promise<Response>{
 try{
  const cfg=(env&&typeof env==="object"?env:{}) as Env;
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith("/api/signal-alerts/telegram"))return json({error:"Not found"},404);
  const origin=request.headers.get("Origin");
  if(origin&&origin!==url.origin)return json({error:"Cross-origin request rejected"},403);
  const bearer=request.headers.get("Authorization");
  if(!bearer?.startsWith("Bearer ")||bearer.length>3000)return json({error:"Please sign in"},401);
  const admin=await getAdmin(cfg);
  const {data:{user},error:authError}=await admin.auth.getUser(bearer.slice(7));
  if(authError||!user)return json({error:"Your login expired. Sign in again."},401);
  const uid=user.id;
  const {data,error:readError}=await admin.from("telegram_alert_settings").select("*").eq("user_id",uid).maybeSingle();
  if(readError)throw Error("Telegram database migration is not active");
  const existing=data as Config|null;
  if(path==="/api/signal-alerts/telegram"&&request.method==="GET")
   return json({configured:!!existing,enabled:existing?.enabled??false,chatId:existing?.chat_id??""});
  if(path==="/api/signal-alerts/telegram"&&request.method==="DELETE"){
   const {error}=await admin.from("telegram_alert_settings").delete().eq("user_id",uid);
   if(error)throw Error("Failed to remove Telegram configuration");
   return json({configured:false,enabled:false});
  }
  if(path==="/api/signal-alerts/telegram"&&request.method==="PUT"){
   const body=await readBody(request);
   if(!isChat(body.chatId))return json({error:"Use a valid numeric Telegram chat ID or public @channel_username"},400);
   const botToken=body.botToken;
   if(botToken!==""&&!isToken(botToken))return json({error:"Invalid Telegram bot token format"},400);
   if(!existing&&!isToken(botToken))return json({error:"Enter a Telegram bot token"},400);
   if(!existing&&botToken==="")return json({error:"Enter a Telegram bot token"},400);
   const encrypted=isToken(botToken)?await encrypt(botToken,cfg):{
    encrypted_bot_token:existing!.encrypted_bot_token,token_iv:existing!.token_iv,
   };
   const {error}=await admin.from("telegram_alert_settings").upsert({
    user_id:uid,...encrypted,chat_id:body.chatId,enabled:body.enabled===true,updated_at:new Date().toISOString(),
   },{onConflict:"user_id"});
   if(error)throw Error("Could not save Telegram configuration to the private database");
   return json({configured:true,enabled:body.enabled===true,chatId:body.chatId});
  }
  if(path==="/api/signal-alerts/telegram/test"&&request.method==="POST"){
   if(!existing)return json({error:"Save Telegram configuration first"},400);
   await telegramSend(await decrypt(existing,cfg),existing.chat_id,"TradePulse test notification ✅\nYour bot can send messages to this channel. Signal monitoring must be enabled in your open dashboard.");
   return json({sent:true});
  }
  if(path==="/api/signal-alerts/telegram/send"&&request.method==="POST"){
   if(!existing?.enabled)return json({error:"Telegram notifications are not enabled"},400);
   const body=await readBody(request),a=body.alert;
   if(!a||typeof a!=="object"||Array.isArray(a))return json({error:"Invalid alert"},400);
   const v=a as Record<string,unknown>;
   const direction=v.direction;
   const strategy=clean(v.strategy),symbol=clean(v.symbol),category=clean(v.category);
   const tf=clean(v.timeframe),id=clean(v.id);
   const entry=Number(v.entry),stop=Number(v.stopLoss),tp1=Number(v.tp1),tp2=Number(v.tp2),rr=Number(v.rr),time=Number(v.candleTime);
   if((direction!=="BUY"&&direction!=="SELL")||!id||!symbol||!strategy||!["M1","M5","M15","M30","H1","H4"].includes(tf)||
      !["FOREX","CRYPTO","INDEX","VOLATILITY","METAL","SYNTHETIC"].includes(category)||
      ![entry,stop,tp1,tp2,rr,time].every(Number.isFinite)||
      rr<2||rr>100||Math.abs(Date.now()-time)>2*60*60*1000||
      !(direction==="BUY"?stop<entry&&tp1>entry&&tp2>=tp1:stop>entry&&tp1<entry&&tp2<=tp1))
       return json({error:"Expired or malformed signal rejected"},400);
   // Durable dedupe and per-user rate cap. Client-generated alerts are not server-certified prices.
   const {data:dup}=await admin.from("telegram_alert_delivery").select("signal_id").eq("user_id",uid).eq("signal_id",id).maybeSingle();
   if(dup)return json({sent:false,duplicate:true});
   const cutoff=new Date(Date.now()-60000).toISOString();
   const {count}=await admin.from("telegram_alert_delivery").select("signal_id",{count:"exact",head:true}).eq("user_id",uid).gte("sent_at",cutoff);
   if((count??0)>=3)return json({error:"Telegram alert rate limit reached"},429);
   const {error:reserveError}=await admin.from("telegram_alert_delivery").insert({user_id:uid,signal_id:id,sent_at:new Date().toISOString()});
   if(reserveError)return json({sent:false,duplicate:true});
   const msg=`TradePulse ${direction} signal · ${symbol}\nStrategy: ${strategy}\nMarket: ${category} · TF: ${tf}\nEntry: ${entry}\nStop loss: ${stop}\nTP1: ${tp1}\nTP2: ${tp2}\nR:R: 1:${rr}\nCompleted candle: ${new Date(time).toISOString()}\n\nSource: browser-side signal engine. Not a verified trade or guaranteed result.`;
   try{await telegramSend(await decrypt(existing,cfg),existing.chat_id,msg);}
   catch(e){await admin.from("telegram_alert_delivery").delete().eq("user_id",uid).eq("signal_id",id);throw e;}
   return json({sent:true});
  }
  return json({error:"Method or endpoint not supported"},405);
 }catch(e){
   // Never log the request body or credential. Error may contain Telegram provider descriptions only.
   return json({error:e instanceof Error?e.message:"Alert server is not configured"},503);
 }
}
