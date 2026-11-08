import { describe, expect, it } from "vitest";
import { analyzeIndex, INDEX_DEFAULT_ENABLED, INDEX_STRATEGIES } from "./index-signal-engine";
import { fromCloses, H1, legs, repeat, after } from "@/test/fixtures/series";
import type { Ohlc } from "./strategies/types";
const candles = fromCloses(legs(repeat(25, [[4,0.8],[3,-0.5]] as [number,number][])), {tfMs:H1});
const input = { candles, timeframe:"H1" as const, now:after(candles), open:true, decimals:2 };
describe("independent index signal safety",()=>{
 it("keeps all six requested algorithms plus a separate benchmark",()=>{
   expect(INDEX_STRATEGIES.map(s=>s.id)).toEqual(["trend","macd","ribbon","snapback","atrbreak","sweep","imbalance"]);
   expect(INDEX_DEFAULT_ENABLED).toEqual(["trend"]);
 });
 it("does not make fictional signals with insufficient, stale or closed market data",()=>{
   expect(analyzeIndex({...input,candles:candles.slice(-30)}).action).toBe("NO TRADE");
   expect(analyzeIndex({...input,now:input.now+9*H1}).action).toBe("NO TRADE");
   expect(analyzeIndex({...input,open:false}).action).toBe("NO TRADE");
 });
 it("does not inspect an in-progress candle",()=>{
   const forming:Ohlc={time:candles.at(-1)!.time+H1,open:160,high:500,low:5,close:460};
   expect(analyzeIndex({...input,candles:[...candles,forming]})).toEqual(analyzeIndex(input));
 });
 it("unsupported timeframe cannot run a strategy as an active recommendation",()=>{
   const a=analyzeIndex({...input,strategy:"macd"});
   expect(a.action).toBe("NO TRADE");
   expect(a.reasons[0]).toContain("support this timeframe");
 });
 it("index strategy evaluation exposes MACD, Bollinger and Stochastic technical values",()=>{
   const a=analyzeIndex({...input,enabled:["ribbon"]});
   expect(a.checks.map(x=>x.label)).toEqual(expect.arrayContaining(["MACD histogram","Bollinger 20/2","Stochastic 14/3","Data source"]));
   if(a.action==="BUY"||a.action==="SELL"){
     expect(a.entry).not.toBeNull();
     expect(a.riskReward).toBeGreaterThanOrEqual(2);
     expect(a.action==="BUY"?a.stopLoss!<a.entry!:a.stopLoss!>a.entry!).toBe(true);
   }
 });
});
