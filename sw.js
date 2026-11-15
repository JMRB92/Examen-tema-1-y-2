/* Almacenamiento en caché de recursos públicos; sin datos del alumno. */
const CACHE = 'examen-test-publico-v103-20261115';
const RESOURCES = ['./index.html', './data/questions.json'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(RESOURCES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('examen-test-publico-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if(response.ok && response.type === 'basic'){
      const cloned=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request,cloned)));
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
