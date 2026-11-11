// Runs in the page's own JS world, every frame. For charts that aren't the TradingView library (Tradovate,
// HyperProp, ...): it watches the numbers the chart writes on its price axis (canvas fillText), fits
// price -> pixel from them, and draws the rP levels on a see-through canvas on top. Because the axis is
// redrawn on every zoom / scroll, the lines follow it on their own.
(function () {
  "use strict";
  if (window.__rpAxis) return;
  window.__rpAxis = true;
  const NUM = /^-?\d[\d,\s]*(\.\d+)?$/;
  const seen = new Map(); // chart canvas -> recent axis-looking labels {x, y, v, t} in canvas pixels
  const orig = CanvasRenderingContext2D.prototype.fillText;
  function record(c, s, x, y) {
    const v = parseFloat(s.replace(/[,\s]/g, ""));
    if (!isFinite(v)) return;
    let a = seen.get(c);
    if (!a) seen.set(c, (a = []));
    a.push({ x, y, v, t: performance.now() });
    if (a.length > 600) a.splice(0, 300);
  }
  // some charts (HyperProp) draw numbers one character at a time: glue touching characters back together
  let cur = null;
  const flush = () => { if (cur && NUM.test(cur.s)) record(cur.c, cur.s, cur.x, cur.y); cur = null; };
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    try {
      const c = this.canvas;
      if (typeof text === "string" && c && c.width > 300 && c.height > 200 && !c.__rpOverlay) {
        const m = this.getTransform();
        // center of the text: correct for the baseline the chart used
        const px = parseFloat(this.font) || 11, b = this.textBaseline;
        const dy = b === "middle" ? 0 : b === "top" || b === "hanging" ? px * 0.5 : -px * 0.35;
        const X = m.a * x + m.c * (y + dy) + m.e, Y = m.b * x + m.d * (y + dy) + m.f;
        if (text.length === 1 && /[\d.,]/.test(text)) {
          if (cur && cur.c === c && Math.abs(Y - cur.y) < 1 && X > cur.xl && X - cur.xl < px * 1.5 * m.a) { cur.s += text; cur.xl = X; }
          else { flush(); cur = { c, s: text, x: X, y: Y, xl: X }; }
        } else {
          flush();
          if (text.length < 14 && NUM.test(text)) record(c, text, X, Y);
        }
      }
    } catch (_) { /* never break the page's drawing */ }
    return orig.call(this, text, x, y, ...rest);
  };

  // y = A + B * price from the labels: the pair that most other labels agree with (within 2 px) wins,
  // so the time axis, volume pane or order-book numbers can't throw it off
  function fit(c) {
    const now = performance.now();
    const all = (seen.get(c) || []).filter((p) => now - p.t < 2000);
    const byV = new Map();
    for (const p of all) byV.set(p.v + ":" + Math.round(p.y), p);
    const pts = [...byV.values()].slice(-60);
    let best = null;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const p = pts[i], q = pts[j];
      if (p.v === q.v || Math.abs(p.x - q.x) > 40) continue;      // same axis column
      const B = (q.y - p.y) / (q.v - p.v);
      if (!(B < 0)) continue;                                        // higher price = higher on screen
      const A = p.y - B * p.v;
      const inl = pts.filter((r) => Math.abs(A + B * r.v - r.y) < 2 && Math.abs(r.x - p.x) < 40);
      if (inl.length >= 3 && (!best || inl.length > best.n)) best = { A, B, n: inl.length, axisX: Math.min(...inl.map((r) => r.x)) };
    }
    return best;
  }

  let levels = [];
  const overlays = new Map(); // chart canvas -> our canvas
  addEventListener("message", (e) => {
    if (e.data && Array.isArray(e.data.rpLevels)) levels = e.data.rpLevels;
  });

  function overlayFor(c) {
    let o = overlays.get(c);
    if (!o) {
      o = document.createElement("canvas");
      o.__rpOverlay = true;
      o.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646";
      document.documentElement.appendChild(o);
      overlays.set(c, o);
    }
    return o;
  }

  setInterval(() => {
    for (const [c, o] of overlays) if (!c.isConnected || !levels.length) { o.getContext("2d").clearRect(0, 0, o.width, o.height); }
    if (!levels.length) return;
    // the biggest canvas with a readable price axis is the main chart
    let chart = null, area = 0;
    for (const c of seen.keys()) {
      if (!c.isConnected) { seen.delete(c); continue; }
      const f = fit(c);
      if (f && c.width * c.height > area) { chart = { c, f }; area = c.width * c.height; }
    }
    if (!chart) return;
    const { c, f } = chart, r = c.getBoundingClientRect(), o = overlayFor(c);
    const sx = r.width / c.width, sy = r.height / c.height, dpr = devicePixelRatio || 1;
    if (o.width !== Math.round(r.width * dpr) || o.height !== Math.round(r.height * dpr)) { o.width = Math.round(r.width * dpr); o.height = Math.round(r.height * dpr); }
    Object.assign(o.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const g = o.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    // wrong symbol on the chart (levels nowhere near the visible prices): draw nothing
    const lo = (f.A - c.height) / -f.B, hi = f.A / -f.B, span = hi - lo;
    if (!levels.some((L) => L.p > lo - span && L.p < hi + span)) return;
    const right = f.axisX * sx - 4;
    g.font = "10px ui-monospace,Consolas,monospace";
    g.textAlign = "right";
    for (const L of levels) {
      const y = Math.round((f.A + f.B * L.p) * sy) + 0.5;
      if (y < 0 || y > r.height) continue;
      g.strokeStyle = g.fillStyle = L.c;
      g.lineWidth = L.w;
      g.setLineDash(L.s ? [4, 4] : []);
      g.beginPath(); g.moveTo(0, y); g.lineTo(right, y); g.stroke();
      g.fillText(`${L.t}  ${L.p.toFixed(L.p < 10 ? 4 : 2)}`, right - 4, y - 3);
    }
    try { window.top.postMessage({ rpAxis: 1 }, "*"); } catch (_) {}   // tells the panel the auto overlay is on
  }, 250);
})();
