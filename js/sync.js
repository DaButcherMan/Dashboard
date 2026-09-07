/* ══════════════════════════════════════════
   sync.js — pluggable calendar sources.

   Each provider turns a remote feed into records and hands them to
   Store.replaceSource(), which swaps out everything previously imported
   from that source while leaving anything typed by hand untouched. Local
   edits (done, priority, notes) survive a resync by sourceId.

   ── The CORS problem, stated plainly ──────────────────────────────────
   Canvas, Outlook and Google do not send CORS headers on their .ics
   feeds, so a browser on a different origin cannot read them directly.
   That is a browser rule, not a bug to work around in JS. Two ways out:

     1. Set a proxy URL in Settings. Any endpoint that fetches a URL and
        echoes the body with `Access-Control-Allow-Origin` works — a
        Supabase edge function or Cloudflare Worker is about ten lines.
     2. Paste the feed's contents into the importer by hand for a one-off.

   Sports data needs none of this: ESPN sends `Access-Control-Allow-Origin: *`.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  // Build the fetch URL, routing through the configured proxy when present.
  // '{url}' in the template is replaced with the encoded feed URL; a
  // template without the token gets it appended as a query value.
  function proxied(feedUrl) {
    const tpl = (D.Store.settings.proxyUrl || '').trim();
    if (!tpl) return feedUrl;
    return tpl.includes('{url}')
      ? tpl.replace('{url}', encodeURIComponent(feedUrl))
      : tpl + encodeURIComponent(feedUrl);
  }

  async function fetchFeed(feedUrl) {
    const url = proxied(feedUrl);
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(
        D.Store.settings.proxyUrl
          ? 'Could not reach the proxy. Check the proxy URL in Settings.'
          : 'The browser blocked this request (CORS). Set a proxy URL in Settings, ' +
            'or use "Paste feed" to import once by hand.'
      );
    }
    if (!res.ok) throw new Error('Feed returned ' + res.status);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('That URL did not return a calendar feed.');
    }
    return text;
  }

  // ── Providers ───────────────────────────────────────────────────────
  // A provider declares which collections it writes and how to map a
  // parsed VEVENT into a record.

  const providers = {
    // Canvas emits assignment due dates and calendar events in one feed.
    // Assignment UIDs are prefixed 'event-assignment-'; everything else is
    // a calendar event. Summaries read 'Title [Course Name]'.
    canvas: {
      label: 'Canvas',
      area: 'school',
      placeholder: 'https://school.instructure.com/feeds/calendars/…',
      ingest(parsed) {
        const tasks = [], events = [];
        parsed.forEach((ev) => {
          const uid = ev.uid || (ev.summary + '@' + ev.start.toISOString());
          const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(ev.summary || '');
          const title = m ? m[1] : (ev.summary || 'Untitled');
          const courseName = m ? m[2] : '';

          if (/assignment/i.test(uid)) {
            tasks.push({
              sourceId: uid,
              title,
              area: 'school',
              courseName,
              course: matchCourse(courseName),
              due: D.dayKey(ev.start),
              dueTime: ev.allDay ? null : ev.start.toISOString(),
              notes: '',
              url: ev.url || '',
              priority: 0,
              done: false,
            });
          } else {
            events.push({
              sourceId: uid,
              title,
              kind: 'event',
              area: 'school',
              start: ev.start.toISOString(),
              end: ev.end ? ev.end.toISOString() : null,
              allDay: !!ev.allDay,
              location: ev.location || '',
              url: ev.url || '',
            });
          }
        });
        return { tasks, events };
      },
    },

    // Outlook and Google feeds are plain meeting calendars. Each lands in a
    // sensible default area, which you can change per event afterwards.
    outlook: {
      label: 'Outlook',
      placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics',
      ingest: meetingsAs('meeting', 'work'),
    },
    google: {
      label: 'Google Calendar',
      placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
      // No area: a personal calendar spans everything, so leave imported
      // events unassigned rather than guessing one.
      ingest: meetingsAs('personal', null),
    },
  };

  function meetingsAs(kind, area) {
    return function (parsed) {
      return {
        tasks: [],
        events: parsed.map((ev) => ({
          sourceId: ev.uid || (ev.summary + '@' + ev.start.toISOString()),
          title:    ev.summary || 'Untitled',
          kind,
          area,
          start:    ev.start.toISOString(),
          end:      ev.end ? ev.end.toISOString() : null,
          allDay:   !!ev.allDay,
          location: ev.location || '',
          url:      ev.url || '',
        })),
      };
    };
  }

  // Canvas names a course in full ('BIOL 101 Intro to Biology'); the user
  // may have shortened it. Match on either name or code, case-insensitively.
  function matchCourse(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    const hit = D.Store.courses.find((c) =>
      n.includes((c.name || '').toLowerCase()) ||
      (c.code && n.includes(c.code.toLowerCase())) ||
      (c.name || '').toLowerCase().includes(n));
    return hit ? hit.id : null;
  }

  const Sync = {
    providers,

    // Import already-fetched .ics text. Used both by run() and by the
    // manual paste box, so the two paths cannot drift apart.
    async ingestText(name, text) {
      const provider = providers[name];
      if (!provider) throw new Error('Unknown source: ' + name);

      const parsed = D.ICS.parse(text);
      if (!parsed.length) throw new Error('No events found in that feed.');

      const { tasks, events } = provider.ingest(parsed);
      const nT = tasks.length  ? await D.Store.replaceSource('tasks',  name, tasks)  : 0;
      const nE = events.length ? await D.Store.replaceSource('events', name, events) : 0;

      const sources = Object.assign({}, D.Store.settings.sources);
      sources[name] = Object.assign({}, sources[name], { lastSync: new Date().toISOString() });
      await D.Store.saveSettings({ sources });

      return { tasks: nT, events: nE };
    },

    // Fetch and import in one step.
    async run(name) {
      const cfg = (D.Store.settings.sources || {})[name];
      if (!cfg || !cfg.url) throw new Error('No feed URL saved for ' + name + '.');
      const text = await fetchFeed(cfg.url);
      return Sync.ingestText(name, text);
    },

    // Every configured source, one after another. Failures are collected
    // rather than thrown so one bad feed does not stop the others.
    async runAll() {
      const cfgs = D.Store.settings.sources || {};
      const names = Object.keys(cfgs).filter((n) => cfgs[n] && cfgs[n].url && providers[n]);
      const report = [];
      for (const n of names) {
        try {
          const r = await Sync.run(n);
          report.push({ name: n, ok: true, ...r });
        } catch (e) {
          report.push({ name: n, ok: false, error: e.message });
        }
      }
      return report;
    },
  };

  D.Sync = Sync;
})(window.DASH);
