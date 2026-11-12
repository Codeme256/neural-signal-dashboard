/**
 * Self-contained, dependency-free Telegram PNG card renderer.
 * Draws ACTUAL validated signal/outcome values; never embeds example prices.
 * No third-party image API, browser renderer, external fonts, or paid service.
 */
const W=840,H=950;
const FONT={
 "A":["01110","10001","10001","11111","10001","10001","10001"],
 "B":["11110","10001","10001","11110","10001","10001","11110"],
 "C":["01111","10000","10000","10000","10000","10000","01111"],
 "D":["11110","10001","10001","10001","10001","10001","11110"],
 "E":["11111","10000","10000","11110","10000","10000","11111"],
 "F":["11111","10000","10000","11110","10000","10000","10000"],
 "G":["01111","10000","10000","10111","10001","10001","01111"],
 "H":["10001","10001","10001","11111","10001","10001","10001"],
 "I":["11111","00100","00100","00100","00100","00100","11111"],
 "J":["00111","00010","00010","00010","10010","10010","01100"],
 "K":["10001","10010","10100","11000","10100","10010","10001"],
 "L":["10000","10000","10000","10000","10000","10000","11111"],
 "M":["10001","11011","10101","10101","10001","10001","10001"],
 "N":["10001","11001","10101","10011","10001","10001","10001"],
 "O":["01110","10001","10001","10001","10001","10001","01110"],
 "P":["11110","10001","10001","11110","10000","10000","10000"],
 "Q":["01110","10001","10001","10001","10101","10010","01101"],
 "R":["11110","10001","10001","11110","10100","10010","10001"],
 "S":["01111","10000","10000","01110","00001","00001","11110"],
 "T":["11111","00100","00100","00100","00100","00100","00100"],
 "U":["10001","10001","10001","10001","10001","10001","01110"],
 "V":["10001","10001","10001","10001","10001","01010","00100"],
 "W":["10001","10001","10001","10101","10101","10101","01010"],
 "X":["10001","10001","01010","00100","01010","10001","10001"],
 "Y":["10001","10001","01010","00100","00100","00100","00100"],
 "Z":["11111","00001","00010","00100","01000","10000","11111"],
 "0":["01110","10011","10101","10101","11001","10001","01110"],
 "1":["00100","01100","00100","00100","00100","00100","01110"],
 "2":["01110","10001","00001","00010","00100","01000","11111"],
 "3":["11110","00001","00001","01110","00001","00001","11110"],
 "4":["00010","00110","01010","10010","11111","00010","00010"],
 "5":["11111","10000","10000","11110","00001","00001","11110"],
 "6":["01111","10000","10000","11110","10001","10001","01110"],
 "7":["11111","00001","00010","00100","00100","00100","00100"],
 "8":["01110","10001","10001","01110","10001","10001","01110"],
 "9":["01110","10001","10001","01111","00001","00001","11110"],
 " ":["00000","00000","00000","00000","00000","00000","00000"],
 ".":["00000","00000","00000","00000","00000","00100","00100"],
 ",":["00000","00000","00000","00000","00100","00100","01000"],
 ":":["00000","00100","00100","00000","00100","00100","00000"],
 "-":["00000","00000","00000","11111","00000","00000","00000"],
 "+":["00000","00100","00100","11111","00100","00100","00000"],
 "/":["00001","00001","00010","00100","01000","10000","10000"],
 "%":["11001","11010","00100","00100","01011","10011","00000"],
 "|":["00100","00100","00100","00100","00100","00100","00100"],
 "=":["00000","11111","00000","11111","00000","00000","00000"],
 "?":["11110","00001","00010","00100","00100","00000","00100"],
 "(":["00010","00100","01000","01000","01000","00100","00010"],
 ")":["01000","00100","00010","00010","00010","00100","01000"],
};
const COLORS={bg:[3,13,27],deep:[5,22,38],box:[9,32,49],white:[240,247,250],muted:[145,176,194],cyan:[38,220,232],green:[67,233,139],red:[251,97,107],amber:[248,193,74],gold:[247,208,98]};
function rgba(p,i,c){p[i]=c[0];p[i+1]=c[1];p[i+2]=c[2];p[i+3]=255;}
function rect(p,x,y,w,h,c){
 for(let j=Math.max(0,Math.floor(y));j<Math.min(H,Math.ceil(y+h));j++){
  let i=(j*W+Math.max(0,Math.floor(x)))*4;
  for(let k=Math.max(0,Math.floor(x));k<Math.min(W,Math.ceil(x+w));k++,i+=4)rgba(p,i,c);
 }
}
function outline(p,x,y,w,h,c,t=2){
 rect(p,x,y,w,t,c);rect(p,x,y+h-t,w,t,c);rect(p,x,y,t,h,c);rect(p,x+w-t,y,t,h,c);
}
function fontText(p,x,y,value,scale=3,color=COLORS.white,maxChars=43){
 let pos=x;
 const t=String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9 .,:+\/%|=()?\-]/g," ").slice(0,maxChars);
 for(const letter of t){
  const rows=FONT[letter]??FONT["?"];
  for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(rows[r][c]==="1")
   rect(p,pos+c*scale,y+r*scale,scale,scale,color);
  pos+=6*scale;
 }
}
function panel(p,y,height=58){rect(p,35,y,770,height,COLORS.box);outline(p,35,y,770,height,[21,91,112],2);}
function row(p,y,label,value,valueColor=COLORS.white){
 fontText(p,55,y,label,3,COLORS.muted,18);
 fontText(p,345,y,value,3,valueColor,24);
}
function fmt(n){if(typeof n!=="number"||!Number.isFinite(n))return "N/A";return String(Number(n.toPrecision(9)));}
function dateEAT(ms){
 if(!Number.isFinite(ms))return "UNKNOWN";
 const d=new Date(ms+3*3600000);
 return d.toISOString().slice(0,16).replace("T"," ")+" EAT";
}
function lines(input){
 const type=input.type;
 if(type==="SIGNAL"){
  return {
   status:"CONFIRMED "+input.direction,accent:input.direction==="BUY"?COLORS.green:COLORS.red,
   rows:[
    ["SYMBOL",input.symbol],["STRATEGY",input.strategy],["TIMEFRAME",input.timeframe+" / M1 RETEST"],
    ["ENTRY",fmt(input.entry)],["STOP LOSS",fmt(input.stopLoss)],["TP1",fmt(input.tp1)],
    ["TP2",fmt(input.tp2)],["RISK REWARD","1:"+fmt(input.rr)],
    ["LIVE QUOTE",fmt(input.currentPrice)],["SETUP SCORE",fmt(input.score)+"/100"]
   ],
   analysis:[
    "M15 SETUP CONFIRMED",
    "M1 PULLBACK REJECTION VERIFIED",
    "LIVE QUOTE NEAR ENTRY"
   ],
   stamp:dateEAT(input.verifiedAt),footer:"SIGNAL ONLY / NO BROKER FILL VERIFIED"
  };
 }
 if(type==="WATCH"){
  return {
   status:"WAIT FOR ENTRY",accent:COLORS.amber,
   rows:[["SYMBOL",input.symbol],["STRATEGY",input.strategy],["TIMEFRAME",input.timeframe],
   ["BIAS",input.bias],["VERIFIED QUOTE",fmt(input.verifiedPrice)],
   ["PULLBACK LOW",fmt(input.zoneLow)],["PULLBACK HIGH",fmt(input.zoneHigh)],
   ["EXPIRES",dateEAT(input.expiresAt)],
   ["QUOTE SOURCE",input.dataSource],["QUOTE TIME",dateEAT(input.quoteTime)]],
   analysis:["NO CONFIRMED ENTRY","WAIT FOR M1 RETEST","CANCEL IF TARGET OR STOP HIT"],
   stamp:dateEAT(input.candleTime),footer:"WATCH ONLY / NOT AN ENTRY SIGNAL"
  };
 }
 const won=type==="WON",outcome=won?"WIN":"LOSS";
 const target=won?(input.target??"TP1"):"STOP LOSS";
 const risk=Math.abs(input.entry-input.stopLoss);
 const price=won?(input.target==="TP2"?input.tp2:input.tp1):input.stopLoss;
 const r=risk>0?Math.abs(price-input.entry)/risk:null;
 return {
  status:"SIGNAL "+(won?"WON":"LOST"),accent:won?COLORS.green:COLORS.red,
  rows:[["SYMBOL",input.symbol],["DIRECTION",input.direction],["STRATEGY",input.strategy],
   ["TIMEFRAME",input.timeframe],["ENTRY",fmt(input.entry)],["STOP LOSS",fmt(input.stopLoss)],
   ["TP1",fmt(input.tp1)],["TP2",fmt(input.tp2)],
   ["PRICE TOUCHED",target],["TARGET R",r===null?"N/A":(won?"+":"-")+fmt(r)+"R"]],
  analysis:won?
   ["TARGET TOUCHED IN M15 OHLC","NO BROKER FILL VERIFIED","FEES AND SLIPPAGE EXCLUDED"]:
   ["STOP TOUCHED BEFORE TP1","M15 CANDLE-BASED RESULT","NO BROKER FILL VERIFIED"],
  stamp:dateEAT(input.closedAt),footer:"HYPOTHETICAL PRICE RESULT / NOT TRADE PNL"
 };
}
function drawCard(input){
 if(!input||!["SIGNAL","WATCH","WON","LOST"].includes(input.type))throw Error("Unknown banner type");
 if(input.type==="WATCH"&&(![input.zoneLow,input.zoneHigh,input.expiresAt,input.verifiedPrice,input.quoteTime].every(x=>typeof x==="number"&&Number.isFinite(x))||
  input.zoneLow<=0||input.zoneHigh<=input.zoneLow||input.expiresAt<=Date.now()||
  input.verifiedPrice<=0||input.quoteTime>Date.now()+10000||Date.now()-input.quoteTime>90000||
  typeof input.dataSource!=="string"||!input.dataSource.length))
   throw Error("Invalid or stale price evidence for WATCH banner");
 const p=new Uint8Array(W*H*4),a=lines(input);
 for(let y=0;y<H;y++){
  const j=y*W*4;
  for(let x=0;x<W;x++){
   const i=j+x*4,glow=((x+y)%73<2?3:0);
   rgba(p,i,[3+glow,13+Math.floor(y/H*12)+glow,27+Math.floor(x/W*10)+glow]);
  }
 }
 rect(p,0,0,W,12,COLORS.cyan);
 fontText(p,45,42,"APEX SIGNAL TANK",5,COLORS.white,21);
 fontText(p,48,106,"DATA DRIVEN MARKET ANALYSIS",2,COLORS.cyan,34);
 rect(p,35,153,770,102,COLORS.deep);outline(p,35,153,770,102,a.accent,4);
 fontText(p,61,184,a.status,5,a.accent,24);
 const rows=a.rows.slice(0,10);
 for(let i=0;i<rows.length;i++){
  const y=278+i*52;panel(p,y,46);
  row(p,y+12,rows[i][0],rows[i][1],i===8?a.accent:COLORS.white);
 }
 rect(p,35,811,770,105,COLORS.deep);outline(p,35,811,770,105,COLORS.cyan,2);
 fontText(p,55,822,"EVIDENCE AND STATUS",3,COLORS.cyan,27);
 for(let i=0;i<a.analysis.length;i++)fontText(p,55,852+i*19,a.analysis[i],2,COLORS.white,56);
 fontText(p,42,930,a.stamp+" / "+a.footer,2,COLORS.muted,67);
 return p;
}
function uint32(n){return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function crc(bytes){
 let c=0xffffffff;
 for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c&1)?(c>>>1)^0xedb88320:c>>>1;}
 return (c^0xffffffff)>>>0;
}
function join(parts){
 const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let k=0;
 for(const p of parts){out.set(p,k);k+=p.length;}return out;
}
function chunk(type,data){
 const label=new TextEncoder().encode(type);
 const bytes=join([label,data]);
 return join([uint32(data.length),bytes,uint32(crc(bytes))]);
}
export async function renderSignalBanner(input){
 const pixels=drawCard(input),stride=W*4,raw=new Uint8Array((stride+1)*H);
 for(let y=0;y<H;y++){
  raw[y*(stride+1)]=0;
  raw.set(pixels.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
 }
 if(typeof CompressionStream!=="function")throw Error("PNG compression not supported");
 const stream=new CompressionStream("deflate");
 const writer=stream.writable.getWriter();
 const compressedPromise=new Response(stream.readable).arrayBuffer();
 await writer.write(raw);await writer.close();
 const compressed=new Uint8Array(await compressedPromise);
 const header=join([uint32(W),uint32(H),new Uint8Array([8,6,0,0,0])]);
 return join([
  new Uint8Array([137,80,78,71,13,10,26,10]),
  chunk("IHDR",header),chunk("IDAT",compressed),chunk("IEND",new Uint8Array())
 ]);
}
