const scope = new URL('./', self.location.href);
const prefix = 'shiori-app-' + scope.pathname + ':';
const CACHE = prefix + 'v6';
const files = ['./', './app.mjs', './theme.mjs', './paper.mjs', './zxing-browser.min.js', './style.css', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './hero.jpg', './aozora.tsv'].map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith(prefix) && key !== CACHE) ||
      (scope.pathname === '/' && ['shiori-app-v1', 'shiori-app-v2'].includes(key)))
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const key = new URL(url.pathname === scope.pathname + 'index.html' ? scope.pathname : url.pathname, scope).href;
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !files.includes(key)) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(key, response.clone()).catch(() => {});
    }
    return response;
  }).catch(async () => (await caches.match(key, { cacheName: CACHE })) || Response.error()));
});
