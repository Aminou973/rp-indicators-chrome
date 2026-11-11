# rP Indicators for Chrome

My rP range 3/5/60 and the screener, pulled out of TradingView into a little floating panel so I can see them on Vest, NinjaTrader Web, TopstepX or wherever I'm trading.

It only shows stuff. It never touches orders.

## What's in the panel

- **Top card (the symbol you're on):** 3m / 5m / 60m direction, H / 50% / L, time left on each candle, the 60m 40% and 60% with a ✓ once touched, plus Setup and Sweep status with entry / stop / target.
- **Screener table:** same columns as the Pine screener: 3m, 5m, 60m, 60m lvl, Status, Sweep.
- **No-trade warning** (04:00 move, equity open, CPI / NFP / PPI / FOMC days) and the countdown to the next red-folder release.

The logic is a straight port of `rp_screener v1.3.pine` (ranges rebuilt from 1m bars, same setup and sweep rules), in `rp.js`.

## Install

1. `chrome://extensions` → turn on Developer mode
2. Load unpacked → pick this folder
3. Open TradingView, Vest, NinjaTrader Web, TopstepX or HyperProp. The panel shows up top right. Drag it by the header; it remembers where you left it.

On any other site, click the extension icon and it drops the panel there too.

⚙ in the header lets you change the symbol list. Futures use Yahoo symbols (`NQ=F`, `ES=F`, `GC=F`…), crypto uses Binance pairs (`BTCUSDT`).

## Where the data comes from

1. **The page's own chart feed (live).** TopstepX and a lot of other terminals build their charts on the TradingView charting library. When the extension can find it on the page, it asks that chart for 1m bars of whatever symbol you're on, so the card is as live as your chart. The header says `live, chart 1m` (or whatever timeframe) when this works.
2. **Fallback: free public feeds.** Futures come from Yahoo (about 10 min delayed), crypto from Binance (live). The screener table always uses these, so the other symbols in it are delayed for futures. There's no free live CME feed, sorry.

Micros map to the mini (MNQ → NQ), same price anyway.

## Lines on the chart

Two ways, picked on their own:

- **TradingView-library charts (TradingView, Vest, NinjaTrader Web, TopstepX, lots of crypto sites):** the full indicator look, drawn as real chart objects. You get the 3m / 5m / 60m step lines through history with the same colors, widths and fades as the Pine, the 60m 40–60% zone, ▲/▼ flip marks, L / S setups, touch dots and the H / 50% / L labels on the right. The bars come from the chart itself, so it's live. On a 1m chart everything is live. Where the page has its own data feed (NinjaTrader Web) it pulls 1m bars, so 5m works on any chart timeframe. Where it only has the chart bars (TradingView, Vest) a 3m chart can.t build the 5m, so that one comes from the delayed feed and stays out of setups.
- **Other canvas charts (HyperProp and similar):** the extension reads the numbers on the chart's price axis and lines up with them, so the current H / 50% / L and 40% / 60% follow your zoom and scroll. You only get the current levels here, no history or marks yet.

📏 turns green when either one is working. If neither works on some site, click 📏 and set two prices by hand.

## Per platform

| Platform | Status | Lines | Data |
|---|---|---|---|
| TradingView | ✅ works | full Pine look | live from the chart |
| Vest | ✅ works | full Pine look | live from the chart |
| NinjaTrader Web | ✅ works | full Pine look | live, 1m from its own feed (5m too on any chart timeframe) |
| TopstepX | ⚠️ not tested yet, should work (same chart engine) | full Pine look | live if found |
| HyperProp | ✅ works, but we also keep a native HyperProp version of the indicator that we update and share, use that one there | current levels that follow the price axis | public feed, delayed |
| Tradovate Classic | ❌ not working, its chart is WebGL. Use NinjaTrader Web with the same account instead | 📏 by hand only | public feed, delayed |

## Tests

```bash
node --test tests/rp.test.js tests/tv-hook.test.js
```

They check the range rule (close beyond = new range, wicks don't count, flips), candles with a missing last minute, setup (touch then flip in the 60m direction, window expiry, wrong-way flips), sweep, the 60m reset, and the NY session / news times.

## Changing things

Colors, levels, sessions, news dates, symbols: see [CUSTOMIZE.md](CUSTOMIZE.md). There's also a ready-made prompt in there you can hand to an AI to make the change for you.

## License

MPL-2.0, same as the Pine scripts. Not financial advice, it only shows levels and never places orders.
