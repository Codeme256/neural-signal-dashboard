import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {renderSignalBanner} from "./signal-banners.mjs";
const signature=[137,80,78,71,13,10,26,10];
const baseline={type:"SIGNAL",symbol:"US500",strategy:"Trend Pullback",timeframe:"M15",
 direction:"BUY",entry:6100.25,stopLoss:6088.5,tp1:6123.75,tp2:6130.4,rr:2,
 score:77,currentPrice:6101.1,verifiedAt:Date.parse("2026-11-12T10:30:00Z")};
test("renders a real nonempty PNG for validated BUY with no external URLs",async()=>{
 const png=await renderSignalBanner(baseline);
 assert.deepEqual([...png.subarray(0,8)],signature);
 assert.equal(new DataView(png.buffer).getUint32(16),840);
 assert.equal(new DataView(png.buffer).getUint32(20),950);
 assert.ok(png.length>3500);
});
test("each signal price changes the actual image bytes; no fixed example banner",async()=>{
 const p1=await renderSignalBanner(baseline);
 const p2=await renderSignalBanner({...baseline,entry:6122.17});
 assert.notEqual(createHash("sha256").update(p1).digest("hex"),createHash("sha256").update(p2).digest("hex"));
});
test("separate outcome cards render for WIN and LOSS",async()=>{
 const settled={...baseline,target:"TP2",closedAt:Date.parse("2026-11-12T10:50:00Z")};
 const won=await renderSignalBanner({...settled,type:"WON"});
 const lost=await renderSignalBanner({...settled,type:"LOST"});
 assert.deepEqual([...won.subarray(0,8)],signature);
 assert.notEqual(createHash("sha256").update(won).digest("hex"),createHash("sha256").update(lost).digest("hex"));
});
test("watch without an entry is rendered distinctly and does not invent prices",async()=>{
 const watch=await renderSignalBanner({type:"WATCH",symbol:"US500",strategy:"Trend Pullback",
  timeframe:"M15",bias:"BULLISH",zoneLow:6098,zoneHigh:6101,
  candleTime:Date.now(),expiresAt:Date.now()+600000,verifiedPrice:6102,
  quoteTime:Date.now()-5000,dataSource:"Deriv broker index feed"});
 assert.deepEqual([...watch.subarray(0,8)],signature);
});

test("missing price evidence cannot generate Telegram WATCH banner",async()=>{
 await assert.rejects(()=>renderSignalBanner({type:"WATCH",symbol:"OTC SX5E",strategy:"Trend Watch",
 timeframe:"M15",bias:"BULLISH",candleTime:Date.now()}),/Invalid or stale price evidence/);
});
