/* Tests for the workout log maths. Run: node --test tests/*.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDash(files) {
  const ctx = { window: {}, console, Intl, Date, Math, Number, Object, String, isNaN };
  ctx.window.DASH = {};
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  return ctx.window.DASH;
}

const D = loadDash(['util.js', 'workouts.js']);
const W = D.Workouts;
const list = (a) => Array.from(a);

let seq = 0;
const set = (date, exercise, weight, reps) =>
  ({ id: 's' + (++seq), date, exercise, weight, reps, createdAt: '2026-01-01T00:00:' + String(seq).padStart(2, '0') });

const LOG = [
  set('2026-08-31', 'Bench Press', 185, 5),
  set('2026-08-31', 'Bench Press', 195, 3),
  set('2026-08-31', 'Overhead Press', 95, 8),
  set('2026-09-02', 'Deadlift', 275, 5),
  set('2026-09-02', 'Row', 135, 10),
  set('2026-09-04', 'Bench Press', 190, 5),
  set('2026-09-04', 'Bench Press', 190, 5),
  set('2026-09-04', 'Overhead Press', 100, 6),
];

test('sets sort by date, then by the order they were entered', () => {
  const shuffled = [LOG[5], LOG[0], LOG[3], LOG[1]];
  assert.deepStrictEqual(list(W.sortSets(shuffled)).map((s) => s.id),
    ['s1', 's2', 's4', 's6']);
});

test('a day returns only that day', () => {
  assert.strictEqual(W.onDate(LOG, '2026-09-02').length, 2);
  assert.strictEqual(W.onDate(LOG, '2026-09-03').length, 0);
});

test('an exercise matches regardless of case or stray spacing', () => {
  assert.strictEqual(W.forExercise(LOG, '  bench press ').length, 4);
});

test('exercises on a day come back in the order they were trained', () => {
  assert.deepStrictEqual(list(W.exercisesOn(LOG, '2026-09-04')),
    ['Bench Press', 'Overhead Press']);
});

test('trained dates are newest first', () => {
  assert.deepStrictEqual(list(W.dates(LOG)),
    ['2026-09-04', '2026-09-02', '2026-08-31']);
});

test('volume is weight times reps across the sets given', () => {
  // 185×5 + 195×3 + 95×8
  assert.strictEqual(W.volume(W.onDate(LOG, '2026-08-31')), 2270);
  assert.strictEqual(W.volume([]), 0);
});

test('a single rep is its own estimated max', () => {
  assert.strictEqual(W.e1rm(225, 1), 225);
});

test('nonsense input estimates nothing instead of NaN', () => {
  [[0, 5], [185, 0], [null, 5], [185, null]].forEach(([w, r]) =>
    assert.strictEqual(W.e1rm(w, r), 0, `${w}x${r}`));
});

test('the best set is the strongest, not merely the heaviest', () => {
  // 185×5 estimates 215.8; 195×3 only 214.5.
  const best = W.bestSet(W.onDate(LOG, '2026-08-31').filter((s) => s.exercise === 'Bench Press'));
  assert.strictEqual(best.set.weight, 185);
  assert.strictEqual(best.e1rm, 215.8);
});

// ── The reference you want while logging ────────────────────────────
test('last time is the previous session, not the one in progress', () => {
  // Logging on the 4th must look back to the 31st, even though sets for
  // the 4th already exist.
  const prev = W.lastTime(LOG, 'Bench Press', '2026-09-04');
  assert.strictEqual(prev.date, '2026-08-31');
  assert.strictEqual(prev.sets.length, 2);
});

test('last time is null the first time an exercise is done', () => {
  assert.strictEqual(W.lastTime(LOG, 'Bench Press', '2026-08-31'), null);
  assert.strictEqual(W.lastTime(LOG, 'Snatch', '2026-09-04'), null);
});

test('last time skips days the exercise was not trained', () => {
  // The 2nd was a pull day; bench last happened on the 31st.
  const prev = W.lastTime(LOG, 'Bench Press', '2026-09-03');
  assert.strictEqual(prev.date, '2026-08-31');
});

// ── Records ─────────────────────────────────────────────────────────
test('records track heaviest set, most reps and best estimate', () => {
  const r = W.records(LOG, 'Bench Press');
  assert.strictEqual(r.maxWeight.weight, 195);
  assert.strictEqual(r.maxReps.reps, 5);
  assert.strictEqual(r.best.e1rm, W.e1rm(190, 5));   // 221.7 beats 215.8
  assert.strictEqual(r.sessions, 2);
});

test('best volume is a whole session, not a single set', () => {
  // 4 Sep: 190×5 twice = 1900. 31 Aug bench alone = 1510.
  const r = W.records(LOG, 'Bench Press');
  assert.strictEqual(r.maxVolume.date, '2026-09-04');
  assert.strictEqual(r.maxVolume.volume, 1900);
});

test('an untrained exercise has no records', () => {
  assert.strictEqual(W.records(LOG, 'Snatch'), null);
});

test('a set is flagged as a record before it is saved', () => {
  const heavier = W.wouldBeRecord(LOG, 'Bench Press', { weight: 200, reps: 3 });
  assert.strictEqual(heavier.weight, true);         // 200 > 195
  const lighter = W.wouldBeRecord(LOG, 'Bench Press', { weight: 150, reps: 5 });
  assert.strictEqual(lighter.weight, false);
  assert.strictEqual(lighter.e1rm, false);
});

test('the first set of a brand new exercise counts as a record', () => {
  const r = W.wouldBeRecord(LOG, 'Snatch', { weight: 95, reps: 3 });
  assert.strictEqual(r.first, true);
});

test('a big estimate counts even when the bar is lighter', () => {
  // 185×8 estimates 234.3, beating the 221.7 best, despite 185 < 195.
  const r = W.wouldBeRecord(LOG, 'Bench Press', { weight: 185, reps: 8 });
  assert.strictEqual(r.weight, false);
  assert.strictEqual(r.e1rm, true);
});

// ── Charts and totals ───────────────────────────────────────────────
test('progression gives one point per session, oldest first', () => {
  const p = W.progression(LOG, 'Bench Press');
  assert.deepStrictEqual(list(p).map((x) => x.date), ['2026-08-31', '2026-09-04']);
  assert.strictEqual(p[1].value, W.e1rm(190, 5));
  assert.ok('date' in p[0] && 'value' in p[0]);
});

test('week stats cover the current week only', () => {
  // Week of Sun 30 Aug 2026 holds all three days.
  const s = W.weekStats(LOG, '2026-09-05');
  assert.strictEqual(s.days, 3);
  assert.strictEqual(s.sets, 8);
  assert.strictEqual(s.volume, W.volume(LOG));
});

test('week stats exclude earlier weeks', () => {
  const older = LOG.concat([set('2026-08-20', 'Back Squat', 225, 5)]);
  assert.strictEqual(W.weekStats(older, '2026-09-05').days, 3);
});
