import { AlertTriangle, CalendarClock, TrendingDown, TrendingUp, ShieldAlert, Activity } from "lucide-react";
export type NewsCardEvent = {
 id:string;event:string;currency:string;impact:string;scheduledAt:string;
 forecast:string|number|null;previous:string|number|null;actual:string|number|null;
 affected:string[];scenarios:Record<string,string>;source:string;
};
export type NewsCardScan = {
 symbol:string;technicalBias:string;ema9:number|null;ema21:number|null;rsi:number|null;
 checkedAt:number;dataTime:number|null;note:string;minutesToRelease:number;
};
const eat=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",dateStyle:"medium",timeStyle:"short"});
function directionLabel(bias:string|null){
 return bias==="BULLISH"?"BULLISH TREND":bias==="BEARISH"?"BEARISH TREND":"WAIT — NO TRADE";
}
/** Same factual card used for manual results and scheduled in-app reminders. */
export function NewsSignalCard({event,symbol,scan,busy,error,automatic,stage}:{
 event:NewsCardEvent|null;symbol:string;scan:NewsCardScan|null;
 busy:boolean;error:string;automatic:boolean;stage:string|null;
}){
 const bias=scan?.technicalBias??null;
 const directional=bias==="BULLISH"||bias==="BEARISH";
 const releaseTime=event?Date.parse(event.scheduledAt):null;
 const mins=releaseTime==null?null:Math.ceil((releaseTime-Date.now())/60000);
 const extraRisk=mins!==null&&mins<=15&&mins>=0;
 const tone=directional?(bias==="BEARISH"?"text-rose-600 dark:text-rose-300":"text-emerald-700 dark:text-emerald-300"):"text-amber-600 dark:text-amber-300";
 return <div className="space-y-4 text-sm">
  <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-md">
   <div className={"p-5 sm:p-6 "+(directional?(bias==="BEARISH"?"bg-rose-500/10":"bg-emerald-500/10"):"bg-amber-500/10")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div className="flex min-w-0 items-start gap-3">
      <div className="rounded-xl bg-background/70 p-2">{directional?(bias==="BEARISH"?<TrendingDown className="h-6 w-6 text-rose-500"/>:<TrendingUp className="h-6 w-6 text-emerald-500"/>):<Activity className="h-6 w-6 text-amber-500"/>}</div>
      <div>
       <p className="text-xs font-bold tracking-[0.15em] text-muted-foreground">{automatic?"AUTOMATIC PRE-NEWS ALERT":"APEX PRE-NEWS SCAN"}</p>
       <h3 className={"mt-1 text-2xl font-black tracking-tight "+tone}>{busy?"SCANNING…":error?"DATA UNAVAILABLE":directionLabel(bias)}</h3>
       <p className="font-semibold">{symbol} · {event?.currency??"NEWS"} PRE-RELEASE</p>
      </div>
     </div>
     <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-right">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">News direction probability</p>
      <p className="text-lg font-black">Not established</p>
      <p className="max-w-[12rem] text-[10px] text-muted-foreground">No validated probability model</p>
     </div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Existing H1 technical conditions only — not a confirmed news BUY/SELL prediction.</p>
   </div>
   <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
    <div className="rounded-lg bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">Bias</p><p className={"mt-1 font-bold "+tone}>{directional?bias:"WAIT"}</p></div>
    <div className="rounded-lg bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">Volatility</p><p className="mt-1 font-bold text-amber-600 dark:text-amber-300">POTENTIALLY HIGH</p></div>
    <div className="rounded-lg bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">News risk</p><p className="mt-1 font-bold">{extraRisk?"VERY HIGH":"ELEVATED"}</p></div>
    <div className="rounded-lg bg-muted/50 p-3"><p className="text-[10px] uppercase text-muted-foreground">Expected move</p><p className="mt-1 font-bold">Not estimated</p></div>
   </div>
  </div>
  <section className="rounded-xl border border-border bg-card p-4">
   <h4 className="flex items-center gap-2 font-bold"><CalendarClock className="h-4 w-4 text-primary"/> Economic event</h4>
   <p className="mt-2 font-semibold">{event?.event??"No verified event"}</p>
   {event&&<p className="mt-1">{eat.format(new Date(event.scheduledAt))} EAT · {mins!==null&&mins>0?mins+" minutes until release":"Release time reached"}</p>}
   {stage&&<p className="mt-1 text-xs text-primary">Automated reminder: {stage} pre-release window</p>}
   <p className="mt-2 text-xs text-muted-foreground">Previous: {event?.previous??"—"} · Consensus: {event?.forecast??"—"} · Actual: {event?.actual??"Pending"}</p>
  </section>
  {busy&&<p role="status" className="rounded-xl border border-primary/30 bg-primary/10 p-4">Checking completed Deriv H1 candles…</p>}
  {!busy&&error&&<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">No verified technical result: {error}. No trade recommendation was generated.</p>}
  {!busy&&scan&&<section className="rounded-xl border border-border bg-card p-4">
   <h4 className="font-bold">H1 technical analysis</h4>
   <div className="mt-3 grid grid-cols-3 gap-2 text-center">
    {([["EMA 9",scan.ema9?.toFixed(5)??"—"],["EMA 21",scan.ema21?.toFixed(5)??"—"],["RSI 14",scan.rsi?.toFixed(1)??"—"]] as const).map(([k,v])=><div key={k} className="rounded-lg bg-muted/50 p-2"><p className="text-[10px] text-muted-foreground">{k}</p><p className="mt-1 font-semibold">{v}</p></div>)}
   </div>
   <p className="mt-3">{scan.note}</p>
   <p className="mt-2 text-xs text-muted-foreground">H1 closed at {scan.dataTime?eat.format(new Date(scan.dataTime))+" EAT":"unavailable"}.</p>
  </section>}
  <section className="rounded-xl border border-border bg-card p-4">
   <h4 className="font-bold">Possible news impact · {symbol}</h4>
   <p className="mt-2">{event?.scenarios[symbol]??"The effect may be indirect. Actual direction depends on the released surprise, market expectations and rates."}</p>
   <p className="mt-2 text-xs text-muted-foreground">Potentially affected: {event?.affected.slice(0,8).join(", ")??"Not available"}</p>
  </section>
  <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
   <h4 className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300"><ShieldAlert className="h-4 w-4"/> News-trading risk &amp; timeframe</h4>
   <p className="mt-2">Before release: H1 / M15 context. At release: M1 / M5 volatility. Wait for a confirmed M15 close and normalized spreads before evaluating a setup.</p>
   <p className="mt-2 font-medium">Avoid assuming the first spike will continue. No verified entry, stop loss, take profit or win probability is available from this pre-news scan.</p>
  </section>
  <p className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 shrink-0"/> The technical bias may reverse at release. Only the calendar time and historical technical measurements are observations; future direction is unknown.</p>
 </div>;
}
