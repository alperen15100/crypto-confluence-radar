const $=id=>document.getElementById(id),API="https://fapi.binance.com",LIMIT=200,TOL=.005,RSI_LIMIT=70;
let markets=[],signals=[],chart=null,candleSeries=null,selected=null,scanning=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(p){let r=await fetch(API+p,{cache:"no-store"});if(!r.ok)throw Error(r.status);return r.json()}
function rsi(c,p=14){if(c.length<p+1)return null;let x=c.slice(-(p+1)),g=0,l=0;for(let i=1;i<=p;i++){let d=x[i]-x[i-1];d>=0?g+=d:l-=d}if(l===0)return 100;let rs=(g/p)/(l/p);return 100-100/(1+rs)}
function overbought(c){let R=rsi(c),price=c.at(-1);if(R<70)return null;let old=c.slice(0,-1).some(p=>Math.abs(p-price)/price<TOL);return old?null:{rsi:R,price}}
function key(s){return"overbought1d:"+s}function count(s){let n=Date.now(),a=[];try{a=JSON.parse(localStorage.getItem(key(s))||"[]")}catch(e){}a=a.filter(t=>n-t<86400000);let last=a.at(-1)||0;if(!last||n-last>=3600000)a.push(n);try{localStorage.setItem(key(s),JSON.stringify(a))}catch(e){}return a.length}
async function universe(){let[i,t]=await Promise.all([json("/fapi/v1/exchangeInfo"),json("/fapi/v1/ticker/24hr")]);let ok=new Set(i.symbols.filter(s=>s.quoteAsset==="USDT"&&s.contractType==="PERPETUAL"&&s.status==="TRADING").map(s=>s.symbol));markets=t.filter(x=>ok.has(x.symbol)).sort((a,b)=>+b.quoteVolume-+a.quoteVolume)}
async function candles(s){let d=await json(`/fapi/v1/klines?symbol=${s}&interval=1d&limit=200`);return d.map(c=>({time:Math.floor(c[0]/1000),open:+c[1],high:+c[2],low:+c[3],close:+c[4]}))}
async function analyze(t){try{let c=await candles(t.symbol),f=overbought(c.map(x=>x.close));if(!f)return null;return{symbol:t.symbol,rsi:f.rsi,price:f.price,change:+t.priceChangePercent,count:count(t.symbol),candles:c}}catch(e){return null}}
function fmt(v){
  if(!Number.isFinite(v)) return "--";
  const a=Math.abs(v);
  if(a===0) return "0";
  if(a>=1000) return v.toLocaleString(undefined,{maximumFractionDigits:2});
  if(a>=1) return v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6});
  if(a>=0.01) return v.toFixed(6).replace(/0+$/,"").replace(/\.$/,"");
  if(a>=0.000001) return v.toFixed(8).replace(/0+$/,"").replace(/\.$/,"");
  return v.toExponential(6);
}
function render(){let q=($("search").value||"").toUpperCase(),a=signals.filter(x=>x.symbol.includes(q));$("signalCount").textContent=signals.length;$("marketCount").textContent=markets.length;$("updated").textContent=new Date().toLocaleTimeString();$("feedRows").innerHTML=a.length?a.map(x=>`<div class="feed-item ${selected===x.symbol?"active":""}" data-s="${x.symbol}"><div class="feed-line"><span class="symbol">${x.symbol.replace("USDT","")}<span class="pair">/USDT.P</span></span><span class="badge">OVERBOUGHT</span></div><div class="feed-meta"><span>RSI <b>${x.rsi.toFixed(2)}</b></span><span>PRICE <b>${fmt(x.price)}</b></span><span>24H <b>${x.count}</b></span></div></div>`).join(""):'<div class="empty">No overbought market right now.</div>';document.querySelectorAll(".feed-item").forEach(e=>e.onclick=()=>openChart(e.dataset.s))}
function horizontalZones(c){let prior=c.slice(0,-1),last=c.at(-1),levels=[];for(let i=Math.max(2,prior.length-90);i<prior.length-2;i++){let h=prior[i].high;if(h>prior[i-1].high&&h>prior[i-2].high&&h>=prior[i+1].high&&h>=prior[i+2].high)levels.push(h)}levels.sort((a,b)=>Math.abs(a-last.close)-Math.abs(b-last.close));let chosen=[];for(let p of levels){if(!chosen.some(x=>Math.abs(x-p)/p<.01))chosen.push(p);if(chosen.length===3)break}return chosen}
function drawZones(c){if(!zonesOn||!candleSeries)return;horizontalZones(c).forEach((p,i)=>candleSeries.createPriceLine({price:p,title:"AUTO ZONE "+(i+1),lineWidth:1,lineStyle:2,axisLabelVisible:true}))}
function openChart(s){selected=s;let x=signals.find(v=>v.symbol===s);if(!x)return;$("chartSymbol").textContent=s.replace("USDT","")+"/USDT.P";$("metricRsi").textContent=x.rsi.toFixed(2);$("metricCount").textContent=x.count;$("tvLink").href=`https://www.tradingview.com/chart/?symbol=BINANCE:${s}.P`;let el=$("chart");el.innerHTML="";if(chart)try{chart.remove()}catch(e){}chart=LightweightCharts.createChart(el,{
  width:el.clientWidth,
  height:el.clientHeight||480,
  layout:{background:{color:"#050806"},textColor:"#75837a"},
  grid:{vertLines:{color:"#0e1511"},horzLines:{color:"#0e1511"}},
  rightPriceScale:{borderColor:"#1a241e"},
  localization:{priceFormatter:fmt},
  timeScale:{borderColor:"#1a241e"}
});
const minMove = x.price >= 1 ? 0.01 : x.price >= 0.01 ? 0.000001 : x.price >= 0.000001 ? 0.00000001 : 0.0000000001;
candleSeries=chart.addCandlestickSeries({priceFormat:{type:"price",minMove}});
candleSeries.setData(x.candles);candleSeries.createPriceLine({price:x.price,title:"PRICE",lineWidth:2,axisLabelVisible:true});drawBreakout(x.candles);chart.timeScale().fitContent();render()}
async function scan(){if(scanning)return;scanning=true;$("scanState").textContent="SCANNING";try{await universe();let found=[];for(let i=0;i<markets.length;i+=8){let v=await Promise.all(markets.slice(i,i+8).map(analyze));found.push(...v.filter(Boolean));await sleep(90)}signals=found.sort((a,b)=>b.count-a.count || b.rsi-a.rsi);render();if(!selected&&signals[0])openChart(signals[0].symbol);else if(selected&&signals.some(x=>x.symbol===selected))openChart(selected)}catch(e){console.warn(e)}finally{scanning=false;$("scanState").textContent="LIVE"}}
$("rescanBtn").onclick=scan;$("search").oninput=render;scan();setInterval(scan,60000);