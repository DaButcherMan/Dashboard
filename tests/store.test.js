/* Tests for the sync half of the store: what gets pushed, what a remote
   row is allowed to overwrite, and — the one that actually loses data if
   it is wrong — whether a deleted record can come back.

   Run: node --test tests/*.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A fresh store per test, with localStorage faked in memory so each one
// starts from nothing.
function freshStore(seed) {
  const mem = {};
  const ctx = {
    console, Date, Math, isNaN, Number, JSON, Object, Array, String,
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
    window: {},
  };
  ctx.window.DASH = {};
  ctx.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) };
  vm.createContext(ctx);
  for (const f of ['util.js', 'store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  }
  if (seed) mem['dashboard.v2'] = JSON.stringify(seed);
  return { D: ctx.window.DASH, mem };
}

const T = {
  old:   '2026-01-01T00:00:00.000Z',
  mid:   '2026-06-01T00:00:00.000Z',
  newer: '2026-09-01T00:00:00.000Z',
};

async function storeWith(rows) {
  const { D } = freshStore(rows);
  await D.Store.init();
  return D.Store;
}

// ── updatedAt ─────────────────────────────────────────────────────────
test('backfills updatedAt on records written before sync existed', async () => {
  const S = await storeWith({
    tasks: [{ id: 't1', title: 'old', createdAt: T.old }, { id: 't2', title: 'no dates' }],
  });
  assert.strictEqual(S.tasks[0].updatedAt, T.old, 'falls back to createdAt');
  assert.strictEqual(S.tasks[1].updatedAt, '1970-01-01T00:00:00.000Z');
});

test('every mutator stamps updatedAt', async () => {
  const S = await storeWith(null);
  const before = new Date().toISOString();
  const t = await S.add('tasks', { title: 'x' });
  assert.ok(t.updatedAt >= before, 'add stamps');

  const bump = t.updatedAt;
  await new Promise((r) => setTimeout(r, 2));
  const u = await S.update('tasks', t.id, { title: 'y' });
  assert.ok(u.updatedAt > bump, 'update re-stamps');
});

// ── changedSince ──────────────────────────────────────────────────────
test('changedSince returns only records edited after the cursor', async () => {
  const S = await storeWith({
    tasks: [
      { id: 'a', title: 'stale', updatedAt: T.old },
      { id: 'b', title: 'fresh', updatedAt: T.newer },
    ],
  });
  const out = S.changedSince(T.mid);
  assert.deepStrictEqual(Array.from(out, (r) => r.id), ['b']);
  assert.strictEqual(out[0].collection, 'tasks');
  assert.strictEqual(out[0].deleted, false);
});

test('changedSince carries deletions as flagged rows, not as absences', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'go', updatedAt: T.old }] });
  await S.remove('tasks', 'a');

  const out = S.changedSince(T.newer);   // cursor past every edit
  const tomb = out.find((r) => r.id === 'a');
  assert.ok(tomb, 'the deletion is pushed even though the row is gone');
  assert.strictEqual(tomb.deleted, true);
  // Object.keys, not deepStrictEqual: a literal built inside the vm context
  // has that realm's prototype and never compares equal to one out here.
  assert.deepStrictEqual(Object.keys(tomb.data), []);
});

test('settings sync as one row, stripped of the calendar credentials', async () => {
  const S = await storeWith(null);
  await S.saveSettings({ name: 'Gabriel', proxyUrl: 'https://proxy.example/?url=',
                         sources: { canvas: { url: 'https://canvas.fsu.edu/feeds/…secret' } } });

  const row = S.changedSince(T.old).find((r) => r.collection === 'settings');
  assert.ok(row, 'settings are pushed');
  assert.strictEqual(row.data.name, 'Gabriel');
  assert.strictEqual(row.data.proxyUrl, undefined, 'proxy URL never leaves the device');
  assert.strictEqual(row.data.sources, undefined, 'feed URLs never leave the device');
});

test('areas are never pushed — the code owns that list', async () => {
  const S = await storeWith(null);
  const colls = new Set(S.changedSince(T.old).map((r) => r.collection));
  assert.ok(!colls.has('areas'));
});

// ── applyRemote ───────────────────────────────────────────────────────
test('a newer remote edit wins', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'mine', updatedAt: T.old }] });
  await S.applyRemote([{ collection: 'tasks', id: 'a',
                         data: { id: 'a', title: 'theirs' }, updated_at: T.newer }]);
  assert.strictEqual(S.tasks[0].title, 'theirs');
  assert.strictEqual(S.tasks[0].updatedAt, T.newer, 'keeps the time the edit happened');
});

test('an older remote edit loses', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'mine', updatedAt: T.newer }] });
  await S.applyRemote([{ collection: 'tasks', id: 'a',
                         data: { id: 'a', title: 'theirs' }, updated_at: T.old }]);
  assert.strictEqual(S.tasks[0].title, 'mine');
});

test('an unseen remote record is added', async () => {
  const S = await storeWith(null);
  await S.applyRemote([{ collection: 'weights', id: 'w1',
                         data: { id: 'w1', date: '2026-09-01', value: 182 },
                         updated_at: T.newer }]);
  assert.strictEqual(S.weights.length, 1);
  assert.strictEqual(S.weights[0].value, 182);
});

test('a remote deletion removes the local row', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'mine', updatedAt: T.old }] });
  await S.applyRemote([{ collection: 'tasks', id: 'a', data: {},
                         updated_at: T.newer, deleted: true }]);
  assert.strictEqual(S.tasks.length, 0);
});

test('a local delete is not undone by the stale copy still on the server', async () => {
  // The case the whole tombstone mechanism exists for: another device
  // still holds the row and hands it back on its next sync.
  const S = await storeWith({ tasks: [{ id: 'a', title: 'done with it', updatedAt: T.old }] });
  await S.remove('tasks', 'a');
  await S.applyRemote([{ collection: 'tasks', id: 'a',
                         data: { id: 'a', title: 'done with it' }, updated_at: T.mid }]);
  assert.strictEqual(S.tasks.length, 0, 'the deleted task stays deleted');
});

test('but a genuine re-add after the delete does come through', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'x', updatedAt: T.old }] });
  await S.remove('tasks', 'a');
  const later = new Date(Date.now() + 60000).toISOString();
  await S.applyRemote([{ collection: 'tasks', id: 'a',
                         data: { id: 'a', title: 'back on purpose' }, updated_at: later }]);
  assert.strictEqual(S.tasks.length, 1);
  assert.strictEqual(S.tasks[0].title, 'back on purpose');
});

test('remote settings merge without overwriting this device\'s feed URLs', async () => {
  const S = await storeWith(null);
  await S.saveSettings({ sources: { canvas: { url: 'https://canvas.fsu.edu/feeds/…secret' } } });
  await S.applyRemote([{ collection: 'settings', id: 'app',
                         data: { name: 'From the phone', weightUnit: 'kg' },
                         updated_at: '2099-01-01T00:00:00.000Z' }]);
  assert.strictEqual(S.settings.name, 'From the phone');
  assert.strictEqual(S.settings.weightUnit, 'kg');
  assert.ok(S.settings.sources.canvas, 'the local feed URL survives the merge');
});

test('a collection this build does not know is ignored, not crashed on', async () => {
  const S = await storeWith(null);
  const n = await S.applyRemote([{ collection: 'recipes', id: 'r1',
                                   data: { id: 'r1' }, updated_at: T.newer }]);
  assert.strictEqual(n, 0);
});

// ── bookkeeping ───────────────────────────────────────────────────────
test('syncDone clears pushed tombstones but keeps ones raised mid-flight', async () => {
  const S = await storeWith({
    tasks: [{ id: 'a', title: 'a', updatedAt: T.old },
            { id: 'b', title: 'b', updatedAt: T.old }],
  });
  await S.remove('tasks', 'a');
  const cutoff = new Date(Date.now() + 1).toISOString();
  await new Promise((r) => setTimeout(r, 3));
  await S.remove('tasks', 'b');           // deleted while the push was in flight

  await S.syncDone({ lastPushedAt: cutoff }, cutoff);
  assert.deepStrictEqual(Array.from(S.tombstones, (t) => t.id), ['b']);
});

test('resetLocal empties the device and records whose data it now holds', async () => {
  const S = await storeWith({ tasks: [{ id: 'a', title: 'previous account', updatedAt: T.old }] });
  await S.resetLocal('user-2');
  assert.strictEqual(S.tasks.length, 0);
  assert.strictEqual(S.syncMeta.userId, 'user-2');
  assert.strictEqual(S.areas.length, 3, 'the areas come back from code');
});

test('sync bookkeeping is not part of settings, so a sync is not an edit', async () => {
  const S = await storeWith(null);
  await S.saveSettings({ name: 'Gabriel' });
  const before = S.settings.updatedAt;
  await S.syncDone({ lastPulledAt: T.newer });
  assert.strictEqual(S.settings.updatedAt, before,
    'recording a sync must not look like a settings change');
});
