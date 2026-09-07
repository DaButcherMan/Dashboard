/* ══════════════════════════════════════════
   workouts.js — sets, and everything derived from them.

   set { id, date, exercise, weight, reps, distance, duration, createdAt }

   Sets are a FLAT collection keyed by date and exercise, not nested inside
   a session. That is what makes the log exercise-first: you pick a day and
   an exercise and add sets to it, and a "workout" is simply whatever you
   logged that day. It also makes the two questions that matter cheap to
   answer — what did I do last time, and is this a record.

   All maths is pure and takes rows as arguments so it tests without a Store.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const S = () => D.Store;
  const round = (n) => Math.round(n * 10) / 10;
  const key = (n) => String(n || '').trim().toLowerCase();

  // Date first, then the order they were entered within the day.
  function sortSets(rows) {
    return (rows || []).slice().sort((a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1
        : String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1));
  }

  function onDate(rows, date) {
    return sortSets(rows).filter((s) => s.date === date);
  }

  function forExercise(rows, exercise) {
    const k = key(exercise);
    return sortSets(rows).filter((s) => key(s.exercise) === k);
  }

  // Exercise names logged that day, in the order they were first touched —
  // which is the order you actually trained them.
  function exercisesOn(rows, date) {
    const seen = {};
    const out = [];
    onDate(rows, date).forEach((s) => {
      const k = key(s.exercise);
      if (seen[k]) return;
      seen[k] = true;
      out.push(s.exercise);
    });
    return out;
  }

  function dates(rows) {
    const seen = {};
    sortSets(rows).forEach((s) => { seen[s.date] = true; });
    return Object.keys(seen).sort().reverse();
  }

  function volume(rows) {
    return (rows || []).reduce((sum, s) =>
      sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
  }

  // Epley. An ESTIMATE, and it drifts above ~10 reps — which is why
  // progression compares estimates with each other rather than presenting
  // any one of them as a true max.
  function e1rm(weight, reps) {
    const w = Number(weight) || 0, r = Number(reps) || 0;
    if (w <= 0 || r <= 0) return 0;
    return r === 1 ? w : round(w * (1 + r / 30));
  }

  function bestSet(rows) {
    let best = null, bestE = 0;
    (rows || []).forEach((s) => {
      const e = e1rm(s.weight, s.reps);
      if (e > bestE) { bestE = e; best = s; }
    });
    return best ? { set: best, e1rm: bestE } : null;
  }

  // The last day this exercise was trained BEFORE the given date, with its
  // sets. This is the reference you want in front of you while logging:
  // beating last time is the whole game.
  function lastTime(rows, exercise, beforeDate) {
    const mine = forExercise(rows, exercise).filter((s) => s.date < beforeDate);
    if (!mine.length) return null;
    const date = mine[mine.length - 1].date;
    return { date, sets: mine.filter((s) => s.date === date) };
  }

  // Personal bests. Volume is per SESSION rather than per set, because a
  // day's total is the number people actually chase.
  function records(rows, exercise) {
    const mine = forExercise(rows, exercise);
    if (!mine.length) return null;

    let maxWeight = null, maxReps = null, best = null;
    mine.forEach((s) => {
      const w = Number(s.weight) || 0, r = Number(s.reps) || 0;
      if (w > 0 && (!maxWeight || w > maxWeight.weight)) maxWeight = s;
      if (r > 0 && (!maxReps || r > maxReps.reps)) maxReps = s;
      const e = e1rm(s.weight, s.reps);
      if (!best || e > best.e1rm) best = { set: s, e1rm: e };
    });

    let maxVolume = null;
    dates(mine).forEach((d) => {
      const v = volume(mine.filter((s) => s.date === d));
      if (v > 0 && (!maxVolume || v > maxVolume.volume)) maxVolume = { date: d, volume: v };
    });

    return { maxWeight, maxReps, maxVolume, best, sessions: dates(mine).length };
  }

  // Would this set be a new best? Checked before it is saved, so the answer
  // is about the set you are about to add rather than one already counted.
  function wouldBeRecord(rows, exercise, set) {
    const r = records(rows, exercise);
    if (!r) return { weight: true, e1rm: true, first: true };
    const w = Number(set.weight) || 0;
    return {
      first: false,
      weight: !!(w > 0 && r.maxWeight && w > Number(r.maxWeight.weight)),
      e1rm: e1rm(set.weight, set.reps) > (r.best ? r.best.e1rm : 0),
    };
  }

  // One point per session: the best estimated max that day. Shaped
  // { date, value } so it drops into the same chart the weight log uses.
  function progression(rows, exercise) {
    const mine = forExercise(rows, exercise);
    return dates(mine).slice().reverse().map((d) => {
      const best = bestSet(mine.filter((s) => s.date === d));
      return best ? { date: d, value: best.e1rm, set: best.set } : null;
    }).filter(Boolean);
  }

  function weekStats(rows, todayKey) {
    const today = todayKey || D.today();
    const start = D.dayKey(D.startOfWeek(D.parseDayKey(today)));
    const inWeek = sortSets(rows).filter((s) => s.date >= start && s.date <= today);
    return {
      from: start,
      days: dates(inWeek).length,
      sets: inWeek.length,
      volume: volume(inWeek),
    };
  }

  const Workouts = {
    sortSets, onDate, forExercise, exercisesOn, dates, volume, e1rm, bestSet,
    lastTime, records, wouldBeRecord, progression, weekStats,

    allSets() { return sortSets(S().sets); },
    setsOn(date) { return onDate(S().sets, date); },
    trainedDates() { return dates(S().sets); },
    lastTrained() { return dates(S().sets)[0] || null; },

    unit() { return S().settings.weightUnit || 'lb'; },

    fmtWeight(v) {
      const n = Number(v) || 0;
      return (n % 1 === 0 ? n.toFixed(0) : round(n).toFixed(1)) + ' ' + Workouts.unit();
    },

    fmtVolume(v) {
      return Math.round(Number(v) || 0).toLocaleString() + ' ' + Workouts.unit();
    },

    // '185 × 5', or '30 min · 3.1 mi' for cardio.
    fmtSet(s) {
      const kind = D.Exercises ? D.Exercises.kindOf(s.exercise) : 'lift';
      if (kind === 'cardio') {
        return [s.duration ? s.duration + ' min' : '',
                s.distance ? s.distance + ' mi' : ''].filter(Boolean).join(' · ') || '—';
      }
      if (kind === 'bodyweight' && !Number(s.weight)) return (s.reps || 0) + ' reps';
      return (Number(s.weight) || 0) + ' × ' + (Number(s.reps) || 0);
    },
  };

  D.Workouts = Workouts;
})(window.DASH);
