// node --test tests/   (no dependencies)
const test = require("node:test");
const assert = require("node:assert");
require("../rp.js");
const { analyze, chartShapes, tfState, tfStep, session, noTrade, nextNews } = globalThis.RP;

const T0 = Date.UTC(2026, 10, 9, 15, 0); // a round hour
// 1m bars from [h, l, c] triples, open = previous close
const mk = (rows, start = T0) => rows.map(([h, l, c], i) => ({ t: start + i * 60000, o: c, h, l, c }));
const flat = (n, h, l, c) => Array.from({ length: n }, () => [h, l, c]);

test("first closed candle seeds the range, no direction yet", () => {
  const s = tfState(3);
  mk(flat(3, 105, 95, 100)).forEach((b) => tfStep(s, b));
  assert.deepStrictEqual([s.h, s.l, s.d], [105, 95, 0]);
});

test("close above the high starts an UP range with that candle's high/low", () => {
  const s = tfState(3);
  const ev = mk([...flat(3, 105, 95, 100), [107, 104, 106], [109, 103, 108], [110, 102, 108]]).map((b) => tfStep(s, b));
  assert.deepStrictEqual([s.h, s.l, s.d], [110, 102, 1]);
  assert.ok(ev[5].isNew && !ev[5].flip, "new range, not a flip (no prior direction)");
});

test("wick beyond the range without a close beyond keeps the range", () => {
  const s = tfState(3);
  mk([...flat(3, 105, 95, 100), [120, 80, 100], [101, 99, 100], [101, 99, 104]]).forEach((b) => tfStep(s, b));
  assert.deepStrictEqual([s.h, s.l, s.d], [105, 95, 0]);
});

test("UP then close below the low is a flip DOWN", () => {
  const s = tfState(3);
  const ev = mk([...flat(3, 105, 95, 100), ...flat(3, 110, 102, 108), [104, 90, 92], [95, 91, 93], [94, 89, 90]]).map((b) => tfStep(s, b));
  assert.strictEqual(s.d, -1);
  assert.deepStrictEqual([s.h, s.l], [104, 89]);
  assert.ok(ev[8].flip);
});

test("candle closes on the next bucket's first bar when its last 1m bar is missing", () => {
  const s = tfState(3);
  const bars = mk([...flat(2, 105, 95, 100)]).concat(mk([[101, 99, 100]], T0 + 3 * 60000));
  bars.forEach((b) => tfStep(s, b));
  assert.deepStrictEqual([s.h, s.l], [105, 95]);
});

// 60m: hour 1 seeds 100-200, hour 2 closes 221 above -> UP range 150-222 (40% = 178.8, 50% = 186, 60% = 193.2).
// Its last 6 bars also start fresh 3m / 5m UP ranges 205-222, so hour 3 starts from known 3m / 5m state.
function upHourThen(rows) {
  const seed = flat(60, 200, 100, 150);
  const up = [...flat(54, 220, 150, 205), ...flat(6, 222, 205, 221)];
  return mk([...seed, ...up, ...rows]);
}

test("SETUP: 60m 50% touch then a 3m flip UP inside the window", () => {
  // 3m candles in hour 3: go down (flip 3m DOWN), touch 185, then close back above (flip UP)
  const rows = [
    ...flat(3, 200, 196, 198), // 3m seeds 200/196 (and 5m keeps going)
    ...flat(3, 197, 190, 191), // close < 196 -> 3m DOWN
    ...flat(3, 190, 184, 185), // touches 185 (50%) + 184 (no 40%) ; close < 190 -> DOWN again
    ...flat(3, 195, 186, 194), // close > 190 -> 3m flips UP => SETUP LONG
  ];
  const r = analyze(upHourThen(rows));
  assert.strictEqual(r.r60.d, 1);
  assert.ok(r.t50 && r.t60 && !r.t40, "touched 60 then 50, not 40");
  assert.ok(r.done, "setup fired");
  assert.strictEqual(r.sDir, 1);
  assert.strictEqual(r.sTf, "3m");
  assert.strictEqual(r.sEnt, (195 + 186) / 2);
  assert.strictEqual(r.sStp, 186);
  assert.strictEqual(r.sTgt, 195);
});

test("no SETUP when the flip is against the 60m direction", () => {
  const rows = [...flat(3, 200, 196, 198), ...flat(3, 197, 184, 185)]; // 3m flips? no prior dir -> just DOWN
  const r = analyze(upHourThen(rows));
  assert.ok(r.t50);
  assert.ok(!r.done);
  assert.ok(r.inWin);
});

