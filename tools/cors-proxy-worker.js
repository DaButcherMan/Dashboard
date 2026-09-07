/* ══════════════════════════════════════════
   cors-proxy-worker.js — a Cloudflare Worker that lets the dashboard read
   calendar feeds.

   Canvas, Outlook and Google serve their .ics feeds without CORS headers,
   so a browser on your own domain cannot fetch them. This sits in front,
   fetches the feed server-side, and returns it with the one header the
   browser is waiting for.

   ── Deploy ────────────────────────────────────────────────────────────
   1. dash.cloudflare.com → Workers & Pages → Create → Worker
   2. Paste this file over the template, edit the two lists below, Deploy
   3. Copy the workers.dev URL into the dashboard:
        Settings → Proxy URL →  https://<name>.<you>.workers.dev/?url={url}

   ── Why the allowlists matter ─────────────────────────────────────────
   A proxy that will fetch ANY url is an open relay: anyone who finds it can
   bounce traffic through your account, and it can be pointed at internal
   addresses. Both lists below are the difference between a private tool and
   someone else's free infrastructure. Do not widen them to '*'.

   Note the feed URL itself is a credential — it grants read access to your
   calendar with no login — which is why nothing here logs it.
   ══════════════════════════════════════════ */

// Who may call this proxy. Add your real site; keep localhost only while
// developing.
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5599',
  'http://localhost:5599',
  // 'https://your-domain.com',
];

// What it is allowed to fetch. Exact host matches only.
const ALLOWED_HOSTS = [
  'canvas.fsu.edu',
  'outlook.office365.com',
  'outlook.office.com',
  'calendar.google.com',
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    // Preflight. Answered for allowed origins only.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed ? cors(origin) : {},
      });
    }

    if (!allowed) return deny('Origin not allowed', 403);
    if (request.method !== 'GET') return deny('GET only', 405, origin);

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return deny('Missing ?url=', 400, origin);

    let feed;
    try {
      feed = new URL(target);
    } catch (e) {
      return deny('Not a URL', 400, origin);
    }

    // https only: the token travels in the path, so plain http would leak it.
    if (feed.protocol !== 'https:') return deny('https only', 400, origin);
    if (!ALLOWED_HOSTS.includes(feed.hostname)) {
      return deny('Host not allowed: ' + feed.hostname, 403, origin);
    }

    let upstream;
    try {
      upstream = await fetch(feed.toString(), {
        headers: { Accept: 'text/calendar, text/plain, */*' },
        redirect: 'follow',
      });
    } catch (e) {
      // Deliberately not echoing the error: it can contain the feed URL.
      return deny('Could not reach the feed', 502, origin);
    }

    if (!upstream.ok) return deny('Feed returned ' + upstream.status, 502, origin);

    return new Response(upstream.body, {
      status: 200,
      headers: Object.assign(cors(origin), {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store',
      }),
    });
  },
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    // Responses differ per origin, so caches must not share them.
    'Vary': 'Origin',
  };
}

function deny(message, status, origin) {
  return new Response(message, {
    status,
    headers: origin ? cors(origin) : {},
  });
}
