-- ═══════════════════════════════════════════════════════════════════════
--  Dashboard — Supabase schema
--
--  Run once, in the Supabase dashboard: SQL Editor → New query → paste →
--  Run. Safe to run again; every statement is guarded.
--
--  ── Sharing a project ────────────────────────────────────────────────
--  This is designed to be dropped into a Supabase project that is already
--  doing something else, because the free tier limits projects, not tables.
--  Everything it creates is prefixed `dashboard_`, so it cannot collide
--  with what is already there, and it touches no existing table, policy or
--  auth setting.
--
--  ── Why one table ────────────────────────────────────────────────────
--  The app already holds its data as JS objects and does all its querying
--  in the browser. Mirroring each collection as its own typed table would
--  buy nothing and cost a migration every time a field is added — and this
--  app gains fields most weeks. So sync rides on a single row-per-record
--  table with the record kept as jsonb, keyed by the id the app already
--  generates.
--
--  ── What makes it private ────────────────────────────────────────────
--  Row Level Security, enabled below. Every row carries the user_id of
--  whoever wrote it, and the policies allow a row through only when it
--  matches the signed-in user. The anon key shipped in the page grants
--  nothing on its own: with RLS on and no policy matching, a stranger's
--  query returns zero rows rather than everyone's data.
--
--  This is the part worth checking rather than trusting. The verification
--  queries at the bottom prove it.
-- ═══════════════════════════════════════════════════════════════════════

-- ── The one table ──────────────────────────────────────────────────────
create table if not exists public.dashboard_records (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,

  -- Last-writer-wins is resolved on this, so it must be set by the client
  -- (the device that made the change), not by the server.
  updated_at  timestamptz not null default now(),

  -- Soft delete. A hard DELETE would let the row come back: another device
  -- still holding it would push it again on its next sync, and a deletion
  -- that silently undoes itself is worse than no sync at all.
  deleted     boolean     not null default false,

  primary key (user_id, collection, id)
);

comment on table public.dashboard_records is
  'One row per app record. Private per user via RLS; deletes are soft so they survive a sync from a stale device.';

-- ── Indexes ────────────────────────────────────────────────────────────
-- The only query the app makes: "everything of mine changed since X".
create index if not exists dashboard_records_sync_idx
  on public.dashboard_records (user_id, updated_at desc);

-- ── Row Level Security ─────────────────────────────────────────────────
alter table public.dashboard_records enable row level security;

-- Force it even for the table owner, so a future service-role script
-- cannot quietly sidestep the rule.
alter table public.dashboard_records force row level security;

drop policy if exists "dashboard records are readable by their owner"  on public.dashboard_records;
drop policy if exists "dashboard records are writable by their owner"  on public.dashboard_records;
drop policy if exists "dashboard records are updatable by their owner" on public.dashboard_records;
drop policy if exists "dashboard records are deletable by their owner" on public.dashboard_records;

create policy "dashboard records are readable by their owner"
  on public.dashboard_records for select
  using (auth.uid() = user_id);

-- WITH CHECK is the half people forget. USING decides which rows you may
-- touch; WITH CHECK decides what you may leave behind. Without it you
-- could insert a row stamped with someone else's user_id.
create policy "dashboard records are writable by their owner"
  on public.dashboard_records for insert
  with check (auth.uid() = user_id);

create policy "dashboard records are updatable by their owner"
  on public.dashboard_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dashboard records are deletable by their owner"
  on public.dashboard_records for delete
  using (auth.uid() = user_id);

-- ── Stop the client setting someone else's user_id ─────────────────────
-- The policy above already refuses it, but defaulting the column means the
-- client never sends a user_id at all, so it cannot be wrong.
alter table public.dashboard_records
  alter column user_id set default auth.uid();

-- ═══════════════════════════════════════════════════════════════════════
--  Verify — run these after the tables exist. Do not skip this: a schema
--  that looks right and a schema that is enforcing are different things.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. RLS must be ON and FORCED. Expect: rowsecurity = true, forced = true.
--
-- select relname,
--        relrowsecurity  as rls_enabled,
--        relforcerowsecurity as rls_forced
--   from pg_class
--  where oid = 'public.dashboard_records'::regclass;

-- 2. Four policies, each qualified by auth.uid(). Expect 4 rows, and every
--    qual/with_check mentioning auth.uid().
--
-- select policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname = 'public' and tablename = 'dashboard_records'
--  order by policyname;

-- 3. The real test: a signed-out caller must see nothing. Run this from
--    the SQL editor with the role set to anon.
--
-- set local role anon;
-- select count(*) from public.dashboard_records;  -- expect 0, not an error, not a count
-- reset role;