test("SETUP expires after the window", () => {
  const rows = [...flat(3, 200, 196, 198), ...flat(3, 197, 184, 185), ...flat(6, 197, 186, 190)];
  const r = analyze(upHourThen(rows), { winMin: 5 });
  assert.ok(r.tTouch !== null && !r.inWin && !r.done);
});

test("SWEEP: price trades under the UP 60m low, 3m flips UP and closes back inside", () => {
  const rows = [
    ...flat(3, 160, 155, 158), // 3m seed
    ...flat(3, 156, 145, 147), // below 150 = swept, 3m DOWN (close 147 < 155)
    ...flat(3, 147, 140, 141), // deeper sweep to 140, still DOWN
    ...flat(3, 152, 143, 151), // close 151 > 147 and inside 150..220 -> flip UP => SWEEP LONG
  ];
  const r = analyze(upHourThen(rows));
  assert.ok(r.swept && r.swDone);
  assert.strictEqual(r.wDir, 1);
  assert.strictEqual(r.wStp, 140, "stop = sweep extreme");
  assert.strictEqual(r.wTgt, 222, "target = far 60m edge");
});

test("a new 60m range resets touches and setup", () => {
  const rows = [...flat(3, 200, 196, 198), ...flat(3, 197, 184, 185), ...flat(54, 230, 200, 228)]; // hour 3 closes 228 > 222
  const r = analyze(upHourThen(rows));
  assert.deepStrictEqual([r.r60.h, r.r60.l, r.r60.d], [230, 184, 1]);
  assert.ok(!r.t50 && r.tTouch === null && !r.done);
});

test("NY sessions, no-trade windows and news", () => {
  const ny = (y, m, d, hh, mi) => Date.UTC(y, m - 1, d, hh + 5, mi); // November = EST (UTC-5)
  assert.strictEqual(session(ny(2026, 11, 12, 9, 0)), "NY AM");
  assert.strictEqual(session(ny(2026, 11, 12, 19, 0)), "Asia");
  assert.strictEqual(session(ny(2026, 11, 12, 17, 30)), "");
  assert.strictEqual(noTrade(ny(2026, 11, 12, 4, 0)), "04:00 move");
  assert.strictEqual(noTrade(ny(2026, 11, 12, 9, 45)), "Equity open");
  assert.strictEqual(noTrade(ny(2026, 11, 13, 8, 15)), "PPI 08:30");
  assert.strictEqual(noTrade(ny(2026, 11, 12, 8, 15)), "", "no release that day");
  const n = nextNews(ny(2026, 11, 11, 12, 0));
  assert.deepStrictEqual([n.name, n.t], ["PPI", ny(2026, 11, 13, 8, 30)]);
});

test("range start time + building from 3m chart bars (barMin = 3)", () => {
  const s = tfState(3);
  mk([...flat(3, 105, 95, 100), ...flat(3, 110, 102, 108)]).forEach((b) => tfStep(s, b));
  assert.strictEqual(s.t0, T0 + 3 * 60000, "range starts at the candle that set it");
  // the same hour pattern as 3m bars: 60m works, 5m can't be built and stays empty
  const bars3 = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * 180000, h: i < 20 ? 200 : 220, l: i < 20 ? 100 : 150, c: i < 20 ? 150 : 210 }));
  const a = analyze(bars3, { barMin: 3 });
  assert.deepStrictEqual([a.r60.h, a.r60.l, a.r60.d, a.r60.t0], [220, 150, 1, T0 + 3600000]);
  assert.ok(a.r5.off && isNaN(a.r5.h));
});

test("chart shapes: step lines per direction run, zone, flip / setup marks, right labels", () => {
  const rows = [...flat(3, 200, 196, 198), ...flat(3, 197, 190, 191), ...flat(3, 190, 184, 185), ...flat(3, 195, 186, 194)];
  const a = analyze(upHourThen(rows));
  const sh = chartShapes(a);
  const h60 = sh.filter((x) => x.kind === "poly" && x.text === "60m H");
  // seed (d 0, drawn green) then UP: two runs; the UP run starts with the vertical step from 200
  assert.strictEqual(h60.length, 2);
  assert.deepStrictEqual(h60[1].pts.slice(0, 2), [[T0 + 2 * 3600000, 200], [T0 + 2 * 3600000, 222]]);
  assert.ok(sh.some((x) => x.kind === "rect"));
  assert.ok(sh.some((x) => x.text === "▲3"), "3m flip up mark");
  assert.ok(sh.some((x) => x.text === "L"), "setup label");
  assert.ok(sh.some((x) => x.text === "60m 50%  186.00"));
  assert.strictEqual(new Set(sh.map((x) => x.key)).size, sh.length, "keys unique");
});
