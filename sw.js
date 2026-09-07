/* ══════════════════════════════════════════
   sw.js — service worker.

   The app shell is cached so the dashboard opens instantly and works with
   no signal; your data lives in localStorage and never needed the network.
   The shell is served stale-while-revalidate, so a deploy lands on the next
   visit. ESPN calls are never cached here — sports.js does its own TTL
   caching, and a stale score is worse than no score. Neither is the
   Supabase library: it is loaded from a CDN on demand, and the app is
   built to work without it.
   ══════════════════════════════════════════ */
const VERSION = 'dash-v14';
const SHELL = [
  '/', '/index.html',
  '/css/dashboard.css',
  '/js/config.js', '/js/util.js', '/js/store.js', '/js/cloud.js', '/js/agenda.js',
  '/js/ics.js', '/js/sync.js', '/js/canvas.js', '/js/weight.js', '/js/peptides.js', '/js/exercises.js', '/js/workouts.js', '/js/sports.js', '/js/app.js',
  '/manifest.json',
  '/images/icon-192.png', '/images/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   // ESPN, fonts, proxies: network

  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
