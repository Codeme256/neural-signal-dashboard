/** Standalone, price-only Deriv index signal engine. Never routes through Forex DETECTORS. */
import { BollingerBands, MACD, Stochastic } from "technicalindicators";
import { atrSeries, emaSeries, rsiSeries, adxLast, swings, structureTrend } from "./strategies/indicators";
import { buildContext, trendSetup, liquiditySweep, fairValueGap, structureBreak } from "./strategies/detectors";
import { closedCandles, isStale, buildLevels } from "./signal-engine";
import { HIGHER_TF, CONFIRM_TF, TF_SECONDS, type Analysis, type Ohlc, type Timeframe, type Dir, type Check } from "./strategies/types";

export const INDEX_STRATEGIES = [
  { id: "trend", label: "Trend Continuation · benchmark", timeframes: ["M5","M15","M30","H1","H4"], experimental: false },
  { id: "macd", label: "MACD Histogram Scalping", timeframes: ["M5","M15"], experimental: true },
  { id: "ribbon", label: "EMA Ribbon Continuation", timeframes: ["H1","H4"], experimental: true },
  { id: "snapback", label: "Bollinger + RSI Snap-Back", timeframes: ["M15","H1"], experimental: true },
  { id: "atrbreak", label: "ATR Volatility Breakout", timeframes: ["M30","H1"], experimental: true },
  { id: "sweep", label: "Liquidity Sweep + MSS", timeframes: ["M5","M15"], experimental: true },
  { id: "imbalance", label: "FVG Imbalance", timeframes: ["M5","M15"], experimental: true },
] as const;
export type IndexStrategyId = (typeof INDEX_STRATEGIES)[number]["id"];
export type IndexStrategySelection = IndexStrategyId | "all";
export const INDEX_DEFAULT_ENABLED: IndexStrategyId[] = ["trend"];
const rrMin = 2;

export type IndexInput = {
  candles: Ohlc[]; higher?: Ohlc[] | null; timeframe: Timeframe; now: number; open: boolean;
  decimals: number; strategy?: IndexStrategySelection; enabled?: IndexStrategyId[];
  minRR?: number; breakoutAtrThreshold?: number;
};
type Finding = { dir: Dir; stopRef: number; why: string; checks: Check[]; zone?: [number,number] | null };
const check = (label:string, value:string, ok:boolean | null):Check => ({ label,value,ok });
const fmt=(n:number|null|undefined,d=3)=>n == null ? "n/a" : n.toFixed(d);
const lab=(dir:Dir)=>dir===1?"bullish":"bearish";

