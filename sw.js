/**
 * sw.js
 * Service Worker para funcionamiento 100 % sin conexión tras la primera carga.
 * Compatible con GitHub Pages (rutas relativas).
 */

const CACHE_NAME = 'examen-test-offline-v1';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './test.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/exam.js',
  './js/questions.js',
  './js/results.js',
  './js/storage.js',
  './js/pdf.js',
  './js/teacher.js',
  './data/questions.json',
  './assets/logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Actualizar caché en segundo plano si hay conexión
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Recurso no disponible sin conexión.', {
            status: 503,
            statusText: 'Offline'
          });
        });
    })
  );
});
