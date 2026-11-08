import { describe, expect, it } from "vitest";
import { isDerivVolatilityIndex, parseDerivMarkets } from "./deriv-data";

const row=(underlying_symbol:string,underlying_symbol_name:string,market="synthetic_index")=>({
 underlying_symbol,underlying_symbol_name,market,pip_size:0.01,exchange_is_open:1,is_trading_suspended:0,
});

describe("Deriv Volatility Indices automatic discovery",()=>{
 it("detects standard, one-second, and higher-number volatility indices from actual provider metadata",()=>{
   const symbols=[
    row("R_10","Volatility 10 Index"),row("R_25","Volatility 25 Index"),
    row("R_50","Volatility 50 Index"),row("R_75","Volatility 75 Index"),
    row("R_100","Volatility 100 Index"),row("1HZ10V","Volatility 10 (1s) Index"),
    row("1HZ25V","Volatility 25 (1s) Index"),row("1HZ50V","Volatility 50 (1s) Index"),
    row("1HZ75V","Volatility 75 (1s) Index"),row("1HZ100V","Volatility 100 (1s) Index"),
    row("1HZ150V","Volatility 150 (1s) Index"),row("1HZ250V","Volatility 250 (1s) Index"),
    row("NEW_SYMBOL","Volatility 30 (1s) Index"),
   ];
   expect(symbols.every(isDerivVolatilityIndex)).toBe(true);
   const found=parseDerivMarkets(symbols);
   expect(found).toHaveLength(symbols.length);
   expect(found.every(m=>m.category==="VOLATILITY")).toBe(true);
   expect(found.find(m=>m.derivSymbol==="NEW_SYMBOL")?.name).toBe("Volatility 30 (1s) Index");
 });
 it("does not misclassify regular stock indices or unrelated synthetic families",()=>{
   expect(isDerivVolatilityIndex(row("BOOM500","Boom 500 Index"))).toBe(false);
   expect(isDerivVolatilityIndex(row("SWITCH","Volatility Switch 10 Index"))).toBe(false);
   expect(isDerivVolatilityIndex(row("R_100","Volatility 100 Index","indices"))).toBe(false);
   const mixed=parseDerivMarkets([
     row("R_100","Volatility 100 Index"),
     row("BOOM500","Boom 500 Index"),
     row("STOCK","US Tech 100","indices"),
   ]);
   expect(mixed.map(m=>[m.derivSymbol,m.category])).toEqual(expect.arrayContaining([
     ["R_100","VOLATILITY"],["BOOM500","SYNTHETIC"],["STOCK","INDEX"],
   ]));
 });
 it("preserves the provider open/suspended flag; never fabricates live data",()=>{
   const x=parseDerivMarkets([{...row("1HZ75V","Volatility 75 (1s) Index"),is_trading_suspended:1}]);
   expect(x[0]?.open).toBe(false);
 });
});