function evaluate(id: IndexStrategyId, c: Ohlc[], atr: number, adx: number | null): { finding:Finding|null; checks:Check[] } {
  const n=c.length, last=c[n-1]!, prev=c[n-2]!, closes=c.map(k=>k.close);
  const e50=emaSeries(closes,50), e9=emaSeries(closes,9), e21=emaSeries(closes,21), e55=emaSeries(closes,55);
  const rsi=rsiSeries(closes), r=rsi.at(-1) ?? null, a=(label:string,v:number|null|undefined)=>check(label,fmt(v),v!=null);
  const checks:Check[]=[];
  const yes=(label:string,pass:boolean,value:string)=>{checks.push(check(label,value,pass));return pass;};
  let dir:Dir|null=null, stopRef=0, why="", zone:[number,number]|null=null;
  if(id==="trend") {
    const ctx=buildContext(c);
    const setup=ctx && trendSetup(ctx);
    checks.push(check("Trend continuation",setup?.confirmation??"No completed-candle trigger",!!setup));
    if(setup){dir=setup.dir;stopRef=setup.stopRef;why=setup.confirmation;}
  }
  if(id==="macd"){
    const mac=MACD.calculate({values:closes,fastPeriod:12,slowPeriod:26,signalPeriod:9,SimpleMAOscillator:false,SimpleMASignal:false});
    const now=mac.at(-1),old=mac.at(-2), ema=e50.at(-1);
    checks.push(a("MACD 12/26/9",now?.MACD),a("MACD signal",now?.signal),a("MACD histogram",now?.histogram),a("EMA 50",ema));
    if(now?.MACD != null&&now.signal!=null&&now.histogram!=null&&old?.MACD!=null&&old.signal!=null&&old.histogram!=null&&ema!=null){
      const up=old.MACD<=old.signal&&now.MACD>now.signal&&old.MACD<0&&now.histogram>0&&now.histogram>old.histogram&&last.close>ema&&last.close>last.open;
      const down=old.MACD>=old.signal&&now.MACD<now.signal&&old.MACD>0&&now.histogram<0&&now.histogram<old.histogram&&last.close<ema&&last.close<last.open;
      yes("Completed MACD cross",up||down,up?"Bullish below zero":down?"Bearish above zero":"Absent or conflicting");
      yes("Histogram expansion",up||down,fmt(now.histogram));
      if(up||down){dir=up?1:-1;stopRef=up?Math.min(last.low,prev.low):Math.max(last.high,prev.high);why="MACD signal-line cross with histogram expansion and EMA 50 confirmation";}
    }
  }
  if(id==="ribbon"){
    const x=e9.at(-1),y=e21.at(-1),z=e55.at(-1), prior=c.slice(-5,-1);
    checks.push(a("EMA 9",x),a("EMA 21",y),a("EMA 55",z));
    if(x!=null&&y!=null&&z!=null){
      const up=x>y&&y>z,down=x<y&&y<z;
      yes("Ribbon alignment",up||down,up?"9 > 21 > 55":down?"9 < 21 < 55":"Mixed");
      const touchedUp=prior.some(k=>k.low<=y+0.25*atr&&k.close>=z-0.25*atr);
      const touchedDown=prior.some(k=>k.high>=y-0.25*atr&&k.close<=z+0.25*atr);
      const bull=up&&touchedUp&&last.close>prev.high&&last.close>last.open&&last.low<last.close;
      const bear=down&&touchedDown&&last.close<prev.low&&last.close<last.open;
      yes("Pullback and resumption",bull||bear,bull?"Bullish rejection/resumption":bear?"Bearish rejection/resumption":"Not confirmed");
      if(bull||bear){dir=bull?1:-1;stopRef=bull?Math.min(...c.slice(-5).map(k=>k.low)):Math.max(...c.slice(-5).map(k=>k.high));why="EMA 9/21/55 aligned, ribbon pullback and close beyond prior candle";zone=[Math.min(y,z),Math.max(y,z)];}
    }
  }
  if(id==="snapback"){
    const bands=BollingerBands.calculate({period:20,stdDev:2,values:closes});
    const now=bands.at(-1),old=bands.at(-2);
    checks.push(a("RSI 14",r),a("Bollinger upper",now?.upper),a("Bollinger lower",now?.lower),a("ADX 14",adx));
    const range=adx!=null&&adx<20;yes("Range-bound market",range,adx==null?"ADX unavailable":`ADX ${fmt(adx,1)}`);
    if(now&&old&&r!=null&&range){
      const up=prev.close<old.lower&&r<40&&last.close>now.lower&&last.close>last.open;
      const down=prev.close>old.upper&&r>60&&last.close<now.upper&&last.close<last.open;
      // Require the *oversold/overbought* reading on the triggering excursion (not a relaxed rebound).
      const rPrev=rsi.at(-2);
      const passed=up&&rPrev!=null&&rPrev<30||down&&rPrev!=null&&rPrev>70;
      yes("Band excursion and reversal",!!passed,passed?"Confirmed re-entry":"No qualifying completed re-entry");
      if(passed){dir=up?1:-1;stopRef=up?Math.min(last.low,prev.low):Math.max(last.high,prev.high);why="Bollinger excursion, extreme RSI and completed-candle re-entry in an ADX range";}
    }
  }
  if(id==="atrbreak"){
    const atrs=atrSeries(c), priorAtr=atrs.slice(-36,-1).filter((x):x is number=>x!=null);
    const avg=priorAtr.length?priorAtr.reduce((a,b)=>a+b,0)/priorAtr.length:null;
    const range=c.slice(-17,-1),high=Math.max(...range.map(k=>k.high)),low=Math.min(...range.map(k=>k.low));
    const compression=avg!=null&&avg>0&&Math.min(...priorAtr.slice(-10))<avg*0.8;
    const consolidation=high-low<=4*atr;
    const up=last.close>high&&last.close>last.open&&(last.close-high)>=(0.25*atr);
    const down=last.close<low&&last.close<last.open&&(low-last.close)>=0.25*atr;
    checks.push(a("ATR 14",atr),a("Prior ATR avg",avg));
    yes("ATR compression",compression,compression?"Confirmed":"Not compressed");
    yes("Consolidation",consolidation,`${fmt(low)}–${fmt(high)}`);
    yes("Price-only breakout (volume unavailable)",up||down,up?"Close above range":down?"Close below range":"No completed breakout");
    if(compression&&consolidation&&(up||down)){dir=up?1:-1;stopRef=up?low:high;why="ATR compression then candle closed beyond range; price-only confirmation (no volume feed)";}
  }
  if(id==="sweep"){
    const ctx=buildContext(c,5),s=ctx&&liquiditySweep(ctx),breakout=ctx&&structureBreak(ctx);
    checks.push(check("Confirmed prior swing swept",s?`${lab(s.dir)} sweep at ${fmt(s.level)}`:"Not found",!!s));
    checks.push(check("Sweep rejection",s?.confirmed?"Completed rejection":"Not confirmed",!!s?.confirmed));
    checks.push(check("Market structure shift",breakout?`${breakout.kind} ${lab(breakout.dir)}`:"Not found",!!(s&&breakout&&s.dir===breakout.dir&&breakout.j>s.k)));
    if(s&&s.confirmed&&breakout&&s.dir===breakout.dir&&breakout.j>s.k){dir=s.dir;stopRef=s.extreme;why="Confirmed swing sweep, rejection and subsequent directional structure break; institutional intent not assumed";}
  }
  if(id==="imbalance"){
    const ctx=buildContext(c,5),f=ctx&&fairValueGap(ctx);
    checks.push(check("Three-candle FVG",f?`${lab(f.dir)} ${fmt(f.bottom)}–${fmt(f.top)}`:"Absent or invalidated",!!f));
    checks.push(check("Market structure aligned",f?`Structure ${ctx?.structure??"NEUTRAL"}`:"Unavailable",!!(f&&ctx?.structure===(f.dir===1?"BULLISH":"BEARISH"))));
    if(f&&ctx?.structure===(f.dir===1?"BULLISH":"BEARISH")&&f.i<n-2){
      const mid=(f.top+f.bottom)/2;
      const tapped=f.dir===1?last.low<=mid&&last.low>=f.bottom&&last.close>mid&&last.close>last.open:last.high>=mid&&last.high<=f.top&&last.close<mid&&last.close<last.open;
      yes("50–100% gap retest and rejection",tapped,tapped?"Completed retracement/rejection":"Not confirmed");
      if(tapped){dir=f.dir;stopRef=f.dir===1?f.bottom:f.top;why="Confirmed three-candle imbalance, aligned structure and deep gap retest";zone=[f.bottom,mid];if(dir===-1)zone=[mid,f.top];}
    }
  }
  return {checks,finding:dir==null?null:{dir,stopRef,why,checks,zone}};
}

