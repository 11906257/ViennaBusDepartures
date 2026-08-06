const CACHE_PREFIX = 'vienna-bus-departures-';
const CACHE_VERSION = 'v23';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=23',
  './icons/icon-192.png?v=23',
  './icons/icon-512.png?v=23',
  './icons/apple-touch-icon.png?v=23'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(
      APP_SHELL.map(async path => {
        const request = new Request(new URL(path, self.registration.scope), { cache:'reload' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Failed to cache ${path}`);
        await cache.put(request, response);
      })
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
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
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response.ok) throw new Error('Navigation request failed');
          return response;
        })
        .catch(() => caches.match(new URL('./index.html', self.registration.scope)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached ?? fetch(request))
  );
});
