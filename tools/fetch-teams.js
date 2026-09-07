#!/usr/bin/env node
/* ══════════════════════════════════════════
   tools/fetch-teams.js — regenerate data/teams.json

   ESPN serves `/scoreboard` and `/teams/{id}/schedule` with
   `Access-Control-Allow-Origin: *`, but NOT the `/teams` roster list — so the
   browser cannot build the team picker at runtime. Rosters change about once
   a year (promotion, relegation, expansion), so we fetch them here instead
   and ship the result as a static file.

   Run after a season rolls over:   node tools/fetch-teams.js
   ══════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const API = 'https://site.api.espn.com/apis/site/v2/sports/';

// Keep in step with LEAGUES in js/sports.js.
const LEAGUES = [
  ['esp.1',              'soccer/esp.1'],
  ['eng.1',              'soccer/eng.1'],
  ['ger.1',              'soccer/ger.1'],
  ['ita.1',              'soccer/ita.1'],
  ['fra.1',              'soccer/fra.1'],
  ['usa.1',              'soccer/usa.1'],
  ['mex.1',              'soccer/mex.1'],
  ['uefa.champions',     'soccer/uefa.champions'],
  ['uefa.europa',        'soccer/uefa.europa'],
  ['concacaf.champions', 'soccer/concacaf.champions'],
  ['usa.ncaa.m.1',       'soccer/usa.ncaa.m.1'],
  ['usa.ncaa.w.1',       'soccer/usa.ncaa.w.1'],
  ['nfl',                'football/nfl'],
  ['ncaaf',              'football/college-football'],
  ['nba',                'basketball/nba'],
  ['ncaam',              'basketball/mens-college-basketball'],
  ['mlb',                'baseball/mlb'],
  ['nhl',                'hockey/nhl'],
];

// College leagues run to hundreds of teams. ESPN defaults to 50 and returns no
// pageCount, so ask for a high limit outright rather than trying to page.
const BIG = new Set(['ncaaf', 'ncaam', 'usa.ncaa.m.1', 'usa.ncaa.w.1']);

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}

function extract(data) {
  const leagues = (data.sports && data.sports[0] && data.sports[0].leagues) || [];
  const rows = (leagues[0] && leagues[0].teams) || [];
  return rows.map((r) => r.team).filter(Boolean).map((t) => ({
    id:     t.id,
    name:   t.displayName,
    abbrev: t.abbreviation || t.shortDisplayName || '',
    logo:   (t.logos && t.logos[0] && t.logos[0].href) || '',
  }));
}

async function fetchLeague(key, urlPath) {
  const url = API + urlPath + '/teams' + (BIG.has(key) ? '?limit=1000' : '');
  const teams = extract(await getJSON(url));
  const seen = new Set();
  return teams
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

(async () => {
  // One file per league: the picker downloads only the league being browsed,
  // which keeps a 700-team college list off the critical path on a phone.
  const dir = path.join(__dirname, '..', 'data', 'teams');
  fs.mkdirSync(dir, { recursive: true });

  let total = 0, bytes = 0;
  for (const [key, urlPath] of LEAGUES) {
    let teams = [];
    try {
      teams = await fetchLeague(key, urlPath);
    } catch (e) {
      console.error(String(key).padEnd(20), 'FAILED:', e.message);
    }
    const file = path.join(dir, key + '.json');
    fs.writeFileSync(file, JSON.stringify(teams));
    total += teams.length;
    bytes += fs.statSync(file).size;
    console.log(String(key).padEnd(20), String(teams.length).padStart(4), 'teams',
                (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
  }

  fs.writeFileSync(path.join(dir, '_generated.json'),
    JSON.stringify({ generated: new Date().toISOString() }));
  console.log('\n' + total + ' teams across ' + LEAGUES.length + ' leagues, ' +
              (bytes / 1024).toFixed(0) + ' KB total');
})();
