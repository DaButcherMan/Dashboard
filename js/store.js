/* ══════════════════════════════════════════
   store.js — the single data layer.

   Every read and write goes through Store, and every method is async even
   though the current backend (localStorage) is synchronous. Swapping in a
   real backend means replacing ONLY the `backend` object below.

   ── Areas ─────────────────────────────────────────────────────────────
   School, Work and Fitness are not separate modules; they are one concept.
   A task, event or goal carries an `area`, and each area page is a filtered
   view over the same collections.

   Two areas own something extra of their own: School has `courses` (only it
   has recurring class meetings) and Fitness has `weights`.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const KEY = 'dashboard.v2';
  const LEGACY_KEY = 'dashboard.v1';

  // The definitive list of areas. There is no UI for creating them, so this
  // is the single source of truth: adding or removing one here is all it
  // takes, because `normalize` reconciles stored state against it on load.
  // `id` is used in routing and on every record, so ids never change.
  const DEFAULT_AREAS = [
    { id: 'school',  key: 'school',  name: 'School',  icon: 'school',  color: '#4C7DF0' },
    { id: 'work',    key: 'work',    name: 'Work',    icon: 'work',    color: '#0E9F8E' },
    { id: 'fitness', key: 'fitness', name: 'Fitness', icon: 'fitness', color: '#E0803C' },
  ];

  const EMPTY = {
    areas:    DEFAULT_AREAS.map((a) => Object.assign({}, a)),
    courses:  [],
    tasks:    [],
    events:   [],
    goals:    [],
    weights:  [],
    protocols: [],                  // peptide protocols (the plan)
    doses:     [],                  // peptide doses taken (the record)
    sets:      [],                  // every logged set, flat: date + exercise
    workouts:  [],                  // one row per trained day, for its note
    exercises: [],                  // exercises you added yourself

    // Deletions, kept as [{ collection, id, at }]. A delete has to be a
    // record of its own: drop the row silently and any other device still
    // holding it pushes it back on its next sync, so the deletion undoes
    // itself. Cleared once the server has been told.
    tombstones: [],

    // Facts about this device rather than about your data. Never synced:
    // each device exports its own file, so another device's export tells
    // you nothing about whether *this* one is backed up.
    device: {
      lastExportAt: null,
    },

    // Sync bookkeeping. Not a collection and never uploaded: it is this
    // device's notes about the server, and it lives outside `settings` so
    // that recording a sync does not look like a settings edit and bounce
    // straight back out as one.
    sync: {
      userId:       null,   // whose data this is; a different login must not push it
      lastPulledAt: null,   // newest server updated_at we have seen
      lastPushedAt: null,   // start of our last successful push
    },
    settings: {
      name: '',
      theme: 'system',              // system | light | dark
      favTeams: [],
      sources: {},
      proxyUrl: '',
      weeklyTarget: 15,             // tasks/week, drives Weekly Progress
      weightUnit: 'lb',             // lb | kg
      weightTarget: null,           // optional goal line on the chart
    },
  };

  function blank() { return JSON.parse(JSON.stringify(EMPTY)); }

  const stamp = () => new Date().toISOString();

  // The collections that sync. `areas` is deliberately absent: the code owns
  // that list, so syncing it would let an old device push back an area a
  // newer build has removed.
  const SYNCED = ['courses', 'tasks', 'events', 'goals', 'weights',
                  'protocols', 'doses', 'sets', 'workouts', 'exercises'];

  // Settings sync too — which teams you follow should follow you between
  // devices — as one row, all of it except these. A Canvas feed URL is a
  // bearer token: anyone holding it can read your calendar without logging
  // in. It stays on the device you typed it into rather than being copied
  // into a database, its backups and its logs.
  const DEVICE_ONLY = ['sources', 'proxyUrl'];
  const SETTINGS_ID = 'app';

  // ── Backend: localStorage ───────────────────────────────────────────
  // Replace this object to move to a server. Contract: load() → state,
  // save(state) → void; both may be async.
  const backend = {
    async load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return normalize(JSON.parse(raw));

        // First run on v2: adopt a v1 state if one is sitting there.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const migrated = migrateV1(JSON.parse(legacy));
          await backend.save(migrated);
          return migrated;
        }
        return blank();
      } catch (e) {
        console.error('store: load failed, starting empty', e);
        return blank();
      }
    },
    async save(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.error('store: save failed', e);
        D.toast('Could not save — storage may be full');
      }
    },
  };

  // Merge against EMPTY so a state written by an older build still has every
  // collection the current code expects.
  function normalize(parsed) {
    const s = blank();
    s.courses  = parsed.courses  || [];
    s.tasks    = parsed.tasks    || [];
    s.events   = parsed.events   || [];
    s.goals    = parsed.goals    || [];
    s.weights   = parsed.weights   || [];
    s.protocols = parsed.protocols || [];
    s.doses     = parsed.doses     || [];
    s.workouts  = parsed.workouts  || [];
    s.sets      = parsed.sets      || [];
    s.exercises = parsed.exercises || [];
    s.tombstones = parsed.tombstones || [];
    s.sync = Object.assign({}, EMPTY.sync, parsed.sync || {});
    s.device = Object.assign({}, EMPTY.device, parsed.device || {});

    // Sets used to live nested inside each session. Flatten them once so
    // the log can be read by exercise as well as by day; the day rows stay
    // behind to carry their notes.
    if (!parsed.sets && s.workouts.some((w) => w.sets && w.sets.length)) {
      const flat = [];
      s.workouts.forEach((w) => (w.sets || []).forEach((x, i) => {
        if (!x || !x.exercise) return;
        flat.push({
          id: D.uid(), date: w.date, exercise: x.exercise,
          weight: x.weight, reps: x.reps,
          createdAt: (w.createdAt || w.date) + ':' + i,
        });
      }));
      s.sets = flat;
      s.workouts = s.workouts.map((w) =>
        ({ id: w.id, date: w.date, note: w.note || w.name || '', createdAt: w.createdAt }));
    }
    s.settings = Object.assign({}, EMPTY.settings, parsed.settings || {});

    // `s.areas` is already DEFAULT_AREAS and deliberately overrides whatever
    // was stored: the code owns the list, so dropping an area here removes it
    // everywhere without needing a one-off migration each time.
    //
    // Records pointing at an area that no longer exists are un-assigned
    // rather than deleted — losing a category must never lose the task.
    const live = {};
    s.areas.forEach((a) => { live[a.id] = true; });
    const reattach = (rows) => rows.map((r) =>
      (r.area && !live[r.area]) ? Object.assign({}, r, { area: null }) : r);

    s.tasks  = reattach(s.tasks);
    s.events = reattach(s.events);
    s.goals  = reattach(s.goals);

    // Everything written before sync existed has no updatedAt. Backfill it
    // once, from createdAt where there is one, so the push cursor has
    // something to compare against — otherwise those rows look changed on
    // every pass and get re-uploaded forever.
    SYNCED.forEach((coll) => s[coll].forEach((r) => {
      if (!r.updatedAt) r.updatedAt = r.createdAt || '1970-01-01T00:00:00.000Z';
    }));
    if (!s.settings.updatedAt) s.settings.updatedAt = '1970-01-01T00:00:00.000Z';
    return s;
  }

  // v1 had no areas: everything with a course belonged to School, and
  // meetings were work, appointments personal.
  function migrateV1(old) {
    const s = normalize(old);
    s.tasks = (old.tasks || []).map((t) =>
      Object.assign({}, t, { area: t.area || (t.course ? 'school' : null) }));
    s.events = (old.events || []).map((e) =>
      Object.assign({}, e, {
        area: e.area || (e.kind === 'meeting' ? 'work' : null),
      }));
    return s;
  }

  let state = null;
  const listeners = [];

  function emit() {
    listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
  }
  async function commit() { await backend.save(state); emit(); }

  const Store = {
    async init() { state = await backend.load(); return state; },

    onChange(fn) { listeners.push(fn); },

    // Reads are synchronous against the loaded snapshot; writes are async.
    get all()      { return state; },
    get areas()    { return state.areas; },
    get courses()  { return state.courses; },
    get tasks()    { return state.tasks; },
    get events()   { return state.events; },
    get goals()    { return state.goals; },
    get weights()  { return state.weights; },
    get protocols(){ return state.protocols; },
    get doses()    { return state.doses; },
    get workouts() { return state.workouts; },
    get sets()     { return state.sets; },
    get exercises(){ return state.exercises; },
    get settings() { return state.settings; },

    area(id) { return state.areas.find((a) => a.id === id) || null; },

    areaColor(id) {
      const a = Store.area(id);
      return a ? a.color : 'var(--muted)';
    },

    // ── Generic CRUD ──────────────────────────────────────────────────
    // Every write stamps `updatedAt`. Sync resolves conflicts by comparing
    // it, so a row without one can never win against a row that has one —
    // which is why it is set here rather than left to call sites.
    async add(coll, rec) {
      const row = Object.assign({
        id: D.uid(),
        createdAt: stamp(),
        source: 'manual',
      }, rec, { updatedAt: stamp() });
      state[coll].push(row);
      await commit();
      return row;
    },

    async update(coll, id, patch) {
      const row = state[coll].find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: stamp() });
      await commit();
      return row;
    },

    async remove(coll, id) {
      const i = state[coll].findIndex((r) => r.id === id);
      if (i === -1) return false;
      state[coll].splice(i, 1);
      // Remember the deletion, or the next sync from a device that still
      // has this row will hand it straight back.
      if (SYNCED.includes(coll)) {
        state.tombstones = state.tombstones
          .filter((t) => !(t.collection === coll && t.id === id))
          .concat([{ collection: coll, id, at: stamp() }]);
      }
      await commit();
      return true;
    },

    // One reading per day: logging again for a date you already recorded
    // corrects it rather than stacking a second entry, which would make any
    // trend read as noise.
    async setWeight(date, value, note) {
      const row = state.weights.find((w) => w.date === date);
      if (row) {
        Object.assign(row, { value, note: note || '', updatedAt: stamp() });
      } else {
        state.weights.push({
          id: D.uid(), date, value, note: note || '',
          createdAt: stamp(), updatedAt: stamp(),
        });
      }
      await commit();
      return row || state.weights[state.weights.length - 1];
    },

    async saveSettings(patch) {
      Object.assign(state.settings, patch, { updatedAt: stamp() });
      await commit();
      return state.settings;
    },

    // ── Sync hook ─────────────────────────────────────────────────────
    // A provider hands over the full current set of records it owns. We
    // swap out everything previously imported from that source and leave
    // manual records alone; local edits survive by sourceId.
    async replaceSource(coll, sourceName, records) {
      const keepById = {};
      state[coll].filter((r) => r.source === sourceName)
                 .forEach((r) => { keepById[r.sourceId] = r; });

      const mine = state[coll].filter((r) => r.source !== sourceName);
      const incoming = records.map((r) => {
        const old = keepById[r.sourceId];
        return Object.assign({
          id: (old && old.id) || D.uid(),
          createdAt: (old && old.createdAt) || stamp(),
          source: sourceName,
          updatedAt: stamp(),
        }, r, old ? {
          done:     old.done,
          doneAt:   old.doneAt,
          priority: old.priority,
          area:     old.area || r.area,
          notes:    old.notes || r.notes,
        } : {});
      });

      state[coll] = mine.concat(incoming);
      await commit();
      return incoming.length;
    },

    // Add rows, or update the ones already imported under the same
    // sourceId. Unlike replaceSource this leaves other rows alone, so
    // importing a second course does not wipe the first — and re-pasting an
    // updated page corrects dates in place instead of duplicating.
    //
    // Whatever you have done to a row locally (ticked it off, raised its
    // priority, written a note) outranks the import.
    async upsertBySource(coll, rows) {
      let added = 0, updated = 0;
      rows.forEach((r) => {
        const old = state[coll].find((x) => x.sourceId && x.sourceId === r.sourceId);
        if (old) {
          Object.assign(old, r, {
            id: old.id,
            createdAt: old.createdAt,
            done: old.done,
            doneAt: old.doneAt,
            priority: old.priority,
            notes: old.notes || r.notes,
            updatedAt: stamp(),
          });
          updated++;
        } else {
          state[coll].push(Object.assign({
            id: D.uid(),
            createdAt: stamp(),
          }, r, { updatedAt: stamp() }));
          added++;
        }
      });
      await commit();
      return { added, updated };
    },

    // ── Sync surface ──────────────────────────────────────────────────
    // Used only by cloud.js. Everything here works on `updatedAt`, which is
    // set by whichever device made the change — so conflicts resolve to the
    // most recently edited copy, assuming the devices agree roughly on the
    // time. They do; they are all NTP-synced phones and laptops.
    get syncMeta() { return state.sync; },
    get device() { return state.device; },
    get tombstones() { return state.tombstones; },

    // Strip the device-only keys, then hand back what may leave the device.
    settingsForSync() {
      const out = {};
      Object.keys(state.settings).forEach((k) => {
        if (DEVICE_ONLY.indexOf(k) === -1) out[k] = state.settings[k];
      });
      return out;
    },

    // Everything edited since `iso`, shaped the way the server stores it.
    // Deletions ride along as rows flagged deleted rather than as absences.
    changedSince(iso) {
      const since = iso || '';
      const out = [];
      SYNCED.forEach((coll) => state[coll].forEach((r) => {
        if ((r.updatedAt || '') > since) {
          out.push({ collection: coll, id: r.id, data: r,
                     updated_at: r.updatedAt, deleted: false });
        }
      }));
      if ((state.settings.updatedAt || '') > since) {
        out.push({ collection: 'settings', id: SETTINGS_ID,
                   data: Store.settingsForSync(),
                   updated_at: state.settings.updatedAt, deleted: false });
      }
      state.tombstones.forEach((t) => out.push({
        collection: t.collection, id: t.id, data: {}, updated_at: t.at, deleted: true,
      }));
      return out;
    },

    // Merge rows from the server. Nothing here re-stamps updatedAt: these
    // edits happened elsewhere and must keep the time they happened, or the
    // device that merely received a change would win the next conflict.
    async applyRemote(rows) {
      let n = 0;
      rows.forEach((r) => {
        const at = r.updated_at || '';

        if (r.collection === 'settings') {
          if (r.deleted) return;
          if ((state.settings.updatedAt || '') >= at) return;
          // Device-only keys are not in the payload; keep the local ones.
          const keep = {};
          DEVICE_ONLY.forEach((k) => { keep[k] = state.settings[k]; });
          state.settings = Object.assign({}, EMPTY.settings, r.data, keep,
                                         { updatedAt: at });
          n++;
          return;
        }
        if (SYNCED.indexOf(r.collection) === -1) return;   // unknown to this build

        // A deletion we have not pushed yet outranks an older server copy;
        // without this the row we just deleted comes straight back.
        const tomb = state.tombstones.find(
          (t) => t.collection === r.collection && t.id === r.id);
        if (tomb && tomb.at > at) return;

        const arr = state[r.collection];
        const i = arr.findIndex((x) => x.id === r.id);
        if (i > -1 && (arr[i].updatedAt || '') >= at) return;   // ours is newer

        if (r.deleted) {
          if (i > -1) { arr.splice(i, 1); n++; }
        } else {
          const row = Object.assign({}, r.data, { id: r.id, updatedAt: at });
          if (i > -1) arr[i] = row; else arr.push(row);
          n++;
        }
      });
      if (n) await commit();
      return n;
    },

    // Called after the server has accepted a push. Tombstones raised while
    // that push was in flight are kept, not cleared.
    async syncDone(patch, pushedBefore) {
      Object.assign(state.sync, patch);
      if (pushedBefore) {
        state.tombstones = state.tombstones.filter((t) => t.at > pushedBefore);
      }
      await commit();
    },

    // Signing in as someone else: drop this device's copy rather than push
    // one person's data into another's account.
    async resetLocal(userId) {
      state = blank();
      state.sync.userId = userId || null;
      await commit();
      return state;
    },

    // ── Durability ────────────────────────────────────────────────────
    // Ask the browser to stop treating this data as disposable. Without it
    // a browser clearing space may drop the lot, and on iOS Safari
    // untouched site data can be cleared after about a week.
    //
    // Chrome and Firefox answer this honestly. Safari does not implement
    // it meaningfully, which is why installing to the home screen — not
    // this call — is what actually protects an iPhone.
    async requestPersistence() {
      const s = navigator.storage;
      if (!s || !s.persist || !s.persisted) return null;   // unsupported
      try {
        if (await s.persisted()) return true;
        return await s.persist();
      } catch (e) {
        return null;
      }
    },

    // Size of what we store, in UTF-16 code units — the unit browsers
    // actually bill localStorage in, so this is the number that matters
    // rather than the origin quota, which is orders of magnitude larger
    // and would give a falsely reassuring answer.
    dataSize() { return JSON.stringify(state).length; },

    // ── Backup / restore ──────────────────────────────────────────────
    exportJSON() { return JSON.stringify(state, null, 2); },

    async noteExport() {
      state.device.lastExportAt = stamp();
      await commit();
      return state.device.lastExportAt;
    },

    async importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a dashboard backup');
      // A v1 backup has no areas; route it through the same migration.
      state = parsed.areas ? normalize(parsed) : migrateV1(parsed);
      await commit();
      return state;
    },
  };

  D.Store = Store;
})(window.DASH);
