/* Lattimer Family Budget service worker: offline app shell, never cached API. */

var VERSION = 'lfb-v21';
var SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=21',
  '/app.js?v=21',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // cache: 'reload' bypasses the HTTP cache — a new worker must never
      // "update" itself with stale copies of the old build.
      return Promise.all(SHELL.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error('shell fetch failed: ' + url);
          return cache.put(url, res);
        });
      }));
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

// Lock-screen notifications: bill reminders and the month report.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* plain text */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lattimer Family Budget', {
      body: data.body || '',
      tag: data.tag || 'lfb',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow('/');
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
