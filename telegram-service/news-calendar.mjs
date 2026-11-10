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
 const stale=!updatedAt || now-Date.parse(updatedAt)>72*3600000 || Date.parse(updatedAt)>now+5*60000;
 return {events,source:"XOOMAR",sourceUrl:"https://xoomar.com/markets/calendar",
  updatedAt,stale,coverage:"United States, high-impact scheduled releases only",
  forecastAvailable:false,note:"No directional forecast: conditional scenarios only. Actual market reaction can reverse. Calendar times can change.",
  attribution:"Data: XOOMAR. Official US agency schedules and releases; see source attribution at xoomar.com."};
}
export async function fetchEconomicCalendar(now=Date.now()) {
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 try {
  const response=await fetch(ECONOMIC_CALENDAR_SOURCE,{headers:{Accept:"application/json"},signal:controller.signal});
  if(!response.ok)throw Error("Economic calendar source unavailable");
  return normalizeEconomicCalendar(await response.json(),now);
 }finally{clearTimeout(timeout);}
}
export function formatEventReminder(event,minutes) {
 const stamp=new Date(event.scheduledAt);
 const eat=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",dateStyle:"medium",timeStyle:"short"}).format(stamp);
 const lines=event.affected.filter(x=>["EURUSD","GBPUSD","USDJPY","XAUUSD","DXY","US 500"].includes(x));
 return "📰 APEX PRE-NEWS ALERT · "+event.impact+
  "\n"+event.event+" ("+event.currency+")"+
  "\nRelease: "+eat+" EAT / "+stamp.toISOString().slice(11,16)+" UTC"+
  "\nApprox. "+minutes+" minutes until release"+
  "\nWatchlist: "+lines.join(", ")+
  "\nUSD stronger surprise: EURUSD/GBPUSD & gold often face pressure; USDJPY/DXY may rise."+
  "\nUSD weaker surprise: reverse scenario. Indices can react both ways."+
  "\nChart windows: H1/M15 context before news; M1/M5 initial volatility; M15 close for confirmation."+
  "\n⚠️ No confirmed direction before actual data. Avoid entering during spreads/slippage spikes."+
  "\nData: XOOMAR · "+event.sourceUrl;
}
