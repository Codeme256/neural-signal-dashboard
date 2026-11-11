import { describe, expect, it } from "vitest";
import { alternativesFor, pairStrategyReviews, verdictFor } from "./pair-strategy-policy";
import type { TrackedSignal } from "./signal-tracker";
const base: TrackedSignal={
 id:"0",derivSymbol:"frxEURUSD",symbol:"EURUSD",decimals:5,action:"BUY",
 timeframe:"M15",strategy:"Breakout & Retest",score:80,
 entry:100,stopLoss:99,takeProfit1:102,takeProfit2:103,signalTime:0,
 trackedAt:0,status:"OPEN",target:null,closedAt:null,checkedAt:null
};
function row(n:number,status:TrackedSignal["status"],strategy=base.strategy):TrackedSignal{
 return {...base,id:String(n),signalTime:n*900000,strategy,status,
  target:status==="WON"?"TP1":null,
  closedAt:status==="OPEN"?null:n*900000+900000};
}
describe("guarded signal pair/strategy avoidance",()=>{
 it("does not block a pair after one or four losses",()=>{
  const reviews=pairStrategyReviews([row(1,"LOST"),row(2,"LOST"),row(3,"LOST"),row(4,"LOST")]);
  expect(verdictFor(reviews,"EURUSD","Breakout & Retest")).toMatchObject({total:4,verdict:"COLLECT DATA"});
 });
 it("filters a persistently negative strategy only after 40 resolved outcomes",()=>{
  const losses=Array.from({length:40},(_,i)=>row(i+1,"LOST"));
  const p=verdictFor(pairStrategyReviews(losses),"EURUSD","Breakout & Retest");
  expect(p).toMatchObject({total:40,olderR:-1,newerR:-1,verdict:"AVOID"});
 });
 it("requires both chronological halves to be negative, preventing short-run overreaction",()=>{
  const rows=Array.from({length:20},(_,i)=>row(i+1,"LOST")).concat(
    Array.from({length:20},(_,i)=>row(i+21,"WON")));
  const p=verdictFor(pairStrategyReviews(rows),"EURUSD","Breakout & Retest");
  expect(p?.verdict).toBe("COLLECT DATA");
 });
 it("does not treat unclosed TP1 or expired outcomes as resolved",()=>{
  const rows=Array.from({length:40},(_,i)=>row(i+1,"LOST"));
  rows[1]={...rows[1]!,closedAt:null,status:"WON",target:"TP1"};
  rows[2]={...rows[2]!,status:"EXPIRED"};
  expect(pairStrategyReviews(rows)[0]).toMatchObject({total:38,verdict:"COLLECT DATA"});
 });
 it("suggests another strategy for same pair only after both historical halves are gross positive",()=>{
  const negative=Array.from({length:40},(_,i)=>row(i+1,"LOST"));
  const positive=Array.from({length:40},(_,i)=>row(i+100,"WON","Trend Continuation"));
  const reviews=pairStrategyReviews([...negative,...positive]);
  expect(alternativesFor(reviews,"EURUSD","Breakout & Retest")).toMatchObject([{strategy:"Trend Continuation",verdict:"CANDIDATE"}]);
  expect(alternativesFor(reviews,"GBPUSD","Breakout & Retest")).toEqual([]);
 });
});