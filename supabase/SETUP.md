# Turning on sync

Three steps, about ten minutes, inside a Supabase project you **already
have**. The free tier limits projects, not tables, so the dashboard rides
along in one of your existing two rather than needing a third.

Everything this creates is prefixed `dashboard_`. It adds one table and
four policies, and changes nothing that is already there — no existing
table, no existing policy, and none of that project's auth settings.

## 1. Create the table

Pick whichever of your two projects you expect to keep longest — if that
project ever goes away, the dashboard's data goes with it.

**SQL Editor → New query**, paste all of `schema.sql`, **Run**.

Then run the three verification queries commented out at the bottom of that
file. Do run them. A schema that looks right and a schema that is enforcing
are different things, and the third — `set local role anon; select
count(*)` — is the only one that actually proves a stranger sees nothing.
Expect `0`, not an error.

If that project has other users, this changes nothing for them: every
policy is `auth.uid() = user_id`, so they cannot read a row of yours and
you cannot read one of theirs.

## 2. Put the code in the sign-in email

**Authentication → Emails → Magic Link**, and add the token to the
template, e.g.:

```html
<p>Your dashboard code is <b>{{ .Token }}</b></p>
```

Keep the existing `{{ .ConfirmationURL }}` link alongside it. Both are the
same one-time password shown two ways, and both sign you in, so the email
carries a link to tap and a code to type and you use whichever suits the
device in your hand.

### Why bother with the code

Because of one case, and only one: **an iPhone, with this installed to the
home screen.** iOS gives a home-screen web app its own WebKit storage
container, separate from Safari's, and it opens links from Mail in Safari —
so tapping the link writes the session into Safari while the icon you
actually tap stays signed out, with nothing on screen explaining why.

Everywhere else the link is fine, and it is fewer steps. Android shares
storage between Chrome and an installed app, and a mobile browser you have
not installed to the home screen has only one container anyway. If you have
used magic links elsewhere without trouble, this is why.

Both are live, so use whichever works: tap the link if it signs you in,
type the code if it doesn't.

Keeping to codes does have one side benefit — they need no redirect, so
there is nothing to change under **URL Configuration** and the other app in
that project keeps its auth settings untouched. Add your domain there only
if you want the link to work too.

## 3. Paste the keys

**Project Settings → API**, copy into `js/config.js`:

| Supabase field | goes in |
| --- | --- |
| Project URL | `SUPABASE_URL` |
| `anon` `public` | `SUPABASE_ANON_KEY` |

Reload, open **Settings → Sync**, enter your email, and type the code that
arrives.

### One thing to glance at first

Signing in here uses that project's `auth.users`, which the other app
shares. If your email is already a user there, nothing happens — you get
the same account and the same id, which is what you want.

If it is *not*, signing in creates one. Check whether that project has a
trigger on `auth.users` (a `handle_new_user` function, or anything that
writes a profile or roster row on signup) before you do, or you may find
yourself added to your own team list. Database → Triggers, or:

```sql
select tgname, tgrelid::regclass
  from pg_trigger
 where tgrelid = 'auth.users'::regclass and not tgisinternal;
```

No rows back means nothing to worry about. Then do exactly the same on your phone, with the same email
address — same address means same account means the same dashboard.

### The one key that must never go in this repo

The **`service_role`** key on that same page bypasses Row Level Security
completely, and it would bypass it for *both* apps in that project. In a
client-side app it is a public file. Only the `anon` key belongs in
`config.js`.

The `anon` key, by contrast, is meant to be published. It names the project
and grants nothing on its own: with RLS on and no policy matching a
signed-out caller, a request carrying only that key returns zero rows.

## What syncs, and what does not

Tasks, events, goals, classes, weights, peptide protocols and doses,
workouts and sets, and your settings — including which teams you follow.

**Calendar feed URLs stay on the device you typed them into.** A Canvas
`.ics` URL is a bearer credential: whoever holds it can read your calendar
without logging in as you. It is not worth copying into a database, its
backups and its logs to save retyping it once on your phone.

## If two devices disagree

Last edit wins, per record. Deletes are kept as tombstones, so a device
that was offline when you deleted something cannot hand it back.

Nothing waits on the network. The phone reads and writes from its own copy
and catches up when it can, so the dashboard works the same on a bad
signal as on wifi.
