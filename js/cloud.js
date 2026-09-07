/* ══════════════════════════════════════════
   cloud.js — sync between devices, via Supabase.

   ── The shape of it ──────────────────────────────────────────────────
   localStorage stays the working copy. Every read and write in the app
   goes there and nowhere else, exactly as before; this file runs behind
   it, pushing what changed up and pulling what changed down. Nothing here
   is on the critical path, so the dashboard opens, reads and writes with
   no network, no account and no Supabase project at all — and catches up
   the next time it can reach the server.

   That ordering is the whole design. A sync layer that the app waits on
   is a sync layer that takes the app down with it.

   ── Conflicts ────────────────────────────────────────────────────────
   Last writer wins, per record, on `updatedAt`. For one person on two or
   three devices this is the right trade: the alternative is asking you to
   resolve merge conflicts on your own to-do list. Two devices editing the
   same row while both offline is the only case that loses anything, and
   what it loses is the older edit.

   Deletes are the exception that needs care, and they are handled in
   store.js: a delete is recorded as a tombstone and pushed as a row
   flagged `deleted`, because a row that simply vanishes locally gets
   handed straight back by the next device that still has it.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  const TABLE = 'dashboard_records';   // prefixed: this project has other tables
  const PAGE = 1000;          // rows per pull request
  const CHUNK = 400;          // rows per push request
  const DEBOUNCE = 2500;      // ms of quiet after an edit before pushing
  const INTERVAL = 5 * 60000; // background catch-up
  const EPOCH = '1970-01-01T00:00:00.000Z';

  const cfg = () => (D.CONFIG || {});

  // The Supabase dashboard shows several URLs on one page, and the REST
  // endpoint (…supabase.co/rest/v1/) is the easiest to copy by mistake.
  // supabase-js wants the bare project origin and appends its own paths, so
  // that paste would produce …/rest/v1/rest/v1/… and 404 everything while
  // looking, from the outside, like a wrong sign-in code. Trim to the origin
  // rather than trusting the paste.
  function projectUrl() {
    const raw = String(cfg().SUPABASE_URL || '').trim();
    if (!raw) return '';
    try { return new URL(raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); }
  }

  const configured = () => !!(projectUrl() && cfg().SUPABASE_ANON_KEY);

  let client = null;
  let session = null;
  let libPromise = null;
  let inFlight = null;
  let pushTimer = null;
  let applying = false;       // suppresses the change we cause ourselves

  // ── Status ──────────────────────────────────────────────────────────
  // phase: off | signed-out | idle | syncing | offline | error
  let status = { phase: 'off', message: '', at: null, email: '' };
  const watchers = [];

  function setStatus(phase, message) {
    status = {
      phase,
      message: message || '',
      at: (phase === 'idle') ? new Date().toISOString() : status.at,
      email: (session && session.user && session.user.email) || '',
    };
    watchers.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } });
  }

  // ── Loading the library ─────────────────────────────────────────────
  // Deliberately lazy and deliberately not in the service worker shell:
  // it is a third-party script that the app must be able to boot without.
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { libPromise = null; reject(new Error('offline')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // Postgres hands timestamps back as '…+00:00'; we write '…Z'. Both are
  // the same instant and neither compares correctly against the other as a
  // string ('+' sorts below 'Z', so every server row would silently lose
  // every conflict). Everything crossing this boundary is normalised to Z.
  function iso(v) {
    if (!v) return EPOCH;
    const d = new Date(v);
    return isNaN(d) ? EPOCH : d.toISOString();
  }

  // ── Pull ────────────────────────────────────────────────────────────
  // Pages on updated_at. The cursor moves with `gte`, not `gt`, because a
  // bulk import (pasting thirty assignments at once) stamps every row with
  // the same millisecond — `gt` would step over the rest of that batch.
  // Rows already seen in this pull are dropped by key.
  async function pull(uid) {
    const meta = D.Store.syncMeta;
    let cursor = iso(meta.lastPulledAt || EPOCH);
    let first = true;
    const seen = {};
    const rows = [];

    for (let guard = 0; guard < 50; guard++) {
      let q = client.from(TABLE)
        .select('collection,id,data,updated_at,deleted')
        .eq('user_id', uid)
        .order('updated_at', { ascending: true })
        .limit(PAGE);
      q = first ? q.gt('updated_at', cursor) : q.gte('updated_at', cursor);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;

      let fresh = 0;
      data.forEach((r) => {
        // '/' cannot appear in a collection name, so the two halves of
        // this key can never run together into a different pair.
        const key = r.collection + '/' + r.id;
        if (seen[key]) return;
        seen[key] = 1;
        fresh++;
        rows.push({
          collection: r.collection,
          id: r.id,
          data: r.data || {},
          updated_at: iso(r.updated_at),
          deleted: !!r.deleted,
        });
      });

      cursor = iso(data[data.length - 1].updated_at);
      first = false;
      if (data.length < PAGE || fresh === 0) break;
    }

    if (!rows.length) return { applied: 0, cursor: null };

    applying = true;
    let applied;
    try {
      applied = await D.Store.applyRemote(rows);
    } finally {
      applying = false;
    }
    const newest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), EPOCH);
    return { applied, cursor: newest };
  }

  // ── Push ────────────────────────────────────────────────────────────
  async function push(uid) {
    // Taken before the upload, not after: anything edited while the
    // request is in flight must still look unsent on the next pass.
    const startedAt = new Date().toISOString();
    const meta = D.Store.syncMeta;
    const changes = D.Store.changedSince(meta.lastPushedAt || EPOCH);
    if (!changes.length) return null;

    const rows = changes.map((c) => ({
      user_id: uid,          // RLS would reject a wrong one; sending it
      collection: c.collection,   // explicitly keeps the conflict target whole
      id: c.id,
      data: c.deleted ? {} : c.data,
      updated_at: c.updated_at,
      deleted: c.deleted,
    }));

    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await client.from(TABLE)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,collection,id' });
      if (error) throw error;
    }
    return { count: rows.length, startedAt };
  }

  // ── One pass ────────────────────────────────────────────────────────
  async function run() {
    if (!client || !session) return;
    if (navigator.onLine === false) { setStatus('offline'); return; }

    const uid = session.user.id;
    setStatus('syncing');
    try {
      const got = await pull(uid);
      // Rows that arrived in that pull carry timestamps newer than our push
      // cursor, so they go straight back up once. Harmless — same id, same
      // content, same timestamp — and it self-limits, because the cursor
      // then moves past them. The alternative, advancing the push cursor on
      // a pull, would skip a local edit made offline before that pull.
      const sent = await push(uid);

      const patch = {};
      if (got.cursor) patch.lastPulledAt = got.cursor;
      if (sent && sent.startedAt) patch.lastPushedAt = sent.startedAt;
      applying = true;
      try {
        await D.Store.syncDone(patch, sent && sent.startedAt);
      } finally {
        applying = false;
      }

      setStatus('idle');
      if (got.applied) D.App && D.App.render && D.App.render();
    } catch (e) {
      // A failed sync is not a failed app: the local copy is untouched and
      // the same changes go up on the next attempt.
      const offline = navigator.onLine === false ||
        /fetch|network|Failed to fetch/i.test(e && e.message || '');
      setStatus(offline ? 'offline' : 'error', (e && e.message) || 'Sync failed');
      console.warn('cloud: sync failed', e);
    }
  }

  function schedule(ms) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => Cloud.sync(), ms);
  }

  // Is this account on the list? Asked of the database, which is where the
  // list lives — the app has no copy to disagree with.
  //
  // Fails OPEN on purpose. A missing function means allowlist.sql was never
  // run, and locking someone out of their own planner because an optional
  // extra is not installed would be its own bug. Nothing is lost by being
  // generous here: the policies still refuse to hand over a single row, so
  // this check decides only whether we can say why.
  async function isMember() {
    try {
      const { data, error } = await client.rpc('dashboard_allowed');
      if (error) return true;
      return data !== false;
    } catch (e) {
      return true;
    }
  }

  // ── Session ─────────────────────────────────────────────────────────
  async function adopt(next) {
    session = next || null;
    if (!session) { setStatus('signed-out'); return; }

    // Checked before anything is read or written, so a rejected account
    // never gets as far as looking like a working, empty planner.
    if (!(await isMember())) {
      // Name the address. Without it the message is unfalsifiable from the
      // outside — you cannot tell a wrong list from having signed in as
      // someone other than who you meant to.
      const who = (session.user && session.user.email) || '';
      await Cloud.signOut();
      setStatus('signed-out', who
        ? who + ' is not on the list for this planner.'
        : 'That account is not allowed to use this planner.');
      return;
    }

    const uid = session.user.id;
    const known = D.Store.syncMeta.userId;

    // Signing in as a different account. Local data belongs to the previous
    // one; pushing it would file one person's records under another's id.
    if (known && known !== uid) {
      const ok = window.confirm(
        'This device holds data from a different account.\n\n' +
        'Continue and it will be cleared and replaced with this account\'s data. ' +
        'Cancel to sign out and keep it.'
      );
      if (!ok) { await Cloud.signOut(); return; }
      applying = true;
      try { await D.Store.resetLocal(uid); } finally { applying = false; }
    } else if (!known) {
      applying = true;
      try { await D.Store.syncDone({ userId: uid }); } finally { applying = false; }
    }

    setStatus('idle');
    await Cloud.sync();
  }

  const Cloud = {
    get configured() { return configured(); },
    get status() { return status; },
    get email() { return status.email; },
    get signedIn() { return !!session; },

    onStatus(fn) { watchers.push(fn); },

    async init() {
      if (!configured()) { setStatus('off'); return; }
      setStatus('signed-out');
      try {
        await loadLib();
      } catch (e) {
        // No network on this load. The app is fully usable; try again when
        // the connection comes back.
        setStatus('offline', 'Could not load the sync library');
        window.addEventListener('online', () => Cloud.init(), { once: true });
        return;
      }

      client = window.supabase.createClient(projectUrl(), cfg().SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });

      client.auth.onAuthStateChange((event, s) => {
        if (event === 'SIGNED_OUT') { session = null; setStatus('signed-out'); return; }
        if (s && (!session || session.user.id !== s.user.id)) adopt(s);
        else session = s || session;
      });

      // onAuthStateChange fires an initial event of its own, so only adopt
      // here if it has not already claimed the session.
      const { data } = await client.auth.getSession();
      if (data && data.session && !session) await adopt(data.session);

      // Push shortly after an edit settles, and catch up on the events that
      // mean "you may have missed something": coming back to the tab,
      // regaining a connection, and a slow background tick.
      D.Store.onChange(() => { if (!applying && session) schedule(DEBOUNCE); });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && session) schedule(400);
      });
      window.addEventListener('online', () => { if (session) schedule(800); });
      setInterval(() => { if (session && !document.hidden) Cloud.sync(); }, INTERVAL);
    },

    // Serialised: two overlapping passes would push the same rows twice and
    // race each other's cursors.
    sync() {
      if (!client || !session) return Promise.resolve();
      if (inFlight) return inFlight;
      inFlight = run().finally(() => { inFlight = null; });
      return inFlight;
    },

    // Sends the sign-in one-time password. Supabase presents the same OTP
    // two ways — as a link and as a 6-digit code — and both work, so this
    // app offers the code and the emailed link keeps working as normal.
    //
    // The code exists for one case: an iOS web app installed to the home
    // screen. That gets its own WebKit storage container, separate from
    // Safari's, and iOS opens http links from Mail in Safari — so the
    // session is written to Safari while the icon you actually tap stays
    // signed out, with nothing on screen explaining why. A code is typed
    // into whichever copy is asking, so it signs in the right one.
    //
    // Everywhere else the link is fine and fewer steps: Android shares
    // storage between Chrome and an installed PWA, and an uninstalled
    // mobile browser has only the one container to begin with.
    async signIn(email) {
      if (!client) throw new Error('Sync is not configured yet.');
      const addr = String(email || '').trim();
      const { error } = await client.auth.signInWithOtp({
        email: addr,
        // Deliberately false. This project is shared with another app, so
        // creating users from here would put strangers into its auth.users
        // — firing whatever it does on signup — and spend the hourly email
        // quota on people who could never get in anyway. An account for a
        // new person is invited from the Supabase dashboard instead.
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
    },

    async verify(email, code) {
      if (!client) throw new Error('Sync is not configured yet.');
      const { error } = await client.auth.verifyOtp({
        email: String(email || '').trim(),
        token: String(code || '').replace(/\D/g, ''),
        type: 'email',
      });
      if (error) throw error;
      // onAuthStateChange picks the session up from here and starts the
      // first sync; nothing to do but let it.
    },

    async signOut() {
      if (!client) return;
      await client.auth.signOut();
      session = null;
      setStatus('signed-out');
      // Local data stays put: signing out is not "delete my dashboard".
      // It is cleared only if a different account signs in on this device.
    },
  };

  D.Cloud = Cloud;
})(window.DASH);
