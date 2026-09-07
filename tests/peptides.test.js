/* Tests for peptide protocol scheduling. Run: node --test tests/*.test.js */
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

const D = loadDash(['util.js', 'peptides.js']);
const P = D.Peptides;
const list = (a) => Array.from(a);          // rebuild in this realm for deepStrictEqual

// 2026-09-01 is a Tuesday.
const daily    = { id: 'p1', compound: 'BPC-157', freq: 'daily',    startDate: '2026-09-01' };
const everyDay3 = { id: 'p2', compound: 'CJC',    freq: 'everyN', everyN: 3, startDate: '2026-09-01' };
const monThu   = { id: 'p3', compound: 'Ipamorelin', freq: 'weekdays', days: [1, 4], startDate: '2026-09-01' };

test('describes each schedule in plain words', () => {
  assert.strictEqual(P.describe(daily), 'Every day');
  assert.strictEqual(P.describe(everyDay3), 'Every 3 days');
  assert.strictEqual(P.describe(monThu), 'Mon, Thu');
  assert.strictEqual(P.describe({ freq: 'weekdays', days: [] }), 'No days set');
});

test('a daily protocol calls for every date in the window', () => {
  assert.deepStrictEqual(list(P.scheduleDates(daily, '2026-09-03', '2026-09-06')),
    ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
});

test('every-N counts from the start date, not from the window asked about', () => {
  // Start 1 Sep, every 3 days → 1, 4, 7, 10. Asking about 5–10 must not
  // restart the count at the 5th, which would give 5 and 8.
  assert.deepStrictEqual(list(P.scheduleDates(everyDay3, '2026-09-05', '2026-09-10')),
    ['2026-09-07', '2026-09-10']);
});

test('fixed weekdays land on those days only', () => {
  // 7 Sep is a Monday, 10 Sep a Thursday.
  assert.deepStrictEqual(list(P.scheduleDates(monThu, '2026-09-06', '2026-09-12')),
    ['2026-09-07', '2026-09-10']);
});

test('nothing is scheduled before the protocol starts', () => {
  assert.strictEqual(P.scheduleDates(daily, '2026-08-20', '2026-08-31').length, 0);
});

test('an end date stops the schedule', () => {
  const ends = Object.assign({}, daily, { endDate: '2026-09-04' });
  assert.deepStrictEqual(list(P.scheduleDates(ends, '2026-09-01', '2026-09-10')),
    ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
});

test('next due is today when today is still outstanding', () => {
  assert.strictEqual(P.nextDue(daily, [], '2026-09-05'), '2026-09-05');
});

test('next due skips a day already logged', () => {
  const doses = [{ id: 'd1', protocolId: 'p1', date: '2026-09-05' }];
  assert.strictEqual(P.nextDue(daily, doses, '2026-09-05'), '2026-09-06');
});

test('doses logged against another protocol do not count', () => {
  const doses = [{ id: 'd1', protocolId: 'SOMEONE-ELSE', date: '2026-09-05' }];
  assert.strictEqual(P.nextDue(daily, doses, '2026-09-05'), '2026-09-05');
});

test('a finished or paused protocol has nothing due', () => {
  assert.strictEqual(P.nextDue(Object.assign({}, daily, { endDate: '2026-09-01' }), [], '2026-09-05'), null);
  assert.strictEqual(P.nextDue(Object.assign({}, daily, { active: false }), [], '2026-09-05'), null);
});

test('adherence compares doses taken against doses called for', () => {
  const doses = ['2026-09-01', '2026-09-02', '2026-09-04']
    .map((date, i) => ({ id: 'd' + i, protocolId: 'p1', date }));
  // Window 1–5 Sep: five days due, three logged.
  const a = P.adherence(daily, doses, 5, '2026-09-05');
  assert.deepStrictEqual({ due: a.due, taken: a.taken, pct: a.pct }, { due: 5, taken: 3, pct: 60 });
});

test('adherence is null when the window has nothing scheduled', () => {
  // Not started yet: 0% would claim you missed doses that were never due.
  assert.strictEqual(P.adherence(daily, [], 7, '2026-08-20'), null);
});

test('cycle progress reports the day within a fixed run', () => {
  const cycle = Object.assign({}, daily, { endDate: '2026-09-10' });   // 10 days
  const c = P.cycleProgress(cycle, '2026-09-05');
  assert.deepStrictEqual({ day: c.day, total: c.total, pct: c.pct }, { day: 5, total: 10, pct: 50 });
});

test('an open-ended protocol has no cycle progress', () => {
  assert.strictEqual(P.cycleProgress(daily, '2026-09-05'), null);
});

// ── Washout and restart ─────────────────────────────────────────────
const cycled = Object.assign({}, daily, {
  endDate: '2026-09-30', offValue: 4, offUnit: 'weeks',
});

test('an off period given in weeks is counted in days', () => {
  assert.strictEqual(P.offDays(cycled), 28);
  assert.strictEqual(P.offDays(Object.assign({}, cycled, { offValue: 10, offUnit: 'days' })), 10);
  assert.strictEqual(P.offDays(daily), 0);
});

test('the off period reads back in the units it was given', () => {
  assert.strictEqual(P.describeOff(cycled), '4 weeks off');
  assert.strictEqual(P.describeOff({ offValue: 1, offUnit: 'weeks' }), '1 week off');
  assert.strictEqual(P.describeOff(Object.assign({}, cycled, { offValue: 10, offUnit: 'days' })), '10 days off');
  assert.strictEqual(P.describeOff(daily), '');
});

test('restart is counted from the last day on', () => {
  // Finishes 30 Sep, four weeks off → back on 28 Oct.
  assert.strictEqual(P.restart(cycled, '2026-10-01').date, '2026-10-28');
});

test('restart counts down while the washout runs', () => {
  const r = P.restart(cycled, '2026-10-20');
  assert.strictEqual(r.daysLeft, 8);
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.running, false);      // the protocol itself has ended
});

test('restart is ready on the day and after it', () => {
  assert.strictEqual(P.restart(cycled, '2026-10-28').ready, true);
  assert.strictEqual(P.restart(cycled, '2026-11-05').ready, true);
});

test('while still taking it, the washout has not begun', () => {
  const r = P.restart(cycled, '2026-09-15');
  assert.strictEqual(r.running, true);
  assert.strictEqual(r.ready, false);
});

test('a finished run is superseded once a later one is running', () => {
  const finished = Object.assign({}, cycled, { id: 'old' });
  const fresh = { id: 'new', compound: 'BPC-157', freq: 'daily',
                  startDate: '2026-10-28', active: true };
  const all = [finished, fresh];
  assert.ok(P.supersededBy(finished, all, '2026-11-01'));
  // The new run itself is not superseded by the old one.
  assert.strictEqual(P.supersededBy(fresh, all, '2026-11-01'), null);
});

test('a different compound does not supersede', () => {
  const finished = Object.assign({}, cycled, { id: 'old' });
  const other = { id: 'x', compound: 'TB-500', freq: 'daily',
                  startDate: '2026-10-28', active: true };
  assert.strictEqual(P.supersededBy(finished, [finished, other], '2026-11-01'), null);
});

test('a paused or earlier run does not supersede', () => {
  const finished = Object.assign({}, cycled, { id: 'old' });
  const paused = { id: 'p', compound: 'BPC-157', startDate: '2026-10-28', active: false };
  const earlier = { id: 'e', compound: 'BPC-157', startDate: '2026-01-01', active: true };
  assert.strictEqual(P.supersededBy(finished, [finished, paused], '2026-11-01'), null);
  assert.strictEqual(P.supersededBy(finished, [finished, earlier], '2026-11-01'), null);
});

test('no end date or no off period means no restart to report', () => {
  assert.strictEqual(P.restart(daily, '2026-10-01'), null);              // never ends
  assert.strictEqual(P.restart(Object.assign({}, daily, { endDate: '2026-09-30' }), '2026-10-01'), null);
  assert.strictEqual(P.restart(Object.assign({}, cycled, { offValue: 0 }), '2026-10-01'), null);
});
