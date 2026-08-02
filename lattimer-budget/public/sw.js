/* Lattimer Family Budget service worker: offline app shell, never cached API. */

var VERSION = 'lfb-v5';
var SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === VERSION ? null : caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and the event stream always go to the network.
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  // Navigations: try the network so a deploy lands immediately, fall back to
  // the cached shell when the phone is offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match('/index.html').then(function (hit) {
          return hit || Response.error();
        });
      })
    );
    return;
  }

  // Static assets: serve from cache fast, refresh in the background.
  event.respondWith(
    caches.match(request).then(function (hit) {
      var network = fetch(request)
        .then(function (response) {
          if (response && response.ok && response.type === 'basic') {
            var copy = response.clone();
            caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () { return hit || Response.error(); });
      return hit || network;
    })
  );
});
