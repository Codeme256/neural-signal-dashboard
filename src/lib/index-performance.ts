import type { TrackedSignal } from "./signal-tracker";
export type OutcomeMetrics={resolved:number;wins:number;losses:number;winRate:number|null;avgR:number|null;profitFactor:number|null;maxDrawdownR:number|null};
export function outcomeMetrics(signals:TrackedSignal[]):OutcomeMetrics{
  // Never count OPEN, EXPIRY, or TP1 results still being followed as realized trades.
  const eligible=signals.filter(s=>s.closedAt!==null&&(s.status==="WON"||s.status==="LOST")&&Number.isFinite(s.entry)&&Number.isFinite(s.stopLoss)&&Number.isFinite(s.takeProfit1));
  const withR=eligible.map(s=>{
    const risk=Math.abs(s.entry-s.stopLoss),reward=Math.abs(s.takeProfit1-s.entry);
    return risk>0 ? (s.status==="LOST"?-1:reward/risk) : null;
  }).filter((x):x is number=>x!==null);
  const wins=withR.filter(x=>x>0).length,losses=withR.filter(x=>x<0).length;
  let equity=0,peak=0,dd=0;
  for(const r of withR){equity+=r;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
  const grossProfit=withR.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const grossLoss=-withR.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return {resolved:withR.length,wins,losses,winRate:withR.length?Math.round(1000*wins/withR.length)/10:null,avgR:withR.length?Math.round(1000*withR.reduce((a,b)=>a+b,0)/withR.length)/1000:null,profitFactor:grossLoss>0?Math.round(100*grossProfit/grossLoss)/100:null,maxDrawdownR:withR.length?Math.round(1000*dd)/1000:null};
}
