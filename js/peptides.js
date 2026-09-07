/* ══════════════════════════════════════════
   peptides.js — protocols (the plan) and doses (the record).

   Kept apart deliberately. A protocol says what you intend to take and how
   often; a dose says what you actually took. Adherence is the comparison,
   which is only possible while the two stay separate — folding a dose into
   its protocol would lose the question entirely.

   protocol { id, compound, dose, unit, freq, everyN, days[],
              startDate, endDate, note, active }
   dose     { id, protocolId, compound, date, dose, unit, site, note }

   Schedules cover the shapes peptide protocols actually take:
     daily     — every day
     everyN    — every N days, counted from startDate
     weekdays  — fixed days of the week (5-on-2-off, Mon/Thu, …)

   All maths is pure and takes its rows as arguments, so it tests without a
   Store and `todayKey` can be pinned.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const S = () => D.Store;

  const UNITS = ['mg', 'mcg', 'iu', 'ml'];
  const FREQS = [
    { id: 'daily',    label: 'Every day' },
    { id: 'everyN',   label: 'Every N days' },
    { id: 'weekdays', label: 'Certain days' },
  ];

  function describe(p) {
    if (p.freq === 'daily') return 'Every day';
    if (p.freq === 'everyN') {
      const n = Number(p.everyN) || 1;
      return n === 1 ? 'Every day' : 'Every ' + n + ' days';
    }
    const days = (p.days || []).slice().sort((a, b) => a - b);
    if (!days.length) return 'No days set';
    if (days.length === 7) return 'Every day';
    return days.map((d) => D.DOW_SHORT[d]).join(', ');
  }

  // Every date the protocol calls for, within [fromKey, toKey] and clamped
  // to the protocol's own start/end.
  function scheduleDates(p, fromKey, toKey) {
    const out = [];
    if (!p.startDate) return out;

    let from = fromKey > p.startDate ? fromKey : p.startDate;
    let to = toKey;
    if (p.endDate && p.endDate < to) to = p.endDate;
    if (from > to) return out;

    const start = D.parseDayKey(p.startDate);
    const total = D.daysBetween(from, to);
    if (total < 0) return out;

    for (let i = 0; i <= total; i++) {
      const d = D.addDays(D.parseDayKey(from), i);
      const key = D.dayKey(d);
      if (p.freq === 'daily') { out.push(key); continue; }
      if (p.freq === 'everyN') {
        const n = Math.max(1, Number(p.everyN) || 1);
        // Counted from the start date, so the cadence never drifts with the
        // window being asked about.
        if (D.daysBetween(D.dayKey(start), key) % n === 0) out.push(key);
        continue;
      }
      if ((p.days || []).includes(d.getDay())) out.push(key);
    }
    return out;
  }

  function dosesFor(p, doses) {
    return doses.filter((x) => x.protocolId === p.id);
  }

  // The next date this protocol asks for that has not been logged. Today
  // counts if today's dose is still outstanding.
  function nextDue(p, doses, todayKey) {
    const today = todayKey || D.today();
    if (p.active === false) return null;
    if (p.endDate && p.endDate < today) return null;

    const taken = {};
    dosesFor(p, doses).forEach((x) => { taken[x.date] = true; });
    // 60 days is far enough ahead to find the next slot in any of these
    // cadences without walking a whole year for a lapsed protocol.
    const ahead = D.dayKey(D.addDays(D.parseDayKey(today), 60));
    return scheduleDates(p, today, ahead).find((k) => !taken[k]) || null;
  }

  // Doses taken versus doses called for, over the trailing window.
  // Returns null when the window contains nothing scheduled — a protocol
  // that has not started yet is not 0% adherent, it is not measurable.
  function adherence(p, doses, days, todayKey) {
    const today = todayKey || D.today();
    const from = D.dayKey(D.addDays(D.parseDayKey(today), -(days - 1)));
    const due = scheduleDates(p, from, today);
    if (!due.length) return null;

    const taken = {};
    dosesFor(p, doses).forEach((x) => { taken[x.date] = true; });
    const hit = due.filter((k) => taken[k]).length;
    return { due: due.length, taken: hit, pct: Math.round((hit / due.length) * 100) };
  }

  // The washout, in days. Stored as a value plus a unit so the form can say
  // "4 weeks" and mean it, rather than making you convert to 28 yourself.
  function offDays(p) {
    const v = Number(p.offValue);
    if (!isFinite(v) || v <= 0) return 0;
    return p.offUnit === 'weeks' ? Math.round(v * 7) : Math.round(v);
  }

  function describeOff(p) {
    const v = Number(p.offValue);
    if (!v) return '';
    const unit = p.offUnit === 'weeks' ? 'week' : 'day';
    return v + ' ' + unit + (v === 1 ? '' : 's') + ' off';
  }

  // When the compound can be taken again.
  //
  // Counted from the END date — the last day on — because that is how a
  // washout is stated: "four weeks off" after finishing on the 1st means
  // going again on the 29th, not the 30th. The UI names the end date
  // alongside it so the arithmetic is never in question.
  //
  // Null unless there is both an end date and an off period: an open-ended
  // protocol never stops, so it never restarts.
  function restart(p, todayKey) {
    const today = todayKey || D.today();
    const off = offDays(p);
    if (!p.endDate || !off) return null;

    const date = D.dayKey(D.addDays(D.parseDayKey(p.endDate), off));
    const daysLeft = D.daysBetween(today, date);
    return {
      date,
      off,
      daysLeft,
      ready: daysLeft <= 0,
      // Still taking it: the washout has not begun.
      running: p.endDate >= today,
    };
  }

  // Has this run already been picked up by a later one of the same compound?
  //
  // Restarting adds a NEW protocol rather than editing the old one, so the
  // finished run would otherwise keep offering "Ready to restart" forever
  // and invite a second and third copy.
  function supersededBy(p, protocols, todayKey) {
    const today = todayKey || D.today();
    const name = String(p.compound || '').trim().toLowerCase();
    if (!name) return null;
    return protocols.find((x) =>
      x.id !== p.id &&
      String(x.compound || '').trim().toLowerCase() === name &&
      x.active !== false &&
      (!x.endDate || x.endDate >= today) &&
      (!p.endDate || (x.startDate || '') > p.endDate)) || null;
  }

  // Where you are in a fixed-length cycle. Null when the protocol is open
  // ended — there is no progress through something with no finish.
  function cycleProgress(p, todayKey) {
    const today = todayKey || D.today();
    if (!p.startDate || !p.endDate) return null;
    const total = D.daysBetween(p.startDate, p.endDate) + 1;
    if (total <= 0) return null;
    const day = D.daysBetween(p.startDate, today) + 1;
    return {
      day: Math.max(0, Math.min(total, day)),
      total,
      pct: Math.max(0, Math.min(100, Math.round((day / total) * 100))),
      done: day > total,
      started: day >= 1,
    };
  }

  const Peptides = {
    UNITS, FREQS, describe, describeOff, offDays, restart, supersededBy,
    scheduleDates, nextDue, adherence, cycleProgress, dosesFor,

    // Protocols that have finished and are counting down to going again,
    // soonest first. Runs already restarted are left out — their countdown
    // is answered.
    awaitingRestart() {
      const today = D.today();
      const all = S().protocols;
      return all
        .map((p) => ({ protocol: p, restart: restart(p, today) }))
        .filter((r) => r.restart && !r.restart.running &&
                       !supersededBy(r.protocol, all, today))
        .sort((a, b) => (a.restart.date < b.restart.date ? -1 : 1));
    },

    protocols() { return S().protocols; },
    doses()     { return S().doses.slice().sort((a, b) => (a.date < b.date ? 1 : -1)); },

    active() {
      const today = D.today();
      return S().protocols.filter((p) =>
        p.active !== false && (!p.endDate || p.endDate >= today));
    },

    // The soonest outstanding dose across every active protocol.
    upNext() {
      const doses = S().doses;
      let best = null;
      Peptides.active().forEach((p) => {
        const due = nextDue(p, doses, D.today());
        if (due && (!best || due < best.date)) best = { date: due, protocol: p };
      });
      return best;
    },

    format(p) {
      const d = p.dose == null ? '' : p.dose;
      return d === '' ? '' : d + ' ' + (p.unit || 'mg');
    },
  };

  D.Peptides = Peptides;
})(window.DASH);
