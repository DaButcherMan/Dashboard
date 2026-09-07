-- ═══════════════════════════════════════════════════════════════════════
--  Dashboard — who is allowed in
--
--  Run in the same SQL Editor as schema.sql. Safe to re-run.
--
--  ── Adding someone, afterwards ───────────────────────────────────────
--  Table Editor → dashboard_members → Insert row → type the email → Save.
--  That is the whole job: no SQL to re-run, nothing to redeploy, no app
--  change. Removing someone is deleting that row, and it takes effect on
--  their next request rather than whenever the site is next published.
--
--  ── Why the list is in the database ──────────────────────────────────
--  The publishable key is in the page, so anyone can call this project
--  directly and never load the app's JavaScript. A list kept in the app
--  would be a label, not a lock. This one is checked inside the policies,
--  which is the only place a restriction actually holds.
--
--  That matters more than usual because the project is shared with the
--  soccer app: every one of its users can obtain a valid session here, so
--  without this list "signed in" and "allowed in" would be the same thing.
-- ═══════════════════════════════════════════════════════════════════════

-- ── The list ───────────────────────────────────────────────────────────
create table if not exists public.dashboard_members (
  email     text primary key,
  note      text,
  added_at  timestamptz not null default now()
);

comment on table public.dashboard_members is
  'Who may use the planner. Add a row to grant access; delete it to revoke. Not readable through the API.';

-- Nobody reaches this table through the API. RLS on with no policies at
-- all means every API request matches nothing and returns nothing — the
-- membership list should not be readable by the people on it, let alone by
-- anyone else. The check below still sees it, because it runs as the
-- function's owner rather than as the caller.
alter table public.dashboard_members enable row level security;
revoke all on public.dashboard_members from anon, authenticated;

-- Seed yourself so running this does not lock you out.
insert into public.dashboard_members (email, note)
values ('makotogaming@gmail.com', 'owner')
on conflict (email) do nothing;

-- ── The check ──────────────────────────────────────────────────────────
-- security definer so it can read a table the caller cannot. Lower-cased
-- on both sides so capitalisation never locks anyone out.
create or replace function public.dashboard_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Resolved from auth.users by user id, NOT from the token's email claim.
  -- That claim is not guaranteed to be present on every access token, and
  -- when it is missing the comparison silently becomes '' = <list>, which
  -- is false for everybody — a refusal that looks exactly like a wrong
  -- entry in the table and sends you hunting for a typo that is not there.
  -- The id is always in the token.
  select exists (
    select 1
      from auth.users u
      join public.dashboard_members m
        on lower(m.email) = lower(u.email)
     where u.id = auth.uid()
  );
$$;

comment on function public.dashboard_allowed is
  'True if the signed-in email is in dashboard_members. Used by every policy on dashboard_records.';

-- The app calls this after signing in, to say plainly that an account is
-- not allowed rather than showing an empty planner that silently fails.
grant execute on function public.dashboard_allowed() to anon, authenticated;

-- ── Apply it to every policy ───────────────────────────────────────────
-- Each keeps its owner check too: the list decides who may use the planner,
-- auth.uid() = user_id still decides whose rows they see. Two people on the
-- list get separate planners and cannot read each other.
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

-- 1. Who is on the list, and does each account actually match one?
--    `matches` false on your own row is the whole problem, and the two
--    email columns side by side usually show why: a typo, a stray space,
--    or a different address than the one you signed in with.
--
-- select u.email                     as signed_up_as,
--        m.email                     as on_the_list,
--        (m.email is not null)       as matches,
--        u.created_at
--   from auth.users u
--   left join public.dashboard_members m
--     on lower(m.email) = lower(u.email)
--  order by u.created_at desc
--  limit 20;

-- 2. All four policies should now carry the check. Expect 4 rows, true.
--
-- select policyname, cmd,
--        coalesce(qual, with_check) like '%dashboard_allowed%' as list_applied
--   from pg_policies
--  where schemaname = 'public' and tablename = 'dashboard_records'
--  order by policyname;

-- 3. Signed out: false, and no rows. Not an error.
--
-- begin;
--   set local role anon;
--   select public.dashboard_allowed();               -- expect false
--   select count(*) from public.dashboard_records;   -- expect 0
--   select count(*) from public.dashboard_members;   -- expect permission denied
-- rollback;
