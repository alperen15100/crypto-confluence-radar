const API_ENDPOINTS=[
'https://data-api.binance.vision',
'https://api1.binance.com',
'https://api2.binance.com',
'https://api3.binance.com',
'https://api4.binance.com',
'https://api.binance.com'
];
const WS_ENDPOINTS=['wss://data-stream.binance.vision/ws','wss://stream.binance.com:9443/ws'];
let apiIndex=0,wsIndex=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setConn(state,text=''){
 const el=document.getElementById('connection'); if(!el)return;
 el.classList.toggle('live',state==='live');
 el.dataset.state=state;
 el.innerHTML=`<i></i> ${text||({live:'Live',retry:'Reconnecting',degraded:'Backup connection',offline:'Offline · cached data'}[state]||state)}`;
}
async function resilientJSON(path){
 let last;
 for(let i=0;i<API_ENDPOINTS.length;i++){
  const base=API_ENDPOINTS[apiIndex%API_ENDPOINTS.length];
  try{
   const c=new AbortController(),timer=setTimeout(()=>c.abort(),9000);
   const r=await fetch(base+path,{signal:c.signal,cache:'no-store'});clearTimeout(timer);
   if(!r.ok)throw new Error('HTTP '+r.status);
   const data=await r.json(); setConn('live'); return data;
  }catch(e){
   last=e; apiIndex=(apiIndex+1)%API_ENDPOINTS.length;
   setConn('degraded','Switching endpoint…'); await sleep(Math.min(250*(i+1),1000));
  }
 }
 setConn('offline'); throw last||new Error('All market endpoints failed');
}
function cacheSet(k,v){try{localStorage.setItem('ccr:'+k,JSON.stringify({t:Date.now(),v}))}catch(e){}}
function cacheGet(k,maxAge=30*60*1000){try{let x=JSON.parse(localStorage.getItem('ccr:'+k));return x&&Date.now()-x.t<maxAge?x.v:null}catch(e){return null}}
function resilientSocket(stream,onmessage){
 let socket=null,stopped=false,attempt=0,timer=null;
 const connect=()=>{
  if(stopped)return;
  try{
   socket=new WebSocket(`${WS_ENDPOINTS[wsIndex%WS_ENDPOINTS.length]}/${stream}`);
   socket.onopen=()=>{attempt=0;setConn('live')};
   socket.onmessage=onmessage;
   socket.onerror=()=>{try{socket.close()}catch(e){}};
   socket.onclose=()=>{
    if(stopped)return;
    wsIndex=(wsIndex+1)%WS_ENDPOINTS.length;attempt++;
    const delay=Math.min(1000*Math.pow(2,Math.min(attempt-1,4)),15000);
    setConn('retry',`Reconnecting · ${Math.round(delay/1000)}s`);
    clearTimeout(timer);timer=setTimeout(connect,delay);
   };
  }catch(e){timer=setTimeout(connect,2000)}
 };
 connect();
 return{close(){stopped=true;clearTimeout(timer);try{socket&&socket.close()}catch(e){}}};
}
const $=id=>document.getElementById(id);
let universe=[],results=[],filter='all',selected=null,chart=null,candleSeries=null,ema9Series=null,ema21Series=null,detailSockets=[];

const fmt=n=>{n=Number(n); if(!isFinite(n))return'--'; if(Math.abs(n)>=1000)return n.toLocaleString(undefined,{maximumFractionDigits:2}); if(Math.abs(n)>=1)return n.toLocaleString(undefined,{maximumFractionDigits:4}); return n.toPrecision(4)};
const pct=n=>`${n>=0?'+':''}${Number(n).toFixed(2)}%`;
const avg=a=>a.reduce((x,y)=>x+y,0)/Math.max(a.length,1);

