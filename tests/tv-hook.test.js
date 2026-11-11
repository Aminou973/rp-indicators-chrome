// tv-hook.js against a fake TradingView-library widget (new and old getBars signatures)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync(__dirname + "/../tv-hook.js", "utf8");

function page(oldApi) {
  const shapes = [], posted = [], removed = [];
  let onMsg;
  const bars = [{ time: 1, open: 1, high: 2, low: 0, close: 1 }];
  const datafeed = {
    resolveSymbol: (s, ok) => ok({ name: s }),
    getBars: oldApi ? function (i, r, f, t, ok, err, first) { ok(bars); } : function (i, r, p, ok) { ok(bars); },
  };
  const win = { addEventListener: (_, f) => (onMsg = f), postMessage: (m) => posted.push(m) };
  win.tvWidget = { _options: { datafeed }, activeChart: () => ({ symbol: () => "CME_MINI:NQZ2026", createShape: (p) => (shapes.push(p.price), "id" + shapes.length), removeEntity: (id) => removed.push(id) }) };
  win.window = win;
  vm.runInNewContext(src, Object.assign(win, { Object, Math, Date, Array, String, Map, Set, Promise, JSON }));
  return { send: (data) => onMsg({ data, source: win }), shapes, posted, removed };
}

for (const oldApi of [false, true]) test(`live bars + lines, ${oldApi ? "old" : "new"} getBars`, async () => {
  const p = page(oldApi);
  p.send({ rpBarsReq: 1 });
  assert.strictEqual(JSON.stringify(p.posted[0].rpBars.bars[0]), JSON.stringify({ t: 1, o: 1, h: 2, l: 0, c: 1 }));
  assert.strictEqual(p.posted[0].rpBars.sym, "CME_MINI:NQZ2026");
  const sh = (k, price) => ({ key: k, kind: "text", pts: [[1000, price]], text: k, o: {} });
  p.send({ rpShapes: [sh("a", 100), sh("b", 90)] });
  p.send({ rpShapes: [sh("a", 100), sh("c", 80)] });   // "a" kept, "b" removed, "c" added
  assert.strictEqual(p.shapes.join(), "100,90,80");
  await Promise.resolve();
  assert.strictEqual(p.removed.join(), "id2");
  assert.strictEqual(p.posted[2].rpHook, 1);
});
