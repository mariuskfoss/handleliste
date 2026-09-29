/* Ukeshandel service worker: gjør at appen åpner selv uten dekning (f.eks. i butikken).
 * Appfiler: nett først (alltid nyeste versjon), mellomlager hvis nettet svikter.
 * Firebase-SDK fra gstatic (versjonert, endres aldri): mellomlager først.
 * Firestore/innlogging går aldri via denne (håndteres av Firebase sin egen frakoblet-lagring).
 */
var VERSION = '0.4.2';
var CACHE = 'ukeshandel-' + VERSION;
var SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
var APP_FILES = ['./', 'index.html', 'style.css?v=0.4.2', 'firebase-config.js?v=0.4.2', 'seed.js?v=0.4.2', 'library.js?v=0.4.2', 'units.js?v=0.4.2', 'sync.js?v=0.4.2', 'app.js?v=0.4.2'];
var SDK_FILES = [SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(APP_FILES).then(function () {
      // SDK-filene hentes i bakgrunnen; feiler de, prøves de igjen ved bruk.
      return Promise.all(SDK_FILES.map(function (u) {
        return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('ukeshandel-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return caches.open(CACHE).then(function (c) {
    return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
      if (res && res.ok && res.type === 'basic') c.put(req.url, res.clone());
      return res;
    }).catch(function () {
      return c.match(req.url).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('index.html').then(function (h) { return h || c.match('./'); });
        return Response.error();
      });
    });
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) c.put(req.url, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.href.indexOf(SDK) === 0) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin === self.location.origin && url.pathname.indexOf(new URL('./', self.location).pathname) === 0) {
    e.respondWith(networkFirst(req));
  }
});
