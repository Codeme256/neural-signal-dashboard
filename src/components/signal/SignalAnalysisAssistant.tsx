import { useState } from "react";
import { Bot, Send, ShieldAlert } from "lucide-react";
import { buildFollowUpReport } from "@/lib/signal-follow-up";
import { pairStrategyReviews, alternativesFor } from "@/lib/pair-strategy-policy";
import type { TrackedSignal } from "@/lib/signal-tracker";
type Reply={q:string;a:string};
const options=["Why are signals losing?","Which pair/strategy should I avoid?","What strategies should I test instead?","What should I do before changing signals?"];
export function SignalAnalysisAssistant({signals}:{signals:TrackedSignal[]}){
 const [history,setHistory]=useState<Reply[]>([]);
 const [question,setQuestion]=useState("");
 const report=buildFollowUpReport(signals);
 const reviews=pairStrategyReviews(signals);
 function answer(q:string){
  const normalized=q.toLowerCase();
  const recognized=/why|loss|losing|win|profit|avoid|block|pair|strategy|alternative|test|improve|data|sample|risk|performance|signal|result|how|what|which|filter|review|track|accuracy/.test(normalized);
  if(!recognized)return "I can explain this account's tracked signal outcomes, loss clusters, risky pair/strategy combinations, and the evidence needed before changing a strategy. Try one of the example questions. I have no external AI model connection and do not make up market predictions.";
  if(report.resolved===0)return "There are no fully resolved tracked signal outcomes yet. Track a BUY/SELL signal, then open Signal Analysis to verify its outcome against Deriv candles. Until outcomes exist I cannot establish which strategy is working.";
  if(/alternative|instead|match|better strategy/.test(normalized)){
   const pairs=reviews.filter(x=>x.verdict==="AVOID");
   if(!pairs.length)return "No alternative strategy is currently verified as a research candidate for an avoided pair. Each pair/strategy needs at least 40 resolved outcomes and positive gross average R in both chronological halves before it appears as a candidate. A positive historical result is not a guarantee of profit.";
   return pairs.map(x=>{
     const a=alternativesFor(reviews,x.symbol,x.strategy);
     return x.symbol+" / "+x.strategy+": "+(a.length?a.map(v=>v.strategy+" ("+v.total+" outcomes)").join(", "):"no sufficiently supported alternative")+".";
   }).join(" ");
  }
  if(/avoid|block|which pair|filter/.test(normalized)){
   const bad=reviews.filter(x=>x.verdict==="AVOID");
   return bad.length
     ?"Loss-history avoidance currently flags: "+bad.map(x=>x.symbol+" / "+x.strategy+" ("+x.losses+" losses out of "+x.total+")").join("; ")+". This review uses hypothetical candle outcomes, not broker fills."
     :"No pair/strategy combination currently qualifies for automatic loss-history avoidance. "+reviews.length+" combinations have been evaluated; the strict rule needs 40+ resolved outcomes and negative average R in both time-separated halves. A single loss should not disable an entire pair.";
  }
  if(/what|which|why|loss|losing|performance|profit|win|accuracy/.test(normalized)){
   const won=signals.filter(s=>s.closedAt!==null&&s.status==="WON").length;
   const lost=signals.filter(s=>s.closedAt!==null&&s.status==="LOST").length;
   const top=report.topLossClusters.slice(0,3).map(x=>x.label+": "+x.losses+" losses / "+x.resolved+" resolved").join("; ");
   return "Of the stored account-tracked signals, "+won+" have final WON outcomes and "+lost+" have final LOST outcomes (only the tracked subset, not all issued signals). Main loss clusters: "+(top||"none yet")+". "+(report.sampleReady?"Review the breakdown by strategy, timeframe and pair before suggesting a change.":"The sample is too small to infer a durable failure pattern.")+" Spread, fees, fill timing and slippage are not captured.";
  }
  return "Before changing rules, collect more resolved outcomes by pair and strategy, check data freshness, estimate realistic transaction costs, and evaluate proposed filters on a later unseen time period. APEX never automatically rewrites live strategy logic from this chat.";
 }
 const send=(q:string)=>{const text=q.trim().slice(0,500);if(!text)return;setHistory(x=>[...x,{q:text,a:answer(text)}].slice(-16));setQuestion("");};
 return <section className="rounded-xl border border-primary/30 bg-card/70 p-4 sm:p-5" aria-label="Signal analysis assistant">
   <div className="flex items-start gap-3">
     <div className="rounded-lg bg-primary/10 p-2"><Bot className="h-5 w-5 text-primary"/></div>
     <div><h2 className="font-display text-lg font-bold">APEX SIGNAL ANALYSIS ASSISTANT</h2>
      <p className="mt-1 text-xs text-muted-foreground">Working evidence-based assistant using your tracked signal results. Answers use recorded data only; no paid LLM or live trading access.</p>
     </div>
   </div>
   <div className="mt-3 flex flex-wrap gap-2">
     {options.map(o=><button key={o} type="button" onClick={()=>send(o)} className="chip chip-sm text-xs">{o}</button>)}
   </div>
   <div role="log" aria-live="polite" className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border bg-background/50 p-3">
     {history.length===0?<p className="text-xs text-muted-foreground">Ask a question about tracked wins, losses or strategy alternatives. I will answer from your recorded outcomes.</p>:
       history.map((h,i)=><div key={i} className="space-y-1 text-sm">
         <p className="ml-4 rounded-lg bg-primary/10 p-2 text-right text-xs font-medium">{h.q}</p>
         <p className="rounded-lg bg-card p-3 text-xs leading-relaxed">{h.a}</p>
       </div>)}
   </div>
   <form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();send(question);}}>
     <label htmlFor="apex-signal-assistant-question" className="sr-only">Ask about signal outcomes</label>
     <input id="apex-signal-assistant-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} placeholder="Ask why a pair/strategy is losing…" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
     <button type="submit" disabled={!question.trim()} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4"/><span className="sr-only">Ask</span></button>
   </form>
   <p className="mt-3 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-300"><ShieldAlert className="h-4 w-4 shrink-0"/>This is a data-driven question-answer assistant, not a connected Grok/Claude model. It does not predict prices, change strategy parameters or place orders.</p>
 </section>;
}