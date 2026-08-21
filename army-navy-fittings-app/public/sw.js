/*
 * Offline support.
 *
 * The catalogue and the AN size chart are the two things worth having with no
 * signal — under a car, in a workshop with thick walls, out on a farm. So the
 * app shell is cached on install and served cache-first, while the page itself
 * falls back to the cached shell when the network is unreachable.
 *
 * The build stamps in the cache name and the list of files to pre-cache — they
 * are content-hashed, so their names are not known until then. See
 * scripts/finalise-sw.mjs.
 */

const CACHE_VERSION = '__CACHE_VERSION__';
const PRECACHE = __PRECACHE_ASSETS__;
const SHELL = self.registration.scope;

/**
 * `ignoreVary` matters more than it looks. Hosts commonly answer with
 * `Vary: Origin` (Vite's own preview server does), and a response stored by
 * `cache.addAll` — whose request carries no Origin header — then fails to match
 * the page's own request for the same file. The cache fills up correctly and
 * every lookup misses, which offline looks exactly like having no cache at all.
 */
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([SHELL, ...PRECACHE.map((file) => `${SHELL}${file}`)]))
      .then(() => self.skipWaiting())
      .catch(() => {
        // A failed pre-cache must not block activation; runtime caching will
        // pick the files up on first use instead.
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache wa.me, mailto and friends

  // Navigations: try the network so a redeploy is picked up, fall back to the
  // cached shell when there is none.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL, MATCH).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Assets are content-hashed by the build, so a cache hit is always current.
  event.respondWith(
    caches.match(request, MATCH).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
