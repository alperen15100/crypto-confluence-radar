# Crypto Daily Fresh Radar

Pure 1D scanner based on the working RSI + fresh horizontal breakout system.

Rules:
- Binance USDT perpetual futures only
- 1D candles only
- 200 candles
- RSI(14) >= 70
- Current close must have no previous close within ±0.5%
- Scan every 60 seconds
- Only matching FRESH signals are listed
- Clicking a signal opens its 1D chart
- Built by Ecrin Labs


## V8 Structure confirmation
FRESH remains the mandatory entry filter. Every FRESH candidate is then checked for three simple structure confirmations:
1. Daily close above the highest high of the prior 30 completed daily candles.
2. Daily close above the highest candle-body top of the prior 7 completed daily candles.
3. Current daily close above the previous daily close.
3/3 is labeled CONFIRMED. The chart remains 1D only and draws only the horizontal and body reference levels.
