/** Scheduled US economic calendar, with factual release times and CONDITIONAL FX scenarios.
 * Source: XOOMAR public high-impact calendar. Do not interpret the scenarios as forecasts.
 */
export const ECONOMIC_CALENDAR_SOURCE="https://xoomar.com/api/markets/calendar?importance=high";
const AFFECTED=["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","XAUUSD","US 500","US Tech 100","Wall Street 30","DXY"];
const ASSET_EFFECTS={
 EURUSD:"USD-positive surprise → generally downward pressure; USD-negative → generally upward pressure",
 GBPUSD:"USD-positive surprise → generally downward pressure; USD-negative → generally upward pressure",
 USDJPY:"USD-positive surprise → often upward pressure, but yields and risk sentiment can reverse it",
 USDCHF:"USD-positive surprise → often upward pressure, but safe-haven flows can reverse it",
 USDCAD:"USD-positive surprise → generally upward pressure; oil and CAD releases can dominate",
 AUDUSD:"USD-positive surprise → generally downward pressure; risk sentiment can dominate",
 NZDUSD:"USD-positive surprise → generally downward pressure; risk sentiment can dominate",
 XAUUSD:"USD/yield-positive surprise → often downward pressure on gold; risk aversion can reverse it",
 "US 500":"Higher-rate expectations can pressure equities; growth surprises have mixed effects",
 "US Tech 100":"Higher yields can pressure rate-sensitive tech; growth and earnings may offset",
 "Wall Street 30":"Rate, growth and risk-sentiment reaction is conditional, not deterministic",
 DXY:"USD-positive surprise → generally upward pressure; USD-negative → generally downward pressure",
};
const asNumberOrNull=v=>v==null||String(v).trim()===""?null:Number.isFinite(Number(v))?Number(v):null;
export function normalizeEconomicEvent(raw) {
 if(!raw||typeof raw!=="object")return null;
 const time=Date.parse(raw.scheduledAt);
 if(!Number.isFinite(time)||time<=0||!String(raw.eventName||"").trim()||raw.importance!=="high")return null;
 const eventName=String(raw.eventName).slice(0,140);
 const iso=new Date(time).toISOString();
 return {
  id:String(raw.source||"us")+":"+eventName+":"+iso,
  event:eventName,currency:"USD",impact:"HIGH",country:"United States",
  scheduledAt:iso,period:String(raw.periodLabel||"").slice(0,100),
  previous:asNumberOrNull(raw.previous),actual:asNumberOrNull(raw.actual),
  forecast:null,unit:raw.unit==null?null:String(raw.unit).slice(0,80),
  source:"XOOMAR",sourceUrl:String(raw.canonicalUrl||"https://xoomar.com/markets/calendar"),
  affected:AFFECTED,scenarios:ASSET_EFFECTS,
  direction:"UNKNOWN — wait for released data and market reaction",
  timeframes:{preparation:"H1 / M15 before release",volatility:"M1 / M5 at release; avoid trading initial spike",confirmation:"M15 / H1 after confirmed closes"},
 };
}
export function normalizeEconomicCalendar(json,now=Date.now()) {
 if(!json||!Array.isArray(json.data))throw Error("Economic calendar format unavailable");
 const events=json.data.map(normalizeEconomicEvent).filter(Boolean)
   .filter(e=>Date.parse(e.scheduledAt)>now-3*3600000&&Date.parse(e.scheduledAt)<now+31*86400000)
   .sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt)).slice(0,45);
 const updatedAt=typeof json.updatedAt==="string"&&Number.isFinite(Date.parse(json.updatedAt))?json.updatedAt:null;
 const stale=!updatedAt || now-Date.parse(updatedAt)>7*86400000 || Date.parse(updatedAt)>now+5*60000;
 return {events,source:"XOOMAR",sourceUrl:"https://xoomar.com/markets/calendar",
  updatedAt,stale,coverage:"United States, high-impact scheduled releases only",
  forecastAvailable:false,note:"No directional forecast: conditional scenarios only. Actual market reaction can reverse. Calendar times can change.",
  attribution:"Data: XOOMAR. Official US agency schedules and releases; see source attribution at xoomar.com."};
}
export const SECONDARY_CALENDAR_SOURCE="https://showmytrades.com/api/public/calendar/v1?impact=high&days=30";
const PRIMARY_CALENDAR_TIMEOUT_MS=6000;
const SECONDARY_CALENDAR_TIMEOUT_MS=8500;
const currencyEffects={
 USD:{affected:AFFECTED,scenarios:ASSET_EFFECTS},
 EUR:{affected:["EURUSD","EURGBP","EURJPY","EURCHF","EURCAD","EURAUD","EURNZD","DXY","XAUUSD"]},
 GBP:{affected:["GBPUSD","EURGBP","GBPJPY","GBPCHF","GBPCAD","GBPAUD","GBPNZD"]},
 JPY:{affected:["USDJPY","EURJPY","GBPJPY","AUDJPY","CADJPY","CHFJPY","NZDJPY"]},
 AUD:{affected:["AUDUSD","AUDJPY","EURAUD","GBPAUD","AUDNZD","AUDCAD"]},
 CAD:{affected:["USDCAD","CADJPY","EURCAD","GBPCAD","AUDCAD","NZDCAD"]},
 CHF:{affected:["USDCHF","EURCHF","GBPCHF","CHFJPY"]},
 NZD:{affected:["NZDUSD","NZDJPY","EURNZD","GBPNZD","AUDNZD","NZDCAD"]},
 CNY:{affected:["AUDUSD","NZDUSD","USDCNH","XAUUSD","US 500"]},
};
export function normalizeSecondaryCalendar(json,now=Date.now()){
 if(!json||!Array.isArray(json.events))throw Error("Alternative calendar response invalid");
 const eventSource="ShowMyTrades";
 const sourceUrl="https://showmytrades.com/tools/economic-calendar";
 const events=json.events.flatMap(item=>{
  const currency=String(item?.currency??"").toUpperCase();
  const iso=Date.parse(item?.time);
  const eventName=String(item?.title??"").trim();
  if(!Number.isFinite(iso)||!currencyEffects[currency]||item.impact!=="high"||!eventName
    ||(item.status!=="scheduled"&&item.status!=="moved")||item.confidence==="sources_disagree")return [];
  const impacted=currencyEffects[currency].affected;
  const scenarios=currency==="USD"?ASSET_EFFECTS:Object.fromEntries(impacted.map(pair=>[pair,
   currency+"-supportive release surprise may strengthen "+currency+"; market reaction depends on forecast deviation, rate expectations and risk sentiment. Pair direction is not predetermined."
  ]));
  return [{
   id:"smt:"+String(item.id||currency+":"+eventName+":"+item.time).slice(0,200),
   event:eventName.slice(0,140),currency,impact:"HIGH",country:currency,
   scheduledAt:new Date(iso).toISOString(),period:String(item.period??"").slice(0,100),
   previous:typeof item.previous==="string"&&item.previous?item.previous:null,
   actual:typeof item.actual==="string"&&item.actual?item.actual:null,
   forecast:typeof item.forecast==="string"&&item.forecast?item.forecast:null,
   unit:null,source:eventSource,sourceUrl,affected:impacted,scenarios,
   direction:"UNKNOWN — conditional scenarios only; compare actual with forecast after release",
   timeframes:{preparation:"H1 / M15 before release",volatility:"M1 / M5 at release; avoid the first spike",
    confirmation:"M15 / H1 after confirmed closes"},
  }];
 }).filter(e=>Date.parse(e.scheduledAt)>now-6*3600000&&Date.parse(e.scheduledAt)<now+31*86400000)
  .sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt)).slice(0,100);
 const updatedAt=typeof json.generated_at==="string"&&Number.isFinite(Date.parse(json.generated_at))?json.generated_at:null;
 const stale=!updatedAt || now-Date.parse(updatedAt)>24*3600000 || Date.parse(updatedAt)>now+5*60000;
 return {events,source:eventSource,sourceUrl,updatedAt,stale,
  coverage:"High-impact USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF and CNY events",
  forecastAvailable:events.some(e=>e.forecast!==null),
  note:"Consensus values can change. Direction before release remains unknown. Exact time is scheduled, not guaranteed.",
  attribution:"Economic calendar by ShowMyTrades · "+sourceUrl};
}
async function fetchJson(url,timeoutMs){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  const response=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"APEX-News-Calendar/2.1 (public economic events)"},
   signal:controller.signal,redirect:"follow"});
  if(!response.ok)throw Error("Calendar provider HTTP "+response.status);
  return await response.json();
 }finally{clearTimeout(timeout);}
}
export async function fetchEconomicCalendar(now=Date.now()) {
 let firstError;
 try{
  const primary=normalizeEconomicCalendar(await fetchJson(ECONOMIC_CALENDAR_SOURCE,PRIMARY_CALENDAR_TIMEOUT_MS),now);
  if(!primary.stale&&primary.events.length>0)return primary;
  firstError=Error("Primary calendar stale or empty");
 }catch(e){firstError=e;}
 try{
  const secondary=normalizeSecondaryCalendar(await fetchJson(SECONDARY_CALENDAR_SOURCE,SECONDARY_CALENDAR_TIMEOUT_MS),now);
  if(!secondary.stale&&secondary.events.length>0)return {...secondary,fallbackUsed:true};
  throw Error("Secondary calendar stale or empty");
 }catch(e){
  console.error("Both news calendar providers unavailable",{
   primary:String(firstError?.message??firstError).slice(0,120),secondary:String(e?.message??e).slice(0,120)
  });
  throw Error("All verified economic calendar sources are unavailable");
 }
}
export function formatEventReminder(event,minutes) {
 const stamp=new Date(event.scheduledAt);
 const eat=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",dateStyle:"medium",timeStyle:"short"}).format(stamp);
 const lines=event.affected.slice(0,7);
 return "📰 APEX PRE-NEWS ALERT · "+event.impact+
  "\n"+event.event+" ("+event.currency+")"+
  "\nRelease: "+eat+" EAT / "+stamp.toISOString().slice(11,16)+" UTC"+
  "\nApprox. "+minutes+" minutes until release"+
  "\nWatchlist: "+lines.join(", ")+
  "\nCurrency: "+event.currency+" · Forecast: "+(event.forecast??"not available")+" · Previous: "+(event.previous??"not available")+
  "\nDirection: UNKNOWN until the actual figures and market response; pairs can react differently."+
  "\nChart windows: H1/M15 context before news; M1/M5 initial volatility; M15 close for confirmation."+
  "\n⚠️ No confirmed direction before actual data. Avoid entering during spreads/slippage spikes."+
  "\nData: "+event.source+" · "+event.sourceUrl;
}
