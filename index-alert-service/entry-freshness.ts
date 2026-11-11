/**
 * A completed-candle confirmation is not necessarily an available entry.
 * Reject stale signals and entries where the current quote has already moved
 * substantially away. No assumed fill or broker transaction-cost data.
 */
export type EntryFreshnessInput={
 now:number; candleTime:number;expiresAt:number|null;
 quoteTime:number;currentPrice:number;entry:number;stopLoss:number;tp1:number;tp2:number;
 direction:"BUY"|"SELL";
};
export type EntryFreshnessResult={ok:boolean;reason:"FRESH"|"STALE_CANDLE"|"EXPIRED"|"STALE_QUOTE"|"INVALID_LEVELS"|"ENTRY_ALREADY_PASSED"|"TP_OR_SL_REACHED";distanceR:number|null};
const MAX_CANDLE_AGE_MS=5*60*1000;
const MAX_QUOTE_AGE_MS=2*60*1000;
const MAX_DISTANCE_R=0.25;
export function validateFreshEntry(s:EntryFreshnessInput):EntryFreshnessResult{
 const fail=(reason:EntryFreshnessResult["reason"],distanceR:number|null=null):EntryFreshnessResult=>({ok:false,reason,distanceR});
 const v=[s.now,s.candleTime,s.quoteTime,s.currentPrice,s.entry,s.stopLoss,s.tp1,s.tp2];
 if(!v.every(Number.isFinite))return fail("INVALID_LEVELS");
 const risk=Math.abs(s.entry-s.stopLoss);
 const valid=s.direction==="BUY"?
  s.stopLoss<s.entry&&s.entry<s.tp1&&s.tp1<=s.tp2:
  s.stopLoss>s.entry&&s.entry>s.tp1&&s.tp1>=s.tp2;
 if(!valid||risk<=0)return fail("INVALID_LEVELS");
 if(s.now<s.candleTime||s.now-s.candleTime>MAX_CANDLE_AGE_MS)return fail("STALE_CANDLE");
 if(s.expiresAt!==null&&s.now>=s.expiresAt)return fail("EXPIRED");
 if(s.quoteTime>s.now+10_000||s.now-s.quoteTime>MAX_QUOTE_AGE_MS)return fail("STALE_QUOTE");
 const crossed=s.direction==="BUY"?s.currentPrice>=s.tp1||s.currentPrice<=s.stopLoss:
  s.currentPrice<=s.tp1||s.currentPrice>=s.stopLoss;
 if(crossed)return fail("TP_OR_SL_REACHED");
 const distanceR=Math.abs(s.currentPrice-s.entry)/risk;
 if(distanceR>MAX_DISTANCE_R)return fail("ENTRY_ALREADY_PASSED",distanceR);
 return {ok:true,reason:"FRESH",distanceR};
}
