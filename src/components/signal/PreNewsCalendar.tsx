import { useEffect, useRef, useState } from "react";
import { NewsSignalCard } from "./NewsSignalCard";
import { AlertTriangle, BellRing, CalendarClock, RefreshCw, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
const NEWS_STATUS_URL = "https://tradepulse-telegram-service.davidmwesigwa71.workers.dev/news/status";
const FOREX_COM_CALENDAR_URL = "https://www.forex.com/en-uk/trading-platforms/economic-calendar/";
type DeliveryStatus={ready:boolean;activeSubscribers:number;recordedReminders:number;lastDeliveryAt:string|null;alertStages:string[]};
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
 const [resultsOpen,setResultsOpen]=useState(false);
 const [scannedEvent,setScannedEvent]=useState<Event|null>(null);
 const [autoEnabled,setAutoEnabled]=useState(false);
 const [deliveryStatus,setDeliveryStatus]=useState<DeliveryStatus|null>(null);
 const [browserAllowed,setBrowserAllowed]=useState(false);
 const [autoStage,setAutoStage]=useState<string|null>(null);
 const [newsNotices,setNewsNotices]=useState<{key:string;eventId:string;symbol:string;message:string;at:number;read:boolean}[]>([]);
 const seenNotices=useRef(new Set<string>());
 const scanInFlight=useRef(false);
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
 useEffect(()=>{
  let active=true;
  const check=async()=>{
   try{
    const r=await fetch(NEWS_STATUS_URL,{cache:"no-store"});
    if(!r.ok)throw Error("Status unavailable");
    const j=await r.json() as DeliveryStatus;
    if(active&&typeof j.activeSubscribers==="number")setDeliveryStatus(j);
   }catch{if(active)setDeliveryStatus(null);}
  };
  void check();const poll=setInterval(()=>void check(),300000);
  return ()=>{active=false;clearInterval(poll);};
 },[]);
 const upcoming=(calendar?.events??[]).filter(e=>Date.parse(e["scheduledAt"])>now-15*60000).slice(0,20);
 const chosenEvent=upcoming.find(e=>e.id===eventId)??upcoming[0]??null;
 const market=marketsQ.data?.find(m=>m.symbol===selected && ["FOREX","METAL","INDEX"].includes(m.category));
 const related=!!chosenEvent?.affected.includes(selected);
 const runNewsScan=async(eventOverride?:Event,symbolOverride?:string,auto=false,stage:string|null=null)=>{
  if(scanInFlight.current)return;
  const targetEvent=eventOverride??chosenEvent;
  const targetSymbol=symbolOverride??selected;
  const targetMarket=marketsQ.data?.find(m=>m.symbol===targetSymbol&&["FOREX","METAL","INDEX"].includes(m.category));
  setAutoStage(auto?stage:null);
  setScannedEvent(targetEvent);
  setResultsOpen(true);
  setScanError("");setScanResult(null);
  if(!targetEvent){setScanError("Select an upcoming verified release first.");return;}
  if(calendar?.stale){setScanError("Economic calendar is stale. Refresh the feed before scanning.");return;}
  if(!targetMarket){setScanError("This instrument is not currently available from the Deriv market feed. Its technical bias cannot be verified.");return;}
  if(!targetMarket.open){setScanError("This market is closed. No fresh technical scan can be produced.");return;}
  scanInFlight.current=true;
  setScanning(true);
  try{
   const candles=await fetchCandles(targetMarket.derivSymbol,"H1");
   const snapshot=Date.now();
   const technical=deriveSignal(candles.map(c=>({time:c.time,value:c.close})),snapshot,targetMarket.open);
   if(!technical.actionable || technical.time===null){
    setScanError("Insufficient or stale completed H1 candles. No verified technical bias is available.");
    return;
   }
   setScanResult({eventId:targetEvent.id,symbol:targetSymbol,checkedAt:snapshot,technicalBias:technical.direction,
    ema9:technical.ema9,ema21:technical.ema21,rsi:technical.rsi,note:technical.note,
    dataTime:technical.time,minutesToRelease:Math.round((Date.parse(targetEvent.scheduledAt)-snapshot)/60000),
    fresh:technical.actionable,marketOpen:targetMarket.open});
  }catch{setScanError("Deriv candle scan failed. Try again when fresh market data is available.");}
  finally{scanInFlight.current=false;setScanning(false);}
 };
 useEffect(()=>{
  try {
   setAutoEnabled(localStorage.getItem("apex-news-auto-inapp-v1")!=="off");
   const history=JSON.parse(localStorage.getItem("apex-news-inapp-history-v1")??"[]");
   const notices=Array.isArray(history)?history.filter((v):v is {key:string;eventId:string;symbol:string;message:string;at:number;read:boolean}=>v&&typeof v.key==="string"&&typeof v.message==="string"&&typeof v.symbol==="string"&&typeof v.eventId==="string"&&typeof v.at==="number"&&typeof v.read==="boolean").slice(0,40):[];
   setNewsNotices(notices);
   seenNotices.current=new Set(notices.map(v=>v.key));
  }catch{/* Storage can be blocked in private mode. */}
  setBrowserAllowed(typeof Notification!=="undefined"&&Notification.permission==="granted");
 },[]);
 useEffect(()=>{
  if(!autoEnabled||!calendar||calendar.stale||!calendar.events.length||!now||scanInFlight.current)return;
  const upcomingAlert=calendar.events.find(event=>{
   const mins=(Date.parse(event.scheduledAt)-now)/60000;
   const stage=mins>0&&mins<=15?"15m":mins>15&&mins<=60?"60m":null;
   return stage!==null&&!seenNotices.current.has(event.id+":"+stage);
  });
  if(!upcomingAlert)return;
  const mins=(Date.parse(upcomingAlert.scheduledAt)-now)/60000;
  const stage=mins<=15?"15m":"60m";
  const key=upcomingAlert.id+":"+stage;
  seenNotices.current.add(key);
  const target=upcomingAlert.affected.includes(selected)?selected:
    upcomingAlert.affected.find(x=>DISPLAY_PAIRS.includes(x))??selected;
  const message=upcomingAlert.currency+" "+upcomingAlert.event+" in "+Math.ceil(mins)+" min · "+target+" · direction unconfirmed";
  setNewsNotices(prev=>{
   const next=[{key,eventId:upcomingAlert.id,symbol:target,message,at:now,read:false},...prev].slice(0,40);
   try{localStorage.setItem("apex-news-inapp-history-v1",JSON.stringify(next));}catch{}
   return next;
  });
  if(typeof Notification!=="undefined"&&Notification.permission==="granted"){
   try{new Notification("APEX Pre-News · "+stage+" warning",{body:message,tag:key});}catch{}
  }
  void runNewsScan(upcomingAlert,target,true,stage);
 // Re-evaluate only as the calendar/time changes; the in-flight ref and persisted IDs prevent duplicate alerts.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[autoEnabled,calendar,now,selected,marketsQ.data]);
 const toggleAuto=()=>{
  setAutoEnabled(current=>{
   const next=!current;
   try{localStorage.setItem("apex-news-auto-inapp-v1",next?"on":"off");}catch{}
   return next;
  });
 };
 const allowBrowser=async()=>{
  if(typeof Notification==="undefined")return;
  try{setBrowserAllowed(await Notification.requestPermission()==="granted");}catch{}
 };
 const markNoticesRead=()=>{
  setNewsNotices(prev=>{
   const next=prev.map(x=>({...x,read:true}));
   try{localStorage.setItem("apex-news-inapp-history-v1",JSON.stringify(next));}catch{}
   return next;
  });
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
   <div className="mt-4 flex flex-wrap items-center gap-2">
    <button type="button" onClick={toggleAuto}
      className={"rounded-lg border px-3 py-2 text-xs font-bold "+(autoEnabled?"border-emerald-500/50 bg-emerald-500/10 text-emerald-500":"border-border bg-card text-muted-foreground")}>
      {autoEnabled?"🔔 AUTO PRE-NEWS ALERTS ON":"🔕 ENABLE AUTO PRE-NEWS ALERTS"}
    </button>
    <button type="button" onClick={()=>{void allowBrowser();}} disabled={browserAllowed}
      className="rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50">
      {browserAllowed?"Browser notifications enabled":"Enable browser notifications"}
    </button>
    <span className="text-xs text-muted-foreground">In-app popup only while this page is open · Telegram reminders run separately on Cloudflare</span>
   </div>
   <div className="mt-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center gap-3">
      <span>Telegram delivery: {deliveryStatus?.ready?"configured":"not verified"}</span>
      <span>Active subscribers: {deliveryStatus?.activeSubscribers??"—"}</span>
      <span>Recorded news deliveries: {deliveryStatus?.recordedReminders??"—"}</span>
      <span>Latest delivery: {deliveryStatus?.lastDeliveryAt?eat.format(new Date(deliveryStatus.lastDeliveryAt))+" EAT":"none recorded"}</span>
    </div>
    <p className="mt-2">Telegram checks every five minutes. A verified 07:00 EAT daily briefing plus T-60/T-15 reminders are separate from browser alerts. <a className="text-primary underline" href={FOREX_COM_CALENDAR_URL} target="_blank" rel="noreferrer">Compare with FOREX.com weekly calendar</a> (editorial reference, not the automated feed).</p>
   </div>
   {newsNotices.length>0&&<div className="mt-4 rounded-xl border border-primary/20 bg-card/70 p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">🔔 PRE-NEWS ALERT INBOX ({newsNotices.filter(x=>!x.read).length} new)</h3>
      <button type="button" onClick={markNoticesRead} className="text-xs text-primary underline">Mark read</button></div>
    <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
     {newsNotices.slice(0,8).map(notice=><button type="button" key={notice.key} onClick={()=>{
       const event=calendar?.events.find(e=>e.id===notice.eventId);
       if(event){void runNewsScan(event,notice.symbol,true,notice.key.split(":").at(-1)??null);}
      }} className="block w-full rounded-lg bg-background p-2 text-left text-xs hover:bg-muted">
       <span className="font-semibold">{notice.read?"":"● "}{notice.message}</span>
       <span className="ml-2 text-muted-foreground">{eat.format(new Date(notice.at))} EAT</span>
      </button>)}
    </div>
   </div>}
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
    <button type="button" onClick={()=>{void runNewsScan();}}
      disabled={scanning||loading||!chosenEvent||calendar?.stale===true}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-4 text-base font-bold tracking-wide text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
      <Search className="h-5 w-5" />{scanning?"SCANNING NEWS…":"SCAN NEWS NOW — "+selected}
    </button>
    <p className="text-xs text-muted-foreground">Scans the next selected high-impact release and confirmed Deriv H1 candles. Pair impact may be indirect; news direction cannot be predicted.</p>
    <div className="rounded-xl border border-primary/30 bg-card/80 p-4">
     <h4 className="flex items-center gap-2 font-semibold"><Search className="h-4 w-4 text-primary"/> Scan news impact</h4>
     <label htmlFor="pre-news-event" className="mt-3 block text-xs text-muted-foreground">Select a news release</label>
     <select id="pre-news-event" value={chosenEvent?.id??""} onChange={e=>{setEventId(e.target.value);setScanResult(null);setScanError("");}} className="mt-1 w-full rounded-lg border border-border bg-card p-3 text-sm">
      {upcoming.length===0&&<option value="">No upcoming events</option>}
      {upcoming.map(e=><option key={e.id} value={e.id}>{e.currency} · {e.event} · {eat.format(new Date(e.scheduledAt))} EAT</option>)}
     </select>
     <p className="mt-3 text-xs text-muted-foreground">News impact: {related?"Directly listed":"Indirect / not listed"} · Deriv market: {market?(market.open?"Open":"Closed"):"Not supplied"}</p>
     <button type="button" className="scan-btn mt-3 w-full text-sm" onClick={()=>{void runNewsScan();}} disabled={scanning||loading||!chosenEvent||calendar?.stale===true}>
       <Search className="mr-2 inline h-4 w-4"/>{scanning?"SCANNING CONFIRMED H1 CANDLES…":"SCAN "+selected+" FOR THIS NEWS"}
     </button>

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
  <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
   <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto rounded-2xl border-border bg-background p-4 shadow-2xl sm:p-6">
    <DialogTitle className="font-display text-xl font-black">APEX · PRE-NEWS SIGNAL ANALYSIS</DialogTitle>
    <DialogDescription>Live pre-release watch and historical H1 technical conditions. Not a confirmed news prediction.</DialogDescription>
    <NewsSignalCard event={scannedEvent} symbol={scanResult?.symbol??selected} scan={scanResult}
      busy={scanning} error={scanError} automatic={autoStage!==null} stage={autoStage}/>
    <button type="button" className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground" onClick={()=>setResultsOpen(false)}>CLOSE ANALYSIS</button>
   </DialogContent>
  </Dialog>
 </section>;
}
