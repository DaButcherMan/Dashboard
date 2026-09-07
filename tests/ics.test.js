/* Tests for the ICS reader. Run: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The app modules attach to window.DASH; give them one.
function loadDash(files) {
  const ctx = { window: {}, console, localStorage: null };
  ctx.window.DASH = {};
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  return ctx.window.DASH;
}

const D = loadDash(['util.js', 'ics.js']);

// A Canvas feed: an assignment (note the folded line and the escaped comma),
// a calendar event, and an all-day item.
const CANVAS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT',
  'DTSTART:20260910T035959Z',
  'DTEND:20260910T035959Z',
  'UID:event-assignment-12345',
  'SUMMARY:Problem Set 3\\, chapters 4-5 [CHEM 201 Organic Chem',
  ' istry]',
  'DESCRIPTION:Submit as a PDF.',
  'URL:https://school.instructure.com/courses/1/assignments/12345',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20260912T140000',
  'DTEND;TZID=America/New_York:20260912T150000',
  'UID:event-calendar-event-777',
  'SUMMARY:Review session [CHEM 201 Organic Chemistry]',
  'LOCATION:Sci 118',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260915',
  'UID:event-calendar-event-888',
  'SUMMARY:Reading day',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses every VEVENT in the feed', () => {
  const events = D.ICS.parse(CANVAS);
  assert.strictEqual(events.length, 3);
});

test('unfolds continuation lines and unescapes text', () => {
  const [assignment] = D.ICS.parse(CANVAS);
  assert.strictEqual(assignment.summary,
    'Problem Set 3, chapters 4-5 [CHEM 201 Organic Chemistry]');
});

test('reads a UTC stamp as UTC', () => {
  const [assignment] = D.ICS.parse(CANVAS);
  assert.strictEqual(assignment.start.toISOString(), '2026-09-10T03:59:59.000Z');
});

test('a date-only DTSTART is all-day and does not shift across time zones', () => {
  const readingDay = D.ICS.parse(CANVAS)[2];
  assert.strictEqual(readingDay.allDay, true);
  assert.strictEqual(readingDay.start.getFullYear(), 2026);
  assert.strictEqual(readingDay.start.getMonth(), 8);   // September
  assert.strictEqual(readingDay.start.getDate(), 15);
  // The bug this guards: building it as UTC would render as the 14th
  // anywhere west of Greenwich.
  assert.strictEqual(D.dayKey(readingDay.start), '2026-09-15');
});

test('keeps location and url', () => {
  const [assignment, review] = D.ICS.parse(CANVAS);
  assert.strictEqual(review.location, 'Sci 118');
  assert.match(assignment.url, /assignments\/12345$/);
});

test('an event with no DTSTART is skipped rather than crashing', () => {
  const broken = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:no-date', 'SUMMARY:Nothing', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.strictEqual(D.ICS.parse(broken).length, 0);
});

test('handles LF-only line endings', () => {
  assert.strictEqual(D.ICS.parse(CANVAS.replace(/\r\n/g, '\n')).length, 3);
});

test('empty input yields no events', () => {
  assert.strictEqual(D.ICS.parse('').length, 0);
});
