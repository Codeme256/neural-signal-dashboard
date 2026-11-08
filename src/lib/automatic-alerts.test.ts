import { describe, expect, it } from "vitest";
import { actionableAlert, alertId } from "./automatic-alerts";
import type { Analysis } from "./strategies/types";
import type { DerivMarket } from "./deriv-data";

const market:DerivMarket={symbol:"BTCUSD",ticker:"BTCUSD",name:"Bitcoin",category:"CRYPTO",derivSymbol:"cryBTCUSD",decimals:2,open:true,change:0,volatility:0,confidence:0,bias:"WAIT",horizon:"",note:""};
const analysis:Analysis={
 action:"BUY",score:88,grade:"HIGH CONFLUENCE",strategy:"BTC EMA Trend Continuation",strategyId:null,
 timeframe:"M15",higherTimeframe:"H1",confirmTimeframe:"M5",higherTrend:"BULLISH",marketOpen:true,
 lastCandleTime:Date.UTC(2026,10,8,8,0),entry:100,entryZone:null,stopLoss:98,
 takeProfit1:102,takeProfit2:105,riskReward:2.5,invalidation:null,confirmation:null,
 reasons:[],checks:[],breakdown:[],strategies:[],
};
describe("automatic strong signal alerts",()=>{
 it("constructs a stable, per-candle strategy alert key",()=>{
   expect(alertId(market,"M15",analysis)).toEqual(alertId(market,"M15",analysis));
   const a=actionableAlert(market,"M15",analysis);
   expect(a).toMatchObject({symbol:"Bitcoin",direction:"BUY",entry:100,stopLoss:98,tp1:102,tp2:105});
 });
 it("never notifies from WAIT, weak, incomplete, closed, or invalid-risk signals",()=>{
   expect(actionableAlert({...market,open:false},"M15",analysis)).toBeNull();
   expect(actionableAlert(market,"M15",{...analysis,action:"WAIT"})).toBeNull();
   expect(actionableAlert(market,"M15",{...analysis,score:60})).toBeNull();
   expect(actionableAlert(market,"M15",{...analysis,entry:null})).toBeNull();
   expect(actionableAlert(market,"M15",{...analysis,riskReward:1.2})).toBeNull();
   expect(actionableAlert(market,"M15",{...analysis,stopLoss:103})).toBeNull();
 });
 it("recognizes SELL risk levels correctly",()=>{
   const sell={...analysis,action:"SELL" as const,stopLoss:103,takeProfit1:98,takeProfit2:95};
   expect(actionableAlert(market,"M15",sell)?.direction).toBe("SELL");
   expect(actionableAlert(market,"M15",{...sell,takeProfit1:105})).toBeNull();
 });
});
