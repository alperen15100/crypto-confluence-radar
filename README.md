# Crypto Confluence Radar

A zero-server, browser-based real-time crypto confluence scanner built with Binance public market data.

## Features
- Live USDT market universe
- Deep scan of liquid markets
- Multi-indicator confluence score
- RSI, EMA 9/21, MACD, VWAP
- FVG detection
- Support / resistance
- Volume profile POC
- Breakout detection
- Previous day/week levels
- Live candlestick chart
- Order book
- Large trade feed
- Hot Zones / Breakouts / Oversold / Overbought radars
- Browser alerts
- Responsive mobile UI
- SEO metadata, sitemap, robots.txt
- GitHub Pages deployment

Built by **Ecrin Labs**.

> Educational market scanner only. Not financial advice.


## V3 Connection Resilience
REST endpoint failover, WebSocket automatic reconnect with exponential backoff, cached market-list fallback, and Live/Reconnecting/Backup/Offline states. The previous successful scan stays on screen when a refresh fails.
