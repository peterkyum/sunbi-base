const CACHE_NAME = 'sunbi-v7';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/api.js',
  './js/auth.js',
  './js/ui.js',
  './js/items.js',
  './js/notify.js',
  './js/pages/input.js',
  './js/pages/dashboard.js',
  './js/pages/order.js',
  './js/pages/inbound.js',
  './js/app.js',
  './config.local.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // API 요청은 항상 네트워크 우선
  if (e.request.url.includes('supabase.co') ||
      e.request.url.includes('api.telegram.org') ||
      e.request.url.includes('script.google.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 정적 파일은 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
