const CACHE = 'social-worker-quiz-v8';
const DATA_CACHE = 'social-worker-quiz-data-v8';
const ASSETS = ['./','./index.html','./styles.css?build=8','./theme.css?build=8','./desktop.css?build=8','./app.js?build=8','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![CACHE,DATA_CACHE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put('./',copy)); }
      return response;
    }).catch(()=>caches.match('./')));
    return;
  }
  if (new URL(event.request.url).pathname.endsWith('/questions.json')) {
    event.respondWith(fetch(event.request).then(response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid question data');
      const copy = response.clone(); caches.open(DATA_CACHE).then(cache => cache.put(event.request, copy)); return response;
    }).catch(() => caches.open(DATA_CACHE).then(cache => cache.match(event.request)).then(cached => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  })));
});
