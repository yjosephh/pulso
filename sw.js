/* Service worker de Pulso: caché del "cascarón" de la app y notificaciones. */
const CACHE = 'pulso-v5';
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
  './js/metrics.js',
  './js/factors.js',
  './js/paper.js',
  './js/risk.js',
  './js/portfolio.js',
  './js/plan.js',
  './js/thesis.js',
  './data/factors-ref.json',
  './data/backtest-ref.json',
  './data/portfolio-ref.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
];

// La versión nueva NO toma el control a media carga (eso podía dejar la app en
// blanco al actualizar): se activa la próxima vez que se abre Pulso. Como las
// peticiones van "red primero", igual se reciben los archivos nuevos al instante.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

// Solo intervenimos en los archivos propios de la app (y la página); todo lo
// demás (APIs de mercado, otros archivos) va directo a la red sin pasar por aquí.
const SHELL_PATHS = new Set(SHELL.map((p) => new URL(p, self.location).pathname));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  const isPage = e.request.mode === 'navigate';
  if (!isPage && !SHELL_PATHS.has(url.pathname)) return;
  // Red primero, revalidando siempre con el servidor (cache: 'no-cache') para no
  // mezclar archivos nuevos con viejos tras una actualización; caché si no hay red.
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(isPage ? './index.html' : e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(isPage ? './index.html' : e.request).then((r) => r || caches.match('./index.html')))
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
