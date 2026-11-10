import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEconomicEvent,normalizeEconomicCalendar,formatEventReminder} from "./news-calendar.mjs";
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
