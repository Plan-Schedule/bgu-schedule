// Offline support. The app works the same without it; this only makes it faster
// on repeat visits and usable without a connection.
//
// App files: served from cache immediately and refreshed in the background, so a
//   new version shows up on the next visit.
// Course data: fetched fresh when online (it changes daily), cache used offline.

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = 'data';
const FILES = [
  './', 'index.html', 'about.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/model.js', 'js/grid.js', 'js/share.js', 'js/data.js', 'js/store.js', 'js/config.js',
  'assets/fonts/rubik-hebrew.woff2', 'assets/fonts/rubik-latin.woff2', 'assets/icon.svg', 'assets/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) e.respondWith(networkFirst(e.request));
  else e.respondWith(staleWhileRevalidate(e.request, e));
});

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || Response.error();
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL);
  // page loads with a #hash or ?query still use the cached app page
  const scope = self.registration.scope;
  const path = new URL(req.url).pathname;
  const isApp = req.mode === 'navigate' && (path === new URL(scope).pathname || path.endsWith('/index.html'));
  const key = isApp ? scope : req;
  const cached = await cache.match(key, { ignoreSearch: isApp });
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  }
  return fresh;
}
