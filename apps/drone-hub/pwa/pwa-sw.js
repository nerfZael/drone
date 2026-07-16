const DRONE_HUB_SW_BUILD_ID = "__DRONE_HUB_BUILD_ID__";
const DRONE_HUB_CACHE = `drone-hub-shell-${DRONE_HUB_SW_BUILD_ID}`;
const DRONE_HUB_CACHE_PREFIX = 'drone-hub-';
const DRONE_HUB_DEV_WORKER = DRONE_HUB_SW_BUILD_ID === '__DRONE_HUB_BUILD_ID__';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/drone-app-icon-32.png',
  '/icons/drone-app-icon-256.png',
  '/icons/drone-app-icon-512.png',
];

async function deleteOldDroneHubCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(DRONE_HUB_CACHE_PREFIX) && key !== DRONE_HUB_CACHE)
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener('install', (event) => {
  if (DRONE_HUB_DEV_WORKER) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches
      .open(DRONE_HUB_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  if (DRONE_HUB_DEV_WORKER) {
    event.waitUntil(
      deleteOldDroneHubCaches()
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim()),
    );
    return;
  }

  event.waitUntil(
    deleteOldDroneHubCaches()
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (DRONE_HUB_DEV_WORKER) return;

  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/version.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    fetch(request, request.mode === 'navigate' ? { cache: 'no-store' } : undefined)
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
          return (await caches.match('/index.html')) || Response.error();
        }
        return Response.error();
      }),
  );
});
