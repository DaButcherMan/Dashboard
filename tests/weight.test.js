/* Tests for the weight log maths. Run: node --test tests/*.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDash(files) {
  const ctx = { window: {}, console, Intl, Date, Math, isNaN, Number };
  ctx.window.DASH = {};
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  return ctx.window.DASH;
}

const D = loadDash(['util.js', 'weight.js']);

// Entries are anchored to today so the rolling-window maths is stable
// whenever the suite runs.
const ago = (n) => D.dayKey(D.addDays(new Date(), -n));
const entry = (n, value) => ({ id: 'w' + n, date: ago(n), value, note: '' });

test('sorts oldest first regardless of insertion order', () => {
  const out = D.Weight.sort([entry(1, 180), entry(30, 185), entry(10, 183)]);
  assert.deepStrictEqual(Array.from(out, (e) => e.value), [185, 183, 180]);
});

test('valueOn returns the reading in force, not an exact-date match', () => {
  // Nothing was logged 15 days ago; the 30-day-old reading still stands.
  const rows = [entry(30, 185), entry(2, 180)];
  assert.strictEqual(D.Weight.valueOn(rows, ago(15)).value, 185);
});

test('valueOn is null before the log begins', () => {
  assert.strictEqual(D.Weight.valueOn([entry(5, 180)], ago(90)), null);
});

test('reports change over 7 and 30 days against the reading then in force', () => {
  const s = D.Weight.summarize([entry(40, 190), entry(20, 186), entry(5, 183), entry(0, 182)]);
  assert.strictEqual(s.current.value, 182);
  // Each window takes the reading nearest its mark that is old enough to
  // stand for it: the 5-day-old 183 for a week, the 40-day-old 190 for a
  // month (tied with the 20-day one on distance, and older wins).
  assert.strictEqual(s.change7, -1);
  assert.strictEqual(s.change7From, ago(5));
  assert.strictEqual(s.change30, -8);
  assert.strictEqual(s.change30From, ago(40));
  assert.strictEqual(s.changeAll, -8);    // 190 → 182
});

test('a window the log does not reach back through reports null, not zero', () => {
  // Only three days of history: a 30-day change is unknown, and calling it
  // 0 would claim the weight held steady for a month.
  const s = D.Weight.summarize([entry(3, 181), entry(0, 180)]);
  assert.strictEqual(s.change30, null);
  assert.strictEqual(s.change7, null);
  assert.strictEqual(s.changeAll, -1);
});

test('a reading from months back does not report as a weekly change', () => {
  // Two readings eight months apart. The 16 lb is real, but none of it is
  // known to have happened in the last week or month, so neither window can
  // claim it.
  const s = D.Weight.summarize([entry(248, 289), entry(0, 273)]);
  assert.strictEqual(s.change7, null);
  assert.strictEqual(s.change30, null);
  assert.strictEqual(s.changeAll, -16);   // the honest figure
});

test('a reading too recent cannot stand in for a long window', () => {
  // Three days of history says nothing about a month.
  const s = D.Weight.summarize([entry(3, 181), entry(0, 180)]);
  assert.strictEqual(s.change30, null);
  assert.strictEqual(s.changeAll, -1);
});

test('a single reading has no change to report', () => {
  const s = D.Weight.summarize([entry(0, 180)]);
  assert.strictEqual(s.count, 1);
  assert.strictEqual(s.changeAll, null);
  assert.strictEqual(s.current.value, 180);
});

test('an empty log summarises without throwing', () => {
  assert.deepStrictEqual(D.Weight.summarize([]).count, 0);
  assert.strictEqual(D.Weight.summarize([]).current, null);
});

test('tracks min, max and distance to a target', () => {
  const s = D.Weight.summarize([entry(20, 190), entry(10, 178), entry(0, 184)], { target: 175 });
  assert.strictEqual(s.min, 178);
  assert.strictEqual(s.max, 190);
  assert.strictEqual(s.target, 175);
  assert.strictEqual(s.toGo, 9);          // 184 → 175
});

test('windowed keeps only entries inside the range', () => {
  const rows = [entry(90, 195), entry(20, 185), entry(1, 180)];
  assert.strictEqual(D.Weight.windowed(rows, 30).length, 2);
  assert.strictEqual(D.Weight.windowed(rows, null).length, 3);
});

test('chart spaces points by date, not by index', () => {
  // Two readings a day apart then a 60-day gap: the last point must sit far
  // from the first two, which index-based spacing would not show.
  const rows = [entry(61, 190), entry(60, 189), entry(0, 180)];
  const p = D.Weight.plot(rows, { w: 610, h: 100, pad: 5 });
  const gapA = p.points[1].x - p.points[0].x;
  const gapB = p.points[2].x - p.points[1].x;
  assert.ok(gapB > gapA * 20, `expected a wide gap, got ${gapA.toFixed(1)} then ${gapB.toFixed(1)}`);
});

test('a flat log does not divide by zero', () => {
  const p = D.Weight.plot([entry(2, 180), entry(1, 180), entry(0, 180)], { w: 600, h: 100 });
  assert.ok(p.yMax > p.yMin, 'range must be non-zero');
  assert.ok(p.points.every((pt) => isFinite(pt.x) && isFinite(pt.y)));
});

test('a single reading is placed rather than crashing the scale', () => {
  const p = D.Weight.plot([entry(0, 180)], { w: 600, h: 100 });
  assert.strictEqual(p.points.length, 1);
  assert.ok(isFinite(p.points[0].x) && isFinite(p.points[0].y));
  assert.strictEqual(p.area, '');          // nothing to fill under one point
});

test('the target line is placed on the same scale as the readings', () => {
  const p = D.Weight.plot([entry(1, 190), entry(0, 185)], { w: 600, h: 100, target: 170 });
  assert.ok(isFinite(p.targetY));
  // A target below every reading sits lower on the chart (larger y).
  assert.ok(p.targetY > p.points[0].y && p.targetY > p.points[1].y);
  assert.ok(p.yMin <= 170, 'scale must widen to include the target');
});

test('an empty log produces an empty chart, not a broken path', () => {
  const p = D.Weight.plot([], { w: 600, h: 100 });
  assert.strictEqual(p.line, '');
  assert.strictEqual(p.points.length, 0);
});

test('deltas always carry their sign', () => {
  assert.strictEqual(D.Weight.delta(-2.4), '−2.4');
  assert.strictEqual(D.Weight.delta(1.5), '+1.5');
  assert.strictEqual(D.Weight.delta(3), '+3');
  assert.strictEqual(D.Weight.delta(null), null);
});
