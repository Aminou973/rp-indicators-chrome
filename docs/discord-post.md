**rP Indicators is now a Chrome extension 🟢🔴**

Got tired of flipping back to TradingView to check the ranges, so I put the rP 3/5/60 and the screener into a Chrome extension. It draws on the chart you're already trading on.

**What it does**
• 3m / 5m / 60m ranges drawn like the Pine: step lines, 50%, the 60m 40–60% zone, ▲/▼ flips, L/S setups
• Floating screener: NQ ES YM RTY GC CL BTC with direction, 60m levels touched, setup + sweep status
• No-trade warnings (04:00, equity open, CPI/NFP/PPI/FOMC) + countdown to the next news
• Display only. It never touches your orders

**Where it works**
✅ Vest, live from the chart
✅ NinjaTrader Web, live (gets 1m from the feed, so 5m shows on any timeframe)
✅ TradingView
✅ HyperProp: current levels on the chart. We also have the native HyperProp script, use that one there
⚠️ TopstepX: haven't tested yet, should work
❌ Tradovate Classic: no lines (WebGL chart). Log into NinjaTrader Web with the same account and you're good

**Install (2 min)**
1. Grab the zip: https://github.com/Aminou973/rp-indicators-chrome/archive/refs/heads/main.zip
2. Unzip, go to `chrome://extensions`, turn on Developer mode
3. Load unpacked → pick the folder
4. Open your chart, panel's top right

Page with screenshots: https://aminou973.github.io/tiltguard/#rp

Want other colors, levels or symbols? There's a CUSTOMIZE file in the repo with a prompt you can drop into Claude/ChatGPT and it'll change it for you.

Free, open source. Not financial advice, test it on sim first. Tell me what breaks 👇
