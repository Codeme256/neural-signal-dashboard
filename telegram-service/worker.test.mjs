import test from "node:test";
import assert from "node:assert/strict";
import worker,{notifyFinalOutcomes} from "./worker.mjs";

const ENV={
 TRADEPULSE_DB:{prepare(){ throw Error("No database query expected in this test"); }},
 TRADEPULSE_TELEGRAM_BOT_TOKEN:"123456789:abcdefghijklmnopqrstuvwxyz01234567",
 TELEGRAM_WEBHOOK_SECRET:"test-telegram-webhook-secret-not-real",
 TRADEPULSE_PUBLISH_SECRET:"test-internal-publish-secret-not-real",
 TRADEPULSE_TELEGRAM_CHANNEL_ID:"-1001234567890",
};
const request=(path,opts={})=>new Request("https://example.workers.dev"+path,opts);
const read=async response=>({status:response.status,body:await response.json()});

test("standalone service reports configuration, not user credentials",async()=>{
 const out=await read(await worker.fetch(request("/health"),ENV));
 assert.equal(out.status,200);
 assert.equal(out.body.ready,true);
 assert.equal(out.body.signalSourceConnected,true);
 assert.equal(JSON.stringify(out.body).includes(ENV.TRADEPULSE_TELEGRAM_BOT_TOKEN),false);
});
test("webhook requires verified Telegram header",async()=>{
 const res=await read(await worker.fetch(request("/telegram/webhook",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),ENV));
 assert.equal(res.status,401);
});
test("alert publishing cannot be called without the private publisher secret",async()=>{
 const res=await read(await worker.fetch(request("/publish",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),ENV));
 assert.equal(res.status,401);
});
test("malformed alert rejected despite correct publisher secret",async()=>{
 const res=await read(await worker.fetch(request("/publish",{method:"POST",headers:{
  Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET,"content-type":"application/json"
 },body:JSON.stringify({direction:"BUY"})}),ENV));
 assert.equal(res.status,400);
});
test("channel test sends only when authenticated",async()=>{
 const originalFetch=globalThis.fetch;
 let called=false;
 try{
  globalThis.fetch=async(url,opts)=>{
   assert.equal(String(url).includes("/sendMessage"),true);
   const body=JSON.parse(opts.body);
   assert.equal(body.chat_id,ENV.TRADEPULSE_TELEGRAM_CHANNEL_ID);
   called=true;
   return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200,headers:{"content-type":"application/json"}});
  };
  const res=await read(await worker.fetch(request("/admin/test",{method:"POST",headers:{Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET}}),ENV));
  assert.equal(res.status,200);assert.equal(res.body.sent,true);assert.equal(called,true);
 }finally{globalThis.fetch=originalFetch;}
});

