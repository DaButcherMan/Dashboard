/* ══════════════════════════════════════════
   weight.js — the weight log behind the Fitness area.

   The maths is kept pure and takes its entries as an argument, so it can be
   tested without a Store and reused later for whatever else Fitness grows
   into (workouts, peptides). Only `all` and `stats` reach for stored state.

   An entry is { id, date: 'YYYY-MM-DD', value: Number, note }. One per day —
   the store enforces that — so a date is a safe key.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const S = () => D.Store;

  function sort(entries) {
    return entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // The reading in force on a given day: the most recent one on or before it.
  // Weighing is irregular, so "30 days ago" rarely lands on an actual entry.
  function valueOn(entries, dayKey) {
    let found = null;
    sort(entries).forEach((e) => { if (e.date <= dayKey) found = e; });
    return found;
  }

  function windowed(entries, days) {
    if (!days) return sort(entries);
    const from = D.dayKey(D.addDays(new Date(), -days));
    return sort(entries).filter((e) => e.date >= from);
  }

  // A change is only meaningful if there was a reading to change FROM, so
  // each window reports null rather than 0 when the log cannot support it.
  // Zero would read as "no change", which is a different claim.
  function summarize(entries, opts) {
    const rows = sort(entries);
    const o = opts || {};
    if (!rows.length) return { count: 0, current: null };

    const current = rows[rows.length - 1];
    const first = rows[0];
    const values = rows.map((e) => e.value);

    // The change across a window, → { value, from } or null.
    //
    // The reading we compare against has to actually represent that window,
    // which needs bounding from BOTH sides:
    //   too old  — an eight-month-old reading reporting as a weekly change
    //              is a real loss, but not one that happened this week;
    //   too new  — a three-day-old reading cannot speak for a month, because
    //              there is no month of history behind it.
    // Within those bounds, take whichever reading sits closest to the mark.
    const today = D.today();
    const back = (days) => {
      const mark = D.dayKey(D.addDays(new Date(), -days));
      const youngest = days / 2, oldest = days * 2;
      let best = null, bestGap = Infinity;

      rows.forEach((e) => {
        if (e.id === current.id) return;
        const age = D.daysBetween(e.date, today);
        if (age < youngest || age > oldest) return;
        const gap = Math.abs(D.daysBetween(e.date, mark));
        // Ties go to the older reading: it spans more of the window.
        if (gap < bestGap || (gap === bestGap && best && e.date < best.date)) {
          bestGap = gap; best = e;
        }
      });

      if (!best) return null;
      return {
        value: Math.round((current.value - best.value) * 10) / 10,
        from: best.date,
      };
    };

    const target = o.target == null ? null : Number(o.target);
    const w7 = back(7), w30 = back(30);
    return {
      count: rows.length,
      current,
      first,
      change7: w7 ? w7.value : null,
      change7From: w7 ? w7.from : null,
      change30: w30 ? w30.value : null,
      change30From: w30 ? w30.from : null,
      changeAll: rows.length > 1
        ? Math.round((current.value - first.value) * 10) / 10 : null,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      target,
      toGo: target == null ? null
        : Math.round((current.value - target) * 10) / 10,
    };
  }

  // Geometry for the SVG chart. x is spaced by DATE, not by index, so a
  // three-week gap looks like a three-week gap instead of one step.
  function plot(entries, opts) {
    const o = Object.assign({ w: 600, h: 150, pad: 10, target: null }, opts || {});
    const rows = sort(entries);
    if (!rows.length) return { points: [], line: '', area: '', yMin: 0, yMax: 0 };

    const values = rows.map((e) => e.value);
    if (o.target != null) values.push(Number(o.target));
    let lo = Math.min.apply(null, values);
    let hi = Math.max.apply(null, values);

    // A flat log (or a single reading) has no range to scale against, so
    // give it an arbitrary one rather than dividing by zero.
    if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    const headroom = (hi - lo) * 0.15;
    lo -= headroom; hi += headroom;

    const t0 = D.parseDayKey(rows[0].date).getTime();
    const t1 = D.parseDayKey(rows[rows.length - 1].date).getTime();
    const span = t1 - t0;
    const innerW = o.w - o.pad * 2;
    const innerH = o.h - o.pad * 2;

    const x = (e) => span
      ? o.pad + ((D.parseDayKey(e.date).getTime() - t0) / span) * innerW
      : o.w / 2;                                   // one point sits centred
    const y = (v) => o.pad + (1 - (v - lo) / (hi - lo)) * innerH;

    const points = rows.map((e) => ({ x: x(e), y: y(e.value), e }));
    const line = points.map((p, i) =>
      (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = points.length > 1
      ? line + ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (o.h - o.pad) +
        ' L' + points[0].x.toFixed(1) + ' ' + (o.h - o.pad) + ' Z'
      : '';

    return {
      points, line, area, yMin: lo, yMax: hi,
      targetY: o.target == null ? null : y(Number(o.target)),
    };
  }

  const Weight = {
    sort, valueOn, windowed, summarize, plot,

    all() { return sort(S().weights); },

    stats() {
      return summarize(S().weights, { target: S().settings.weightTarget });
    },

    unit() { return S().settings.weightUnit || 'lb'; },

    // '182.4 lb', trimming a pointless '.0'
    format(v) {
      if (v == null || isNaN(v)) return '—';
      const n = Math.round(Number(v) * 10) / 10;
      return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + Weight.unit();
    },

    // '+1.2' / '-0.8' — the sign carries the meaning, so it is always shown.
    delta(v) {
      if (v == null || isNaN(v)) return null;
      const n = Math.round(Number(v) * 10) / 10;
      const s = (n % 1 === 0 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(1));
      return (n > 0 ? '+' : n < 0 ? '−' : '') + s;
    },
  };

  D.Weight = Weight;
})(window.DASH);
