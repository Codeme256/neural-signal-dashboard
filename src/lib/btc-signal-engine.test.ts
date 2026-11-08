import { describe, expect, it } from "vitest";
import { analyzeBtc, BTC_STRATEGIES, BTC_DEFAULT_ENABLED, isBitcoinMarket } from "./btc-signal-engine";
import { fromCloses, legs, repeat, H1, after } from "@/test/fixtures/series";
import type { Ohlc } from "./strategies/types";

const candles=fromCloses(legs(repeat(23,[[8,1.4],[5,-0.7]] as [number,number][]),45000),{tfMs:H1,wick:6});
const args={candles,timeframe:"H1" as const,now:after(candles),open:true,decimals:2,enabled:["btc-trend","btc-breakout","btc-reversion","btc-sweep"] as const};
const input={...args,enabled:[...args.enabled]};
describe("BTC-only strategy selection and data safety",()=>{
 it("has four BTC-specific algorithms, independent of Forex and indices",()=>{
  expect(BTC_STRATEGIES.map(x=>x.id)).toEqual(["btc-trend","btc-sweep","btc-breakout","btc-reversion"]);
  expect(BTC_DEFAULT_ENABLED).toEqual(["btc-trend","btc-breakout"]);
  expect(isBitcoinMarket("cryBTCUSD","CRYPTO")).toBe(true);
  expect(isBitcoinMarket("BTCUSD","CRYPTO")).toBe(true);
  expect(isBitcoinMarket("BTCUSD","FOREX")).toBe(false);
  expect(isBitcoinMarket("cryETHUSD","CRYPTO")).toBe(false);
 });
 it("rejects closed markets, stale candles, incomplete history and unsupported timeframe",()=>{
  expect(analyzeBtc({...input,open:false}).action).toBe("NO TRADE");
  expect(analyzeBtc({...input,now:input.now+10*H1}).action).toBe("NO TRADE");
  expect(analyzeBtc({...input,candles:candles.slice(-65)}).action).toBe("NO TRADE");
  expect(analyzeBtc({...input,timeframe:"M1",strategy:"btc-trend"}).action).toBe("NO TRADE");
 });
 it("never examines a still-forming candle",()=>{
  const x:Ohlc={time:candles.at(-1)!.time+H1,open:1,high:1e10,low:0,close:5e9};
  expect(analyzeBtc({...input,candles:[...candles,x]})).toEqual(analyzeBtc(input));
 });
 it("shows BTC risk and indicator checks, and never creates price levels for WAIT",()=>{
  const a=analyzeBtc(input);
  expect(a.checks.map(c=>c.label)).toEqual(expect.arrayContaining(["ATR 14","RSI 14","ADX 14","EMA 200"]));
  if(a.action==="BUY"||a.action==="SELL"){
   expect(a.riskReward).toBeGreaterThanOrEqual(2);
   expect(a.entry).not.toBeNull();
   expect(a.stopLoss).not.toBeNull();
   expect(a.action==="BUY"?a.stopLoss!<a.entry!:a.stopLoss!>a.entry!).toBe(true);
  } else {
   expect(a.entry).toBeNull();
   expect(a.stopLoss).toBeNull();
   expect(a.takeProfit1).toBeNull();
  }
 });
 it("an explicit BTC strategy selection never silently runs another BTC algorithm",()=>{
  const a=analyzeBtc({...input,strategy:"btc-breakout"});
  expect(a.strategies.map(s=>s.id)).toEqual(["btc-breakout"]);
 });
});
