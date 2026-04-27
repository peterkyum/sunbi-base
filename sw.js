const CACHE_NAME = 'sunbi-v18';
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
  './js/pages/history.js',
  './js/app.js',
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
  const url = new URL(e.request.url);

  // API 요청은 네트워크에 위임 (캐시하지 않음)
  if (url.hostname.includes('supabase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('api.telegram.org') ||
      url.hostname.includes('script.google.com')) {
    return;
  }

  // 정적 파일은 캐시 우선, 없으면 네트워크에서 가져와 캐시에 저장
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
