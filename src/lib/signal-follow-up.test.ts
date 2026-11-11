import { describe, expect, it } from "vitest";
import { buildFollowUpReport, groupOutcome } from "./signal-follow-up";
import type { TrackedSignal } from "./signal-tracker";

const base: TrackedSignal = {
 id:"x",derivSymbol:"frxEURUSD",symbol:"EURUSD",decimals:5,action:"BUY",timeframe:"M15",
 strategy:"Trend Continuation",score:75,entry:100,stopLoss:99,takeProfit1:102,takeProfit2:103,
 signalTime:0,trackedAt:0,status:"OPEN",target:null,closedAt:null,checkedAt:null,
};
function signal(id:string,status:TrackedSignal["status"],strategy="Trend Continuation"):TrackedSignal{
 return {...base,id,strategy,status,signalTime:Number(id)*900000||0,
  target:status==="WON"?"TP1":null,closedAt:status==="OPEN"?null:3600000};
}
describe("post-outcome evidence and loss diagnostics",()=>{
 it("does not count unfinished TP1 or expired results as resolved",()=>{
  const s=signal("1","WON");
  const r=buildFollowUpReport([s,{...s,id:"open",closedAt:null},signal("2","EXPIRED"),signal("3","LOST")]);
  expect(r).toMatchObject({total:4,resolved:2,expired:1,stillOpen:1,sampleReady:false});
  expect(r.byStrategy[0]).toMatchObject({wins:1,losses:1,averageR:0.5,review:"INSUFFICIENT"});
 });
 it("shows loss review only with adequate resolved history and non-positive expectancy",()=>{
  const negative=Array.from({length:31},(_,i)=>signal(String(i+1),i<29?"LOST":"WON"));
  expect(groupOutcome("Weak",negative)).toMatchObject({resolved:31,wins:2,losses:29,review:"REVIEW LOSSES"});
  expect(groupOutcome("Small sample",negative.slice(0,10)).review).toBe("INSUFFICIENT");
 });
 it("never labels gross profit factor when no loss and does not claim actual P&L",()=>{
  const report=buildFollowUpReport([signal("1","WON")]);
  expect(report.bySymbol[0]?.grossProfitFactor).toBeNull();
  expect(report.lessons.some(x=>x.includes("fees"))).toBe(true);
 });
 it("keeps a zero-risk invalid signal out of outcomes",()=>{
  const report=buildFollowUpReport([{...signal("1","WON"),stopLoss:100}]);
  expect(report.resolved).toBe(0);
  expect(report.unverified).toBe(1);
 });
});