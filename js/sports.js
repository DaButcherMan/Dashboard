/* ══════════════════════════════════════════
   sports.js — scores and fixtures from ESPN's public site API.

   No API key and no backend: these endpoints send
   `Access-Control-Allow-Origin: *`, so a static page can call them
   directly. They are undocumented, so every response is read defensively
   and a failure degrades to "could not load" rather than breaking a view.

   Responses are cached in localStorage. Anything with a live game in it
   gets a short TTL; everything else is held longer.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const API = 'https://site.api.espn.com/apis/site/v2/sports/';

  // Leagues offered in the team picker. `path` is the ESPN URL segment.
  const LEAGUES = [
    { key: 'esp.1',              path: 'soccer/esp.1',                       sport: 'Soccer',     name: 'La Liga' },
    { key: 'eng.1',              path: 'soccer/eng.1',                       sport: 'Soccer',     name: 'Premier League' },
    { key: 'ger.1',              path: 'soccer/ger.1',                       sport: 'Soccer',     name: 'Bundesliga' },
    { key: 'ita.1',              path: 'soccer/ita.1',                       sport: 'Soccer',     name: 'Serie A' },
    { key: 'fra.1',              path: 'soccer/fra.1',                       sport: 'Soccer',     name: 'Ligue 1' },
    { key: 'usa.1',              path: 'soccer/usa.1',                       sport: 'Soccer',     name: 'MLS' },
    { key: 'mex.1',              path: 'soccer/mex.1',                       sport: 'Soccer',     name: 'Liga MX' },
    { key: 'uefa.champions',     path: 'soccer/uefa.champions',              sport: 'Soccer',     name: 'Champions League' },
    { key: 'uefa.europa',        path: 'soccer/uefa.europa',                 sport: 'Soccer',     name: 'Europa League' },
    { key: 'concacaf.champions', path: 'soccer/concacaf.champions',          sport: 'Soccer',     name: 'CONCACAF Champions Cup' },
    { key: 'usa.ncaa.m.1',       path: 'soccer/usa.ncaa.m.1',                sport: 'Soccer',     name: 'College Soccer (M)' },
    { key: 'usa.ncaa.w.1',       path: 'soccer/usa.ncaa.w.1',                sport: 'Soccer',     name: 'College Soccer (W)' },
    { key: 'nfl',                path: 'football/nfl',                       sport: 'Football',   name: 'NFL' },
    { key: 'ncaaf',              path: 'football/college-football',          sport: 'Football',   name: 'College Football' },
    { key: 'nba',                path: 'basketball/nba',                     sport: 'Basketball', name: 'NBA' },
    { key: 'ncaam',              path: 'basketball/mens-college-basketball', sport: 'Basketball', name: 'College Basketball (M)' },
    { key: 'mlb',                path: 'baseball/mlb',                       sport: 'Baseball',   name: 'MLB' },
    { key: 'nhl',                path: 'hockey/nhl',                         sport: 'Hockey',     name: 'NHL' },
  ];

  // Competitions we can query but do not offer in the picker: you follow a
  // team, not a cup, so these are pulled in automatically for that team.
  const CUPS = [
    { key: 'uefa.europa.conf',     path: 'soccer/uefa.europa.conf',     sport: 'Soccer', name: 'Conference League' },
    { key: 'esp.copa_del_rey',     path: 'soccer/esp.copa_del_rey',     sport: 'Soccer', name: 'Copa del Rey' },
    { key: 'eng.fa',               path: 'soccer/eng.fa',               sport: 'Soccer', name: 'FA Cup' },
    { key: 'eng.league_cup',       path: 'soccer/eng.league_cup',       sport: 'Soccer', name: 'Carabao Cup' },
    { key: 'ger.dfb_pokal',        path: 'soccer/ger.dfb_pokal',        sport: 'Soccer', name: 'DFB-Pokal' },
    { key: 'ita.coppa_italia',     path: 'soccer/ita.coppa_italia',     sport: 'Soccer', name: 'Coppa Italia' },
    { key: 'fra.coupe_de_france',  path: 'soccer/fra.coupe_de_france',  sport: 'Soccer', name: 'Coupe de France' },
    { key: 'concacaf.leagues.cup', path: 'soccer/concacaf.leagues.cup', sport: 'Soccer', name: 'Leagues Cup' },
    { key: 'usa.open',             path: 'soccer/usa.open',             sport: 'Soccer', name: 'US Open Cup' },
  ];

  // Which other competitions a team from a given league might also play in.
  // A club's season is not one league: without this, a Real Madrid follower
  // would never see a Champions League tie.
  const COMPANIONS = {
    'esp.1': ['uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'esp.copa_del_rey'],
    'eng.1': ['uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'eng.fa', 'eng.league_cup'],
    'ger.1': ['uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'ger.dfb_pokal'],
    'ita.1': ['uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'ita.coppa_italia'],
    'fra.1': ['uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'fra.coupe_de_france'],
    'usa.1': ['concacaf.champions', 'concacaf.leagues.cup', 'usa.open'],
    'mex.1': ['concacaf.champions', 'concacaf.leagues.cup'],
  };

  const leagueByKey = {};
  LEAGUES.concat(CUPS).forEach((l) => { leagueByKey[l.key] = l; });

  // Team rosters, once per league per page load.
  const teamCache = {};

  // How far ahead to ask for fixtures. Long enough that a fortnightly
  // competition still shows something, short enough to stay one request.
  const FIXTURE_WINDOW_DAYS = 45;

  // How far back to look for cup results. Cup ties are sparse, so this window
  // stays well inside the cap below; a domestic league would not.
  const CUP_BACK_DAYS = 60;

  // ESPN caps a date-ranged scoreboard at 100 events and returns the EARLIEST
  // ones — so too wide a window does not merely truncate, it silently drops
  // everything current and upcoming. Keep windows narrow, and never widen one
  // without checking the returned range still reaches today.
  const EVENT_CAP = 100;

  // ESPN date-range params are 'YYYYMMDD-YYYYMMDD', in local terms.
  function yyyymmdd(d) {
    return String(d.getFullYear()) +
           String(d.getMonth() + 1).padStart(2, '0') +
           String(d.getDate()).padStart(2, '0');
  }

  // ── Cache ───────────────────────────────────────────────────────────
  const CACHE_KEY = 'dashboard.sportscache.v1';
  const TTL_LIVE  = 60 * 1000;        // something is in progress
  const TTL_IDLE  = 15 * 60 * 1000;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function writeCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  async function getJSON(url, opts) {
    const force = opts && opts.force;
    const cache = readCache();
    const hit = cache[url];
    if (!force && hit && Date.now() - hit.at < (hit.ttl || TTL_IDLE)) return hit.data;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('ESPN ' + res.status);
    const data = await res.json();

    cache[url] = { at: Date.now(), data, ttl: TTL_IDLE };
    // Trim the cache so it cannot grow without bound.
    const keys = Object.keys(cache);
    if (keys.length > 60) {
      keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, 20)
          .forEach((k) => delete cache[k]);
    }
    writeCache(cache);
    return data;
  }

  // Mark a URL's cache entry short-lived because its payload has a live game.
  function markLive(url) {
    const cache = readCache();
    if (cache[url]) { cache[url].ttl = TTL_LIVE; writeCache(cache); }
  }

  // ── Normalising ─────────────────────────────────────────────────────
  // The scoreboard returns `score` as a string; the team-schedule endpoint
  // returns it as an object. Accept either.
  function scoreOf(competitor) {
    const s = competitor.score;
    if (s == null) return null;
    if (typeof s === 'object') return s.displayValue != null ? String(s.displayValue) : null;
    return String(s);
  }

  function normalizeEvent(ev, league) {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const cs   = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
    const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
    const st   = (comp.status && comp.status.type) || {};
    const side = (c) => ({
      id:     c.team && c.team.id,
      name:   (c.team && (c.team.displayName || c.team.name)) || 'TBD',
      short:  (c.team && (c.team.shortDisplayName || c.team.abbreviation)) || '',
      logo:   (c.team && (c.team.logo || (c.team.logos && c.team.logos[0] && c.team.logos[0].href))) || '',
      score:  scoreOf(c),
      winner: !!c.winner || !!(c.score && c.score.winner),
      record: (c.records && c.records[0] && c.records[0].summary) || '',
    });

    return {
      id:        ev.id,
      league:    league ? league.name : '',
      leagueKey: league ? league.key : '',
      date:      ev.date,
      dayKey:    ev.date ? D.dayKey(new Date(ev.date)) : '',
      name:      ev.name || ev.shortName || '',
      home:      side(home),
      away:      side(away),
      state:     st.state || 'pre',                  // pre | in | post
      detail:    st.shortDetail || st.detail || '',
      completed: !!st.completed,
      venue:     (comp.venue && comp.venue.fullName) || '',
      network:   (comp.broadcasts && comp.broadcasts[0] &&
                  comp.broadcasts[0].names && comp.broadcasts[0].names[0]) || '',
    };
  }

  const Sports = {
    LEAGUES,
    league(key) { return leagueByKey[key]; },

    // Every competition a team from this league may turn up in. Used to match
    // games back to a team WITHOUT matching on team id alone — ESPN reuses
    // ids across sports, so an unqualified id match could hand an NFL game to
    // a soccer club.
    competitionsFor(leagueKey) {
      return [leagueKey].concat(COMPANIONS[leagueKey] || []);
    },

    // A YouTube search for a finished game's highlights.
    //
    // A search rather than a video id: resolving the actual clip needs the
    // YouTube Data API, which needs a key, and a key in a static page is a
    // public key. The query is built to put official uploads first — league
    // and broadcaster channels title their clips this way — and carries the
    // year so a fixture played every season resolves to the right one.
    recapUrl(g) {
      const year = g.date ? new Date(g.date).getFullYear() : '';
      const q = [g.away.name, 'vs', g.home.name, 'highlights', g.league, year]
        .filter(Boolean).join(' ');
      return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    },

    // Every team in a league — powers the favorites picker.
    //
    // Read from data/teams/<key>.json, not from the API: ESPN serves
    // /scoreboard and /teams/{id}/schedule with CORS headers but NOT the
    // /teams roster list, so the browser cannot fetch it. Rosters change
    // about once a season; `node tools/fetch-teams.js` regenerates them.
    async teams(leagueKey) {
      const lg = leagueByKey[leagueKey];
      if (!lg) return [];
      if (teamCache[leagueKey]) return teamCache[leagueKey];

      const res = await fetch('data/teams/' + leagueKey + '.json');
      if (!res.ok) throw new Error('Team list missing for ' + leagueKey);
      const rows = await res.json();

      teamCache[leagueKey] = rows.map((t) => ({
        key:        leagueKey,
        leaguePath: lg.path,
        teamId:     t.id,
        name:       t.name,
        abbrev:     t.abbrev || '',
        logo:       t.logo || '',
      }));
      return teamCache[leagueKey];
    },

    // A league's current slate. `dates` is optional 'YYYYMMDD'.
    async scoreboard(leagueKey, dates, opts) {
      const lg = leagueByKey[leagueKey];
      if (!lg) return [];
      const url = API + lg.path + '/scoreboard' + (dates ? '?dates=' + dates : '');
      const data = await getJSON(url, opts);
      const out = (data.events || []).map((e) => normalizeEvent(e, lg));
      if (out.some((g) => g.state === 'in')) markLive(url);
      return out;
    },

    // Results and fixtures for one team.
    async teamSchedule(fav, opts) {
      const lg = leagueByKey[fav.key];
      if (!lg) return [];
      const url = API + lg.path + '/teams/' + fav.teamId + '/schedule';
      const data = await getJSON(url, opts);
      const out = (data.events || []).map((e) => normalizeEvent(e, lg));
      if (out.some((g) => g.state === 'in')) markLive(url);
      return out;
    },

    // Everything for the saved favorites.
    //
    // Two endpoints, because neither alone is enough: `/teams/{id}/schedule`
    // returns only games already PLAYED, while the scoreboard queried over a
    // date range returns the fixtures ahead. So results come from the former
    // (one call per team) and fixtures from the latter (one call per league,
    // shared by every favorite in it), then the two are merged.
    //
    // One team or league failing never sinks the rest.
    async forFavorites(favs, opts) {
      const wanted = {};                       // leagueKey -> Set of team ids
      favs.forEach((f) => {
        (wanted[f.key] = wanted[f.key] || new Set()).add(String(f.teamId));
      });

      const from = new Date();
      const to   = new Date(Date.now() + FIXTURE_WINDOW_DAYS * 86400e3);
      const cupFrom = new Date(Date.now() - CUP_BACK_DAYS * 86400e3);

      // Cup competitions the followed teams might appear in. Every favorite
      // is a candidate in its league's companions, so one query per
      // competition serves all of them.
      const cupWanted = {};
      favs.forEach((f) => {
        (COMPANIONS[f.key] || []).forEach((c) => {
          (cupWanted[c] = cupWanted[c] || new Set()).add(String(f.teamId));
        });
      });

      const [played, scheduled, cups] = await Promise.all([
        Promise.all(favs.map((f) =>
          Sports.teamSchedule(f, opts)
            .then((gs) => gs.map((g) => Object.assign({ fav: f }, g)))
            .catch((e) => { console.warn('sports: results failed for', f.name, e); return []; })
        )),
        Promise.all(Object.keys(wanted).map((key) =>
          Sports.scoreboard(key, yyyymmdd(from) + '-' + yyyymmdd(to), opts)
            .then((gs) => gs.filter((g) =>
              wanted[key].has(String(g.home.id)) || wanted[key].has(String(g.away.id))))
            .catch((e) => { console.warn('sports: fixtures failed for', key, e); return []; })
        )),
        // Cups carry both results and fixtures in one window: the team
        // schedule endpoint is league-scoped and returns nothing for them.
        Promise.all(Object.keys(cupWanted).map((key) =>
          Sports.scoreboard(key, yyyymmdd(cupFrom) + '-' + yyyymmdd(to), opts)
            .then((gs) => gs.filter((g) =>
              cupWanted[key].has(String(g.home.id)) || cupWanted[key].has(String(g.away.id))))
            .catch(() => [])          // a cup out of season is not an error
        )),
      ]);

      const seen = {};
      const all = [];
      played.concat(scheduled, cups).forEach((list) => list.forEach((g) => {
        // A game can arrive from both endpoints, and two favorites playing
        // each other would otherwise appear twice.
        if (seen[g.id]) return;
        seen[g.id] = true;
        all.push(g);
      }));

      all.sort((a, b) => new Date(a.date) - new Date(b.date));
      const now = Date.now();
      return {
        live:     all.filter((g) => g.state === 'in'),
        upcoming: all.filter((g) => g.state === 'pre' && new Date(g.date) >= now - 3 * 3600e3),
        recent:   all.filter((g) => g.state === 'post').reverse(),
      };
    },
  };

  D.Sports = Sports;
})(window.DASH);
