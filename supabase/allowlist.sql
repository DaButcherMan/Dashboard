-- ═══════════════════════════════════════════════════════════════════════
--  Dashboard — restrict access to specific people
--
--  Run in the same SQL Editor as schema.sql. Safe to re-run; that is how
--  you change the list.
--
--  ── Why this is in the database ──────────────────────────────────────
--  The app checks the address you type before it sends a code, but that
--  check is courtesy, not security: the publishable key is in the page, so
--  anyone can call the API directly and never load your JavaScript at all.
--  The only place a restriction actually holds is inside the policies, so
--  that is where the list lives.
--
--  This matters more than usual because the project is shared with the
--  soccer app. Every one of its users can obtain a valid session here.
--  Without this, "signed in" and "allowed in" would be the same thing, and
--  any of them could read these rows.
-- ═══════════════════════════════════════════════════════════════════════

-- ── The list ───────────────────────────────────────────────────────────
-- Add addresses to the array and re-run this whole block to change who
-- gets in. Lower-cased on both sides so capitalisation cannot lock you out.
create or replace function public.dashboard_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'makotogaming@gmail.com'
    -- , 'someone.else@example.com'
  ]);
$$;

comment on function public.dashboard_allowed is
  'Who may read and write dashboard_records. Enforced in the policies below, not in the app.';

-- ── Re-create the policies with the list applied ───────────────────────
-- Each keeps its original owner check as well: the list decides who may
-- use the planner at all, auth.uid() = user_id still decides whose rows
-- they see. Two people on the list cannot read each other.
drop policy if exists "dashboard records are readable by their owner"  on public.dashboard_records;
drop policy if exists "dashboard records are writable by their owner"  on public.dashboard_records;
drop policy if exists "dashboard records are updatable by their owner" on public.dashboard_records;
drop policy if exists "dashboard records are deletable by their owner" on public.dashboard_records;

create policy "dashboard records are readable by their owner"
  on public.dashboard_records for select
  using (auth.uid() = user_id and public.dashboard_allowed());

create policy "dashboard records are writable by their owner"
  on public.dashboard_records for insert
  with check (auth.uid() = user_id and public.dashboard_allowed());

create policy "dashboard records are updatable by their owner"
  on public.dashboard_records for update
  using (auth.uid() = user_id and public.dashboard_allowed())
  with check (auth.uid() = user_id and public.dashboard_allowed());

create policy "dashboard records are deletable by their owner"
  on public.dashboard_records for delete
  using (auth.uid() = user_id and public.dashboard_allowed());

-- ═══════════════════════════════════════════════════════════════════════
--  Verify
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Every policy should now mention dashboard_allowed(). Expect 4 rows.
--
-- select policyname, cmd,
--        qual       like '%dashboard_allowed%' as list_on_read,
--        with_check like '%dashboard_allowed%' as list_on_write
--   from pg_policies
--  where schemaname = 'public' and tablename = 'dashboard_records'
--  order by policyname;

-- 2. Signed out, the function is false rather than an error.
--
-- begin;
--   set local role anon;
--   select public.dashboard_allowed();          -- expect false
--   select count(*) from public.dashboard_records;  -- expect 0
-- rollback;
