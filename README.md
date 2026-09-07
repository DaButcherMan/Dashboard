# Dashboard

A personal dashboard: priorities, homework, classes, meetings, appointments,
goals, and live scores for your teams. Static site, no build step, no backend.

```bash
npm run serve      # http://127.0.0.1:5599
npm test           # ICS parser tests
```

## Design

Warm-white canvas, deep-navy sidebar, charcoal ink, one restrained teal accent.
Colour carries meaning — status, priority, selection — and is never decoration.
Four radii, a 4px spacing grid, two shadow levels. Cards are defined by a
hairline border first and a shadow second, so a dense page reads as one surface
rather than a raft of floating boxes. Type is Inter, with tabular numerals
everywhere figures line up in a column.

**Light and dark both ship.** The theme follows the system by default and can be
pinned in Settings. Every text/background pair in both themes clears WCAG AA
(4.5:1); the muted greys are deliberately darker than they look like they should
be, because "muted" must still mean readable.

Two details worth knowing if you edit the CSS:

- The sidebar stays navy in **both** themes, so it uses its own
  `--sidebar-accent` / `--sidebar-dim` tokens. A theme-flipping token there goes
  invisible in light mode.
- `--on-accent` is the text colour that sits on an accent fill. It is white in
  light and near-black in dark, because the dark theme's teal is bright enough
  that white on it fails at 2.5:1.
- `--ink-faint` is for decoration only (rules, dots). Anything that renders text
  must use `--ink-3` or darker.

### Desktop and mobile

One codebase, two shapes. Above 760px you get the fixed sidebar. Below it the
sidebar becomes an off-canvas sheet and a five-item bottom bar takes over;
header actions collapse to icons, the summary cards go to a compact 2×2, and the
modal becomes a bottom sheet. The breakpoint for single-column stats is 330px,
not 380 — at 375 (a very common phone width) four stacked cards pushed Today's
Priorities below the fold, which defeats the point of the page.

## Areas

School, Work, Fitness, Family and Finances are **not** five separate modules.
They are one concept: a task, event or goal carries an `area`, and each area page
is a filtered view over the same collections. School additionally owns `courses`,
because only it has recurring class meetings.

That means adding an area is a data change, not a feature build — and a task
moved between areas keeps its history.

## Structure

| File | Does |
|---|---|
| `js/util.js` | Dates, DOM helpers, the inline icon set. Loaded first. |
| `js/store.js` | The only data layer, plus the v1→v2 migration. |
| `js/agenda.js` | Expands recurring classes into days; task queries; stats; goals. |
| `js/sports.js` | ESPN client, with caching. |
| `js/ics.js` | iCalendar reader (Canvas / Outlook / Google feeds). |
| `js/sync.js` | Turns a feed into records and hands them to the store. |
| `js/app.js` | Routing, views, rendering, modals. |
| `tools/fetch-teams.js` | Regenerates `data/teams/*.json`. |
| `tools/make-icons.js` | Regenerates the PWA icons from source. |

### Where your data lives

In `localStorage`, in whichever browser you are using. Private and offline-
capable, but it does **not** sync between your phone and laptop, and clearing
site data erases it. **Export a backup from Settings now and then.**

Every `Store` method is `async` even though `localStorage` is not. That is
deliberate: moving to a real backend means replacing the `backend` object in
`js/store.js` and nothing else.

Data from the previous version is migrated automatically on first load —
existing tasks and events are assigned areas (anything with a course becomes
School, meetings become Work) and nothing is discarded.

## Sports

Scores and fixtures come from ESPN's public site API. No key, no backend — those
endpoints send `Access-Control-Allow-Origin: *`.

Three quirks, all found the hard way:

- `/scoreboard` and `/teams/{id}/schedule` send CORS headers. **`/teams` does
  not**, so the picker cannot be built at runtime — team lists are baked into
  `data/teams/*.json`, one file per league so the picker downloads only what you
  open.
- `/teams/{id}/schedule` returns only games **already played**. Upcoming fixtures
  come from `/scoreboard?dates=YYYYMMDD-YYYYMMDD`. The app queries both and
  merges: results per team, fixtures per league.
- `score` is a plain string on the scoreboard but an object on the team schedule.

Rosters change about once a season: `node tools/fetch-teams.js`.

## Calendar sources (Canvas, Outlook, Google)

The parser and import path are built and tested. The obstacle is not parsing —
**none of the three send CORS headers** on their `.ics` feeds, so a browser on
your domain cannot fetch them. That is a browser rule, not something JavaScript
can work around.

1. **Paste** — open the feed URL, copy the text, paste it in. Works today, no
   setup. Fine for a one-off, tedious weekly.
2. **Proxy** — set a proxy URL and Sync fetches automatically. Any endpoint that
   fetches a URL and echoes it with `Access-Control-Allow-Origin` works; a
   Cloudflare Worker is about ten lines. Put `{url}` where the feed URL goes.

   A proxy pointed at arbitrary URLs is an open relay — restrict it to your own
   origin and to the calendar hosts you actually use.

Finding each feed:

- **Canvas** — Calendar → *Calendar Feed* (bottom right). Assignments arrive as
  tasks in School; other items as events.
- **Outlook** — Settings → Calendar → Shared calendars → Publish, then take the
  **ICS** link. A work tenant may have publishing disabled by an admin.
- **Google** — Settings → *your calendar* → **Secret address in iCal format**.

Treat all three URLs as passwords. Re-syncing replaces everything previously
imported from that source and leaves anything you typed alone; local edits
(done, priority, notes, area) survive a resync.

## Deploying to GitHub Pages

1. Push this folder to a repository.
2. Settings → Pages → deploy from `main`, folder `/`.
3. For a custom domain, add a `CNAME` file containing just the hostname, then
   point a `CNAME` DNS record at `<user>.github.io`.

The service worker needs HTTPS, which Pages provides. It caches the app shell so
the dashboard opens instantly and works offline; ESPN calls always go to the
network.

Everything here is public once Pages is on. That is fine as it stands — your data
never leaves your browser — but **do not commit a calendar feed URL.** Those
belong in Settings, which keeps them in `localStorage`.

## Keyboard

`n` new task · `Esc` close · `Ctrl/Cmd+Enter` save the open dialog.
