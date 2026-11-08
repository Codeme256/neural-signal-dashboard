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
