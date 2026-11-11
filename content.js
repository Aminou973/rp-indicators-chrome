// Floating rP panel: active-symbol range card + screener table. Display only.
(function () {
  "use strict";
  if (window.__rpPanel) { window.__rpPanel.style.display = ""; return; }
  const RP = globalThis.RP;
  const DEF_LIST = "NQ=F, ES=F, YM=F, RTY=F, GC=F, CL=F, BTCUSDT";
  // page ticker root -> feed symbol (micros use the mini's bars: same price)
  const ROOTS = { NQ: "NQ=F", MNQ: "NQ=F", ES: "ES=F", MES: "ES=F", YM: "YM=F", MYM: "YM=F", RTY: "RTY=F", M2K: "RTY=F",
    GC: "GC=F", MGC: "GC=F", CL: "CL=F", MCL: "CL=F", "6E": "6E=F", "6B": "6B=F", "6J": "6J=F", BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT" };
  const ROOT_RE = new RegExp(`\\b(${Object.keys(ROOTS).join("|")})(?:[FGHJKMNQUVXZ]\\d{1,2}|1!|USDT?|-PERP|PERP)?\\b`);

  const host = document.createElement("div");
  window.__rpPanel = host;
  host.style.cssText = "position:fixed;z-index:2147483647;top:80px;right:20px";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial}
    .p{font:12px/1.35 ui-monospace,Consolas,monospace;color:#d1d4dc;background:#131722ee;border:1px solid #2a2e39;border-radius:8px;min-width:330px;box-shadow:0 6px 24px #0008}
    .hd{display:flex;gap:6px;align-items:center;padding:5px 8px;background:#1e222d;border-radius:8px 8px 0 0;cursor:move;user-select:none}
    .hd b{flex:1} button{all:unset;cursor:pointer;padding:0 4px;color:#9aa0ab} button:hover{color:#fff}
    .bd{padding:6px 8px} table{border-collapse:collapse;width:100%} td,th{padding:2px 5px;text-align:left;white-space:nowrap}
    th{color:#9aa0ab;font-weight:normal} .up{color:#22c55e} .dn{color:#ef4444} .y{color:#facc15} .g{color:#6b7280}
    .nt{background:#f9731633;color:#fb923c;padding:3px 6px;border-radius:4px;margin:4px 0} .news{color:#fb923c;margin-top:5px}
    .soon{background:#f97316;color:#fff;padding:2px 5px;border-radius:4px} hr{border:0;border-top:1px solid #2a2e39;margin:6px 0}
    input{width:100%;box-sizing:border-box;background:#0b0e14;color:#d1d4dc;border:1px solid #2a2e39;padding:3px;font:inherit}
    .err{color:#ef4444}
  </style><div class="p"><div class="hd"><b>rP 3/5/60 <span class="g">v${chrome.runtime.getManifest().version}</span></b><span class="g" id="src"></span>
  <button id="cal" title="Chart lines: click, then click 2 chart points and type their prices. Shift+click removes them.">📏</button><button id="cfg" title="Symbols">⚙</button><button id="min" title="Collapse">–</button><button id="x" title="Hide">✕</button></div>
  <div class="bd" id="bd"><div id="set" hidden><input id="list" placeholder="${DEF_LIST}"><div class="g">Comma separated. Futures = Yahoo (NQ=F), crypto = Binance (BTCUSDT).</div><hr></div>
  <div id="card">loading…</div><hr><div id="scr"></div><div class="news" id="news"></div></div></div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  let list = DEF_LIST, results = {}, live = null, axisAt = 0, sentLevels = "", lastFetch = 0, hookOn = 0, cal = null, sentLines = "";
  const calKey = "cal:" + location.host;
  chrome.storage.local.get(["list", "pos", "min", calKey], (s) => {
    cal = s[calKey] || null;
    if (s.list) list = s.list;
    $("list").value = list;
    if (s.pos) Object.assign(host.style, { top: s.pos.top, left: s.pos.left, right: "auto" });
    if (s.min) $("bd").hidden = true;
    refresh();
  });

  // drag by the header, remember where it was dropped
  $("x").onclick = () => (host.style.display = "none");
  $("min").onclick = () => { $("bd").hidden = !$("bd").hidden; chrome.storage.local.set({ min: $("bd").hidden }); };
  $("cfg").onclick = () => ($("set").hidden = !$("set").hidden);
  $("list").onchange = () => { list = $("list").value.trim() || DEF_LIST; chrome.storage.local.set({ list }); refresh(); };
  root.querySelector(".hd").addEventListener("pointerdown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev) => Object.assign(host.style, { left: Math.max(0, ev.clientX - dx) + "px", top: Math.max(0, ev.clientY - dy) + "px", right: "auto" });
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); chrome.storage.local.set({ pos: { top: host.style.top, left: host.style.left } }); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });

  // ───── chart lines ─────
  // 1) TradingView charting library on the page -> real chart lines via tv-hook.js (follow zoom / scroll)
  // 2) otherwise a see-through canvas on top of the chart, scaled from 2 points the user clicks (📏)
  addEventListener("message", (e) => {
    const d = e.data;
    if (d && typeof d.rpHook === "number") hookOn = Math.max(hookOn, d.rpHook);
    if (d && d.rpAxis) axisAt = Date.now();
    // live 1m bars from the page's own chart feed (tv-hook.js); only closed bars, same as the Pine
    if (d && d.rpBars && !d.rpBars.error && d.rpBars.bars && d.rpBars.bars.length) {
      const res = +d.rpBars.res || 1;
      const bars = d.rpBars.bars.filter((b) => b.t + res * 60000 <= Date.now());   // closed bars only
      if (bars.length) live = { sym: String(d.rpBars.sym), res, a: RP.analyze(bars, { barMin: res }), last: bars.at(-1), at: Date.now() };
    }
  });
  const post = (msg) => { window.postMessage(msg, "*"); for (let i = 0; i < window.frames.length; i++) try { window.frames[i].postMessage(msg, "*"); } catch (_) {} };
  function lineSpec(a) {
    const col = (d, al) => (d < 0 ? `rgba(239,68,68,${al})` : `rgba(34,197,94,${al})`);
    const out = [];
    const add = (p, c, w, s, t, x) => isFinite(p) && out.push({ p, c, w, s, t, x: isFinite(x) ? x : 0 });
    [["3m", a.r3, 0.55, 1], ["5m", a.r5, 0.85, 2], ["60m", a.r60, 1, 3]].forEach(([n, r, al, w]) => {
      add(r.h, col(r.d, al), w, 0, `${n} H`, r.t0); add(r.l, col(r.d, al), w, 0, `${n} L`, r.t0); add(r.mid, col(r.d, al * 0.6), 1, 2, `${n} 50%`, r.t0);
    });
    add(a.r60.p40, col(a.r60.d, 0.35), 1, 2, `60m 40%${a.t40 ? " ✓" : ""}`, a.r60.t0);
    add(a.r60.p60, col(a.r60.d, 0.35), 1, 2, `60m 60%${a.t60 ? " ✓" : ""}`, a.r60.t0);
    return out;
  }
  function sendLines(lines) {
    const j = JSON.stringify(lines);
    if (j === sentLines) return;          // only redraw when a level moved
    sentLines = j;
    post({ rpShapes: lines });
  }

  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none";
  document.documentElement.appendChild(cv);
  function drawCanvas(lines) {
    const dpr = devicePixelRatio || 1;
    if (cv.width !== innerWidth * dpr || cv.height !== innerHeight * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    if (!cal || hookOn || Date.now() - axisAt < 3000 || host.style.display === "none") return;
    const y = (p) => cal.y1 + ((p - cal.p1) * (cal.y2 - cal.y1)) / (cal.p2 - cal.p1);
    const x0 = Math.min(cal.x1, cal.x2), x1 = Math.max(cal.x1, cal.x2);
    g.font = "10px ui-monospace,Consolas,monospace"; g.textAlign = "right";
    for (const L of lines) {
      const yy = Math.round(y(L.p)) + 0.5;
      if (yy < 0 || yy > innerHeight) continue;
      g.strokeStyle = g.fillStyle = L.c; g.lineWidth = L.w; g.setLineDash(L.s ? [4, 4] : []);
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.fillText(`${L.t} ${L.p.toFixed(dp(L.p))}`, x1 - 4, yy - 3);
    }
  }
  // calibration: two clicks on the chart, each followed by the price at that spot
  $("cal").onclick = (ev) => {
    if (ev.shiftKey) { cal = null; chrome.storage.local.remove(calKey); return; }
    alert("Click a spot near the TOP LEFT of the chart, then type the price there. " +
      "Then do the same near the BOTTOM RIGHT. " +
      "The lines span between the two clicks. Redo it after you zoom or scroll the price scale.");
    const pts = [];
    const shield = document.createElement("div");
    shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(250,204,21,.05)";
    shield.onclick = (e) => {
      const p = parseFloat(String(prompt(`Price at this spot (${pts.length + 1} of 2)?`) || "").replace(/[, ]/g, ""));
      if (!isFinite(p)) { shield.remove(); return; }
      pts.push({ x: e.clientX, y: e.clientY, p });
      if (pts.length < 2) return;
      shield.remove();
      if (pts[0].p === pts[1].p || pts[0].y === pts[1].y) return alert("The two points need different prices and heights.");
      cal = { x1: pts[0].x, y1: pts[0].y, p1: pts[0].p, x2: pts[1].x, y2: pts[1].y, p2: pts[1].p };
      chrome.storage.local.set({ [calKey]: cal });
    };
    document.documentElement.appendChild(shield);
  };

  const syms = () => list.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  function active() {
    const m = ROOT_RE.exec(document.title.toUpperCase()) || ROOT_RE.exec(decodeURIComponent(location.href).toUpperCase());
    return m ? ROOTS[m[1]] : syms()[0];
  }

  function refresh() {
    const want = [...new Set([...syms(), active()])];
    lastFetch = Date.now();
    chrome.runtime.sendMessage({ type: "bars", symbols: want }, (res) => {
      if (chrome.runtime.lastError || !res) { $("card").innerHTML = `<span class="err">feed unavailable</span>`; return; }
      results = {};
      for (const r of res) results[r.sym] = r.error ? { error: r.error } : { a: RP.analyze(r.bars), last: r.bars.at(-1) };
      render();
    });
  }

  const name = (s) => s.replace(/=F$|USDT$/, "");
  const dp = (x) => (Math.abs(x) < 10 ? 4 : 2);
  const n = (x, d) => (isFinite(x) ? x.toFixed(d) : "–");
  const dir = (d) => (d > 0 ? `<span class="up">▲</span>` : d < 0 ? `<span class="dn">▼</span>` : `<span class="g">–</span>`);
  const hhmm = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const lv = (a) => [a.t40 && "40", a.t50 && "50", a.t60 && "60"].filter(Boolean).join(" ");
  function status(a) {
    return a.done ? `<span class="${a.sDir > 0 ? "up" : "dn"}">${a.sDir > 0 ? "LONG" : "SHORT"} ${hhmm(a.tSet)} · ${a.sTf}</span>`
      : a.inWin ? `<span class="y">wait flip</span>` : a.tTouch !== null ? `<span class="g">expired</span>` : `<span class="g">–</span>`;
  }
  function sweep(a) {
    return a.swDone ? `<span class="${a.wDir > 0 ? "up" : "dn"}">${a.wDir > 0 ? "LONG" : "SHORT"} ${hhmm(a.tSw)} · ${a.wTf}</span>`
      : a.swept ? `<span class="y">swept, wait flip</span>` : `<span class="g">–</span>`;
  }
  function left(tfMin, now) {
    const s = Math.floor((tfMin * 60000 - (now % (tfMin * 60000))) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function render() {
    const now = Date.now(), isLive = live && now - live.at < 20000;
    const sym = isLive ? live.sym.split(":").pop() : active();
    let r = isLive ? live : results[sym];
    // live chart on e.g. 3m can't build the 5m range: borrow it from the public feed and say so
    if (isLive && live.a.r5.off && results[active()] && results[active()].a) r = { ...live, a: { ...live.a, r5: { ...results[active()].a.r5, delayed: true } } };
    const nt = RP.noTrade(now), ses = RP.session(now);
    let card = `<b>${esc(name(sym))}</b> <span class="g">${ses || "off-session"}</span>`;
    if (nt) card += `<div class="nt">⛔ no-trade: ${nt}</div>`;
    if (!r) card += `<div class="g">loading…</div>`;
    else if (r.error) card += `<div class="err">${esc(r.error)}</div>`;
    else {
      const a = r.a, d = dp(r.last?.c ?? 100);
      const row = (lbl, x, tf) => `<tr><td>${lbl}${x.delayed ? "*" : ""}</td><td>${dir(x.d)}</td><td>${n(x.h, d)}</td><td>${n(x.mid, d)}</td><td>${n(x.l, d)}</td><td class="g">${left(tf, now)}</td></tr>`;
      card += `<table><tr><th></th><th></th><th>H</th><th>50%</th><th>L</th><th>⏱</th></tr>${row("3m", a.r3, 3)}${row("5m", a.r5, 5)}${row("60m", a.r60, 60)}</table>
        <div>60m 40% <span class="${a.t40 ? "y" : ""}">${n(a.r60.p40, d)}${a.t40 ? " ✓" : ""}</span> · 60% <span class="${a.t60 ? "y" : ""}">${n(a.r60.p60, d)}${a.t60 ? " ✓" : ""}</span>${a.t50 ? ` · <span class="y">50 ✓</span>` : ""}</div>
        <div>Setup: ${status(a)}${a.done ? ` <span class="g">E ${n(a.sEnt, d)} S ${n(a.sStp, d)} T ${n(a.sTgt, d)}</span>` : ""}</div>
        <div>Sweep: ${sweep(a)}${a.swDone ? ` <span class="g">E ${n(a.wEnt, d)} S ${n(a.wStp, d)} T ${n(a.wTgt, d)}</span>` : ""}</div>
        <div class="g">last bar ${r.last ? hhmm(r.last.t) : "–"} NY${isLive && live.res !== 1 ? ` · chart is ${live.res}m${a.r5.delayed ? ", 5m* is delayed and left out of the setup" : ""}. A 1m chart gives everything live` : ""}</div>`;
    }
    $("card").innerHTML = card;
    const lines = r && r.a ? lineSpec(r.a) : [];
    // chart library: the full Pine look, built from the live chart bars (or the public feed until those arrive)
    if (r && r.a && r.a.marks) sendLines(RP.chartShapes(r.a, { barMin: isLive ? live.res : 1, dp: dp(r.last ? r.last.c : 100) }));
    // other charts: axis-hook.js reads their price axis and draws the current levels itself
    const lv = hookOn ? "[]" : JSON.stringify(lines);
    if (lv !== sentLevels) { sentLevels = lv; post({ rpLevels: JSON.parse(lv) }); }
    drawCanvas(lines);
    const auto = hookOn || Date.now() - axisAt < 3000;
    $("cal").style.color = auto ? "#22c55e" : cal ? "#facc15" : "";
    if (auto) $("cal").title = hookOn ? "Lines are on the chart (TradingView library found)" : "Lines follow the chart's price axis automatically";
    $("src").textContent = isLive ? `live, chart ${live.res}m` : /USDT$/.test(sym) ? "Binance" : "Yahoo, delayed";

    let t = `<table><tr><th>Symbol</th><th>3m</th><th>5m</th><th>60m</th><th>60m lvl</th><th>Status</th><th>Sweep</th></tr>`;
    for (const s of syms()) {
      const x = results[s];
      t += !x ? `<tr><td>${esc(name(s))}</td><td colspan="6" class="g">…</td></tr>`
        : x.error ? `<tr><td>${esc(name(s))}</td><td colspan="6" class="err">${esc(x.error)}</td></tr>`
        : `<tr><td>${esc(name(s))}</td><td>${dir(x.a.r3.d)}</td><td>${dir(x.a.r5.d)}</td><td>${dir(x.a.r60.d)}</td><td class="y">${lv(x.a) || `<span class="g">–</span>`}</td><td>${status(x.a)}</td><td>${sweep(x.a)}</td></tr>`;
    }
    $("scr").innerHTML = t + `</table>`;

    const nx = RP.nextNews(now);
    if (!nx) $("news").textContent = "⏱ no news date left in the calendar";
    else {
      const ms = nx.t - now, dd = Math.floor(ms / 864e5), hh = Math.floor((ms % 864e5) / 36e5), mm = Math.floor((ms % 36e5) / 6e4);
      $("news").innerHTML = `<span class="${ms < 36e5 ? "soon" : ""}">⏱ next news: ${nx.name} ${new Date(nx.t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} NY · in ${dd ? dd + "d " : ""}${hh}h ${mm}m</span>`;
    }
  }

  // countdowns every second, data every 30 s (and right away when the page's symbol changes)
  let lastSym = null;
  setInterval(() => {
    if (host.style.display === "none") return;
    const s = active();
    if (Date.now() % 5000 < 1000) post({ rpBarsReq: 1 });   // live bars every ~5 s when the page has a chart feed
    if (s !== lastSym || Date.now() - lastFetch > 30000) { lastSym = s; refresh(); }
    else render();
  }, 1000);
})();
