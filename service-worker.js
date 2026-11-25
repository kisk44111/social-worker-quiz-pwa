importScripts('./sw-cache-policy.js');

const CACHE = `${SWCachePolicy.CACHE_PREFIX}assets-v35`;
const DATA_CACHE = `${SWCachePolicy.CACHE_PREFIX}data-v35`;
const ASSETS = [
  './', './index.html', './styles.css?build=9', './theme.css?build=9',
  './desktop.css?build=9', './readability.css?build=35', './knowledge-base.css?build=1', './exam-cram-guides.css?build=1', './historical-theory-dossiers.css?build=1', './knowledge-readability-fix.css?build=2', './data-store.js?build=27', './study-engine.js?build=16',
  './knowledge-base.js?build=1', './exam-cram-guides.js?build=1', './historical-theory-dossiers.js?build=1', './historical-related-concepts.js?build=1', './historical-theory-content.js?build=1', './historical-theory-primers.js?build=1', './theory-completion.js?build=1', './theory-gap-additions.js?build=1', './theory-third-round.js?build=1', './essay-study-tools.js?build=35', './app.js?build=35', './essay-audio-manifest.json', './manifest.webmanifest', './icon-192.png', './icon-512.png'
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
  const reqUrl = new URL(event.request.url);
  // Strictly bypass Service Worker for ALL cross-origin requests (e.g., GitHub Releases / Google Drive MP3 streams)
  // so iOS Safari native networking handles 302 redirects and HTTP Range 206 streaming untouched.
  if (reqUrl.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request)
      .then(response => cacheResponse(CACHE, './', response))
      .catch(() => caches.match('./')));
    return;
  }
  if (reqUrl.pathname.endsWith('/questions.json') || reqUrl.pathname.endsWith('/essay-audio-manifest.json')) {
    const cacheKey = reqUrl.pathname.endsWith('/essay-audio-manifest.json') ? './essay-audio-manifest.json' : event.request;
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid JSON data');
      return cacheResponse(DATA_CACHE, cacheKey, response);
    }).catch(() => caches.open(DATA_CACHE).then(cache => cache.match(cacheKey)).then(cached => cached || caches.match(cacheKey)).then(cached => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request)
    .then(cached => cached || fetch(event.request).then(response => cacheResponse(CACHE, event.request, response))));
});
