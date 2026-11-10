import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, RefreshCw } from "lucide-react";

type Event = {
  id:string;event:string;currency:"USD";impact:string;country:string;
  scheduledAt:string;period:string;previous:number|null;actual:number|null;
  forecast:number|null;unit:string|null;source:string;sourceUrl:string;
  affected:string[];scenarios:Record<string,string>;
  direction:string;timeframes:{preparation:string;volatility:string;confirmation:string};
};
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
 return <section className="space-y-5" aria-label="Economic pre-news monitor">
  <div className="rounded-xl border border-border bg-card/75 p-5 backdrop-blur">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h2 className="flex items-center gap-2 font-display text-xl font-bold"><CalendarClock className="h-5 w-5 text-primary"/> PRE-NEWS DETECTOR</h2>
    <p className="mt-1 text-xs text-muted-foreground">Live high-impact U.S. economic calendar · EAT (Uganda) · Telegram reminders 60 &amp; 15 minutes before releases</p></div>
    <button onClick={()=>{setLoading(true);void refresh();}} className="chip" disabled={loading}><RefreshCw className="inline h-4 w-4 mr-2"/>{loading?"Checking…":"Refresh"}</button>
   </div>
   <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"/>
    <p>Pre-release direction is <strong>unknown</strong>. An event time is verifiable; a future BUY/SELL direction is not. The displayed effects are conditional scenarios, not forecasts, trade calls or expected win rates. News spikes may reverse rapidly.</p>
   </div>
   {calendar?.stale&&<p role="alert" className="mt-3 text-sm text-amber-400">Calendar data is stale. Times may have changed; automatic reminders are paused until the feed updates.</p>}
   {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
   <div className="mt-3 text-xs text-muted-foreground">Coverage: U.S. major releases only · Source: <a className="underline text-primary" href="https://xoomar.com/markets/calendar" target="_blank" rel="noreferrer">XOOMAR</a> (official U.S. agency schedules) · Last source update: {calendar?.updatedAt?eat.format(new Date(calendar.updatedAt))+" EAT":"not verified"}. No consensus forecast available from this feed.</div>
  </div>
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
   <div className="space-y-3">
    <h3 className="font-semibold">Upcoming high-impact releases</h3>
    {loading&&!calendar&&<p className="text-sm text-muted-foreground">Loading verified releases…</p>}
    {!loading&&!error&&!upcoming.length&&<p className="text-sm text-muted-foreground">No upcoming events were returned for the covered period; this is not a complete global economic calendar.</p>}
    {upcoming.map(e=>{
     const mins=(Date.parse(e["scheduledAt"])-now)/60000;
     return <article key={e.id} className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-semibold text-amber-400">HIGH IMPACT · USD</span><span className="font-mono text-xs">{countdown(e["scheduledAt"],now)}</span></div>
      <h4 className="mt-1 font-semibold">{e.event}</h4>
      <p className="mt-2 text-sm"><strong>{eat.format(new Date(e["scheduledAt"]))} EAT</strong> <span className="text-muted-foreground">({utctime.format(new Date(e["scheduledAt"]))} UTC)</span></p>
      <p className="mt-1 text-xs text-muted-foreground">{e.period||"Scheduled release"} · Previous: {e.previous??"Not provided"} · Actual: {e.actual??"Pending"} · Consensus: not available</p>
      <p className="mt-2 text-xs">Potentially affected: EURUSD, GBPUSD, USDJPY, XAUUSD, DXY, U.S. equity indices</p>
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
    <div className="rounded-xl border border-border bg-card/70 p-4">
     <h4 className="font-semibold">{selected} · Scenario map</h4>
     <p className="mt-2 text-sm">{upcoming[0]?.scenarios?.[selected]??"Direction depends on surprise, rates and risk sentiment. No directional forecast available."}</p>
     <p className="mt-3 text-xs text-muted-foreground">This describes potential reaction **after** actual figures become available; the sign, size and duration are unknown beforehand.</p>
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
