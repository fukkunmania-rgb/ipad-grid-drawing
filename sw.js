// Basic service worker for offline-first static assets
const CACHE_VERSION = 'pwa-sketch-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests -> network first, fallback to cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put('./', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets -> cache first
  if (ASSETS.some(a => url.pathname.endsWith(a.replace('./','/')))) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  }
});

