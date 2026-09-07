# Turning on sync

Four steps, about ten minutes. Until you finish them the dashboard runs
exactly as it does now — everything in the browser, no account.

## 1. Create the project

[supabase.com](https://supabase.com) → **New project**. Pick a region near
you (US West for Pacific). Free tier is far more than this needs.

## 2. Create the table

**SQL Editor → New query**, paste all of `schema.sql`, **Run**.

Then run the three verification queries commented out at the bottom of that
file. Do run them. A schema that looks right and a schema that is enforcing
are different things, and the third one — `set local role anon; select
count(*)` — is the only one that actually proves a stranger sees nothing.
Expect `0`, not an error.

## 3. Allow the sign-in link back to your site

**Authentication → URL Configuration**:

- **Site URL** — your domain, e.g. `https://yourdomain.com`
- **Redirect URLs** — add both of these:
  - `https://yourdomain.com` (or `https://yourdomain.com/` if the site
    lives at a path)
  - `http://localhost:5599` — so sign-in works while developing

A magic link that redirects anywhere not on this list is rejected. That
restriction is the point: it stops a link minted for your project being
bounced to somebody else's page with your session attached.

Email sending works out of the box on the free tier, rate-limited to a few
per hour. That is plenty for signing in on two or three devices.

## 4. Paste the keys

**Project Settings → API**, copy into `js/config.js`:

| Supabase field | goes in |
| --- | --- |
| Project URL | `SUPABASE_URL` |
| `anon` `public` | `SUPABASE_ANON_KEY` |

Reload, open **Settings → Sync**, enter your email, and open the link it
sends you on that device. Repeat on your phone with the same email address.

### The one key that must never go in this repo

The **`service_role`** key on that same page bypasses Row Level Security
completely. In a client-side app it is a public file, and anyone who
viewed source would have every row. Only the `anon` key belongs in
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

Last edit wins, per record. Deletes are kept as tombstones so a device that
was offline when you deleted something cannot hand it back.
