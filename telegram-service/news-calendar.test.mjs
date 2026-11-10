import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEconomicEvent,normalizeEconomicCalendar,normalizeSecondaryCalendar,fetchEconomicCalendar,formatEventReminder} from "./news-calendar.mjs";
const raw={
 source:"bls",eventName:"CPI (Consumer Price Index)",importance:"high",
 scheduledAt:"2026-11-13T13:30:00.000Z",periodLabel:"October 2026",
 previous:null,forecast:null,actual:null,unit:"% y/y",
 canonicalUrl:"https://xoomar.com/markets/calendar/cpi",
};
test("verified event time and USD scenario do not claim forecast",()=>{
 const event=normalizeEconomicEvent(raw);
 assert.equal(event.currency,"USD");
 assert.equal(event.scheduledAt,"2026-11-13T13:30:00.000Z");
 assert.equal(event.forecast,null);
 assert.match(event.direction,/UNKNOWN/);
 assert.match(event.scenarios.EURUSD,/USD-positive surprise/);
 assert.match(event.timeframes.confirmation,/M15/);
});
test("malformed events and low impact events are ignored",()=>{
 assert.equal(normalizeEconomicEvent({...raw,scheduledAt:"unknown"}),null);
 assert.equal(normalizeEconomicEvent({...raw,importance:"low"}),null);
});
test("source staleness is explicitly identified",()=>{
 const data={data:[raw],updatedAt:"2026-11-01T00:00:00.000Z"};
 const out=normalizeEconomicCalendar(data,Date.parse("2026-11-10T00:00:00.000Z"));
 assert.equal(out.stale,true);
 assert.equal(out.forecastAvailable,false);
 assert.equal(out.events.length,1);
});
test("reminder displays Uganda and UTC times and does not promise direction",()=>{
 const e=normalizeEconomicEvent(raw);
 const txt=formatEventReminder(e,15);
 assert.match(txt,/16:30/); // 13:30 UTC -> 16:30 EAT
 assert.match(txt,/13:30 UTC/);
 assert.match(txt,/No confirmed direction/);
 assert.match(txt,/EURUSD/);
});

test("alternative event maps currency pairs, consensus and confirmed schedule",()=>{
 const data={generated_at:"2026-11-10T18:00:00Z",events:[
 {currency:"EUR",impact:"high",status:"scheduled",confidence:"official",time:"2026-11-12T13:30:00Z",title:"ECB rates",
 id:"eur-ecb.20261112",forecast:"2.5%",previous:"2.75%",actual:"",period:"November"},
 {currency:"JPY",impact:"high",status:"tentative",confidence:"sources_disagree",time:"2026-11-13T13:30:00Z",title:"Uncertain release"},
 ]};
 const output=normalizeSecondaryCalendar(data,Date.parse("2026-11-10T18:05:00Z"));
 assert.equal(output.stale,false);
 assert.equal(output.events.length,1);
 assert.equal(output.events[0].currency,"EUR");
 assert.ok(output.events[0].affected.includes("EURUSD"));
 assert.equal(output.events[0].forecast,"2.5%");
 assert.match(output.events[0].direction,/UNKNOWN/);
});
test("fallback handles primary provider HTTP failure without inventing event data",async()=>{
 const original=globalThis.fetch;
 const now=Date.parse("2026-11-10T18:05:00Z");
 try {
  let hits=0;
  globalThis.fetch=async url=>{
   hits++;
   if(String(url).includes("xoomar"))return Response.json({error:"blocked"},{status:403});
   return Response.json({generated_at:"2026-11-10T18:00:00Z",events:[
    {currency:"USD",impact:"high",status:"scheduled",confidence:"official",time:"2026-11-12T13:30:00Z",
    title:"CPI",id:"usd-cpi",forecast:"2.5%",previous:"2.4%",actual:"",period:"Oct"}
   ]});
  };
  const result=await fetchEconomicCalendar(now);
  assert.equal(hits,2);
  assert.equal(result.source,"ShowMyTrades");
  assert.equal(result.fallbackUsed,true);
  assert.equal(result.events.length,1);
 }finally{globalThis.fetch=original;}
});
