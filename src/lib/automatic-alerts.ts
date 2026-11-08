/** Foreground-only market monitor. Never executes trades or fabricates missing candle data. */
import { fetchCandles } from "./candle-store";
import { analyze } from "./signal-engine";
import { analyzeIndex, INDEX_DEFAULT_ENABLED } from "./index-signal-engine";
import { analyzeBtc, BTC_DEFAULT_ENABLED, isBitcoinMarket } from "./btc-signal-engine";
import { HIGHER_TF, type Timeframe, type Analysis } from "./strategies/types";
import type { DerivMarket } from "./deriv-data";

export type StrongAlert = {
  id:string; symbol:string; derivSymbol:string; category:string; timeframe:Timeframe;
  strategy:string;direction:"BUY"|"SELL";entry:number;stopLoss:number;tp1:number;tp2:number;
  rr:number; candleTime:number;
};
export const ALERT_INTERVAL_MS=5*60*1000;
export const ALERT_BATCH_SIZE=8;
export const ALERT_TF:Timeframe="M15";
export function alertId(m:DerivMarket,tf:Timeframe,a:Analysis):string {
 return [m.derivSymbol,tf,a.strategy??"unknown",a.action,a.lastCandleTime??0].join("|");
}
export function actionableAlert(m:DerivMarket,tf:Timeframe,a:Analysis):StrongAlert|null {
 if(!m.open||(a.action!=="BUY"&&a.action!=="SELL")||a.score<70||
    a.lastCandleTime==null||a.entry==null||a.stopLoss==null||a.takeProfit1==null||
    a.takeProfit2==null||a.riskReward==null||a.riskReward<2||!a.strategy)return null;
 if(!(a.action==="BUY"?a.stopLoss<a.entry&&a.takeProfit1>a.entry:a.stopLoss>a.entry&&a.takeProfit1<a.entry))return null;
 return {id:alertId(m,tf,a),symbol:m.name,derivSymbol:m.derivSymbol,category:m.category,timeframe:tf,
  strategy:a.strategy,direction:a.action,entry:a.entry,stopLoss:a.stopLoss,tp1:a.takeProfit1,
  tp2:a.takeProfit2,rr:a.riskReward,candleTime:a.lastCandleTime};
}
export async function checkStrongAlerts(markets:DerivMarket[],tf:Timeframe,signal:AbortSignal):Promise<StrongAlert[]>{
 const candidates=markets.filter(m=>m.open);
 const found:StrongAlert[]=[];
 for(const m of candidates){
  if(signal.aborted)break;
  try{
   const candles=await fetchCandles(m.derivSymbol,tf,signal);
   const higher=await fetchCandles(m.derivSymbol,HIGHER_TF[tf],signal).catch(()=>null);
   if(signal.aborted)break;
   const now=Date.now();
   const a=isBitcoinMarket(m.derivSymbol,m.category)?
    analyzeBtc({candles,higher,timeframe:tf,now,open:m.open,decimals:m.decimals,enabled:BTC_DEFAULT_ENABLED}):
    m.category==="INDEX"?
    analyzeIndex({candles,higher,timeframe:tf,now,open:m.open,decimals:m.decimals,enabled:INDEX_DEFAULT_ENABLED}):
    analyze({candles,higher,timeframe:tf,now,open:m.open,decimals:m.decimals});
   const alert=actionableAlert(m,tf,a);
   if(alert)found.push(alert);
  }catch(e){if(signal.aborted)break;console.warn("Alert scanner: market data unavailable",m.symbol);}
 }
 return found;
}
