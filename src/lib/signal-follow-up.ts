import type { TrackedSignal } from "./signal-tracker";

/**
 * Evidence-only post-signal review. These are hypothetical candle outcomes,
 * not realized broker trades, and exclude spreads, slippage and fees.
 * No strategy or execution configuration is modified by this module.
 */
export type FollowUpGroup = {
  label: string;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageR: number | null;
  grossProfitFactor: number | null;
  lossRate: number | null;
  review: "INSUFFICIENT" | "REVIEW LOSSES" | "MONITOR";
  reason: string;
};
export type FollowUpReport = {
  total: number;
  resolved: number;
  stillOpen: number;
  expired: number;
  unverified: number;
  sampleReady: boolean;
  byStrategy: FollowUpGroup[];
  byTimeframe: FollowUpGroup[];
  bySymbol: FollowUpGroup[];
  byScoreBand: FollowUpGroup[];
  recent: FollowUpGroup;
  prior: FollowUpGroup;
  topLossClusters: FollowUpGroup[];
  lessons: string[];
};

const MIN_SAMPLE = 30; // informational sample threshold, not a validity guarantee
const isResolved = (s: TrackedSignal) =>
  s.closedAt !== null && (s.status === "WON" || s.status === "LOST") &&
  Number.isFinite(s.entry) && Number.isFinite(s.stopLoss) &&
  Number.isFinite(s.takeProfit1) && Math.abs(s.entry - s.stopLoss) > 0 &&
  (s.action === "BUY" || s.action === "SELL");

const riskMultiple = (s: TrackedSignal) => {
  const risk = Math.abs(s.entry - s.stopLoss);
  if (!(risk > 0)) return null;
  return s.status === "LOST" ? -1 : Math.abs(s.takeProfit1 - s.entry) / risk;
};

export function groupOutcome(label: string, signals: TrackedSignal[]): FollowUpGroup {
  const resolved = signals.filter(isResolved).sort((a,b)=>a.signalTime-b.signalTime);
  const values = resolved.map(riskMultiple).filter((x):x is number => x !== null && Number.isFinite(x));
  const wins = resolved.filter(s=>s.status==="WON").length;
  const losses = resolved.length-wins;
  const grossWin=values.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const grossLoss=-values.filter(x=>x<0).reduce((a,b)=>a+b,0);
  const averageR=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const review=resolved.length<MIN_SAMPLE?"INSUFFICIENT":averageR!==null&&averageR<=0?"REVIEW LOSSES":"MONITOR";
  const reason=review==="INSUFFICIENT"
   ? `Only ${resolved.length} resolved signals (review threshold: ${MIN_SAMPLE}); do not optimize on this sample.`
   : review==="REVIEW LOSSES"
   ? "Non-positive hypothetical average R; investigate this segment on held-out candles and after costs before considering a rule change."
   : "Positive gross hypothetical average R. Still requires independent out-of-sample and transaction-cost validation.";
  return {
    label, resolved:resolved.length,wins,losses,
    winRate:resolved.length?100*wins/resolved.length:null,
    averageR,
    grossProfitFactor:grossLoss>0?grossWin/grossLoss:null,
    lossRate:resolved.length?100*losses/resolved.length:null,
    review,reason
  };
}

function byKey(rows: TrackedSignal[], key:(s:TrackedSignal)=>string):FollowUpGroup[]{
  const groups=new Map<string,TrackedSignal[]>();
  for(const row of rows){
    const k=key(row);
    groups.set(k,[...(groups.get(k)??[]),row]);
  }
  return [...groups].map(([k,v])=>groupOutcome(k,v))
   .sort((a,b)=>b.resolved-a.resolved||a.label.localeCompare(b.label));
}

/** Returns a descriptive review report, never automatic self-tuning thresholds. */
export function buildFollowUpReport(signals: TrackedSignal[]): FollowUpReport {
 const resolved=signals.filter(isResolved);
 const chronological=[...resolved].sort((a,b)=>a.signalTime-b.signalTime);
 // Chronological comparison avoids reporting later samples as though they were earlier.
 // It is descriptive only, not a backtest or a prospective performance estimate.
 const midpoint=Math.floor(chronological.length/2);
 const prior=groupOutcome("Earlier resolved half",chronological.slice(0,midpoint));
 const recent=groupOutcome("Later resolved half",chronological.slice(midpoint));
 const byStrategy=byKey(resolved,s=>s.strategy??"Unknown strategy");
 const byTimeframe=byKey(resolved,s=>s.timeframe);
 const bySymbol=byKey(resolved,s=>s.symbol);
 const byScoreBand=byKey(resolved,s=>s.score>=85?"Score 85+":s.score>=70?"Score 70–84":"Below 70 / unknown");
 const topLossClusters=byKey(resolved,s=>`${s.symbol} · ${s.timeframe} · ${s.strategy??"Unknown strategy"}`)
  .filter(g=>g.losses>0).sort((a,b)=>b.losses-a.losses||b.resolved-a.resolved).slice(0,5);
 const lessons:string[]=[];
 if(resolved.length<MIN_SAMPLE)lessons.push(`Only ${resolved.length} verified outcomes: collect more signals before evaluating new filters.`);
 else {
   const weak=byStrategy.filter(g=>g.review==="REVIEW LOSSES");
   if(weak.length)lessons.push(`Investigate ${weak.map(g=>g.label).join(", ")}: gross hypothetical expectancy is non-positive for these strategy groups.`);
   if(prior.resolved>=MIN_SAMPLE&&recent.resolved>=MIN_SAMPLE&&
      prior.averageR!==null&&recent.averageR!==null&&recent.averageR<prior.averageR)
     lessons.push("The later sample has lower hypothetical average R than the earlier sample. Check market-regime changes and data quality.");
 }
 lessons.push("Review losses by symbol, timeframe and strategy; test one proposed filter at a time on unseen historical periods.");
 lessons.push("Outcome labels reflect candle touches, not actual orders; fill timing, fees, spreads and slippage may materially worsen results.");
 return {
  total:signals.length,resolved:resolved.length,
  stillOpen:signals.filter(s=>s.closedAt===null).length,
  expired:signals.filter(s=>s.status==="EXPIRED").length,
  unverified:signals.filter(s=>s.closedAt!==null&&!isResolved(s)&&s.status!=="EXPIRED").length,
  sampleReady:resolved.length>=MIN_SAMPLE,
  byStrategy,byTimeframe,bySymbol,byScoreBand,
  prior,recent,topLossClusters,lessons
 };
}
