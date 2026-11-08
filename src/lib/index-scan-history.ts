import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Check } from "./strategies/types";
/** Analysis and scan audit, distinct from candle-verified tracked signal outcomes. */
export type ScanRecord = {
  symbol:string;derivSymbol:string;category:string;timeframe:string;strategy:string|null;
  action:string;at:number;candleTime:number|null;entry:number|null;stopLoss:number|null;
  tp1:number|null;tp2:number|null;error:string|null;scanId?:string;
  indicatorSnapshot?:Check[];marketRegime?:string|null;dataStatus?:"FRESH"|"STALE"|"UNAVAILABLE"|"CLOSED";
};
const KEY="tradepulse-scan-audit-v2", LIMIT=2000;
const key=(uid:string)=>KEY+":"+uid;
const opportunityId=(r:ScanRecord)=>r.action==="BUY"||r.action==="SELL"?
  [r.derivSymbol,r.timeframe,r.strategy,r.action,r.candleTime].join("|"):null;
function dedup(rows:ScanRecord[]):ScanRecord[]{
 const seen=new Set<string>();
 return rows.sort((a,b)=>b.at-a.at).filter(r=>{
   const k=opportunityId(r)??[r.scanId,r.derivSymbol,r.timeframe].join("|");
   if(seen.has(k))return false;seen.add(k);return true;
 }).slice(0,LIMIT);
}
function readLocal(uid:string):ScanRecord[]{
 try{const x=JSON.parse(localStorage.getItem(key(uid))??"[]");return Array.isArray(x)?x.filter(r=>r&&typeof r.symbol==="string"):[];}
 catch{return [];}
}
export async function getScanHistory():Promise<ScanRecord[]>{
 if(typeof window==="undefined")return [];
 try{
   const {data:{user}}=await supabase.auth.getUser();
   if(!user)return [];
   const local=readLocal(user.id);
   // The managed DB migration may not yet have been applied. Fall back without interrupting scanning.
   const {data,error}=await supabase.from("scan_results").select("*").eq("user_id",user.id).order("scanned_at",{ascending:false}).limit(1000);
   if(error||!data)return dedup(local);
   const cloud:ScanRecord[]=data.map(r=>({
     symbol:r.symbol,derivSymbol:r.deriv_symbol,category:r.category,timeframe:r.timeframe,
     strategy:r.strategy,action:r.direction,at:Number(r.scanned_at),candleTime:r.candle_time==null?null:Number(r.candle_time),
     entry:r.entry,stopLoss:r.stop_loss,tp1:r.tp1,tp2:r.tp2,error:r.error_reason,scanId:r.scan_id,
     indicatorSnapshot:Array.isArray(r.indicator_snapshot)?r.indicator_snapshot as Check[]:[],
     marketRegime:r.market_regime,dataStatus:r.data_status as ScanRecord["dataStatus"],
   }));
   return dedup([...cloud,...local]);
 }catch{return [];}
}
export async function storeScanSession(records:ScanRecord[]){
 if(typeof window==="undefined"||records.length===0)return;
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)return;
 const scanId=crypto.randomUUID();
 const rows=records.map(r=>({...r,scanId}));
 try{
   // Save to the browser first; full server persistence is contingent on DB migration deployment.
   const local=dedup([...rows,...readLocal(user.id)]);
   localStorage.setItem(key(user.id),JSON.stringify(local));
   window.dispatchEvent(new Event("tradepulse-scan-recorded"));
 }catch(e){console.warn("Could not cache scan audit locally",e);}
 try{
   const {error}=await supabase.from("scan_sessions").insert({
     user_id:user.id,id:scanId,started_at:Math.min(...records.map(r=>r.at)),finished_at:Date.now(),
     timeframe:records[0]!.timeframe,section:records.every(r=>r.category==="INDEX")?"index":"mixed",
     analysis_count:records.length,data_source:"Deriv",sample_type:"LIVE_SCAN",
   });
   if(error)return; // Table may not be deployed yet. Preserve local audit.
   const values=rows.map(r=>({
     user_id:user.id,scan_id:scanId,deriv_symbol:r.derivSymbol,symbol:r.symbol,category:r.category,timeframe:r.timeframe,
     strategy:r.strategy,direction:r.action,candle_time:r.candleTime,scanned_at:r.at,
     entry:r.entry,stop_loss:r.stopLoss,tp1:r.tp1,tp2:r.tp2,
     indicator_snapshot:(r.indicatorSnapshot??[]) as unknown as Json,market_regime:r.marketRegime??null,
     data_status:r.dataStatus??(r.action==="UNAVAILABLE"?"UNAVAILABLE":"FRESH"),
     error_reason:r.error,opportunity_id:opportunityId(r),
   }));
   const {error:writeError}=await supabase.from("scan_results").insert(values);
   // A repeated opportunity may violate the unique signal key. It remains in the scan session
   // but is intentionally not counted as another independent actionable signal.
   if(writeError&&writeError.code!=="23505")console.warn("Cloud scan analysis storage unavailable",writeError.message);
 }catch(e){console.warn("Cloud scan storage is not configured",e);}
}
