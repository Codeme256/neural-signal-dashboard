import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DerivMarket } from "@/lib/deriv-data";
import { ALERT_BATCH_SIZE, ALERT_INTERVAL_MS, ALERT_TF, checkStrongAlerts, type StrongAlert } from "@/lib/automatic-alerts";

const ACTIVE_KEY="tradepulse-monitor-active-v1";
const BROWSER_KEY="tradepulse-browser-notifications-v1";
const seenKey=(uid:string)=>"tradepulse-alert-seen-v1:"+uid;
const remember=(uid:string,id:string)=>{
  try{
    const key=seenKey(uid),ids=JSON.parse(localStorage.getItem(key)||"[]") as string[];
    if(ids.includes(id))return false;
    localStorage.setItem(key,JSON.stringify([id,...ids].slice(0,500)));
  }catch{return true;}
  return true;
};
const numberText=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:5});
async function authedRequest(method:string,path:string,body?:unknown):Promise<Record<string,unknown>>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)throw Error("Sign in to configure Telegram.");
 const response=await fetch(path,{
  method,credentials:"same-origin",headers:{"Authorization":`Bearer ${session.access_token}`,"Content-Type":"application/json"},
  ...(body==null?{}:{body:JSON.stringify(body)}),
 });
 const json=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(!response.ok)throw Error(typeof json['error']==="string"?json['error']:`Request failed (${response.status})`);
 return json;
}
export function SignalAlertCenter({markets}:{markets:DerivMarket[]}){
 const [enabled,setEnabled]=useState(()=>typeof window!=="undefined"&&localStorage.getItem(ACTIVE_KEY)==="true");
 const [desktop,setDesktop]=useState(()=>typeof window!=="undefined"&&localStorage.getItem(BROWSER_KEY)==="true");
 const [showSettings,setShowSettings]=useState(false);
 const [status,setStatus]=useState("Not checked");
 const [last,setLast]=useState<StrongAlert|null>(null);
 const [token,setToken]=useState("");
 const [chatId,setChatId]=useState("");
 const [telegramConfigured,setTelegramConfigured]=useState(false);
 const [telegramEnabled,setTelegramEnabled]=useState(false);
 const [busy,setBusy]=useState(false);
 const cursor=useRef(0);
 const running=useRef(false);
 const marketsRef=useRef(markets);marketsRef.current=markets;
 const run=useCallback(async(signal:AbortSignal)=>{
   if(running.current||signal.aborted||document.visibilityState!=="visible"||!navigator.onLine)return;
   running.current=true;
   try{
     const {data:{user}}=await supabase.auth.getUser();
     if(!user)return;
     const available=marketsRef.current.filter(m=>m.open);
     if(!available.length){setStatus("No open markets; nothing to alert");return;}
     const start=cursor.current%available.length;
     const batch=Array.from({length:Math.min(ALERT_BATCH_SIZE,available.length)},(_,i)=>available[(start+i)%available.length]!);
     cursor.current=(start+batch.length)%available.length;
     setStatus(`Checking ${batch.length} of ${available.length} open markets`);
     const alerts=await checkStrongAlerts(batch,ALERT_TF,signal);
     if(signal.aborted)return;
     let emitted=0;
     for(const alert of alerts){
       if(!remember(user.id,alert.id))continue;
       emitted++;
       setLast(alert);
       toast.success(`${alert.direction} · ${alert.symbol} · ${alert.timeframe}`,{
         description:`${alert.strategy} · Entry ${numberText(alert.entry)} · SL ${numberText(alert.stopLoss)} · TP ${numberText(alert.tp1)}`,
         duration:20000,
       });
       if(desktop&&"Notification" in window&&Notification.permission==="granted"){
         const n=new Notification(`TradePulse ${alert.direction}: ${alert.symbol}`,{
           body:`${alert.strategy} · Entry ${numberText(alert.entry)} · SL ${numberText(alert.stopLoss)} · TP1 ${numberText(alert.tp1)}`,
           tag:alert.id,
         });
         n.onclick=()=>{window.focus();n.close();};
       }
       if(telegramConfigured&&telegramEnabled){
         void authedRequest("POST","/api/signal-alerts/telegram/send",{alert}).catch((e:Error)=>toast.error("Telegram alert could not be delivered",{description:e.message}));
       }
     }
     setStatus(`Checked ${batch.length} markets · ${emitted} new strong signals · ${new Date().toLocaleTimeString()}`);
   }catch(e){if(!signal.aborted)setStatus(e instanceof Error?e.message:"Monitoring unavailable");}
   finally{running.current=false;}
 },[desktop,telegramConfigured,telegramEnabled]);

 useEffect(()=>{
   let cancelled=false;
   void authedRequest("GET","/api/signal-alerts/telegram").then(x=>{
     if(cancelled)return;setTelegramConfigured(x['configured']===true);setTelegramEnabled(x['enabled']===true);
     if(typeof x['chatId']==="string")setChatId(x['chatId']);
   }).catch(()=>{});
   return()=>{cancelled=true;};
 },[]);
 useEffect(()=>{
   if(!enabled)return;
   const ctrl=new AbortController();
   void run(ctrl.signal);
   const timer=window.setInterval(()=>{void run(ctrl.signal);},ALERT_INTERVAL_MS);
   const visible=()=>{if(document.visibilityState==="visible")void run(ctrl.signal);};
   document.addEventListener("visibilitychange",visible);
   return()=>{ctrl.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
 },[enabled,run]);

 const toggle=()=>setEnabled(v=>{const next=!v;localStorage.setItem(ACTIVE_KEY,String(next));return next;});
 const browser=async()=>{
   if(!("Notification" in window)){toast.error("Browser notifications are not supported here");return;}
   if(desktop){setDesktop(false);localStorage.setItem(BROWSER_KEY,"false");return;}
   const permission=await Notification.requestPermission();
   if(permission!=="granted"){toast.error("Browser notification permission not granted");return;}
   setDesktop(true);localStorage.setItem(BROWSER_KEY,"true");
 };
 const save=async()=>{
   setBusy(true);
   try{
     const out=await authedRequest("PUT","/api/signal-alerts/telegram",{botToken:token,chatId,enabled:true});
     setTelegramConfigured(out['configured']===true);setTelegramEnabled(out['enabled']===true);setToken("");
     toast.success("Telegram settings saved securely");
   }catch(e){toast.error("Telegram setup failed",{description:e instanceof Error?e.message:"Server unavailable"});}
   finally{setBusy(false);}
 };
 const test=async()=>{
   setBusy(true);
   try{await authedRequest("POST","/api/signal-alerts/telegram/test",{});toast.success("Telegram test sent. Check the channel.");}
   catch(e){toast.error("Telegram test failed",{description:e instanceof Error?e.message:"Unknown error"});}
   finally{setBusy(false);}
 };
 const disconnect=async()=>{
   setBusy(true);
   try{await authedRequest("DELETE","/api/signal-alerts/telegram");setTelegramConfigured(false);setTelegramEnabled(false);setChatId("");setToken("");toast.success("Telegram disconnected");}
   catch(e){toast.error("Unable to disconnect Telegram",{description:e instanceof Error?e.message:"Server unavailable"});}
   finally{setBusy(false);}
 };
 return <section className="mt-6 rounded-xl border border-border bg-card/60 p-4 backdrop-blur" aria-label="Automatic signal notifications">
   <div className="flex flex-wrap items-center justify-between gap-3">
     <div>
       <h2 className="font-display text-lg font-bold">🔔 AUTOMATIC SIGNAL ALERTS</h2>
       <p className="mt-1 font-mono text-xs text-muted-foreground">Scans M15 candles automatically every 5 minutes while this dashboard stays open · 8 markets per cycle</p>
     </div>
     <div className="flex flex-wrap gap-2">
       <button type="button" onClick={toggle} className="chip" aria-pressed={enabled}>{enabled?"● AUTO MONITOR ON":"○ START AUTO MONITOR"}</button>
       <button type="button" onClick={()=>setShowSettings(v=>!v)} className="chip" aria-expanded={showSettings}>⚙ NOTIFICATIONS</button>
     </div>
   </div>
   <p role="status" className="mt-2 font-mono text-xs text-muted-foreground">{enabled?status:"Monitoring off"} · {telegramConfigured?"Telegram configured":"Telegram not configured"}</p>
   {last&&<div className="mt-3 rounded-lg border border-primary/40 p-3 font-mono text-xs">
     <strong className="text-primary">LATEST STRONG SIGNAL: {last.direction} · {last.symbol} · {last.timeframe}</strong>
     <p className="mt-1">{last.strategy} · Entry {numberText(last.entry)} · SL {numberText(last.stopLoss)} · TP1 {numberText(last.tp1)} · TP2 {numberText(last.tp2)} · R:R 1:{last.rr}</p>
     <p className="mt-1 text-muted-foreground">Completed candle: {new Date(last.candleTime).toLocaleString()}</p>
   </div>}
   {showSettings&&<div className="mt-4 grid gap-4 rounded-lg border border-border bg-background/50 p-4">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={desktop} onChange={()=>void browser()}/> Enable browser pop-up notifications</label>
     <div className="space-y-2">
       <h3 className="font-display font-bold">Telegram channel alerts</h3>
       <p className="text-xs text-muted-foreground">The bot must be an administrator of your channel with permission to post. Your bot token is sent to the authenticated server, encrypted at rest, and never returned to this browser.</p>
       <label className="block text-xs">Bot token (only when setting or replacing)
         <input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder={telegramConfigured?"Leave blank to keep existing token":"123456789:AA..."} className="mt-1 w-full rounded border border-border bg-background p-2 font-mono text-sm"/>
       </label>
       <label className="block text-xs">Channel ID (e.g. -100… or @channel_username)
         <input type="text" autoComplete="off" value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="@your_channel" className="mt-1 w-full rounded border border-border bg-background p-2 font-mono text-sm"/>
       </label>
       <div className="flex flex-wrap gap-2">
         <button disabled={busy||!chatId.trim()||(!telegramConfigured&&!token)} onClick={()=>void save()} className="chip chip-active">SAVE TELEGRAM</button>
         <button disabled={busy||!telegramConfigured} onClick={()=>void test()} className="chip">SEND TEST</button>
         <button disabled={busy||!telegramConfigured} onClick={()=>void disconnect()} className="chip">DISCONNECT</button>
       </div>
       <p className="text-xs text-muted-foreground">Telegram delivery requires the Cloudflare server secrets and database migration described in the project setup guide. If your browser is closed, this monitor stops; 24/7 scanning requires a separate scheduled server worker.</p>
     </div>
   </div>}
 </section>;
}
