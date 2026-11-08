/** BTCUSD-only quantitative signal analysis. No trade execution or profitability guarantees.
 * Indicators use ONLY completed Deriv price candles. Market-data quality is a hard gate.
 */
import { BollingerBands } from "technicalindicators";
import { adxLast, atrSeries, emaSeries, rsiSeries, swings } from "./strategies/indicators";
import { buildContext, higherTrend, structureBreak } from "./strategies/detectors";
import { buildLevels, closedCandles, isStale } from "./signal-engine";
import {
  CONFIRM_TF, HIGHER_TF, TF_SECONDS, type Analysis, type Check, type Dir,
  type Ohlc, type Timeframe, type Trend,
} from "./strategies/types";

export const BTC_STRATEGIES = [
  { id: "btc-trend", label: "BTC EMA Trend Continuation", timeframes: ["M5","M15","H1","H4"], experimental: true },
  { id: "btc-sweep", label: "BTC Liquidity Sweep + BOS", timeframes: ["M5","M15","H1"], experimental: true },
  { id: "btc-breakout", label: "BTC ATR Range Breakout", timeframes: ["M15","H1","H4"], experimental: true },
  { id: "btc-reversion", label: "BTC Bollinger + RSI Range Reversal", timeframes: ["M15","H1"], experimental: true },
] as const;
export type BtcStrategyId = (typeof BTC_STRATEGIES)[number]["id"];
export type BtcStrategySelection = BtcStrategyId | "all";
/** Two conservative, testable starting configurations; both are experimental, NOT proven profitable. */
export const BTC_DEFAULT_ENABLED: BtcStrategyId[] = ["btc-trend","btc-breakout"];
export const isBitcoinMarket = (derivSymbol:string,category:string) =>
  category==="CRYPTO" && /^(?:cry)?BTCUSD$/i.test(derivSymbol);

export type BtcInput = {
 candles:Ohlc[];higher?:Ohlc[]|null;timeframe:Timeframe;now:number;open:boolean;
 decimals:number;strategy?:BtcStrategySelection;enabled?:BtcStrategyId[];
 minRR?:number;
};
type Candidate={id:BtcStrategyId;dir:Dir;stop:number;reason:string;zone?:[number,number]};
const ck=(label:string,value:string,ok:boolean|null):Check=>({label,value,ok});
const fmt=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?"unavailable":n.toFixed(2);
const labelFor=(id:BtcStrategyId)=>BTC_STRATEGIES.find(s=>s.id===id)!.label;

