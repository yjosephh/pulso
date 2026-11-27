/* Service worker de Pulso: caché del "cascarón" de la app y notificaciones. */
const CACHE = 'pulso-v3';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/analysis.js',
  './js/charts.js',
  './js/notify.js',
  './js/universe.js',
  './js/store.js',
  './js/backtest.js',
  './data/backtest-ref.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
];

// La versión nueva NO toma el control a media carga (eso podía dejar la app en
// blanco al actualizar): se activa la próxima vez que se abre Pulso. Como las
// peticiones van "red primero", igual se reciben los archivos nuevos al instante.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Las APIs de mercado siempre van a la red (datos en vivo, nunca en caché).
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  // Red primero para tener siempre la última versión; caché si no hay conexión.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'open', url: target });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
