/* Blog Editor service worker. Scope: /_editor/. Never touches /_editor/api/* or anything outside /_editor/. */
const VERSION = 'v1';
const SHELL_CACHE = `editor-shell-${VERSION}`;
const ASSET_CACHE = `editor-assets-${VERSION}`;
const SCOPE = '/_editor/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon.svg']))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('editor-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.startsWith(SCOPE + 'api/')) return;

  // hashed build assets: cache first
  if (url.pathname.startsWith(SCOPE + 'assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // navigations + other shell files: network first, fall back to cache
  const isNav = req.mode === 'navigate';
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(isNav ? SCOPE : req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(isNav ? SCOPE : req, { ignoreSearch: true })) || Response.error();
      }),
  );
});
