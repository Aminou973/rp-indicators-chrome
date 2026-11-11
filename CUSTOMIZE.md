# Changing things

Everything is plain JavaScript, no build step. Edit a file, then hit reload on the extension in `chrome://extensions` and refresh your chart tab. Bump `"version"` in `manifest.json` every time so you can see in the panel header which build is running.

## Where stuff lives

| You want to change | File | Look for |
|---|---|---|
| Up / down colors | `rp.js` | `const UP = ...`, `DN = ...` |
| Line widths and fades per timeframe | `rp.js` | `const LOOK = { 3: ..., 5: ..., 60: ... }` |
| 40% / 60% levels, setup window (120 min) | `rp.js` | `opt = Object.assign({ lvLo: 0.4, lvHi: 0.6, winMin: 120 ...` (in `analyze` and `chartShapes`) |
| Session times (Asia / London / NY) | `rp.js` | `function session` (minutes after midnight, New York time) |
| No-trade windows (04:00 move, equity open, news ± 30 min) | `rp.js` | `function noTrade` |
| Red-folder news dates | `rp.js` | `const NEWS = {...}` (ends Dec 2027) |
| Default screener symbols | `content.js` | `DEF_LIST` (or just use ⚙ in the panel) |
| Which page tickers map to which feed symbol | `content.js` | `ROOTS` |
| How often data refreshes | `content.js` | `30000` (public feed) and `5000` (live chart bars) near the bottom |
| Sites it loads on by itself | `manifest.json` | both `"matches"` lists |
| Panel look | `content.js` | the `<style>` block at the top |

Run the tests after any logic change:

```bash
node --test tests/rp.test.js tests/tv-hook.test.js
```

## Let an AI do it

Open the folder in Claude Code (or paste the files into any AI chat) and use this prompt. Swap the last line for what you want.

```text
You're editing "rP Indicators", a Chrome extension (Manifest V3, plain JS, no build step).

Files:
- rp.js: the rP range engine (3m / 5m / 60m ranges from 1m bars, 40/50/60% touches, SETUP, SWEEP),
  New York sessions, no-trade windows, news calendar, and chartShapes() which builds the chart drawing.
  The rule: a candle that CLOSES beyond the range starts a new range in that direction, using that candle's high/low.
- content.js: the floating panel (screener + active symbol card) and the messages to the page hooks.
- tv-hook.js: runs in the page; finds a TradingView-library chart, reads live bars, draws the shapes.
- axis-hook.js: runs in the page; for other canvas charts, reads the price axis and draws the current levels.
- background.js: fetches public 1m bars (Yahoo for futures, Binance for crypto).
- tests/: node:test tests, run with `node --test tests/rp.test.js tests/tv-hook.test.js`.

Rules:
- Display only. Never add anything that places, modifies or cancels orders.
- Keep it dependency-free and build-free.
- Keep the range logic matching the Pine rules above; add or update a test for any logic change.
- Bump "version" in manifest.json.
- Run the tests and tell me what you changed in plain words.

What I want: <describe your change here, e.g. "make the 60m lines blue/orange instead of green/red">
```

## Not financial advice

It's an educational tool. It shows levels, it doesn't trade for you. Try it on a sim first.
