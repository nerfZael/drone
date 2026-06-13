const DRONE_HUB_CACHE = 'drone-hub-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/remote.html',
  '/manifest.webmanifest',
  '/remote-manifest.webmanifest',
  '/icons/drone-app-icon-32.png',
  '/icons/drone-app-icon-256.png',
  '/icons/drone-app-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(DRONE_HUB_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== DRONE_HUB_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(DRONE_HUB_CACHE).then((cache) => {
          cache.put(request, copy).catch(() => {});
        });
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = url.pathname === '/remote.html' ? '/remote.html' : '/index.html';
          return (await caches.match(fallback)) || Response.error();
        }
        return Response.error();
      }),
  );
});