export function analyzeBtc(input:BtcInput):Analysis {
 const tf=input.timeframe,htfTf=HIGHER_TF[tf],now=input.now;
 const c=closedCandles(input.candles,tf,now),n=c.length;
 const candleTime=n?c[n-1]!.time+TF_SECONDS[tf]*1000:null;
 const selected=input.strategy&&input.strategy!=="all"?[input.strategy]:(input.enabled??BTC_DEFAULT_ENABLED);
 const strategies=BTC_STRATEGIES.filter(s=>selected.includes(s.id)&&s.timeframes.some(t=>t===tf));
 const base:Analysis={
   action:"NO TRADE",score:0,grade:"WEAK — NO TRADE",strategy:null,strategyId:null,
   timeframe:tf,higherTimeframe:htfTf,confirmTimeframe:CONFIRM_TF[tf],higherTrend:"NEUTRAL",
   marketRegime:"UNKNOWN",marketOpen:input.open,lastCandleTime:candleTime,
   expiresAt:candleTime==null?null:candleTime+TF_SECONDS[tf]*1000,entry:null,entryZone:null,
   stopLoss:null,takeProfit1:null,takeProfit2:null,riskReward:null,invalidation:null,
   confirmation:null,reasons:[],checks:[],breakdown:[],strategies:[],
 };
 const reject=(reason:string):Analysis=>({...base,reasons:[reason]});
 if(!input.open)return reject("BTC market is closed or suspended; no live signal.");
 if(!strategies.length)return reject("No BTC strategy enabled for this timeframe; select a supported strategy.");
 if(n<220)return reject(`BTC history insufficient: ${n} completed candles; require 220 to calculate EMA 200 safely.`);
 if(isStale(c,tf,now))return reject("BTC price candles stale; signal blocked.");
 const ctx=buildContext(c,5);
 if(!ctx)return reject("BTC indicators unavailable; no signal generated.");
 const h=input.higher?closedCandles(input.higher,htfTf,now):[];
 const htf:Trend=h.length>=55&&!isStale(h,htfTf,now)?higherTrend(h):"NEUTRAL";
 base.higherTrend=htf;
 const last=c[n-1]!,prev=c[n-2]!;
 const closes=c.map(k=>k.close);
 const e21=emaSeries(closes,21),e50=emaSeries(closes,50),e200=emaSeries(closes,200);
 const atrs=atrSeries(c),rsi=rsiSeries(closes),r=rsi.at(-1),rPrev=rsi.at(-2);
 const atr=atrs.at(-1);
 const adx=adxLast(c);
 if(atr==null||atr<=0||r==null||adx==null)return reject("BTC ATR/RSI/ADX cannot be computed.");
 const regime=adx>=25?"TRENDING":adx<20?"RANGING":"TRANSITION";
 base.marketRegime=regime;
 const checks:Check[]=[
   ck("Live data source","Deriv BTCUSD OHLC · no execution, order book or reliable volume data",true),
   ck("Completed candle time",new Date(candleTime!).toISOString(),true),
   ck("Data freshness","Fresh completed BTC candle",true),
   ck("ATR 14",fmt(atr),true),
   ck("RSI 14",fmt(r),r>=30&&r<=70),
   ck("ADX 14",`${fmt(adx)} · ${regime}`,adx>=20),
   ck("EMA 21",fmt(e21.at(-1)),e21.at(-1)!=null),
   ck("EMA 50",fmt(e50.at(-1)),e50.at(-1)!=null),
   ck("EMA 200",fmt(e200.at(-1)),e200.at(-1)!=null),
   ck(`${htfTf} trend`,htf,htf!=="NEUTRAL"),
 ];
 const findings:Candidate[]=[];
 const report:(id:BtcStrategyId,rule:string,pass:boolean,detail:string)=>void=(id,rule,pass,detail)=>{
   checks.push(ck(`${labelFor(id)} · ${rule}`,detail,pass));
 };
 for(const strategy of strategies){
   const id=strategy.id;
   let dir:Dir|null=null,stop=0,reason="",zone:[number,number]|undefined;
   if(id==="btc-trend"){
     const a=e21.at(-1),b=e50.at(-1),d=e200.at(-1);
     const up=a!=null&&b!=null&&d!=null&&a>b&&b>d&&last.close>d&&htf==="BULLISH";
     const down=a!=null&&b!=null&&d!=null&&a<b&&b<d&&last.close<d&&htf==="BEARISH";
     report(id,"EMA 21/50/200 + HTF alignment",up||down,up?"Bullish ribbon/HTF":down?"Bearish ribbon/HTF":"Not aligned");
     const recent=c.slice(-6,-1);
     const pullUp=a!=null&&recent.some(k=>k.low<=a+0.3*atr);
     const pullDown=a!=null&&recent.some(k=>k.high>=a-0.3*atr);
     const buy=up&&pullUp&&last.close>prev.high&&last.close>last.open&&r>=50&&r<70&&adx>=22;
     const sell=down&&pullDown&&last.close<prev.low&&last.close<last.open&&r<=50&&r>30&&adx>=22;
     report(id,"Pullback, closed-candle resumption, RSI and ADX",buy||sell,buy?"Bullish confirmation":sell?"Bearish confirmation":"Not all conditions met");
     if(buy||sell){dir=buy?1:-1;stop=buy?Math.min(...c.slice(-6).map(k=>k.low)):Math.max(...c.slice(-6).map(k=>k.high));reason="BTC EMA 21/50/200 trend pullback and confirmed continuation with higher-timeframe alignment";}
   }
   if(id==="btc-sweep"){
     const piv=swings(c.slice(0,-2),5),lo=piv.lows.at(-1),hi=piv.highs.at(-1);
     const bull=lo!=null&&prev.low<lo.price&&prev.close>lo.price&&last.close>prev.high&&last.close>last.open;
     const bear=hi!=null&&prev.high>hi.price&&prev.close<hi.price&&last.close<prev.low&&last.close<last.open;
     report(id,"Confirmed swing sweep and reversal",bull||bear,bull?"Prior low swept and reclaimed":bear?"Prior high swept and rejected":"No confirmed sweep");
     // A structure shift must be observable from completed candles, and in sweep direction.
     const br=structureBreak(ctx);
     const aligned=br!=null&&br.j>=n-2&&(bull&&br.dir===1||bear&&br.dir===-1);
     report(id,"Recent BOS / CHoCH confirms sweep",aligned,br?`${br.kind} ${br.dir===1?"bullish":"bearish"}`:"No recent structural break");
     if(aligned){dir=bull?1:-1;stop=bull?prev.low:prev.high;reason="Confirmed historical swing sweep followed by directional structure break"; }
   }
   if(id==="btc-breakout"){
     const prior=c.slice(-21,-1),upper=Math.max(...prior.map(k=>k.high)),lower=Math.min(...prior.map(k=>k.low));
     const recentAtr=atrs.slice(-35,-5).filter((x):x is number=>x!=null);
     const atrAverage=recentAtr.length?recentAtr.reduce((a,b)=>a+b,0)/recentAtr.length:0;
     const compressed=atrAverage>0&&atrs[n-2]!=null&&atrs[n-2]!<atrAverage*0.85&&upper-lower<5*atr;
     report(id,"Range and ATR compression",compressed,`Range ${fmt(lower)}–${fmt(upper)} · ATR avg ${fmt(atrAverage)}`);
     const buy=compressed&&last.close>upper+0.25*atr&&last.close>last.open&&last.close-last.open>=0.5*atr&&htf==="BULLISH";
     const sell=compressed&&last.close<lower-0.25*atr&&last.close<last.open&&last.open-last.close>=0.5*atr&&htf==="BEARISH";
     report(id,"Completed directional breakout + HTF confirmation",buy||sell,buy?"Above range":sell?"Below range":"No confirmed breakout");
     if(buy||sell){dir=buy?1:-1;stop=buy?lower:upper;reason="ATR-compressed BTC range broke with completed momentum candle and higher-timeframe agreement; price-only confirmation";}
   }
   if(id==="btc-reversion"){
     const bands=BollingerBands.calculate({values:closes,period:20,stdDev:2});
     const b=bands.at(-1),p=bands.at(-2);
     const range=adx<20&&htf==="NEUTRAL";
     report(id,"ADX range, neutral higher timeframe",range,`ADX ${fmt(adx)} · HTF ${htf}`);
     const buy=range&&p!=null&&b!=null&&rPrev!=null&&prev.close<p.lower&&rPrev<30&&last.close>b.lower&&last.close>last.open&&r>rPrev;
     const sell=range&&p!=null&&b!=null&&rPrev!=null&&prev.close>p.upper&&rPrev>70&&last.close<b.upper&&last.close<last.open&&r<rPrev;
     report(id,"Band excursion + extreme RSI + confirmed re-entry",buy||sell,buy?"Bullish snap-back":sell?"Bearish snap-back":"Re-entry not confirmed");
     if(buy||sell){dir=buy?1:-1;stop=buy?Math.min(prev.low,last.low):Math.max(prev.high,last.high);reason="BTC range Bollinger excursion followed by RSI-backed completed candle re-entry";}
   }
   if(dir!==null)findings.push({id,dir,stop,reason,...(zone?{zone}:{})});
 }
 base.checks=checks;
 base.strategies=strategies.map(s=>{
   const candidate=findings.find(x=>x.id===s.id);
   return {id:s.id,name:s.label,dir:candidate?.dir??null,score:candidate?100:null,action:candidate?(candidate.dir===1?"BUY" as const:"SELL" as const):"NO TRADE" as const,note:candidate?.reason??"Mandatory rules incomplete"};
 });
 if(!findings.length)return {...base,action:"WAIT",grade:"MODERATE — WATCHLIST",reasons:["No BTC setup passed every required rule. WAIT; do not invent entry, stop or profit levels."]};
 if(new Set(findings.map(f=>f.dir)).size!==1)return {...base,reasons:["BTC strategies disagree on direction. NO TRADE."]};
 const best=findings[0]!;
 const levels=buildLevels({id:"trend",dir:best.dir,stopRef:best.stop,confirmation:best.reason,reversal:best.id==="btc-reversion"||best.id==="btc-sweep"},ctx,{decimals:input.decimals,minRR:input.minRR??2});
 if(!levels.ok)return {...base,strategy:labelFor(best.id),reasons:[levels.reason]};
 const lv=levels.levels;
 return {...base,action:best.dir===1?"BUY":"SELL",score:100,grade:"HIGH CONFLUENCE",strategy:labelFor(best.id),
   entry:lv.entry,stopLoss:lv.stopLoss,takeProfit1:lv.takeProfit1,takeProfit2:lv.takeProfit2,riskReward:lv.riskReward,
   entryZone:null,invalidation:`BTC candle close ${best.dir===1?"below":"above"} ${best.stop.toFixed(input.decimals)} invalidates this setup.`,
   confirmation:best.reason,breakdown:[{label:"Mandatory BTC conditions passed (not win probability)",points:100,max:100}],
   reasons:["Experimental signal only. Slippage, spread and fees are not provided by this Deriv candle feed; not proven profitable."]};
}
