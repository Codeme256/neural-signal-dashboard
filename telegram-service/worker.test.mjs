import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

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
 assert.equal(out.body.signalSourceConnected,false);
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