const telegramWebhook = (text) => request("/telegram/webhook",{
 method:"POST",
 headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":ENV.TELEGRAM_WEBHOOK_SECRET},
 body:JSON.stringify({update_id:1,message:{chat:{id:123456,type:"private"},from:{id:123456},text}}),
});
test("bot menu handles Telegram private commands without broker execution",async()=>{
 const originalFetch=globalThis.fetch;
 let sent;
 try {
  globalThis.fetch=async(url,opts)=>{
   assert.ok(String(url).includes("/sendMessage"));
   sent=JSON.parse(opts.body);
   return Response.json({ok:true,result:{message_id:123}});
  };
  const result=await read(await worker.fetch(telegramWebhook("/menu"),ENV));
  assert.equal(result.status,200);
  assert.equal(result.body.ok,true);
  assert.equal(sent.chat_id,"123456");
  assert.ok(sent.reply_markup?.inline_keyboard?.length>0);
 }finally{globalThis.fetch=originalFetch;}
});
test("broker close is explicitly unavailable, never a trade",async()=>{
 const originalFetch=globalThis.fetch;
 let sent;
 try{
  globalThis.fetch=async(_url,opts)=>{
   sent=JSON.parse(opts.body);
   return Response.json({ok:true,result:{message_id:1}});
  };
  const result=await read(await worker.fetch(telegramWebhook("/close 123"),ENV));
  assert.equal(result.status,200);
  assert.match(sent.text,/not connected/i);
 }finally{globalThis.fetch=originalFetch;}
});
test("webhook registration requires private publisher authentication",async()=>{
 const result=await read(await worker.fetch(request("/admin/setup",{method:"POST"}),ENV));
 assert.equal(result.status,401);
});
test("authorized setup registers Telegram webhook and all command labels without exposing secrets",async()=>{
 const originalFetch=globalThis.fetch,called=[];
 try{
  globalThis.fetch=async(url,opts)=>{
   const body=JSON.parse(opts.body);
   called.push({url:String(url),body});
   if(String(url).endsWith("/getWebhookInfo"))
    return Response.json({ok:true,result:{url:"https://example.workers.dev/telegram/webhook",pending_update_count:0}});
   return Response.json({ok:true,result:true});
  };
  const result=await read(await worker.fetch(request("/admin/setup",{
   method:"POST",headers:{Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET}
  }),ENV));
  assert.equal(result.status,200);
  assert.equal(result.body.configured,true);
  const setHook=called.find(x=>x.url.endsWith("/setWebhook"));
  assert.equal(setHook.body.secret_token,ENV.TELEGRAM_WEBHOOK_SECRET);
  assert.equal(setHook.body.url,"https://example.workers.dev/telegram/webhook");
  const commands=called.find(x=>x.url.endsWith("/setMyCommands"));
  assert.ok(commands.body.commands.some(c=>c.command==="signal"));
  assert.ok(commands.body.commands.some(c=>c.command==="price"));
  assert.ok(commands.body.commands.some(c=>c.command==="support"));
  assert.equal(JSON.stringify(result.body).includes(ENV.TELEGRAM_WEBHOOK_SECRET),false);
 }finally{globalThis.fetch=originalFetch;}
});
test("status only exposes actual signal and broker status",async()=>{
 const originalFetch=globalThis.fetch;
 const env={...ENV,TRADEPULSE_DB:{prepare(sql){
  if(sql.includes("telegram_subscriptions"))return {bind:()=>({first:async()=>({enabled:1})})};
  if(sql.includes("index_alerts"))return {bind:()=>({all:async()=>({results:[]})})};
  throw Error("Unexpected SQL: "+sql);
 }}};
 let sent;
 try{
  globalThis.fetch=async(_url,opts)=>{sent=JSON.parse(opts.body);return Response.json({ok:true,result:{message_id:1}});};
  const result=await read(await worker.fetch(telegramWebhook("/status"),env));
  assert.equal(result.status,200);
  assert.match(sent.text,/signal-only/);
  assert.match(sent.text,/no|none|not configured/i);
 }finally{globalThis.fetch=originalFetch;}
});

test("early WATCH reaches configured channel and subscribers without an entry price",async()=>{
 const now=Date.now();
 const sent=[];
 const originalFetch=globalThis.fetch;
 const env={...ENV,TRADEPULSE_DB:{prepare(sql){
  if(sql.includes("telegram_subscriptions"))return {all:async()=>({results:[{user_id:"sub",telegram_chat_id:"123456789"}]})};
  if(sql.includes("INSERT OR IGNORE INTO telegram_alert_delivery"))return {bind:()=>({run:async()=>({meta:{changes:1}})})};
  throw Error("Unexpected SQL "+sql);
 }}};
 try{
  globalThis.fetch=async(url,opts)=>{assert.ok(String(url).includes("/sendPhoto"));const form=opts.body;assert.ok(form instanceof FormData);sent.push({text:form.get("caption"),photo:form.get("photo")});return Response.json({ok:true,result:{message_id:1}});};
  const res=await read(await worker.fetch(request("/publish",{method:"POST",headers:{Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET,"content-type":"application/json"},body:JSON.stringify({
   type:"WATCH",id:"index:test:WATCH",symbol:"US500",strategy:"Higher-timeframe trend watch",timeframe:"M15",
   candleTime:now-30000,bias:"BULLISH",regime:"TRENDING",createdAt:now,
  })}),env));
  assert.equal(res.status,200);
  assert.equal(res.body.sent,2);
  assert.ok(sent.every(x=>x.text.includes("NO ENTRY YET")&&!x.text.includes("SL:")&&x.photo.type==="image/png"&&x.photo.size>3500));
 }finally{globalThis.fetch=originalFetch;}
});
test("old entry without new quote verification is rejected before broadcasting",async()=>{
 const now=Date.now();
 const env={...ENV,TRADEPULSE_DB:{prepare(){throw Error("No DB query should occur");}}};
 const res=await read(await worker.fetch(request("/publish",{method:"POST",headers:{Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET,"content-type":"application/json"},body:JSON.stringify({
  id:"old",symbol:"US500",strategy:"Trend Continuation",direction:"BUY",timeframe:"M15",
  entry:100,stopLoss:99,tp1:102,tp2:103,rr:2,candleTime:now-45*60000
 })}),env));
 assert.equal(res.status,400);
});


