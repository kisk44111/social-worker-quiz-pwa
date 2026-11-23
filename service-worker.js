importScripts('./sw-cache-policy.js');

const CACHE = `${SWCachePolicy.CACHE_PREFIX}assets-v29`;
const DATA_CACHE = `${SWCachePolicy.CACHE_PREFIX}data-v29`;
const ASSETS = [
  './', './index.html', './styles.css?build=9', './theme.css?build=9',
  './desktop.css?build=9', './readability.css?build=29', './knowledge-base.css?build=1', './exam-cram-guides.css?build=1', './historical-theory-dossiers.css?build=1', './knowledge-readability-fix.css?build=2', './data-store.js?build=27', './study-engine.js?build=16',
  './knowledge-base.js?build=1', './exam-cram-guides.js?build=1', './historical-theory-dossiers.js?build=1', './historical-related-concepts.js?build=1', './historical-theory-content.js?build=1', './historical-theory-primers.js?build=1', './theory-completion.js?build=1', './theory-gap-additions.js?build=1', './theory-third-round.js?build=1', './essay-study-tools.js?build=29', './app.js?build=29', './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

function cacheResponse(cacheName, request, response) {
  if (!response.ok) return Promise.resolve(response);
  const copy = response.clone();
  return caches.open(cacheName).then(cache => cache.put(request, copy)).then(() => response);
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS))
));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(SWCachePolicy.obsoleteProjectCaches(keys, [CACHE, DATA_CACHE]).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request)
      .then(response => cacheResponse(CACHE, './', response))
      .catch(() => caches.match('./')));
    return;
  }
  if (new URL(event.request.url).pathname.endsWith('/questions.json')) {
    event.respondWith(fetch(event.request).then(response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid question data');
      return cacheResponse(DATA_CACHE, event.request, response);
    }).catch(() => caches.open(DATA_CACHE).then(cache => cache.match(event.request)).then(cached => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request)
    .then(cached => cached || fetch(event.request).then(response => cacheResponse(CACHE, event.request, response))));
});
