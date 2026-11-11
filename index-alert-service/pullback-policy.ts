import type { Ohlc } from "../src/lib/strategies/types";

/** Signal-only retest logic. Every M1 candle must be complete and consecutive. */
export type PullbackPlan = {
 id:string; symbol:string; deriv_symbol:string;strategy:string;direction:"BUY"|"SELL";
 candle_time:number;created_at:number;expires_at:number;entry:number;stop_loss:number;
 tp1:number;tp2:number;rr:number;quality_score:number;status:string;
};
export type PullbackDecision = {
 state:"WAIT"|"CONFIRMED"|"INVALIDATED"|"EXPIRED";
 reason:string;zoneLow:number;zoneHigh:number;
};
export const PULLBACK_ZONE_R=0.15;
export const DEPARTURE_R=0.35;
export function pullbackZone(p:Pick<PullbackPlan,"entry"|"stop_loss">) {
 const risk=Math.abs(p.entry-p.stop_loss);
 return {low:p.entry-PULLBACK_ZONE_R*risk,high:p.entry+PULLBACK_ZONE_R*risk};
}
export function assessPullback(p:PullbackPlan,candles:Ohlc[],now:number,quote:number,quoteTime:number):PullbackDecision{
 const risk=Math.abs(p.entry-p.stop_loss),zone=pullbackZone(p);
 const result=(state:PullbackDecision["state"],reason:string):PullbackDecision=>({state,reason,zoneLow:zone.low,zoneHigh:zone.high});
 if(![p.entry,p.stop_loss,p.tp1,p.tp2,now,quote,quoteTime,p.created_at,p.expires_at].every(Number.isFinite)||
   risk<=0||!(p.direction==="BUY"?p.stop_loss<p.entry&&p.entry<p.tp1&&p.tp1<=p.tp2:
    p.stop_loss>p.entry&&p.entry>p.tp1&&p.tp1>=p.tp2))return result("INVALIDATED","Invalid levels");
 if(now>=p.expires_at)return result("EXPIRED","Setup expired before confirmed retest");
 if(quoteTime>now+10000||now-quoteTime>90000)return result("WAIT","Price quote stale");
 if(!candles.length)return result("WAIT","No closed M1 evidence");
 const sorted=[...candles].sort((a,b)=>a.time-b.time);
 const first=sorted[0],last=sorted[sorted.length-1];
 if(!first||!last||first.time>p.created_at+60000||last.time+60000>now||
   sorted.some((c,i)=>i>0&&c.time-sorted[i-1]!.time!==60000))
   return result("WAIT","Missing completed consecutive M1 candles");
 const buying=p.direction==="BUY";
 let departed=false;
 let confirmedAt:number|null=null;
 for(const c of sorted){
  if(c.time+60000<=p.created_at)continue;
  // Once TP or SL was touched, any later retest is no longer a valid fresh setup.
  if(buying?(c.high>=p.tp1||c.low<=p.stop_loss):(c.low<=p.tp1||c.high>=p.stop_loss))
   return result("INVALIDATED","TP or SL was already touched before entry");
  if(!departed){
   if(buying?c.high>=p.entry+DEPARTURE_R*risk:c.low<=p.entry-DEPARTURE_R*risk)
    departed=true;
   continue; // Require a later completed candle for retest; no same-candle sequencing assumption.
  }
  const touched=c.low<=zone.high&&c.high>=zone.low;
  const rejected=buying?c.close>=p.entry&&c.close>c.open:c.close<=p.entry&&c.close<c.open;
  if(touched&&rejected)confirmedAt=c.time+60000;
 }
 if(!departed)return result("WAIT","No initial move away from entry yet");
 if(confirmedAt===null)return result("WAIT","Waiting for completed M1 pullback rejection");
 if(now-confirmedAt>120000)return result("WAIT","Retest confirmation is old; wait for a new close");
 if(quote<zone.low||quote>zone.high)return result("WAIT","Current price outside pullback entry zone");
 return result("CONFIRMED","Fresh completed M1 rejection in pullback zone with live quote inside zone");
}