export function analyzeIndex(input:IndexInput):Analysis{
 const tf=input.timeframe,now=input.now,htf=HIGHER_TF[tf],closed=closedCandles(input.candles,tf,now);
 const selected=input.strategy==="all"||!input.strategy?(input.enabled??INDEX_DEFAULT_ENABLED):[input.strategy];
 const ids=INDEX_STRATEGIES.filter(s=>selected.includes(s.id)&&s.timeframes.some(t=>t===tf));
 const stamp=closed.at(-1)?closed.at(-1)!.time+TF_SECONDS[tf]*1000:null;
 const base:Analysis={action:"NO TRADE",score:0,grade:"WEAK — NO TRADE",strategy:null,strategyId:null,timeframe:tf,higherTimeframe:htf,confirmTimeframe:CONFIRM_TF[tf],higherTrend:"NEUTRAL",marketOpen:input.open,lastCandleTime:stamp,entry:null,entryZone:null,stopLoss:null,takeProfit1:null,takeProfit2:null,riskReward:null,invalidation:null,confirmation:null,reasons:[],checks:[],breakdown:[],strategies:[]};
 const reject=(message:string):Analysis=>({...base,reasons:[message]});
 if(!input.open)return reject("Market closed — no active index signal.");
 if(closed.length<70)return reject(`Insufficient index data: ${closed.length} completed candles (need 70).`);
 if(isStale(closed,tf,now))return reject("Index candles are stale — no actionable signal.");
 if(!ids.length)return reject("No enabled index strategies support this timeframe. Select another timeframe or enable one.");
 const ctx=buildContext(closed,5);
 if(!ctx)return reject("Index indicators unavailable; refusing to invent a signal.");
 const mac=MACD.calculate({values:closed.map(k=>k.close),fastPeriod:12,slowPeriod:26,signalPeriod:9,SimpleMAOscillator:false,SimpleMASignal:false}).at(-1);
 const bb=BollingerBands.calculate({period:20,stdDev:2,values:closed.map(k=>k.close)}).at(-1);
 const st=Stochastic.calculate({high:closed.map(k=>k.high),low:closed.map(k=>k.low),close:closed.map(k=>k.close),period:14,signalPeriod:3}).at(-1);
 const generic:Check[]=[check("MACD histogram",fmt(mac?.histogram),mac?.histogram!=null?mac.histogram>0:null),check("Bollinger 20/2",bb?`${fmt(bb.lower)} / ${fmt(bb.middle)} / ${fmt(bb.upper)}`:"n/a",bb?true:null),check("Stochastic 14/3",st?`K ${fmt(st.k,1)} / D ${fmt(st.d,1)}`:"n/a",st?true:null),check("ATR 14",fmt(ctx.atr),true),check("Data source","Deriv OHLC · completed candles · price-only (no exchange volume)",true),check("Last completed candle",stamp?new Date(stamp).toISOString():"none",stamp!=null)];
 const evaluations=ids.map(s=>({s,...evaluate(s.id,closed,ctx.atr,ctx.adx)}));
 base.strategies=evaluations.map(({s,finding,checks})=>({id:s.id,name:s.label,dir:finding?.dir??null,score:finding?100:null,action:finding?(finding.dir===1?"BUY":"SELL"):"NO TRADE",note:finding?.why ?? (checks.filter(c=>c.ok===false).map(c=>c.label).join(", ") || "No confirmation")}));
 const valid=evaluations.filter((v):v is typeof v & {finding:Finding}=>v.finding!==null);
 base.checks=generic.concat(evaluations.flatMap(v=>v.checks.map(c=>({...c,label:`${v.s.label}: ${c.label}`}))));
 if(!valid.length)return {...base,action:"WAIT",grade:"MODERATE — WATCHLIST",reasons:["No fully confirmed index setup. No actionable BUY or SELL."]};
 if(new Set(valid.map(v=>v.finding.dir)).size>1)return {...base,reasons:["Index strategies disagree on direction — suppressed."]};
 const winning=valid[0]!;
 const f=winning.finding;
 const lv=buildLevels({id:"trend",dir:f.dir,stopRef:f.stopRef,confirmation:f.why,reversal:false},ctx,{decimals:input.decimals,minRR:input.minRR??rrMin});
 if(!lv.ok)return {...base,strategy:winning.s.label,reasons:[lv.reason]};
 const level=lv.levels;
 const zone=f.zone?([Number(f.zone[0].toFixed(input.decimals)),Number(f.zone[1].toFixed(input.decimals))] as [number,number]):null;
 return {...base,action:f.dir===1?"BUY":"SELL",score:100,grade:"HIGH CONFLUENCE",strategy:winning.s.label,entry:level.entry,entryZone:zone,stopLoss:level.stopLoss,takeProfit1:level.takeProfit1,takeProfit2:level.takeProfit2,riskReward:level.riskReward,invalidation:`Close ${f.dir===1?"below":"above"} ${fmt(f.stopRef,input.decimals)} invalidates the setup.`,confirmation:f.why,breakdown:[{label:"Mandatory strategy rules",points:100,max:100}],reasons:["All required rules satisfied on completed price candles. No volume or spread data; experimental, not validated profitability."]};
}
