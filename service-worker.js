const CACHE_PREFIX = 'vienna-bus-departures-';
const CACHE_VERSION = 'v29';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest?v=29',
  './icons/icon-192.png?v=29',
  './icons/icon-512.png?v=29',
  './icons/apple-touch-icon.png?v=29'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = APP_SHELL.map(path => new Request(
      new URL(path, self.registration.scope),
      { cache:'reload' }
    ));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version:CACHE_VERSION });
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch {}
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(new URL('./index.html', self.registration.scope)) ?? Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request) ?? fetch(request);
  })());
});
