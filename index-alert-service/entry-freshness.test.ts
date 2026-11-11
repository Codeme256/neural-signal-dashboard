import {describe,it,expect} from "vitest";
import {validateFreshEntry,type EntryFreshnessInput} from "./entry-freshness";
const now=Date.UTC(2026,10,11,12,1,10);
const baseline:EntryFreshnessInput={now,candleTime:now-65000,expiresAt:now+10*60*1000,quoteTime:now-10000,currentPrice:100.1,entry:100,stopLoss:99,tp1:102,tp2:103,direction:"BUY"};
describe("telegram-confirmed entry freshness",()=>{
 it("accepts only a near-current quote close to the proposed entry",()=>expect(validateFreshEntry(baseline)).toMatchObject({ok:true,reason:"FRESH"}));
 it("suppresses the entry once price moves beyond 0.25R",()=>expect(validateFreshEntry({...baseline,currentPrice:100.4}).reason).toBe("ENTRY_ALREADY_PASSED"));
 it("suppresses candles discovered after five minutes",()=>expect(validateFreshEntry({...baseline,candleTime:now-6*60000}).reason).toBe("STALE_CANDLE"));
 it("suppresses stale quotes",()=>expect(validateFreshEntry({...baseline,quoteTime:now-121000}).reason).toBe("STALE_QUOTE"));
 it("suppresses already-hit TP or stop",()=>{
   expect(validateFreshEntry({...baseline,currentPrice:102}).reason).toBe("TP_OR_SL_REACHED");
   expect(validateFreshEntry({...baseline,currentPrice:98}).reason).toBe("TP_OR_SL_REACHED");
 });
 it("rejects expired confirmed setups",()=>expect(validateFreshEntry({...baseline,expiresAt:now-1000}).reason).toBe("EXPIRED"));
 it("works for SELL and blocks wrong-sided levels",()=>{
   const sell={...baseline,direction:"SELL" as const,stopLoss:101,tp1:98,tp2:97};
   expect(validateFreshEntry({...sell,currentPrice:99.9}).ok).toBe(true);
   expect(validateFreshEntry({...sell,currentPrice:99.6}).reason).toBe("ENTRY_ALREADY_PASSED");
   expect(validateFreshEntry({...sell,stopLoss:99}).reason).toBe("INVALID_LEVELS");
 });
});