test("valid confirmed signal is sent as a real image and includes its actual price",async()=>{
 const now=Date.now(),calls=[];
 const env={...ENV,TRADEPULSE_DB:{prepare(sql){
  if(sql.includes("telegram_subscriptions"))return{all:async()=>({results:[]})};
  if(sql.includes("INSERT OR IGNORE INTO telegram_alert_delivery"))return{bind:()=>({run:async()=>({meta:{changes:1}})})};
  throw Error("Unexpected SQL: "+sql);
 }}};
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{calls.push({url:String(url),body:opts.body});return Response.json({ok:true,result:{message_id:5}});};
  const result=await read(await worker.fetch(request("/publish",{method:"POST",headers:{
   Authorization:"Bearer "+ENV.TRADEPULSE_PUBLISH_SECRET,"content-type":"application/json"
  },body:JSON.stringify({id:"new-signal-1",symbol:"US500",strategy:"Trend Pullback · Confirmed pullback",
   direction:"BUY",timeframe:"M15",entry:6101.25,stopLoss:6091.25,tp1:6121.25,tp2:6131.25,
   rr:2,candleTime:now-60000,verifiedAt:now-1000,currentPrice:6101.5,quoteTime:now-4000,setupScore:78,
   expiresAt:now+120000})}),env));
  assert.equal(result.status,200);
  assert.equal(result.body.sent,1);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/sendPhoto$/);
  assert.match(calls[0].body.get("caption"),/6101.25/);
  assert.equal(calls[0].body.get("photo").type,"image/png");
 }finally{globalThis.fetch=original;}
});
test("final win and loss outcomes each send a distinct PNG with database-backed prices",async()=>{
 const now=Date.now(),sent=[],claimed=new Set();
 const alerts=[
  {alert_id:"x1",status:"WON",target:"TP2",closed_at:now-600000,
   symbol:"US500",strategy:"Trend Pullback",direction:"BUY",timeframe:"M15",
   entry:6000,stop_loss:5990,tp1:6020,tp2:6030,created_at:now-1500000},
  {alert_id:"x2",status:"LOST",target:null,closed_at:now-900000,
   symbol:"US500",strategy:"Trend Pullback",direction:"SELL",timeframe:"M15",
   entry:6000,stop_loss:6010,tp1:5980,tp2:5970,created_at:now-1600000}
 ];
 const env={...ENV,TRADEPULSE_DB:{prepare(sql){
  if(sql.startsWith("SELECT o.alert_id"))return {bind:()=>({all:async()=>({results:alerts})})};
  if(sql.startsWith("SELECT telegram_chat_id"))return {all:async()=>({results:[]})};
  if(sql.startsWith("INSERT OR IGNORE INTO telegram_outcome_delivery"))return {bind:(...params)=>({run:async()=>{
   const key=params.slice(0,3).join(":");if(claimed.has(key))return {meta:{changes:0}};
   claimed.add(key);return {meta:{changes:1}};
  }})};
  if(sql.startsWith("DELETE FROM telegram_outcome_delivery"))return {bind:()=>({run:async()=>({})})};
  throw Error("Unexpected SQL "+sql);
 }}};
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{sent.push({url:String(url),caption:opts.body.get("caption"),name:opts.body.get("photo").name});
   return Response.json({ok:true,result:{message_id:1}});
  };
  await notifyFinalOutcomes(env);
  assert.equal(sent.length,2);
  assert.ok(sent.every(x=>x.url.endsWith("/sendPhoto")));
  assert.ok(sent.some(x=>x.caption.includes("TP2 touched")&&x.name.includes("won")));
  assert.ok(sent.some(x=>x.caption.includes("SL touched before TP1")&&x.name.includes("lost")));
  assert.ok(sent.every(x=>x.caption.includes("NOT VERIFIED BROKER P/L")));
  await notifyFinalOutcomes(env);
  assert.equal(sent.length,2); // no repeated outcome announcements
 }finally{globalThis.fetch=original;}
});
