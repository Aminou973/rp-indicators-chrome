// rP range engine, ported from "rp_screener v1.3.pine" (f_tf / f_sym) and "rp_range_Minoux mod v1.5.pine".
// Pure functions, no DOM: loaded by the content script and by tests/rp.test.js.
(function (root) {
  "use strict";
  const MIN = 60000;
  const NY = "America/New_York";

  // Red-folder calendar copied from the Pine v1.5 / screener v1.3 (bls.gov + federalreserve.gov)
  // shortcut: dates end Dec 2027, add 2028 when BLS / the Fed publish them (same as the Pine)
  const NEWS = {
    CPI: "2026-11-10 2026-12-10 2027-01-13 2027-02-11 2027-03-10 2027-04-13 2027-05-12 2027-06-10 2027-07-14 2027-08-11 2027-09-14 2027-10-14 2027-11-10 2027-12-10",
    NFP: "2026-11-06 2026-12-04 2027-01-08 2027-02-05 2027-03-05 2027-04-02 2027-05-07 2027-06-04 2027-07-02 2027-08-06 2027-09-03 2027-10-08 2027-11-05 2027-12-03",
    PPI: "2026-11-13 2026-12-15 2027-01-14 2027-02-12 2027-03-12 2027-04-14 2027-05-13 2027-06-11 2027-07-15 2027-08-10 2027-09-10 2027-10-15 2027-11-12 2027-12-15",
    FOMC: "2026-12-09 2027-01-27 2027-03-17 2027-04-28 2027-06-09 2027-07-28 2027-09-15 2027-10-27 2027-12-08",
  };

  // One timeframe's range, fed 1m bars in order. Mirrors f_tf: the candle finishes on its last 1m bar,
  // or on the first bar of the next candle if that last 1m bar was missing.
  // barMin = size of the bars fed in (1 normally; the chart's own timeframe when reading a live chart)
  function tfState(tfMin, barMin = 1) {
    return { ms: tfMin * MIN, barMs: barMin * MIN, off: tfMin % barMin !== 0, bucket: null, ah: NaN, al: NaN, ac: NaN, closed: true, h: NaN, l: NaN, d: 0, t0: NaN, hist: [] };
  }
  function tfStep(s, bar) {
    let fin = null;
    if (s.off) return { isNew: false, flip: false, c: NaN };   // can't build this TF from these bars
    const b = Math.floor(bar.t / s.ms);
    if (b !== s.bucket) {
      if (!s.closed && !isNaN(s.ac)) fin = { h: s.ah, l: s.al, c: s.ac, t0: s.bucket * s.ms };
      s.bucket = b; s.ah = bar.h; s.al = bar.l; s.closed = false;
    } else {
      s.ah = Math.max(s.ah, bar.h); s.al = Math.min(s.al, bar.l);
    }
    s.ac = bar.c;
    if (!fin && !s.closed && bar.t + s.barMs >= (b + 1) * s.ms) {
      fin = { h: s.ah, l: s.al, c: s.ac, t0: b * s.ms }; s.closed = true;
    }
    let isNew = false, flip = false;
    if (fin) {
      if (isNaN(s.h)) { s.h = fin.h; s.l = fin.l; s.t0 = fin.t0; s.hist.push({ h: s.h, l: s.l, d: 0, from: fin.t0 + s.ms }); }
      else if (fin.c > s.h || fin.c < s.l) {      // the rP rule: a close beyond the range starts a new one
        const nd = fin.c > s.h ? 1 : -1;
        flip = s.d !== 0 && nd !== s.d;
        s.h = fin.h; s.l = fin.l; s.d = nd; s.t0 = fin.t0; isNew = true;
        // history for the chart: the Pine's step line takes the new value from the close of that candle
        s.hist.push({ h: s.h, l: s.l, d: nd, from: fin.t0 + s.ms });
        if (s.hist.length > 600) s.hist.shift();
      }
    }
    return { isNew, flip, c: fin ? fin.c : NaN };
  }

  // Full screener state for one symbol from closed 1m bars [{t,o,h,l,c}] (t = bar open, ms UTC).
  function analyze(bars, opt) {
    opt = Object.assign({ lvLo: 0.4, lvHi: 0.6, winMin: 120, barMin: 1 }, opt);
    const s3 = tfState(3, opt.barMin), s5 = tfState(5, opt.barMin), s60 = tfState(60, opt.barMin);
    const st = {
      t40: false, t50: false, t60: false, tTouch: null, done: false, tSet: null, sDir: 0, sEnt: NaN, sStp: NaN, sTgt: NaN, sTf: "",
      swept: false, swX: NaN, swDone: false, tSw: null, wDir: 0, wEnt: NaN, wStp: NaN, wTgt: NaN, wTf: "", inWin: false,
    };
    const marks = [];   // chart marks, same as the Pine: ▲/▼ flips, L/S setups, level-touch dots
    let pend = [];      // flips / setups show on the next chart bar, at its low (up) or high (down)
    for (const bar of bars) {
      for (const m of pend) marks.push(Object.assign(m, { t: bar.t, p: m.d > 0 ? bar.l : bar.h }));
      pend = [];
      const e3 = tfStep(s3, bar), e5 = tfStep(s5, bar), e60 = tfStep(s60, bar);
      if (e3.flip) pend.push({ k: "flip", tf: "3", d: s3.d });
      if (e5.flip) pend.push({ k: "flip", tf: "5", d: s5.d });
      if (e60.flip) pend.push({ k: "flip", tf: "60", d: s60.d });
      const touchedBefore = st.t40 + st.t50 + st.t60;
      const h60 = s60.h, l60 = s60.l, d60 = s60.d;
      // SWEEP: beyond the 60m edge against its direction, then a 3/5m flip back inside
      if (e60.isNew) { st.swept = false; st.swX = NaN; st.swDone = false; }
      else if (d60 !== 0 && !isNaN(h60) && (d60 > 0 ? bar.l < l60 : bar.h > h60)) {
        st.swept = true;
        st.swX = d60 > 0 ? Math.min(isNaN(st.swX) ? bar.l : st.swX, bar.l) : Math.max(isNaN(st.swX) ? bar.h : st.swX, bar.h);
      }
      const w3 = e3.flip && s3.d === d60 && e3.c > l60 && e3.c < h60;
      const w5 = e5.flip && s5.d === d60 && e5.c > l60 && e5.c < h60;
      if (st.swept && !st.swDone && d60 !== 0 && (w3 || w5)) {
        const hW = w3 ? s3.h : s5.h, lW = w3 ? s3.l : s5.l;
        Object.assign(st, { swDone: true, tSw: bar.t, wDir: d60, wEnt: (hW + lW) / 2, wStp: st.swX, wTgt: d60 > 0 ? h60 : l60,
          wTf: w3 && w5 ? "3m+5m" : w3 ? "3m" : "5m" });
      }
      // SETUP: first 40/50/60 touch, then a 3/5m flip in the 60m direction inside the window
      if (e60.isNew) Object.assign(st, { t40: false, t50: false, t60: false, tTouch: null, done: false });
      else if (!isNaN(h60)) {
        const hit = (p) => bar.h >= p && bar.l <= p;
        st.t40 = st.t40 || hit(l60 + (h60 - l60) * opt.lvLo);
        st.t50 = st.t50 || hit((h60 + l60) / 2);
        st.t60 = st.t60 || hit(l60 + (h60 - l60) * opt.lvHi);
        if ((st.t40 || st.t50 || st.t60) && st.tTouch === null) st.tTouch = bar.t;
        if (st.t40 + st.t50 + st.t60 > touchedBefore) marks.push({ k: "touch", t: bar.t, p: bar.c, d: d60 });
      }
      st.inWin = st.tTouch !== null && bar.t - st.tTouch <= opt.winMin * MIN;
      const f3 = e3.flip && s3.d === d60, f5 = e5.flip && s5.d === d60;
      if (st.inWin && !st.done && d60 !== 0 && (f3 || f5)) {
        const hL = f3 ? s3.h : s5.h, lL = f3 ? s3.l : s5.l;
        Object.assign(st, { done: true, tSet: bar.t, sDir: d60, sEnt: (hL + lL) / 2, sStp: d60 > 0 ? lL : hL, sTgt: d60 > 0 ? hL : lL,
          sTf: f3 && f5 ? "3m+5m" : f3 ? "3m" : "5m" });
        pend.push({ k: "setup", d: d60 });
      }
    }
    const last = bars[bars.length - 1];
    for (const m of pend) marks.push(Object.assign(m, { t: last.t + opt.barMin * MIN, p: m.d > 0 ? last.l : last.h }));
    const r = (s) => ({ h: s.h, l: s.l, d: s.d, mid: (s.h + s.l) / 2, t0: s.t0, off: s.off, hist: s.hist });
    const r60 = r(s60);
    r60.p40 = r60.l + (r60.h - r60.l) * opt.lvLo;
    r60.p60 = r60.l + (r60.h - r60.l) * opt.lvHi;
    return Object.assign(st, { r3: r(s3), r5: r(s5), r60, marks, lastT: last ? last.t : NaN });
  }

  // ───── chart drawing, same look as "rp_range_Minoux mod v1.5.pine" with its default settings ─────
  // Returns shape specs for tv-hook.js: { key, kind: "poly" | "rect" | "text", pts: [[ms, price], ...], o: overrides, text }
  const UP = [34, 197, 94], DN = [239, 68, 68];
  const rgba = (d, a) => { const c = d < 0 ? DN : UP; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  // Pine: 3m width 1 / transp 45 (50% transp 75) · 5m width 2 / transp 15 (50% 55) · 60m width 3 (50% width 2 transp 35, 40/60% transp 70, zone 92)
  const LOOK = { 3: { w: 1, a: 0.55, mw: 1, ma: 0.25 }, 5: { w: 2, a: 0.85, mw: 1, ma: 0.45 }, 60: { w: 3, a: 1, mw: 2, ma: 0.65 } };
  function chartShapes(a, opt) {
    opt = Object.assign({ barMin: 1, lvLo: 0.4, lvHi: 0.6, dp: 2 }, opt);
    const barMs = opt.barMin * MIN, end = a.lastT + barMs, out = [];
    const fx = (x) => x.toFixed(opt.dp);
    const push = (sh) => { sh.key = JSON.stringify([sh.kind, sh.pts, sh.o, sh.text || ""]); out.push(sh); };
    const series = (tf, hist, val, w, al, name) => {
      // one polyline per run of same-direction ranges; it starts with the vertical step from the previous range
      let pts = [], d = null;
      const flush = () => { if (pts.length > 1) push({ kind: "poly", pts, o: { lineColor: rgba(d, al), lineWidth: w, lineStyle: 0, leftEnd: 0, rightEnd: 0 }, text: name }); };
      hist.forEach((g, i) => {
        const to = i + 1 < hist.length ? hist[i + 1].from : end, v = val(g);
        if (g.d !== d) { flush(); pts = i > 0 ? [[g.from, val(hist[i - 1])]] : []; d = g.d; }
        pts.push([g.from, v], [to, v]);
      });
      flush();
    };
    const lv = (k) => (g) => g.l + (g.h - g.l) * k;
    for (const tf of [3, 5, 60]) {
      const r = a["r" + tf];
      if (r.off || !r.hist.length) continue;
      const L = LOOK[tf];
      series(tf, r.hist, (g) => g.h, L.w, L.a, `${tf}m H`);
      series(tf, r.hist, (g) => g.l, L.w, L.a, `${tf}m L`);
      series(tf, r.hist, lv(0.5), L.mw, L.ma, `${tf}m 50%`);
      if (tf === 60) {
        series(tf, r.hist, lv(opt.lvLo), 1, 0.3, "60m 40%");
        series(tf, r.hist, lv(opt.lvHi), 1, 0.3, "60m 60%");
        r.hist.forEach((g, i) => push({ kind: "rect", pts: [[g.from, lv(opt.lvHi)(g)], [i + 1 < r.hist.length ? r.hist[i + 1].from : end, lv(opt.lvLo)(g)]],
          o: { color: "rgba(0,0,0,0)", backgroundColor: rgba(g.d, 0.08), fillBackground: true, linewidth: 0 } }));
      }
    }
    for (const m of a.marks) {
      if (m.k === "flip") push({ kind: "text", pts: [[m.t, m.p]], text: (m.d > 0 ? "▲" : "▼") + m.tf,
        o: { color: rgba(m.d, 1), backgroundColor: rgba(m.d, 0.2), fillBackground: true, fontsize: m.tf === "60" ? 11 : 9 } });
      else if (m.k === "setup") push({ kind: "text", pts: [[m.t, m.p]], text: m.d > 0 ? "L" : "S",
        o: { color: "#ffffff", backgroundColor: rgba(m.d, 1), fillBackground: true, fontsize: 10, bold: true } });
      else if (m.k === "touch") push({ kind: "text", pts: [[m.t, m.p]], text: "●", o: { color: rgba(m.d, 0.8), fontsize: 8 } });
    }
    // right-side labels, one column per timeframe so they never stack (Pine: 3 bars right, 14 bars between columns)
    let col = 0;
    for (const tf of [3, 5, 60]) {
      const r = a["r" + tf];
      if (r.off || isNaN(r.h)) continue;
      const x = a.lastT + (3 + col++ * 14) * barMs;
      const lab = (p, text, al) => push({ kind: "text", pts: [[x, p]], text, o: { color: "#ffffff", backgroundColor: rgba(r.d, al), fillBackground: true, fontsize: 10 } });
      lab(r.h, `${tf}m H  ${fx(r.h)}`, 0.75);
      lab(r.mid, `${tf}m 50%  ${fx(r.mid)}`, 0.45);
      lab(r.l, `${tf}m L  ${fx(r.l)}`, 0.75);
      if (tf === 60) {
        lab(r.p40, `60m 40%  ${fx(r.p40)}${a.t40 ? "  ✓" : ""}`, 0.3);
        lab(r.p60, `60m 60%  ${fx(r.p60)}${a.t60 ? "  ✓" : ""}`, 0.3);
      }
    }
    return out;
  }

  // ───── New York time helpers (DST handled by Intl) ─────
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function nyParts(t) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hm: +p.hour * 60 + +p.minute };
  }
  const inRange = (hm, a, b) => (a <= b ? hm >= a && hm < b : hm >= a || hm < b);   // b < a wraps midnight, like "1800-0200"

  function session(t) {
    const { hm } = nyParts(t);
    return inRange(hm, 1080, 120) ? "Asia" : inRange(hm, 120, 480) ? "London" : inRange(hm, 480, 720) ? "NY AM" : inRange(hm, 720, 1020) ? "NY PM" : "";
  }

  // No-trade window name or "" (04:00 move 03:45-04:30, equity open 09:30-10:15, red-folder news ± pad)
  function noTrade(t, pad = 30) {
    const { day, hm } = nyParts(t);
    if (inRange(hm, 225, 270)) return "04:00 move";
    if (inRange(hm, 570, 615)) return "Equity open";
    if (NEWS.FOMC.includes(day) && hm >= 840 - pad && hm < 840 + pad) return "FOMC 14:00";
    if (hm >= 510 - pad && hm < 510 + pad) for (const k of ["CPI", "NFP", "PPI"]) if (NEWS[k].includes(day)) return k + " 08:30";
    return "";
  }

  // Epoch ms of yyyy-mm-dd hh:mm in New York (tries both UTC offsets, keeps the one that reads back right)
  function nyTime(day, hh, mi) {
    const [y, m, d] = day.split("-").map(Number);
    for (const off of [4, 5]) {
      const t = Date.UTC(y, m - 1, d, hh + off, mi);
      if (nyParts(t).hm === hh * 60 + mi) return t;
    }
    return NaN;
  }
  function nextNews(now) {
    let best = null;
    for (const [k, list] of Object.entries(NEWS)) for (const day of list.split(" ")) {
      const t = k === "FOMC" ? nyTime(day, 14, 0) : nyTime(day, 8, 30);
      if (t > now && (!best || t < best.t)) best = { name: k, t };
    }
    return best;
  }

  root.RP = { analyze, chartShapes, tfState, tfStep, session, noTrade, nextNews, nyParts, NEWS };
})(typeof globalThis !== "undefined" ? globalThis : this);
