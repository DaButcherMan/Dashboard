/* ══════════════════════════════════════════
   canvas.js — read a pasted Canvas grades/assignments page.

   Canvas has no student-facing API without a token, but its grades page
   pastes as text with a very regular shape:

       Unit 3 Lab          <- name
       Labs                <- category
       Sep 14 by 11:59pm   <- due (then tabs, then submitted/score columns)

   So due lines are the anchor: find one, and the name is two lines above.
   Everything else on the page — the nav header, the grade-weight table at
   the bottom — has no due line and is ignored for free.

   ── Time zones ────────────────────────────────────────────────────────
   Canvas prints due dates in the COURSE's zone with no zone marker. We
   read them as US Eastern and resolve the real instant with Intl, rather
   than hardcoding a UTC offset: the offset changes with DST, and the
   parser must not care which side of the switch a date falls on.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const SOURCE_ZONE = 'America/New_York';

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // 'Sep 14 by 11:59pm' — the due column. An optional leading 'Due '
  // appears on some Canvas layouts.
  const DUE_RE = /^(?:due\s+)?([a-z]{3})[a-z]*\s+(\d{1,2})\s+by\s+(\d{1,2}):(\d{2})\s*([ap])m/i;

  // 'Aug 25 at 11:45pm' — that is the SUBMITTED column, not a deadline.
  // It only reaches column one when the assignment has no due date.
  const SUBMITTED_RE = /^([a-z]{3})[a-z]*\s+(\d{1,2})\s+at\s+/i;

  // '(ISM5563-0003.fa26) Introduction to Business Analytics'
  //   → code 'ISM5563', name 'Introduction to Business Analytics'
  // The code is the letters AND the digits welded together; what follows the
  // first hyphen is the section and term, which we do not want.
  const COURSE_RE = /^\(([A-Za-z]{2,5}\s?\d{3,5})[^)]*\)\s*(.+)$/;

  // ── Time zone ───────────────────────────────────────────────────────
  // How far `tz` is ahead of UTC at this instant, in ms.
  function zoneOffset(date, tz) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    dtf.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    const asUTC = Date.UTC(p.year, p.month - 1, p.day,
      p.hour === '24' ? 0 : p.hour, p.minute, p.second);
    return asUTC - date.getTime();
  }

  // A wall-clock reading in `tz` → the real instant.
  // Applied twice because the offset itself depends on the instant, and the
  // first guess can land on the wrong side of a DST boundary.
  function fromZone(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo, d, h, mi);
    const first = guess - zoneOffset(new Date(guess), tz);
    const second = guess - zoneOffset(new Date(first), tz);
    return new Date(second);
  }

  // Canvas omits the year. Assume the one that puts the date nearest to
  // now: a Fall listing read in September is this year, a Spring listing
  // read in the same September belongs to next year.
  function inferYear(month, day, now) {
    const y = now.getFullYear();
    const candidates = [y - 1, y, y + 1].map((yy) => ({
      yy, gap: Math.abs(new Date(yy, month, day) - now),
    }));
    candidates.sort((a, b) => a.gap - b.gap);
    return candidates[0].yy;
  }

  function looksLikeName(line) {
    if (!line) return false;
    if (DUE_RE.test(line) || SUBMITTED_RE.test(line)) return false;
    if (/^[\s/\d.\-]*$/.test(line)) return false;         // score fragments: '/ 25'
    if (/^click to test/i.test(line)) return false;
    return line.length <= 160;
  }

  const Canvas = {
    // → { course: {code, name} | null, items: [...], skipped: n }
    parse(text, opts) {
      const now = (opts && opts.now) || new Date();
      const lines = String(text).replace(/\r/g, '').split('\n')
        .map((l) => l.replace(/\t+/g, '\t').trim());

      let course = null;
      for (const line of lines) {
        const m = COURSE_RE.exec(line);
        if (m) { course = { code: m[1].toUpperCase(), name: m[2].trim() }; break; }
      }

      const items = [];
      const seen = {};
      let skipped = 0;

      for (let i = 0; i < lines.length; i++) {
        const due = DUE_RE.exec(lines[i]);
        if (!due) continue;
        if (i < 2) continue;

        const name = lines[i - 2];
        const category = lines[i - 1];
        if (!looksLikeName(name)) { skipped++; continue; }

        const month = MONTHS[due[1].toLowerCase()];
        if (month === undefined) { skipped++; continue; }

        const day = Number(due[2]);
        let hour = Number(due[3]) % 12;
        if (due[5].toLowerCase() === 'p') hour += 12;
        const minute = Number(due[4]);
        const year = inferYear(month, day, now);

        const at = fromZone(year, month, day, hour, minute, SOURCE_ZONE);
        if (!isFinite(at)) { skipped++; continue; }

        // Keyed on course + name so two courses never collide and a
        // re-paste updates in place instead of duplicating.
        const sourceId = 'canvas:' + (course ? course.code : '?') + ':' + name;
        if (seen[sourceId]) continue;
        seen[sourceId] = true;

        items.push({
          title: name,
          category: looksLikeName(category) ? category : '',
          sourceId,
          at,                                  // the real instant
          due: D.dayKey(at),                   // local calendar day
          dueTime: at.toISOString(),
        });
      }

      return { course, items, skipped };
    },

    // The zone the converted times will read in — shown in the preview so
    // there is never a question about what "converted" produced.
    localZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time';
      } catch (e) { return 'your local time'; }
    },

    SOURCE_ZONE,
  };

  D.Canvas = Canvas;
})(window.DASH);
