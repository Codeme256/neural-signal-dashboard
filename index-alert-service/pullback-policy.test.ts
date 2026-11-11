import { describe,expect,it } from "vitest";
import { assessPullback,type PullbackPlan } from "./pullback-policy";
import type { Ohlc } from "../src/lib/strategies/types";
const base=Date.UTC(2026,10,11,12,0,0);
const plan:PullbackPlan={
 id:"p1",symbol:"US500",deriv_symbol:"OTC_US500",strategy:"Trend Continuation",direction:"BUY",
 candle_time:base,created_at:base,expires_at:base+15*60000,
 entry:100,stop_loss:99,tp1:102,tp2:103,rr:2,quality_score:80,status:"PENDING"
};
const candle=(n:number,o:number,h:number,l:number,c:number):Ohlc=>({time:base+n*60000,open:o,high:h,low:l,close:c});
const departure=candle(1,100.1,100.45,100.08,100.38);
const retest=candle(2,99.95,100.10,99.9,100.04);
describe("confirmed pullback entry is never a historical TP chase",()=>{
 it("confirms later M1 departure and fresh entry-zone rejection only",()=>{
  const r=assessPullback(plan,[candle(0,100,100.2,99.9,100.1),departure,retest],base+3*60000+10000,100.05,base+3*60000);
  expect(r).toMatchObject({state:"CONFIRMED",zoneLow:99.85,zoneHigh:100.15});
 });
 it("won't issue a signal without an actual pullback retest",()=>{
  expect(assessPullback(plan,[departure],base+2*60000+10000,100.05,base+2*60000).state).toBe("WAIT");
 });
 it("suppresses a setup if TP1 was already hit before the pullback",()=>{
  const hit=candle(2,100.38,102.1,100.25,101.9);
  expect(assessPullback(plan,[departure,hit,retest],base+4*60000+10000,100.05,base+4*60000).state).toBe("INVALIDATED");
 });
 it("suppresses a setup if SL was touched, even with a subsequent rebound",()=>{
  expect(assessPullback(plan,[departure,candle(2,100.1,100.2,98.95,100.04)],base+3*60000+5000,100.04,base+3*60000).state).toBe("INVALIDATED");
 });
 it("requires a rejection in a later candle, not ambiguous same-candle high/low",()=>{
  const both=candle(1,100,100.5,99.9,100.1);
  expect(assessPullback(plan,[both],base+2*60000+10000,100.04,base+2*60000).state).toBe("WAIT");
 });
 it("fails closed with missing M1 bars",()=>{
  const r=assessPullback(plan,[departure,candle(3,99.95,100.1,99.92,100.05)],base+4*60000+1000,100,base+4*60000);
  expect(r.state).toBe("WAIT");
 });
 it("requires current price inside the entry zone",()=>{
  const r=assessPullback(plan,[departure,retest],base+3*60000+10000,100.35,base+3*60000);
  expect(r.state).toBe("WAIT");
 });
 it("does not publish expired or stale-quote signals",()=>{
  expect(assessPullback(plan,[departure,retest],base+16*60000,100.04,base+16*60000).state).toBe("EXPIRED");
  expect(assessPullback(plan,[departure,retest],base+3*60000+10000,100.04,base).state).toBe("WAIT");
 });
 it("handles SELL mirror case",()=>{
  const sell={...plan,direction:"SELL" as const,stop_loss:101,tp1:98,tp2:97};
  const down=candle(1,99.9,99.95,99.53,99.61),rebound=candle(2,100.05,100.12,99.92,99.96);
  expect(assessPullback(sell,[down,rebound],base+3*60000+10000,99.97,base+3*60000).state).toBe("CONFIRMED");
 });
});
