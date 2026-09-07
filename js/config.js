/* ══════════════════════════════════════════
   config.js — where this dashboard syncs to.

   Fill these in after creating the Supabase project:
     Supabase dashboard → Project Settings → API
       Project URL      → SUPABASE_URL
       anon / public key → SUPABASE_ANON_KEY

   Leave them blank and the app runs exactly as it does now: everything in
   this browser, no account, no sync.

   ── On committing the anon key ────────────────────────────────────────
   It is meant to be public. It identifies the project, it does not grant
   access to anything; every table has Row Level Security on, so a request
   carrying only this key and no signed-in user matches no policy and comes
   back empty. That is why it can sit in a public repository.

   What must NEVER go here is the `service_role` key. That one bypasses RLS
   entirely and would hand over every row to anyone who viewed source.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
window.DASH.CONFIG = {
  // Who may sign in is NOT configured here. It lives in the
  // dashboard_members table (see supabase/allowlist.sql), because a list in
  // this file would be a label rather than a lock — the key below is public,
  // so anyone can call the project without ever loading this JavaScript.
  //
  // Keeping it in one place also means adding someone is a single row in the
  // Table Editor, with nothing to redeploy and no chance of the two lists
  // drifting apart.

  SUPABASE_URL: 'https://mhgmyvgthogqsmossbht.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_WRQDo5aVAgqbSq9i_P8YQA_eYFnkgv4',
};
