const CACHE_NAME = 'qingxing-shell-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => { if (event.data === '清除旧缓存') event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    try {
      const response = await fetch(event.request);
      if (response.ok && event.request.destination !== 'document') cache.put(event.request, response.clone());
      return response;
    } catch { return cache.match(event.request) || Response.error(); }
  }));
});
