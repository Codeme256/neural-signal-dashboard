import { useEffect, useState } from "react";
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
  setScannedEvent(chosenEvent);
  setResultsOpen(true);
  setScanError("");setScanResult(null);
  if(!chosenEvent){setScanError("Select an upcoming verified release first.");return;}
  if(calendar?.stale){setScanError("Economic calendar is stale. Refresh the feed before scanning.");return;}
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
   <DialogContent className="max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto border-primary/40 bg-background p-5 sm:p-7">
    <DialogTitle className="font-display text-xl font-bold text-primary">APEX · PRE-NEWS SCAN RESULT</DialogTitle>
    <DialogDescription>Verified calendar context + last completed Deriv H1 candles. Technical bias is not a prediction of the release.</DialogDescription>
    <div className="space-y-4 text-sm">
     <div className="rounded-lg border border-border bg-card/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
       <span className="font-semibold">{scanResult?.symbol??selected}</span>
       <span className="text-xs font-semibold text-amber-400">{scannedEvent?.impact??"HIGH"} IMPACT · {scannedEvent?.currency??"NEWS"}</span>
      </div>
      <p className="mt-2 font-medium">{scannedEvent?.event??"No event selected"}</p>
      {scannedEvent&&<p className="mt-1 text-muted-foreground">Release: {eat.format(new Date(scannedEvent.scheduledAt))} EAT ({utctime.format(new Date(scannedEvent.scheduledAt))} UTC)</p>}
      <p className="mt-1 text-xs text-muted-foreground">Previous: {scannedEvent?.previous??"Not reported"} · Consensus: {scannedEvent?.forecast??"Not reported"} · Actual: {scannedEvent?.actual??"Pending"}</p>
     </div>
     {scanning&&<div role="status" className="rounded-lg border border-primary/30 bg-primary/10 p-4">
      <RefreshCw className="mr-2 inline h-4 w-4 animate-spin"/>Scanning the latest completed H1 candles…
     </div>}
     {!scanning&&scanError&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
       <p className="font-semibold text-destructive">NO VERIFIED SIGNAL — SCAN UNAVAILABLE</p>
       <p className="mt-2">{scanError}</p>
       <p className="mt-2 text-xs text-muted-foreground">No direction or entry is provided when data is stale, a market is closed, or the source fails.</p>
      </div>}
     {!scanning&&scanResult&&
      <>
       <div className="rounded-lg border border-border bg-card/80 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Existing H1 technical bias — not news prediction</p>
        <p className={"mt-2 text-2xl font-bold "+(scanResult.technicalBias==="BULLISH"?"text-emerald-400":scanResult.technicalBias==="BEARISH"?"text-red-400":"text-amber-400")}>
         {scanResult.technicalBias==="BULLISH"?"BULLISH TECHNICAL BIAS":scanResult.technicalBias==="BEARISH"?"BEARISH TECHNICAL BIAS":"WAIT / NO TRADE"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Checked {eat.format(new Date(scanResult.checkedAt))} EAT · Last completed H1 close: {scanResult.dataTime?eat.format(new Date(scanResult.dataTime))+" EAT":"Unavailable"}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
         <div className="rounded-md bg-background p-3"><p className="text-xs text-muted-foreground">EMA 9</p><strong>{scanResult.ema9?.toFixed(5)??"—"}</strong></div>
         <div className="rounded-md bg-background p-3"><p className="text-xs text-muted-foreground">EMA 21</p><strong>{scanResult.ema21?.toFixed(5)??"—"}</strong></div>
         <div className="rounded-md bg-background p-3"><p className="text-xs text-muted-foreground">RSI 14</p><strong>{scanResult.rsi?.toFixed(1)??"—"}</strong></div>
        </div>
        <p className="mt-3">{scanResult.note}</p>
       </div>
       <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="font-semibold text-amber-400">News proximity &amp; execution risk</p>
        <p className="mt-2">{scanResult.minutesToRelease>0?"Approximately "+scanResult.minutesToRelease+" minutes until release.":"Scheduled release time reached or passed."}</p>
        <p className="mt-2">H1/M15: pre-release structure · M1/M5: volatile reaction · M15/H1: wait for a post-release close.</p>
        <p className="mt-2">Spreads and slippage may widen substantially. No entry price, SL or TP is generated by this news scan.</p>
       </div>
      </>
     }
     {scannedEvent&&<div className="rounded-lg border border-border bg-card/80 p-4">
      <p className="font-semibold">Possible news impact · {scanResult?.symbol??selected}</p>
      <p className="mt-2">{scannedEvent.scenarios[scanResult?.symbol??selected]??"Impact may be indirect; actual direction depends on data surprise, yields and market reaction."}</p>
      <p className="mt-2 text-xs text-muted-foreground">Affected instruments: {scannedEvent.affected.slice(0,12).join(", ")}</p>
     </div>}
     <p className="text-xs font-medium text-amber-400">A directional technical reading is not a confirmed BUY or SELL trade signal. There is no reliable way to know exact news-driven direction in advance.</p>
     <button type="button" onClick={()=>setResultsOpen(false)} className="w-full rounded-lg border border-border bg-card px-4 py-3 font-semibold hover:bg-accent">CLOSE ANALYSIS</button>
    </div>
   </DialogContent>
  </Dialog>
 </section>;
}
