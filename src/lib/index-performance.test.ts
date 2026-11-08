import {describe,it,expect} from "vitest";
import {outcomeMetrics} from "./index-performance";
import type {TrackedSignal} from "./signal-tracker";
const base:TrackedSignal={id:"a",derivSymbol:"IDX",symbol:"IDX",decimals:2,action:"BUY",timeframe:"H1",strategy:"EMA Ribbon Continuation",score:100,entry:100,stopLoss:99,takeProfit1:102,takeProfit2:103,signalTime:0,trackedAt:0,status:"OPEN",target:null,closedAt:null,checkedAt:1000};
const win={...base,id:"w",status:"WON",target:"TP1",closedAt:3600000} as TrackedSignal;
const loss={...base,id:"l",status:"LOST",target:null,closedAt:7200000} as TrackedSignal;
describe("resolved outcome performance, cost-excluded",()=>{
 it("ignores open, expired, and TP1 awaiting resolution",()=>{expect(outcomeMetrics([base,{...win,closedAt:null},{...base,status:"EXPIRED",closedAt:7200000}])).toMatchObject({resolved:0,winRate:null,avgR:null});});
 it("computes hypothetical TP1 R and stop R only",()=>{expect(outcomeMetrics([win,loss])).toMatchObject({resolved:2,winRate:50,avgR:0.5,profitFactor:2,maxDrawdownR:1});});
 it("never fabricates profit factor when no loss",()=>{expect(outcomeMetrics([win]).profitFactor).toBeNull();});
});
