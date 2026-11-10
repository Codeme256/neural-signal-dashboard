import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, RefreshCw, Search } from "lucide-react";
import { useDerivMarkets } from "@/hooks/use-deriv";
import { fetchCandles } from "@/lib/candle-store";
import { deriveSignal } from "@/lib/deriv-data";

type Event = {
  id:string;event:string;currency:string;impact:string;country:string;
  scheduledAt:string;period:string;previous:string|number|null;actual:string|number|null;
  forecast:string|number|null;unit:string|null;source:string;sourceUrl:string;
  affected:string[];scenarios:Record<string,string>;
  direction:string;timeframes:{preparation:string;volatility:string;confirmation:string};
};
type NewsScan = { eventId:string;symbol:string;checkedAt:number;technicalBias:string;ema9:number|null;ema21:number|null;rsi:number|null;note:string;dataTime:number|null;minutesToRelease:number;fresh:boolean;marketOpen:boolean; };
type Calendar = {events:Event[];stale:boolean;updatedAt:string|null;source:string;
  coverage:string;forecastAvailable:boolean;note:string;attribution:string;sourceUrl:string};
const NEWS_URL = "https://tradepulse-telegram-service.davidmwesigwa71.workers.dev/news/calendar";
const DISPLAY_PAIRS=["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","XAUUSD","US 500","US Tech 100","Wall Street 30","DXY"];
const eat=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
const utctime=new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false});
function countdown(target:string,now:number){
 const left=Date.parse(target)-now;
 if(left<=0)return "Released / awaiting data";
 const m=Math.ceil(left/60000);return m>=1440?Math.floor(m/1440)+"d "+Math.ceil(m%1440/60)+"h":m>=60?Math.floor(m/60)+"h "+m%60+"m":m+"m";
}
function isEvent(x:unknown):x is Event {
 if(!x||typeof x!=="object")return false;
 const e=x as Record<string,unknown>;
 return typeof e["id"]==="string"&&typeof e["event"]==="string"&&typeof e["scheduledAt"]==="string"&&
   Number.isFinite(Date.parse(e["scheduledAt"]))&&typeof e["scenarios"]==="object"&&e["scenarios"]!==null&&Array.isArray(e["affected"]);
}
export function PreNewsCalendar(){
 const [calendar,setCalendar]=useState<Calendar|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [now,setNow]=useState(0);
 const [selected,setSelected]=useState("EURUSD");
 const [eventId,setEventId]=useState("");
 const [scanResult,setScanResult]=useState<NewsScan|null>(null);
 const [scanError,setScanError]=useState("");
 const [scanning,setScanning]=useState(false);
 const marketsQ=useDerivMarkets();
 const refresh=async(signal?:AbortSignal)=>{
  try {
   const response=await fetch(NEWS_URL,{cache:"no-store",signal:signal??null});
   if(!response.ok)throw Error("Calendar service unavailable");
   const raw:unknown=await response.json();
   if(!raw||typeof raw!=="object"||!("events" in raw))throw Error("Invalid calendar response");
   const data=raw as Calendar;
   if(!Array.isArray(data.events)||!data.events.every(isEvent))throw Error("Invalid calendar event data");
   if(!signal?.aborted){setCalendar(data);setError("");}
  }catch{
   if(!signal?.aborted)setError("Verified calendar unavailable. Do not assume no important releases are due.");
  }finally{if(!signal?.aborted)setLoading(false);}
 };
 useEffect(()=>{
  const controller=new AbortController();
  setNow(Date.now());
  void refresh(controller.signal);
  const ticker=setInterval(()=>setNow(Date.now()),30000);
  const polling=setInterval(()=>void refresh(controller.signal),5*60000);
  return ()=>{controller.abort();clearInterval(ticker);clearInterval(polling);};
 },[]);
 const upcoming=(calendar?.events??[]).filter(e=>Date.parse(e["scheduledAt"])>now-15*60000).slice(0,20);
 const chosenEvent=upcoming.find(e=>e.id===eventId)??upcoming[0]??null;
 const market=marketsQ.data?.find(m=>m.symbol===selected && ["FOREX","METAL","INDEX"].includes(m.category));
 const related=!!chosenEvent?.affected.includes(selected);
 const runNewsScan=async()=>{
  setScanError("");setScanResult(null);
  if(!chosenEvent){setScanError("Select an upcoming verified release first.");return;}
  if(calendar?.stale){setScanError("Economic calendar is stale. Refresh the feed before scanning.");return;}
  if(!related){setScanError(selected+" is not listed as directly affected by "+chosenEvent.currency+" news. Choose an affected pair.");return;}
  if(!market){setScanError("This instrument is not currently available from the Deriv market feed. Its technical bias cannot be verified.");return;}
  if(!market.open){setScanError("This market is closed. No fresh technical scan can be produced.");return;}
  setScanning(true);
  try{
   const candles=await fetchCandles(market.derivSymbol,"H1");
   const snapshot=Date.now();
   const technical=deriveSignal(candles.map(c=>({time:c.time,value:c.close})),snapshot,market.open);
   if(!technical.actionable || technical.time===null){
    setScanError("Insufficient or stale completed H1 candles. No verified technical bias is available.");
    return;
   }
   setScanResult({eventId:chosenEvent.id,symbol:selected,checkedAt:snapshot,technicalBias:technical.direction,
    ema9:technical.ema9,ema21:technical.ema21,rsi:technical.rsi,note:technical.note,
    dataTime:technical.time,minutesToRelease:Math.round((Date.parse(chosenEvent.scheduledAt)-snapshot)/60000),
    fresh:technical.actionable,marketOpen:market.open});
  }catch{setScanError("Deriv candle scan failed. Try again when fresh market data is available.");}
  finally{setScanning(false);}
 };
 return <section className="space-y-5" aria-label="Economic pre-news monitor">
  <div className="rounded-xl border border-border bg-card/75 p-5 backdrop-blur">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h2 className="flex items-center gap-2 font-display text-xl font-bold"><CalendarClock className="h-5 w-5 text-primary"/> PRE-NEWS DETECTOR</h2>
    <p className="mt-1 text-xs text-muted-foreground">High-impact economic calendar · EAT (Uganda) · Telegram reminders 60 &amp; 15 minutes before releases</p></div>
    <button onClick={()=>{setLoading(true);void refresh();}} className="chip" disabled={loading}><RefreshCw className="inline h-4 w-4 mr-2"/>{loading?"Checking…":"Refresh"}</button>
   </div>
   <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"/>
    <p>Pre-release direction is <strong>unknown</strong>. An event time is verifiable; a future BUY/SELL direction is not. The displayed effects are conditional scenarios, not forecasts, trade calls or expected win rates. News spikes may reverse rapidly.</p>
   </div>
   {calendar?.stale&&<p role="alert" className="mt-3 text-sm text-amber-400">Calendar data is stale. Times may have changed; automatic reminders are paused until the feed updates.</p>}
   {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
   <div className="mt-3 text-xs text-muted-foreground">Coverage: {calendar?.coverage??"Calendar coverage not available"} · Source: <a className="underline text-primary" href={calendar?.sourceUrl??"https://xoomar.com/markets/calendar"} target="_blank" rel="noreferrer">{calendar?.source??"Unavailable"}</a> · Last source update: {calendar?.updatedAt?eat.format(new Date(calendar.updatedAt))+" EAT":"not verified"}. Consensus may not be available; check individual releases.</div>
  </div>
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
   <div className="space-y-3">
    <h3 className="font-semibold">Upcoming high-impact releases</h3>
    {loading&&!calendar&&<p className="text-sm text-muted-foreground">Loading verified releases…</p>}
    {!loading&&!error&&!upcoming.length&&<p className="text-sm text-muted-foreground">No upcoming verified events were returned for the covered period. This is not a complete global calendar.</p>}
    {upcoming.map(e=>{
     const mins=(Date.parse(e["scheduledAt"])-now)/60000;
     return <article key={e.id} className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-semibold text-amber-400">HIGH IMPACT · {e.currency}</span><span className="font-mono text-xs">{countdown(e["scheduledAt"],now)}</span></div>
      <h4 className="mt-1 font-semibold">{e.event}</h4>
      <p className="mt-2 text-sm"><strong>{eat.format(new Date(e["scheduledAt"]))} EAT</strong> <span className="text-muted-foreground">({utctime.format(new Date(e["scheduledAt"]))} UTC)</span></p>
      <p className="mt-1 text-xs text-muted-foreground">{e.period||"Scheduled release"} · Previous: {e.previous??"Not provided"} · Actual: {e.actual??"Pending"} · Consensus: {e.forecast??"Not provided"}</p>
      <p className="mt-2 text-xs">Potentially affected: {e.affected.slice(0,8).join(", ")}</p>
      <p className="mt-2 text-xs text-muted-foreground">{mins>60?"Monitor H1 / M15 before release":mins>0?"News proximity: volatility and spread risk elevated":"Wait for confirmed post-release candles"} · No pre-news trade direction</p>
     </article>;
    })}
   </div>
   <div className="space-y-3">
    <h3 className="font-semibold">Conditional impact by instrument</h3>
    <label htmlFor="pre-news-pair" className="text-xs text-muted-foreground">Choose a currency pair or market</label>
    <select id="pre-news-pair" value={selected} onChange={e=>setSelected(e.target.value)} className="w-full rounded-lg border border-border bg-card p-3 text-sm">
     {DISPLAY_PAIRS.map(p=><option key={p} value={p}>{p}</option>)}
    </select>
    <div className="rounded-xl border border-primary/30 bg-card/80 p-4">
     <h4 className="flex items-center gap-2 font-semibold"><Search className="h-4 w-4 text-primary"/> Scan news impact</h4>
     <label htmlFor="pre-news-event" className="mt-3 block text-xs text-muted-foreground">Select a news release</label>
     <select id="pre-news-event" value={chosenEvent?.id??""} onChange={e=>{setEventId(e.target.value);setScanResult(null);setScanError("");}} className="mt-1 w-full rounded-lg border border-border bg-card p-3 text-sm">
      {upcoming.length===0&&<option value="">No upcoming events</option>}
      {upcoming.map(e=><option key={e.id} value={e.id}>{e.currency} · {e.event} · {eat.format(new Date(e.scheduledAt))} EAT</option>)}
     </select>
     <p className="mt-3 text-xs text-muted-foreground">Affected pair: {related?"Yes, listed for this event":"Not listed"} · Deriv market: {market?(market.open?"Open":"Closed"):"Not supplied"}</p>
     <button type="button" className="scan-btn mt-3 w-full text-sm" onClick={()=>{void runNewsScan();}} disabled={scanning||loading||!chosenEvent||calendar?.stale===true||!related||!market?.open}>
       <Search className="mr-2 inline h-4 w-4"/>{scanning?"SCANNING CONFIRMED H1 CANDLES…":"SCAN "+selected+" FOR THIS NEWS"}
     </button>
     {scanError&&<p role="alert" className="mt-3 text-sm text-destructive">{scanError}</p>}
     {scanResult&&scanResult.eventId===chosenEvent?.id&&scanResult.symbol===selected&&
      <div className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm" aria-live="polite">
       <p className="font-semibold">Technical scan: {scanResult.technicalBias}</p>
       <p>Last completed H1 candle: {scanResult.dataTime?eat.format(new Date(scanResult.dataTime))+" EAT":"Unavailable"}</p>
       <p className="text-xs">EMA9: {scanResult.ema9?.toFixed(5)??"—"} · EMA21: {scanResult.ema21?.toFixed(5)??"—"} · RSI14: {scanResult.rsi?.toFixed(1)??"—"}</p>
       <p className="text-xs">{scanResult.note}</p>
       <p className="text-xs">{scanResult.minutesToRelease>0?"Release approximately "+scanResult.minutesToRelease+" minutes away.":"Release time reached or passed."} {scanResult.minutesToRelease<=60&&scanResult.minutesToRelease>0?"Avoid pre-release entries and the initial news spike.":""}</p>
       <p className="text-xs font-medium text-amber-400">This H1 technical bias is NOT a prediction of the news reaction. A release surprise can reverse the existing trend. Do not treat it as an entry signal.</p>
      </div>}
    </div>
    <div className="rounded-xl border border-border bg-card/70 p-4">
     <h4 className="font-semibold">{selected} · Scenario map</h4>
     <p className="mt-2 text-sm">{chosenEvent?.scenarios?.[selected]??"Direction depends on surprise, rates and risk sentiment. No directional forecast available."}</p>
     <p className="mt-3 text-xs text-muted-foreground">This describes a potential reaction after actual figures become available; the sign, size and duration are unknown beforehand.</p>
    </div>
    <div className="rounded-xl border border-border bg-card/70 p-4">
     <h4 className="font-semibold">Relevant analysis timeframes</h4>
     <p className="mt-2 text-sm">H1 / M15 — trend and structure ahead of release</p>
     <p className="mt-2 text-sm">M1 / M5 — immediate volatility; avoid guessing the first spike</p>
     <p className="mt-2 text-sm">M15 / H1 — wait for a closed candle and spread normalization</p>
     <p className="mt-3 text-xs text-muted-foreground">These are analysis windows, not a promised time for profitable entry or a news direction.</p>
    </div>
    <div className="flex gap-2 rounded-xl border border-border bg-card/70 p-4 text-sm">
     <BellRing className="h-5 w-5 shrink-0 text-primary"/><p>Telegram alerts are server-side. Subscribe to the bot with <code>/start</code>; use <code>/news</code> for the next scheduled releases. Channel posts require the bot's channel-posting permission.</p>
    </div>
   </div>
  </div>
 </section>;
}
