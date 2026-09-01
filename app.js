
const $ = id => document.getElementById(id);
const API = "https://fapi.binance.com";
const SCAN_MS = 60 * 1000;
const LIMIT = 200;
const TOLERANCE = 0.005;
const RSI_LIMIT = 70;
const HISTORY_MS = 24 * 60 * 60 * 1000;

let markets = [];
let signals = [];
let scanning = false;
let chart = null;
let candleSeries = null;
let selectedSymbol = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(path){
  const r = await fetch(API + path, {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function calculateRSI(closes, period=14){
  if(!Array.isArray(closes) || closes.length < period + 1) return null;
  const x = closes.slice(-(period + 1));
  let gains = 0, losses = 0;

  for(let i=1;i<=period;i++){
    const diff = x[i] - x[i-1];
    if(diff >= 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if(avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function testFresh(closes){
  if(closes.length < 15) return null;

  const rsi = calculateRSI(closes, 14);
  const lastPrice = closes[closes.length - 1];

  if(rsi === null || rsi < RSI_LIMIT) return null;

  const previousNear = closes
    .slice(0, -1)
    .some(p => Math.abs(p - lastPrice) / lastPrice < TOLERANCE);

  if(previousNear) return null;

  return {rsi, lastPrice};
}

function historyKey(symbol){
  return `fresh1d:${symbol}`;
}

function updateHistory(symbol){
  const now = Date.now();
  let arr = [];
  try{ arr = JSON.parse(localStorage.getItem(historyKey(symbol)) || "[]"); }catch(e){}

  arr = arr.filter(t => now - t < HISTORY_MS);

  // Aynı açık günlük mum 60 saniyede bir sayacı şişirmesin:
  // son kayıt 1 saatten eskiyse yeni olay olarak say.
  const last = arr[arr.length - 1] || 0;
  if(!last || now - last >= 60 * 60 * 1000) arr.push(now);

  try{ localStorage.setItem(historyKey(symbol), JSON.stringify(arr)); }catch(e){}
  return arr.length;
}

async function loadMarkets(){
  const [info, tickers] = await Promise.all([
    getJSON("/fapi/v1/exchangeInfo"),
    getJSON("/fapi/v1/ticker/24hr")
  ]);

  const valid = new Set(
    (info.symbols || [])
      .filter(s =>
        s.quoteAsset === "USDT" &&
        s.contractType === "PERPETUAL" &&
        s.status === "TRADING"
      )
      .map(s => s.symbol)
  );

  markets = (tickers || [])
    .filter(t => valid.has(t.symbol))
    .sort((a,b) => (+b.quoteVolume) - (+a.quoteVolume));
}

async function fetchDaily(symbol){
  const data = await getJSON(`/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${LIMIT}`);
  if(!Array.isArray(data)) return [];
  return data.map(c => ({
    time: Math.floor(c[0] / 1000),
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4],
    volume: +c[5]
  }));
}


function structureConfirmation(candles){
  if(!candles || candles.length < 35) return {
    horizontal:false, weeklyBody:false, marketDirection:false,
    resistance:null, weeklyBodyLevel:null, confirmations:0
  };

  const last = candles.at(-1);
  const prev = candles.at(-2);

  // Horizontal structure: highest HIGH of the prior 30 completed daily candles.
  // The live daily candle must trade/close above it.
  const prior30 = candles.slice(-31,-1);
  const resistance = Math.max(...prior30.map(c=>c.high));
  const horizontal = last.close > resistance;

  // Higher-timeframe body proxy from daily data:
  // compare current price with the highest candle BODY top in the prior 7 completed daily candles.
  const prior7 = candles.slice(-8,-1);
  const weeklyBodyLevel = Math.max(...prior7.map(c=>Math.max(c.open,c.close)));
  const weeklyBody = last.close > weeklyBodyLevel;

  // Simple daily bullish structure confirmation.
  const marketDirection = last.close > prev.close;

  const confirmations = [horizontal,weeklyBody,marketDirection].filter(Boolean).length;
  return {horizontal,weeklyBody,marketDirection,resistance,weeklyBodyLevel,confirmations};
}

async function analyze(ticker){
  try{
    const candles = await fetchDaily(ticker.symbol);
    const hit = testFresh(candles.map(c => c.close));
    if(!hit) return null;

    const structure = structureConfirmation(candles);
    return {
      symbol: ticker.symbol,
      rsi: hit.rsi,
      price: hit.lastPrice,
      change: +ticker.priceChangePercent,
      count: updateHistory(ticker.symbol),
      candles,
      structure,
      status: structure.confirmations === 3 ? "CONFIRMED" : "FRESH"
    };
  }catch(e){
    return null;
  }
}

function fmt(v){
  if(v >= 1000) return v.toLocaleString(undefined,{maximumFractionDigits:2});
  if(v >= 1) return v.toFixed(4).replace(/0+$/,"").replace(/\.$/,"");
  return v.toPrecision(5);
}

function render(){
  $("signalCount").textContent = signals.length;
  $("marketCount").textContent = markets.length;
  $("updated").textContent = new Date().toLocaleTimeString();

  const body = $("signalRows");
  if(!signals.length){
    body.innerHTML = `<tr><td colspan="5" class="empty">Şu an kriteri geçen FRESH sinyal yok.</td></tr>`;
    return;
  }

  body.innerHTML = signals.map(x => `
    <tr data-symbol="${x.symbol}">
      <td>
        <strong>${x.symbol.replace("USDT","")}</strong>
        <span class="pair">/USDT.P</span>
        <span class="${x.status==="CONFIRMED"?"confirmed":"fresh"}">${x.status}</span>
      </td>
      <td>${fmt(x.price)}</td>
      <td><strong>${x.rsi.toFixed(2)}</strong></td>
      <td>${x.structure.horizontal ? "✓" : "—"}</td>
      <td>${x.structure.weeklyBody ? "✓" : "—"}</td>
      <td>${x.structure.marketDirection ? "✓" : "—"}</td>
      <td><strong>${x.structure.confirmations}/3</strong></td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-symbol]").forEach(row => {
    row.onclick = () => openDailyChart(row.dataset.symbol);
  });
}

async function openDailyChart(symbol){
  selectedSymbol = symbol;
  const hit = signals.find(x => x.symbol === symbol);
  const candles = hit?.candles || await fetchDaily(symbol);

  $("chartPanel").classList.remove("hidden");
  $("chartSymbol").textContent = symbol.replace("USDT","") + "/USDT.P";
  $("chartMeta").textContent = "1D · 200 candles";
  $("tvLink").href = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}.P`;

  const el = $("chart");
  el.innerHTML = "";

  if(chart) {
    try { chart.remove(); } catch(e){}
  }

  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: 430,
    layout: { background: {color:"#07100c"}, textColor:"#9fb2a7" },
    grid: { vertLines: {color:"#102019"}, horzLines: {color:"#102019"} },
    rightPriceScale: { borderColor:"#20352b" },
    timeScale: { borderColor:"#20352b", timeVisible:false }
  });

  candleSeries = chart.addCandlestickSeries();
  candleSeries.setData(candles.map(c => ({
    time:c.time, open:c.open, high:c.high, low:c.low, close:c.close
  })));

  const structure = structureConfirmation(candles);
  if(Number.isFinite(structure.resistance)){
    candleSeries.createPriceLine({
      price:structure.resistance,
      title:"30D Horizontal",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true
    });
  }
  if(Number.isFinite(structure.weeklyBodyLevel)){
    candleSeries.createPriceLine({
      price:structure.weeklyBodyLevel,
      title:"7D Body",
      lineWidth:1,
      lineStyle:3,
      axisLabelVisible:true
    });
  }
  chart.timeScale().fitContent();

  new ResizeObserver(() => {
    if(chart) chart.applyOptions({width:el.clientWidth});
  }).observe(el);
}

async function scan(){
  if(scanning) return;
  scanning = true;
  $("scanState").textContent = "Taranıyor…";

  try{
    await loadMarkets();
    const found = [];

    // Tüm USDT perpetual sözleşmelerini küçük gruplarla tarar.
    for(let i=0;i<markets.length;i+=8){
      const batch = markets.slice(i,i+8);
      const vals = await Promise.all(batch.map(analyze));
      found.push(...vals.filter(Boolean));
      await sleep(100);
    }

    signals = found.sort((a,b) => b.structure.confirmations-a.structure.confirmations || b.rsi-a.rsi);
    render();

    // Açık grafikteki coin hâlâ fresh ise grafiği yenile.
    if(selectedSymbol && signals.some(x => x.symbol === selectedSymbol)){
      openDailyChart(selectedSymbol);
    }
  }catch(e){
    console.warn(e);
  }finally{
    scanning = false;
    $("scanState").textContent = "Aktif";
  }
}

$("refreshBtn").onclick = scan;

scan();
setInterval(scan, SCAN_MS);
