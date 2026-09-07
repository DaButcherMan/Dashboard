/* ══════════════════════════════════════════
   ics.js — a small iCalendar (RFC 5545) reader.

   Canvas, Outlook and Google all publish a subscribable .ics feed, and all
   three describe assignments and meetings with the same handful of
   properties. This parses the subset that matters: VEVENT blocks with
   DTSTART / DTEND / SUMMARY / LOCATION / DESCRIPTION / UID / URL.

   Recurrence (RRULE) is deliberately not expanded — the feeds we care
   about emit assignment due dates and individual meetings as discrete
   VEVENTs. Recurring class blocks are entered as courses instead.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  // Long property lines are folded onto continuation lines beginning with a
  // space or tab. Rejoin them before anything else.
  function unfold(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n[ \t]/g, '');
  }

  // 'DTSTART;TZID=America/New_York:20260910T133000' splits into the property
  // name, its parameters, and the value.
  function splitLine(line) {
    const colon = line.indexOf(':');
    if (colon === -1) return null;
    const left  = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts = left.split(';');
    const params = {};
    parts.slice(1).forEach((p) => {
      const eq = p.indexOf('=');
      if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    });
    return { name: parts[0].toUpperCase(), params, value };
  }

  // Text values escape commas, semicolons and newlines.
  function unescapeText(v) {
    return String(v)
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  // Returns { date, allDay }. A bare 'YYYYMMDD' is an all-day value and is
  // built in local time so it does not slide a day across time zones. A
  // 'Z' suffix is UTC. A floating or TZID-qualified stamp is read as local:
  // without a full tz database that is the closest honest reading, and the
  // feeds we consume publish in the viewer's own zone anyway.
  function parseDate(value, params) {
    const v = String(value).trim();

    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (dateOnly) {
      return {
        date: new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
        allDay: true,
      };
    }

    const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
    if (!stamp) return { date: null, allDay: false };

    const [, y, mo, d, h, mi, s, z] = stamp;
    const n = (x) => Number(x);
    const date = z
      ? new Date(Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s)))
      : new Date(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s));
    return { date, allDay: false, tzid: params && params.TZID };
  }

  const ICS = {
    // Parse a feed into plain objects:
    //   { uid, summary, description, location, url, start, end, allDay }
    parse(text) {
      const lines = unfold(text).split('\n');
      const out = [];
      let cur = null;

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (line === 'END:VEVENT') {
          if (cur && cur.start) out.push(cur);
          cur = null;
          continue;
        }
        if (!cur) continue;

        const p = splitLine(line);
        if (!p) continue;

        switch (p.name) {
          case 'UID':         cur.uid = p.value; break;
          case 'SUMMARY':     cur.summary = unescapeText(p.value); break;
          case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
          case 'LOCATION':    cur.location = unescapeText(p.value); break;
          case 'URL':         cur.url = p.value; break;
          case 'DTSTART': {
            const r = parseDate(p.value, p.params);
            if (r.date) { cur.start = r.date; cur.allDay = r.allDay; }
            break;
          }
          case 'DTEND': {
            const r = parseDate(p.value, p.params);
            if (r.date) cur.end = r.date;
            break;
          }
          default: break;
        }
      }
      return out;
    },
  };

  D.ICS = ICS;
})(window.DASH);
