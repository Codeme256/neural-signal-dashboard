import type { TrackedSignal } from "./signal-tracker";

/**
 * Cautious, retrospective evidence policy for pair/strategy combinations.
 * No backfit on the same sample: require at least 20 earlier and 20 later
 * RESOLVED results, and both chronological halves must have negative gross R.
 * Only advice/filtering, not mathematical proof or broker execution controls.
 */
export const MIN_SEGMENT_OUTCOMES=40;
export type PairStrategyVerdict="AVOID"|"CANDIDATE"|"COLLECT DATA";
export type PairStrategyReview={
 symbol:string;strategy:string;total:number;wins:number;losses:number;
 olderR:number|null;newerR:number|null;averageR:number|null;
 verdict:PairStrategyVerdict;message:string;
};
const valid=(s:TrackedSignal)=>s.closedAt!==null&&(s.status==="LOST"||s.status==="WON")&&
 Number.isFinite(s.entry)&&Number.isFinite(s.stopLoss)&&Number.isFinite(s.takeProfit1)&&
 Math.abs(s.entry-s.stopLoss)>0;
const rr=(s:TrackedSignal)=>{
 const risk=Math.abs(s.entry-s.stopLoss);
 return s.status==="LOST"?-1:Math.abs(s.takeProfit1-s.entry)/risk;
};
const mean=(a:TrackedSignal[])=>a.length?a.reduce((sum,s)=>sum+rr(s),0)/a.length:null;
function review(symbol:string,strategy:string,items:TrackedSignal[]):PairStrategyReview {
 const resolved=items.filter(valid).sort((a,b)=>a.signalTime-b.signalTime||a.id.localeCompare(b.id));
 const half=Math.floor(resolved.length/2);
 const olderR=mean(resolved.slice(0,half)),newerR=mean(resolved.slice(half));
 const averageR=mean(resolved);
 const verdict:PairStrategyVerdict=resolved.length<MIN_SEGMENT_OUTCOMES?"COLLECT DATA":
  olderR!==null&&newerR!==null&&olderR<0&&newerR<0?"AVOID":
  olderR!==null&&newerR!==null&&olderR>0&&newerR>0?"CANDIDATE":"COLLECT DATA";
 const message=verdict==="AVOID"
  ?"Both earlier and later tracked samples have negative gross expectancy. Hide this pair/strategy from new signal recommendations until reviewed; past tracking excludes spreads and fees."
  :verdict==="CANDIDATE"
  ?"Both chronological samples are gross-positive. Research candidate only; not a proven winning strategy or a recommended automatic substitution."
  :`Only ${resolved.length} resolved outcomes or inconsistent evidence. No automatic rejection or substitution.`;
 return {symbol,strategy,total:resolved.length,wins:resolved.filter(s=>s.status==="WON").length,
  losses:resolved.filter(s=>s.status==="LOST").length,olderR,newerR,averageR,verdict,message};
}
export function pairStrategyReviews(signals:TrackedSignal[]):PairStrategyReview[]{
 const groups=new Map<string,{symbol:string;strategy:string;signals:TrackedSignal[]}>();
 for(const s of signals){
  const strategy=s.strategy?.trim()||"Unknown strategy";
  const key=JSON.stringify([s.symbol,strategy]);
  const existing=groups.get(key);
  if(existing)existing.signals.push(s);
  else groups.set(key,{symbol:s.symbol,strategy,signals:[s]});
 }
 return [...groups.values()].map(g=>review(g.symbol,g.strategy,g.signals))
 .sort((a,b)=>(a.verdict==="AVOID"?-1:a.verdict==="CANDIDATE"?0:1)-
 (b.verdict==="AVOID"?-1:b.verdict==="CANDIDATE"?0:1)||b.total-a.total);
}
export function verdictFor(reviews:PairStrategyReview[],symbol:string,strategy:string|null):PairStrategyReview|undefined{
 return reviews.find(x=>x.symbol===symbol&&x.strategy===(strategy?.trim()||"Unknown strategy"));
}
export function alternativesFor(reviews:PairStrategyReview[],symbol:string,strategy:string|null):PairStrategyReview[]{
 return reviews.filter(x=>x.symbol===symbol&&x.strategy!==(strategy?.trim()||"Unknown strategy")&&x.verdict==="CANDIDATE")
 .sort((a,b)=>(b.newerR??-Infinity)-(a.newerR??-Infinity));
}
