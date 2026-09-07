/* Tests for the pasted-Canvas-page reader. Run: node --test tests/*.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDash(files) {
  const ctx = { window: {}, console, Intl, Date };
  ctx.window.DASH = {};
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  return ctx.window.DASH;
}

const D = loadDash(['util.js', 'canvas.js']);

// Read while the Fall 2026 term is running, so year inference has a fixed
// reference instead of depending on when the suite is run.
const NOW = new Date('2026-09-06T12:00:00Z');

// A slice of a real Canvas grades page: nav chrome at the top, the course
// line, graded and ungraded rows, a submitted-only row, and the grade-weight
// table at the bottom.
const PAGE = [
  'Skip To Content',
  'Dashboard',
  'Courses',
  'Calendar',
  'ISM5563-0003.fa26GradesGabriel Galindo Mendez',
  '2026 Fall - 1',
  'Course',
  '(ISM5563-0003.fa26) Introduction to Business Analytics',
  'Arrange By',
  'Due Date',
  'Name\tDue\tSubmitted\tStatus\tScore',
  'Student Information Survey',
  'Surveys',
  'Aug 31 by 11:59pm\tAug 30 at 12:01am\t\t',
  'Click to test a different scoreInstructor has not posted this gradeQuiz Submission / 0',
  'Unit 1 DB-1',
  'Discussions',
  'Aug 31 by 11:59pm\tAug 31 at 2:13am\t\t',
  'Click to test a different score1.5 / 5',
  'Unit 3 Lab',
  'Labs',
  'Sep 14 by 11:59pm\t\t\t',
  ' / 25',
  'Unit 10 Quiz',
  'Quizzes',
  'Nov 2 by 11:59pm\t\t\t',
  ' / 10',
  'Final Group Project',
  'Group Project',
  'Dec 7 by 11:59pm\t\t\t',
  ' / 100',
  'Introductions',
  'Surveys',
  'Aug 25 at 11:45pm\t\t',          // submitted column only — no deadline
  'Unit 1 DB',
  'Discussions',
  ' / 5',                            // no dates at all
  'Labs\t\t\t\t',
  'N/A',
  '0.00 / 0.00',
  'Total',
  '30%',
].join('\n');

const parsed = D.Canvas.parse(PAGE, { now: NOW });
const byName = {};
parsed.items.forEach((i) => { byName[i.title] = i; });

// The module runs inside a vm context, so arrays it builds have that
// realm's Array prototype and are never deep-equal to one built here.
// Array.from rebuilds them in this realm.
const pluck = (items, key) => Array.from(items, (i) => i[key]);

test('pulls the course code and title out of the header', () => {
  assert.deepStrictEqual(
    { code: parsed.course.code, name: parsed.course.name },
    { code: 'ISM5563', name: 'Introduction to Business Analytics' });
});

test('finds every row that has a real due date, and nothing else', () => {
  assert.deepStrictEqual(pluck(parsed.items, 'title'), [
    'Student Information Survey',
    'Unit 1 DB-1',
    'Unit 3 Lab',
    'Unit 10 Quiz',
    'Final Group Project',
  ]);
});

test('keeps the category that sits under each name', () => {
  assert.strictEqual(byName['Unit 3 Lab'].category, 'Labs');
  assert.strictEqual(byName['Final Group Project'].category, 'Group Project');
});

test('a submitted-only row is not mistaken for a deadline', () => {
  // 'Aug 25 at 11:45pm' is the Submitted column: it says when it went in,
  // not when it was due.
  assert.ok(!byName['Introductions']);
});

test('nav chrome and the grade-weight table are ignored', () => {
  ['Skip To Content', 'Dashboard', 'Labs', 'Total', 'N/A']
    .forEach((junk) => assert.ok(!byName[junk], junk + ' should not be an assignment'));
});

test('11:59pm Eastern in September resolves as EDT (UTC-4)', () => {
  assert.strictEqual(byName['Unit 3 Lab'].at.toISOString(), '2026-09-15T03:59:00.000Z');
});

test('11:59pm Eastern in November resolves as EST (UTC-5)', () => {
  // US DST ended 1 Nov 2026, so this date is an hour further from UTC than
  // the September one. Hardcoding a single offset would put it out by an hour.
  assert.strictEqual(byName['Unit 10 Quiz'].at.toISOString(), '2026-11-03T04:59:00.000Z');
});

test('both sides of the DST switch read as 8:59 PM Pacific', () => {
  // The point of the conversion: Eastern and Pacific shift together, so an
  // 11:59pm Eastern deadline is always 8:59pm Pacific — same calendar day.
  const pacific = (d) => {
    const p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour12: true,
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
    return p.month + ' ' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + p.dayPeriod;
  };
  assert.strictEqual(pacific(byName['Unit 3 Lab'].at), 'Sep 14 8:59 PM');
  assert.strictEqual(pacific(byName['Unit 10 Quiz'].at), 'Nov 2 8:59 PM');
});

test('infers the year that puts each date nearest the reading date', () => {
  assert.strictEqual(byName['Final Group Project'].at.getUTCFullYear(), 2026);
  // A spring term read in September belongs to the following year.
  const spring = D.Canvas.parse(
    ['Midterm', 'Exams', 'Jan 20 by 11:59pm'].join('\n'), { now: NOW });
  assert.strictEqual(spring.items[0].at.getUTCFullYear(), 2027);
});

test('sourceId is stable and namespaced by course, so a re-paste updates', () => {
  assert.strictEqual(byName['Unit 3 Lab'].sourceId, 'canvas:ISM5563:Unit 3 Lab');
  const again = D.Canvas.parse(PAGE, { now: NOW });
  assert.deepStrictEqual(pluck(again.items, 'sourceId'),
                         pluck(parsed.items, 'sourceId'));
});

test('the same assignment listed twice is only imported once', () => {
  const dupe = D.Canvas.parse(PAGE + '\n' + PAGE, { now: NOW });
  assert.strictEqual(dupe.items.length, parsed.items.length);
});

test('empty or junk input yields nothing rather than throwing', () => {
  assert.strictEqual(D.Canvas.parse('', { now: NOW }).items.length, 0);
  assert.strictEqual(D.Canvas.parse('no dates here at all', { now: NOW }).items.length, 0);
});
