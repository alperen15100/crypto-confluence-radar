# Crypto Overbought Radar
Built by Ecrin Labs.

Core behavior:
- Binance USDT perpetual futures
- 1D chart
- RSI >= 70
- 200 daily candles
- no prior close within +/-0.5%
- every successful scan increments the 24h overbought count
- technical flow ranks markets by highest 24h overbought count
- no overbought wording in the UI
- improved formatting for very small prices
- optional Auto Confluence horizontal zones
