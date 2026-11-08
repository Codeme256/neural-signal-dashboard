import { supabase } from "@/integrations/supabase/client";
/** Browser-local scan audit (not a verified outcome and not yet synchronized to cloud). */
export type ScanRecord = {
 symbol:string; derivSymbol:string; category:string; timeframe:string; strategy:string|null;
 action:string; at:number; candleTime:number|null; entry:number|null; stopLoss:number|null;
 tp1:number|null; tp2:number|null; error:string|null; scanId?:string;
};
const KEY="tradepulse-scan-audit-v1";
const LIMIT=2000;
export async function getScanHistory():Promise<ScanRecord[]>{
 if(typeof window==="undefined")return [];
 try{
   const {data:{user}}=await supabase.auth.getUser();
   if(!user)return [];
   const x=JSON.parse(localStorage.getItem(KEY+":"+user.id)??"[]");
   return Array.isArray(x)?x.filter((r)=>r&&typeof r.symbol==="string").slice(0,LIMIT):[];
 }catch{return [];}
}
export async function storeScanSession(records:ScanRecord[]){
 if(typeof window==="undefined"||records.length===0)return;
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)return;
 const scanId=crypto.randomUUID();
 const next=[...records.map(r=>({...r,scanId})),...(await getScanHistory())];
 // One current opportunity per symbol/TF/direction/strategy/closed candle. Every scan still records WAIT.
 const seen=new Set<string>();
 const unique=next.filter(r=>{
   const key=r.action==="BUY"||r.action==="SELL"?
     [r.derivSymbol,r.timeframe,r.strategy,r.action,r.candleTime].join("|"):
     [r.scanId,r.derivSymbol,r.timeframe].join("|");
   if(seen.has(key))return false;
   seen.add(key);return true;
 }).slice(0,LIMIT);
 try{localStorage.setItem(KEY+":"+user.id,JSON.stringify(unique));window.dispatchEvent(new Event("tradepulse-scan-recorded"));}catch(e){console.warn("Scan history storage unavailable",e);}
}
