// Runs in the page's own JS world. Many web terminals (TopstepX, Tradovate's newer charts, lots of crypto
// sites) embed the TradingView charting library; if its widget object is reachable on window we draw
// the rP ranges as real chart lines, so they follow zoom and scroll.
(function () {
  "use strict";
  if (window.__rpHook) return;
  window.__rpHook = true;
  const drawn = new Map(); // widget -> entity ids we created

  // the chart often lives in a blank same-origin iframe (Vest, HyperProp): look in this window and every frame we can reach
  function widgets() {
    const out = [];
    const scan = (win, depth) => {
      try {
        for (const k of Object.getOwnPropertyNames(win)) {
          try {
            const v = win[k];
            if (v && typeof v === "object" && typeof v.activeChart === "function" && !out.includes(v)) out.push(v);
          } catch (_) { /* throwing getters */ }
        }
        if (depth < 3) for (let i = 0; i < win.frames.length; i++) scan(win.frames[i], depth + 1);
      } catch (_) { /* cross-origin frame */ }
    };
    scan(window, 0);
    return out;
  }

  // The widget's datafeed is the platform's own live feed (the one its chart uses). Its property name isn't
  // public, so look in the usual places.
  function feedOf(w) {
    const cands = [w._options && w._options.datafeed, w.options && w.options.datafeed, w._datafeed, w.datafeed];
    for (const k of Object.keys(w)) try { const v = w[k]; if (v && typeof v === "object") cands.push(v, v.datafeed); } catch (_) {}
    return cands.find((f) => f && typeof f.getBars === "function" && typeof f.resolveSymbol === "function");
  }

  // 1m bars of the chart's current symbol, last ~24 h, through the page's datafeed
  function liveBars(reply) {
    // best: a datafeed (library embeds like NinjaTrader Web, TopstepX) gives 1m bars whatever timeframe the chart shows
    for (const w of widgets()) {
      let sym, feed;
      try { sym = w.activeChart().symbol(); feed = feedOf(w); } catch (_) { continue; }
      if (sym && feed) return fromFeed(sym, feed, reply, () => chartBars(reply) || reply(null));
    }
    return chartBars(reply);
  }

  // TradingView.com and builds without a reachable datafeed: the bars the chart already has (live, chart timeframe)
  function chartBars(reply) {
    for (const w of widgets()) {
      try {
        const c = w.activeChart(), s = c._chartWidget.model().mainSeries(), b = s.bars(), res = +s.interval();
        if (!(res > 0) || !b.size()) continue;   // seconds / daily charts: skip
        const bars = [];
        for (let i = b.firstIndex(); i <= b.lastIndex(); i++) {
          const v = b.valueAt(i);
          if (v && v[0]) bars.push({ t: v[0] * 1000, o: v[1], h: v[2], l: v[3], c: v[4] });
        }
        reply({ sym: c.symbol(), res, bars });
        return true;
      } catch (_) { /* internals not there */ }
    }
    return false;
  }

  function fromFeed(sym, feed, reply, fallback) {
    const to = Math.floor(Date.now() / 1000), from = to - 26 * 3600;
    let answered = false;
    const done = (bars) => {
      if (answered) return;
      answered = true;
      if (!bars || !bars.length) return fallback();
      reply({ sym, res: 1, bars: bars.map((b) => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close })) });
    };
    const fail = () => { if (!answered) { answered = true; fallback(); } };   // feed won't give 1m: use the chart's bars
    try {
      feed.resolveSymbol(sym, (info) => {
        try {
          if (feed.getBars.length >= 7) feed.getBars(info, "1", from, to, done, fail, true);   // old library signature
          else feed.getBars(info, "1", { from, to, countBack: 1600, firstDataRequest: true }, done, fail);
        } catch (err) { fail(err && err.message); }
      }, fail);
    } catch (err) { fail(err && err.message); }
    return true;
  }

  addEventListener("message", (e) => {
    if (e.data && e.data.rpBarsReq) {
      const src = e.source || window;
      const send = (r) => { try { src.postMessage({ rpBars: r }, "*"); } catch (_) {} };
      if (!liveBars(send)) send(null);
      return;
    }
    const shapes = e.data && e.data.rpShapes;
    if (!Array.isArray(shapes)) return;
    let n = 0;
    for (const w of widgets()) {
      try {
        const c = w.activeChart();
        const have = drawn.get(w) || new Map();   // key -> entity id (or its Promise)
        drawn.set(w, have);
        const want = new Set(shapes.map((x) => x.key));
        // closed ranges keep their key, so only what changed gets removed / redrawn (no flicker)
        for (const [k, id] of have) if (!want.has(k)) { have.delete(k); Promise.resolve(id).then((x) => { try { c.removeEntity(x); } catch (_) {} }); }
        for (const x of shapes) {
          if (have.has(x.key)) continue;
          const pts = x.pts.map(([t, p]) => ({ time: Math.floor(t / 1000), price: p }));
          const o = { lock: true, disableSelection: true, disableSave: true, disableUndo: true, overrides: x.o };
          let id;
          if (x.kind === "poly") id = c.createMultipointShape(pts, Object.assign(o, { shape: "path" }));   // "polyline" closes into a filled polygon
          else if (x.kind === "rect") id = c.createMultipointShape(pts, Object.assign(o, { shape: "rectangle" }));
          else id = c.createShape(pts[0], Object.assign(o, { shape: "text", text: x.text }));
          if (id) have.set(x.key, id);   // sync id in old versions, Promise in new: both resolve fine above
        }
        n++;
      } catch (_) { /* not a chart widget after all, or chart not ready yet */ }
    }
    try { (e.source || window).postMessage({ rpHook: n }, "*"); } catch (_) {}
  });
})();
