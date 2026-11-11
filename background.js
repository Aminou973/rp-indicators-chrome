// Fetches 1m bars for the content script (content scripts can't fetch cross-origin in MV3).
// Free public feeds, no keys: Yahoo Finance chart API (futures, delayed ~10 min) and Binance (crypto, live).
const MIN = 60000;

async function bars(sym) {
  const now = Date.now();
  let out;
  if (/USDT$/i.test(sym)) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym.toUpperCase())}&interval=1m&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    out = (await r.json()).map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  } else {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=2d`);
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0];
    if (!res?.timestamp) throw new Error("no data");
    const q = res.indicators.quote[0];
    out = res.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
      .filter((b) => b.h != null && b.l != null && b.c != null);
  }
  return out.filter((b) => b.t + MIN <= now); // closed bars only: no repaint, same as the Pine
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "bars") return;
  Promise.all(msg.symbols.map((s) => bars(s).then((b) => ({ sym: s, bars: b }), (e) => ({ sym: s, error: String(e.message || e) }))))
    .then(reply);
  return true; // async reply
});

// Toolbar click: drop the panel on any other site (needs no permission beyond activeTab)
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["tv-hook.js", "axis-hook.js"], world: "MAIN" }).catch(() => {});
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["rp.js", "content.js"] }).catch(() => {});
});
