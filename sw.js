const FILES = ['index.html', 'cloud.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const scope = new URL(self.registration.scope);
const prefix = 'jot:' + scope.pathname + ':';
const CACHE = prefix + 'v13';
const shell = new URL('index.html', scope);
const assets = new Set(FILES.map(file => new URL(file, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...assets].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isApp = event.request.mode === 'navigate' && url.origin === scope.origin
    && (url.pathname === scope.pathname || url.pathname === shell.pathname);
  if (!isApp && !assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(isApp ? shell.href : url.href) || fetch(event.request);
  })());
});
