/* ══════════════════════════════════════════
   exercises.js — the exercise list behind the workout log.

   A starting catalogue grouped by body part, plus whatever you add
   yourself. Names only: these are the ordinary names lifts go by, and the
   list exists so logging is picking from a list rather than typing.

   `kind` decides what a set records:
     lift   — weight × reps
     bodyweight — reps (weight optional, for added load)
     cardio — duration and distance
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const S = () => D.Store;

  const CATALOGUE = [
    ['Chest', [
      ['Barbell Bench Press'], ['Incline Barbell Bench Press'], ['Decline Barbell Bench Press'],
      ['Dumbbell Bench Press'], ['Incline Dumbbell Press'], ['Dumbbell Fly'],
      ['Cable Fly'], ['Machine Chest Press'], ['Pec Deck'],
      ['Push Up', 'bodyweight'], ['Chest Dip', 'bodyweight'],
    ]],
    ['Back', [
      ['Deadlift'], ['Rack Pull'], ['Barbell Row'], ['Dumbbell Row'], ['T-Bar Row'],
      ['Seated Cable Row'], ['Lat Pulldown'], ['Straight-Arm Pulldown'],
      ['Face Pull'], ['Shrug'],
      ['Pull Up', 'bodyweight'], ['Chin Up', 'bodyweight'],
    ]],
    ['Shoulders', [
      ['Overhead Press'], ['Seated Dumbbell Press'], ['Arnold Press'],
      ['Machine Shoulder Press'], ['Lateral Raise'], ['Front Raise'],
      ['Rear Delt Fly'], ['Upright Row'],
    ]],
    ['Legs', [
      ['Back Squat'], ['Front Squat'], ['Goblet Squat'], ['Hack Squat'],
      ['Leg Press'], ['Romanian Deadlift'], ['Leg Extension'], ['Leg Curl'],
      ['Walking Lunge'], ['Bulgarian Split Squat'], ['Hip Thrust'], ['Calf Raise'],
    ]],
    ['Arms', [
      ['Barbell Curl'], ['Dumbbell Curl'], ['Hammer Curl'], ['Preacher Curl'],
      ['Cable Curl'], ['Triceps Pushdown'], ['Skull Crusher'],
      ['Overhead Triceps Extension'], ['Close-Grip Bench Press'],
      ['Triceps Dip', 'bodyweight'],
    ]],
    ['Core', [
      ['Hanging Leg Raise', 'bodyweight'], ['Cable Crunch'], ['Ab Wheel', 'bodyweight'],
      ['Russian Twist'], ['Sit Up', 'bodyweight'], ['Back Extension', 'bodyweight'],
      ['Plank', 'cardio'],
    ]],
    ['Olympic', [
      ['Power Clean'], ['Hang Clean'], ['Clean and Jerk'], ['Snatch'], ['Push Press'],
    ]],
    ['Cardio', [
      ['Running', 'cardio'], ['Treadmill', 'cardio'], ['Cycling', 'cardio'],
      ['Rowing Machine', 'cardio'], ['Elliptical', 'cardio'],
      ['Stair Climber', 'cardio'], ['Walking', 'cardio'], ['Swimming', 'cardio'],
    ]],
  ];

  // Flattened once: { name, category, kind }
  const BUILT_IN = [];
  CATALOGUE.forEach(([category, rows]) => {
    rows.forEach(([name, kind]) => {
      BUILT_IN.push({ name, category, kind: kind || 'lift', builtIn: true });
    });
  });

  const key = (n) => String(n || '').trim().toLowerCase();

  const Exercises = {
    CATEGORIES: CATALOGUE.map(([c]) => c),
    BUILT_IN,

    // Built-ins plus anything you have added, custom ones first within
    // their category so your own naming wins in the picker.
    all() {
      const custom = (S().exercises || []).map((e) =>
        ({ name: e.name, category: e.category || 'Other', kind: e.kind || 'lift', builtIn: false }));
      const taken = {};
      custom.forEach((e) => { taken[key(e.name)] = true; });
      return custom.concat(BUILT_IN.filter((e) => !taken[key(e.name)]));
    },

    find(name) {
      const k = key(name);
      return Exercises.all().find((e) => key(e.name) === k) || null;
    },

    // What a set for this exercise records. Unknown names are treated as
    // lifts, which is what a typed-in name almost always is.
    kindOf(name) {
      const e = Exercises.find(name);
      return e ? e.kind : 'lift';
    },

    byCategory(category, query) {
      const q = key(query);
      return Exercises.all()
        .filter((e) => (!category || e.category === category))
        .filter((e) => !q || key(e.name).includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    search(query) {
      const q = key(query);
      if (!q) return [];
      return Exercises.all()
        .filter((e) => key(e.name).includes(q))
        .sort((a, b) => {
          // Names that start with the query come first: typing "bench"
          // should not bury Bench Press under Close-Grip Bench Press.
          const sa = key(a.name).indexOf(q), sb = key(b.name).indexOf(q);
          return sa - sb || a.name.localeCompare(b.name);
        });
    },

    // Names you have actually logged, most recent first — the shortlist
    // that matters day to day.
    recent(limit) {
      const seen = {};
      const out = [];
      D.Workouts.allSets().slice().reverse().forEach((s) => {
        const k = key(s.exercise);
        if (seen[k]) return;
        seen[k] = true;
        out.push(s.exercise);
      });
      return out.slice(0, limit || 8);
    },
  };

  D.Exercises = Exercises;
})(window.DASH);
