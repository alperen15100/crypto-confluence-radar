
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

async function analyze(ticker){
  try{
    const candles = await fetchDaily(ticker.symbol);
    const hit = testFresh(candles.map(c => c.close));
    if(!hit) return null;

    return {
      symbol: ticker.symbol,
      rsi: hit.rsi,
      price: hit.lastPrice,
      change: +ticker.priceChangePercent,
      count: updateHistory(ticker.symbol),
      candles
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
        <span class="fresh">FRESH</span>
      </td>
      <td>${fmt(x.price)}</td>
      <td class="${x.change >= 0 ? "up" : "down"}">${x.change >= 0 ? "+" : ""}${x.change.toFixed(2)}%</td>
      <td><strong>${x.rsi.toFixed(2)}</strong></td>
      <td>${x.count}</td>
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

    signals = found.sort((a,b) => b.rsi - a.rsi);
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
