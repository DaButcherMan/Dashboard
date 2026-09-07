/* ══════════════════════════════════════════
   agenda.js — turns stored records into the shapes views render.

   Classes are stored once as a recurring pattern (days-of-week + time +
   term bounds); events are concrete datetimes. Both expand into a single
   sorted list of occurrences so Overview, Calendar and every area page
   render from one shape.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const S = () => D.Store;

  const KIND_LABEL = {
    class: 'Class', meeting: 'Meeting', appointment: 'Appointment',
    personal: 'Personal', event: 'Event',
  };
  D.KIND_LABEL = KIND_LABEL;

  // An occurrence: { id, kind, title, dayKey, startMin, endMin, allDay,
  //                  location, color, area, ref }
  // `ref` points back at the source record so edit and delete can find it.

  function courseOccurrences(dayKey) {
    const day = D.parseDayKey(dayKey).getDay();
    const out = [];
    S().courses.forEach((c) => {
      if (c.startDate && dayKey < c.startDate) return;    // term not started
      if (c.endDate   && dayKey > c.endDate)   return;    // term over
      (c.meetings || []).forEach((m, i) => {
        if (!(m.days || []).includes(day)) return;
        out.push({
          id:       c.id + ':' + i + ':' + dayKey,
          kind:     'class',
          title:    c.name,
          subtitle: c.code || '',
          dayKey,
          startMin: D.toMinutes(m.start),
          endMin:   m.end ? D.toMinutes(m.end) : D.toMinutes(m.start) + 50,
          allDay:   false,
          location: m.location || c.location || '',
          color:    c.color || S().areaColor('school'),
          area:     'school',
          ref:      { coll: 'courses', id: c.id },
        });
      });
    });
    return out;
  }

  function eventOccurrences(dayKey) {
    return S().events.filter((e) => {
      const start = new Date(e.start);
      return isFinite(start) && D.dayKey(start) === dayKey;
    }).map((e) => {
      const start = new Date(e.start);
      const end   = e.end ? new Date(e.end) : null;
      return {
        id:       e.id,
        kind:     e.kind || 'event',
        title:    e.title,
        subtitle: '',
        dayKey,
        startMin: e.allDay ? -1 : start.getHours() * 60 + start.getMinutes(),
        endMin:   end && !e.allDay ? end.getHours() * 60 + end.getMinutes() : null,
        allDay:   !!e.allDay,
        location: e.location || '',
        color:    e.area ? S().areaColor(e.area) : 'var(--ink-3)',
        area:     e.area || null,
        ref:      { coll: 'events', id: e.id },
      };
    });
  }

  const Agenda = {
    on(dayKey) {
      return courseOccurrences(dayKey)
        .concat(eventOccurrences(dayKey))
        .sort((a, b) => a.startMin - b.startMin);
    },

    // { dayKey: [occurrence,…] } across an inclusive span.
    range(fromKey, days) {
      const out = {};
      const from = D.parseDayKey(fromKey);
      for (let i = 0; i < days; i++) {
        const k = D.dayKey(D.addDays(from, i));
        out[k] = Agenda.on(k);
      }
      return out;
    },

    // The next `limit` occurrences from now, looking across days — this is
    // what "Upcoming Schedule" shows, so it must not stop at midnight.
    upcoming(limit, days) {
      const now = D.minutesNow();
      const today = D.today();
      const out = [];
      for (let i = 0; i < (days || 7) && out.length < limit; i++) {
        const key = D.dayKey(D.addDays(new Date(), i));
        Agenda.on(key).forEach((o) => {
          if (key === today && !o.allDay && o.startMin < now) return;   // already gone
          if (out.length < limit) out.push(o);
        });
      }
      return out;
    },

    nextUp() {
      const now = D.minutesNow();
      return Agenda.on(D.today()).find((o) => !o.allDay && o.startMin > now) || null;
    },

    current() {
      const now = D.minutesNow();
      return Agenda.on(D.today()).find((o) =>
        !o.allDay && o.startMin <= now && (o.endMin || o.startMin + 50) > now) || null;
    },
  };

  // ── Task queries ──────────────────────────────────────────────────────
  function byPriority(a, b) { return (b.priority || 0) - (a.priority || 0); }

  const Tasks = {
    open() { return S().tasks.filter((t) => !t.done); },
    done() { return S().tasks.filter((t) => t.done); },

    inArea(areaId, list) {
      return (list || S().tasks).filter((t) => t.area === areaId);
    },

    overdue() {
      const today = D.today();
      return Tasks.open()
        .filter((t) => t.due && t.due < today)
        .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byPriority(a, b)));
    },

    dueOn(key) { return Tasks.open().filter((t) => t.due === key).sort(byPriority); },

    // Open tasks in the order you would actually work through them:
    // overdue first, then by due date, undated last, priority breaking ties.
    queue() {
      return Tasks.open().slice().sort((a, b) => {
        if (!a.due && !b.due) return byPriority(a, b);
        if (!a.due) return 1;
        if (!b.due) return -1;
        if (a.due !== b.due) return a.due < b.due ? -1 : 1;
        return byPriority(a, b);
      });
    },

    upcoming(days) {
      const limit = D.dayKey(D.addDays(new Date(), days));
      return Tasks.queue().filter((t) => t.due && t.due <= limit);
    },

    // What "Today's Priorities" shows: everything genuinely demanding
    // attention now, hardest-first, without burying today under a backlog.
    priorities(limit) {
      const today = D.today();
      const overdue  = Tasks.overdue();
      const dueToday = Tasks.dueOn(today);
      const flagged  = Tasks.open().filter(
        (t) => t.priority === 2 && (!t.due || t.due > today));
      const seen = new Set();
      return overdue.concat(dueToday, flagged)
        .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
        .slice(0, limit || 6);
    },
  };

  // ── Stats ─────────────────────────────────────────────────────────────
  const Stats = {
    // Tasks completed per day across the current week, for Weekly Progress.
    week() {
      const start = D.startOfWeek(new Date());
      const days = [];
      let completed = 0;
      for (let i = 0; i < 7; i++) {
        const key = D.dayKey(D.addDays(start, i));
        const n = S().tasks.filter(
          (t) => t.done && t.doneAt && D.dayKey(new Date(t.doneAt)) === key).length;
        completed += n;
        days.push({ key, label: D.DOW_MIN[i], count: n, isToday: key === D.today() });
      }
      const target = S().settings.weeklyTarget || 15;
      const busiest = days.reduce((m, d) => Math.max(m, d.count), 0);
      return { days, completed, target, busiest, pct: D.pct(completed, target) };
    },

    // The four numbers across the top of the Overview.
    headline() {
      const today = D.today();
      const overdue = Tasks.overdue().length;
      const dueToday = Tasks.dueOn(today).length;
      const todayEvents = D.Agenda.on(today).length;
      const w = Stats.week();
      return { overdue, dueToday, todayEvents, weekDone: w.completed, weekPct: w.pct };
    },

    // Per-area rollup, used by the area pages and the Overview breakdown.
    byArea() {
      const today = D.today();
      return S().areas.map((a) => {
        const open = Tasks.open().filter((t) => t.area === a.id);
        const all  = S().tasks.filter((t) => t.area === a.id);
        return {
          area: a,
          open: open.length,
          overdue: open.filter((t) => t.due && t.due < today).length,
          total: all.length,
          done: all.filter((t) => t.done).length,
          pct: D.pct(all.filter((t) => t.done).length, all.length),
          goals: S().goals.filter((g) => g.area === a.id).length,
        };
      });
    },
  };

  // ── Goals ─────────────────────────────────────────────────────────────
  const Goals = {
    // A goal either counts something manually (`current`/`target`) or tracks
    // completion of the tasks in its area over a window.
    progress(g) {
      if (g.kind === 'tasks') {
        const all = S().tasks.filter((t) => t.area === g.area);
        const done = all.filter((t) => t.done).length;
        return { current: done, target: all.length || g.target || 1,
                 pct: D.pct(done, all.length || g.target || 1) };
      }
      const target = Number(g.target) || 1;
      const current = Number(g.current) || 0;
      return { current, target, pct: D.pct(current, target) };
    },

    inArea(areaId) { return S().goals.filter((g) => g.area === areaId); },
  };

  D.Agenda = Agenda;
  D.Tasks  = Tasks;
  D.Stats  = Stats;
  D.Goals  = Goals;
})(window.DASH);