function ema(values,period){if(!values.length)return[]; const k=2/(period+1), out=[values[0]]; for(let i=1;i<values.length;i++)out.push(values[i]*k+out[i-1]*(1-k)); return out}
function rsi(values,p=14){if(values.length<=p)return 50; let g=0,l=0; for(let i=values.length-p;i<values.length;i++){let d=values[i]-values[i-1]; if(d>0)g+=d; else l-=d} if(l===0)return 100; let rs=(g/p)/(l/p); return 100-(100/(1+rs))}
function macd(values){let e12=ema(values,12),e26=ema(values,26),m=values.map((_,i)=>e12[i]-e26[i]),sig=ema(m,9); return {macd:m.at(-1),signal:sig.at(-1),hist:m.at(-1)-sig.at(-1)}}
function vwap(c){let pv=0,v=0; for(const x of c){let tp=(x.high+x.low+x.close)/3;pv+=tp*x.volume;v+=x.volume} return v?pv/v:c.at(-1)?.close}
function atr(c,p=14){let a=[];for(let i=1;i<c.length;i++)a.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));return avg(a.slice(-p))}
function fvg(c){let bull=null,bear=null;for(let i=Math.max(2,c.length-35);i<c.length;i++){if(c[i].low>c[i-2].high)bull={low:c[i-2].high,high:c[i].low};if(c[i].high<c[i-2].low)bear={low:c[i].high,high:c[i-2].low}}return {bull,bear}}
function supportResistance(c){let recent=c.slice(-50), lows=recent.map(x=>x.low), highs=recent.map(x=>x.high);return{support:Math.min(...lows),resistance:Math.max(...highs)}}
function volumeProfile(c,bins=24){let low=Math.min(...c.map(x=>x.low)),high=Math.max(...c.map(x=>x.high)),step=(high-low)/bins||1,arr=Array(bins).fill(0); for(const x of c){let p=(x.high+x.low+x.close)/3,i=Math.min(bins-1,Math.max(0,Math.floor((p-low)/step)));arr[i]+=x.volume} let im=arr.indexOf(Math.max(...arr));return{poc:low+(im+.5)*step}}
function parseKlines(d){return d.map(x=>({time:x[0]/1000,open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]}))}
async function getJSON(path){return resilientJSON(path)}
async function klines(symbol,interval='15m',limit=180){return parseKlines(await getJSON(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`))}
async function dailyLevels(symbol){let d=await klines(symbol,'1d',9);let prev=d.at(-2)||d.at(-1),week=d.slice(-8,-1);return{pdh:prev.high,pdl:prev.low,pwh:Math.max(...week.map(x=>x.high)),pwl:Math.min(...week.map(x=>x.low))}}

function analyze(symbol,c,ticker,levels=null){
 const closes=c.map(x=>x.close),price=closes.at(-1),R=rsi(closes),e9=ema(closes,9).at(-1),e21=ema(closes,21).at(-1),M=macd(closes),V=vwap(c.slice(-80)),F=fvg(c),SR=supportResistance(c),VP=volumeProfile(c.slice(-100)),A=atr(c),ev=[]; let score=50;
 const near=(a,b,m=1.2)=>Math.abs(a-b)<=A*m;
 if(e9>e21){score+=9;ev.push('EMA bullish')}else{score-=7;ev.push('EMA bearish')}
 if(M.hist>0){score+=7;ev.push('MACD momentum')}else score-=4;
 if(price>V){score+=7;ev.push('Above VWAP')}else{score-=4;ev.push('Below VWAP')}
 if(R<=35){score+=12;ev.push('RSI oversold')} else if(R>=65){score+=5;ev.push('RSI strong')} else if(R>45&&R<62){score+=4;ev.push('RSI balanced')}
 if(F.bull&&near(price,(F.bull.low+F.bull.high)/2,2)){score+=9;ev.push('Bullish FVG')} if(F.bear&&near(price,(F.bear.low+F.bear.high)/2,2)){score-=5;ev.push('Bearish FVG')}
 if(near(price,SR.support,1.5)){score+=10;ev.push('Near support')} if(near(price,VP.poc,1.3)){score+=8;ev.push('Volume POC')}
 let prevHigh=Math.max(...c.slice(-25,-1).map(x=>x.high)), breakout=price>prevHigh;
 if(breakout){score+=12;ev.push('Breakout')}
 if(levels){if(near(price,levels.pdl,1.5)){score+=7;ev.push('Previous day low')}if(near(price,levels.pwl,1.7)){score+=8;ev.push('Previous week low')}if(near(price,levels.pdh,1.2)){score+=5;ev.push('Previous day high')}}
 score=Math.max(0,Math.min(100,Math.round(score)));
 return {symbol,price,change:+ticker.priceChangePercent,quoteVolume:+ticker.quoteVolume,rsi:R,ema9:e9,ema21:e21,macd:M,vwap:V,fvg:F,sr:SR,poc:VP.poc,atr:A,score,evidence:ev,breakout,hot:score>=80,levels,candles:c};
}

async function loadUniverse(){
 $('scanStatus').textContent='Loading Binance…';
 let t;try{t=await getJSON('/api/v3/ticker/24hr');cacheSet('tickers',t)}catch(e){t=cacheGet('tickers');if(!t)throw e;setConn('offline')}
 universe=t.filter(x=>x.symbol.endsWith('USDT')&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol)&&+x.quoteVolume>500000).sort((a,b)=>+b.quoteVolume-+a.quoteVolume);
 $('marketCount').textContent=universe.length;
 setConn('live');
}

async function scan(){
 try{
   $('scanStatus').textContent='Deep scan running…'; $('refresh').disabled=true;
   if(!universe.length)await loadUniverse();
   const tf=$('timeframe').value, targets=universe.slice(0,36), out=[];
   for(let i=0;i<targets.length;i+=6){
     let chunk=targets.slice(i,i+6);
     let vals=await Promise.all(chunk.map(async t=>{try{return analyze(t.symbol,await klines(t.symbol,tf,160),t)}catch(e){return null}}));
     out.push(...vals.filter(Boolean)); $('scanStatus').textContent=`Analyzed ${Math.min(i+6,targets.length)}/${targets.length}`;
     render(out);
   }
   results=out.sort((a,b)=>b.score-a.score); render(results); updateStats();
   $('updated').textContent=`Last scan ${new Date().toLocaleTimeString()} · ${results.length} liquid markets deeply analyzed`;
   $('scanStatus').textContent='Live radar ready'; notifyHigh();
 }catch(e){console.error(e);$('scanStatus').textContent=results.length?'Connection interrupted · showing last scan':'Connection error';setConn(results.length?'offline':'retry')}
 finally{$('refresh').disabled=false}
}

function updateStats(){
 $('highCount').textContent=results.filter(x=>x.score>=80).length;
 $('breakoutCount').textContent=results.filter(x=>x.breakout).length;
 $('oversoldCount').textContent=results.filter(x=>x.rsi<=30).length;
 $('overboughtCount').textContent=results.filter(x=>x.rsi>=70).length;
}

function filtered(){
 let q=$('search').value.trim().toUpperCase(),arr=results;
 if(filter==='hot')arr=arr.filter(x=>x.score>=80);
 if(filter==='breakout')arr=arr.filter(x=>x.breakout);
 if(filter==='oversold')arr=arr.filter(x=>x.rsi<=30);
 if(filter==='overbought')arr=arr.filter(x=>x.rsi>=70);
 if(q)arr=arr.filter(x=>x.symbol.includes(q));
 return arr;
}

function render(source=results){
 if(source!==results && !results.length) results=source;
 let arr=source===results?filtered():source;
 $('radarBody').innerHTML=arr.length?arr.map(x=>`<tr>
 <td><div class="symbol">${x.symbol.replace('USDT','')} <span class="coin">/USDT</span></div></td>
 <td>${fmt(x.price)}</td><td class="${x.change>=0?'up':'down'}">${pct(x.change)}</td>
 <td class="${x.rsi<=30?'up':x.rsi>=70?'down':''}">${x.rsi.toFixed(1)}</td>
 <td><span class="score-pill">${x.score}</span></td>
 <td>${x.evidence.slice(0,4).map(e=>`<span class="badge">${e}</span>`).join('')}</td>
 <td><button class="open-btn" onclick="openMarket('${x.symbol}')">Open</button></td></tr>`).join(''):`<tr><td colspan="7" class="empty">No markets match this radar.</td></tr>`;
}

function levelRow(name,val,price){let d=(val-price)/price*100;return `<div><span>${name}</span><strong>${fmt(val)} <small class="${d>=0?'up':'down'}">${pct(d)}</small></strong></div>`}
function sigRow(name,val,good=true){return `<div><span>${name}</span><strong class="${good?'good':'bad'}">${val}</strong></div>`}

async function openMarket(symbol){
 detailSockets.forEach(s=>{try{s.close()}catch(e){}});detailSockets=[];
 let base=results.find(x=>x.symbol===symbol); if(!base)return;
 $('detail').classList.remove('hidden'); $('detailSymbol').textContent=symbol; $('detailMeta').textContent='Loading full technical context…'; window.scrollTo({top:$('detail').offsetTop-80,behavior:'smooth'});
 try{
   let [c,lv]=await Promise.all([klines(symbol,$('timeframe').value,300),dailyLevels(symbol)]);
   let ticker=universe.find(x=>x.symbol===symbol)||{priceChangePercent:0,quoteVolume:0};
   selected=analyze(symbol,c,ticker,lv);
   $('detailScore').textContent=selected.score; $('detailMeta').textContent=`${$('timeframe').value} · RSI ${selected.rsi.toFixed(1)} · ${pct(selected.change)} 24h`;
   $('breakdown').innerHTML=[
    sigRow('EMA 9 / 21',selected.ema9>selected.ema21?'Bullish':'Bearish',selected.ema9>selected.ema21),
    sigRow('MACD histogram',selected.macd.hist>0?'Positive':'Negative',selected.macd.hist>0),
    sigRow('VWAP',selected.price>selected.vwap?'Price above':'Price below',selected.price>selected.vwap),
    sigRow('RSI',selected.rsi.toFixed(1),selected.rsi<70),
    sigRow('FVG',selected.fvg.bull?'Bullish gap detected':selected.fvg.bear?'Bearish gap detected':'No nearby gap',!!selected.fvg.bull),
    sigRow('Breakout',selected.breakout?'Detected':'Not active',selected.breakout)
   ].join('');
   $('levels').innerHTML=levelRow('VWAP',selected.vwap,selected.price)+levelRow('Volume POC',selected.poc,selected.price)+levelRow('Support',selected.sr.support,selected.price)+levelRow('Resistance',selected.sr.resistance,selected.price)+levelRow('Prev Day High',lv.pdh,selected.price)+levelRow('Prev Day Low',lv.pdl,selected.price)+levelRow('Prev Week High',lv.pwh,selected.price)+levelRow('Prev Week Low',lv.pwl,selected.price);
   drawChart(selected); openOrderBook(symbol); openTrades(symbol);
 }catch(e){console.error(e);$('detailMeta').textContent='Could not load detail data'}
}

function drawChart(x){
 let el=$('chart');el.innerHTML='';
 chart=LightweightCharts.createChart(el,{layout:{background:{color:'#0a1411'},textColor:'#8aa99b'},grid:{vertLines:{color:'#12241d'},horzLines:{color:'#12241d'}},rightPriceScale:{borderColor:'#1b3329'},timeScale:{borderColor:'#1b3329',timeVisible:true},crosshair:{mode:0}});
 candleSeries=chart.addCandlestickSeries({upColor:'#54e792',downColor:'#ff687d',borderVisible:false,wickUpColor:'#54e792',wickDownColor:'#ff687d'});
 candleSeries.setData(x.candles);
 let e9=ema(x.candles.map(c=>c.close),9),e21=ema(x.candles.map(c=>c.close),21);
 ema9Series=chart.addLineSeries({lineWidth:1,title:'EMA9'});ema21Series=chart.addLineSeries({lineWidth:1,title:'EMA21'});
 ema9Series.setData(x.candles.map((c,i)=>({time:c.time,value:e9[i]})));ema21Series.setData(x.candles.map((c,i)=>({time:c.time,value:e21[i]})));
 const lines=[['VWAP',x.vwap],['POC',x.poc],['Support',x.sr.support],['Resistance',x.sr.resistance]];
 lines.forEach(([title,price])=>candleSeries.createPriceLine({price,title,lineWidth:1,lineStyle:2,axisLabelVisible:true}));
 if(x.fvg.bull)candleSeries.createPriceLine({price:(x.fvg.bull.low+x.fvg.bull.high)/2,title:'Bull FVG',lineWidth:1,lineStyle:1});
 if(x.levels){candleSeries.createPriceLine({price:x.levels.pdh,title:'PDH',lineWidth:1,lineStyle:3});candleSeries.createPriceLine({price:x.levels.pdl,title:'PDL',lineWidth:1,lineStyle:3})}
 chart.timeScale().fitContent(); $('legend').innerHTML='<span>EMA 9</span><span>EMA 21</span><span>VWAP</span><span>Volume POC</span><span>Support/Resistance</span><span>FVG</span><span>PDH/PDL</span>';
 new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth})).observe(el);
}

function openOrderBook(symbol){
 let s=resilientSocket(`${symbol.toLowerCase()}@depth10@1000ms`,e=>{let d=JSON.parse(e.data);$('bids').innerHTML=d.bids.slice(0,7).map(x=>`<div class="book-row up"><span>${fmt(x[0])}</span><span>${fmt(x[1])}</span></div>`).join('');$('asks').innerHTML=d.asks.slice(0,7).map(x=>`<div class="book-row down"><span>${fmt(x[0])}</span><span>${fmt(x[1])}</span></div>`).join('')}); detailSockets.push(s);
}
function openTrades(symbol){
 let arr=[];let s=resilientSocket(`${symbol.toLowerCase()}@aggTrade`,e=>{let d=JSON.parse(e.data),usd=+d.p*+d.q;if(usd<10000)return;arr.unshift({p:+d.p,q:+d.q,usd,buy:!d.m});arr=arr.slice(0,30);$('trades').innerHTML=arr.map(t=>`<div class="trade ${t.buy?'up':'down'}"><span>${t.buy?'BUY':'SELL'} ${fmt(t.p)}</span><strong>$${Math.round(t.usd).toLocaleString()}</strong></div>`).join('')});detailSockets.push(s);
}

function notifyHigh(){if(Notification.permission!=='granted')return; let x=results[0]; if(x&&x.score>=88){let key=`last-${x.symbol}-${Math.floor(Date.now()/1800000)}`;if(!sessionStorage[key]){new Notification(`High Confluence: ${x.symbol}`,{body:`Score ${x.score}/100 · ${x.evidence.slice(0,3).join(' + ')}`});sessionStorage[key]='1'}}}
$('notifyBtn').onclick=async()=>{if(!('Notification'in window))return alert('Notifications are not supported here.');let p=await Notification.requestPermission();$('notifyBtn').textContent=p==='granted'?'Alerts Enabled':'Alerts Blocked'};
$('refresh').onclick=scan;$('timeframe').onchange=scan;$('search').oninput=()=>render();
$('tabs').onclick=e=>{let b=e.target.closest('button');if(!b)return;document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.filter;render()};
window.openMarket=openMarket;

(async()=>{await scan();setInterval(async()=>{try{let t=await getJSON('/api/v3/ticker/24hr');cacheSet('tickers',t);let map=Object.fromEntries(t.map(x=>[x.symbol,x]));results.forEach(x=>{let q=map[x.symbol];if(q){x.price=+q.lastPrice;x.change=+q.priceChangePercent}});render();}catch(e){}},15000);setInterval(scan,180000)})();
