/* Shared by the Service Worker and Node tests. Only this exact prefix may be
 * cleaned up; CacheStorage is shared by all projects on a GitHub Pages origin. */
(function (root) {
  const CACHE_PREFIX = 'social-worker-quiz-pwa-';
  const isProjectCache = name => typeof name === 'string' && name.startsWith(CACHE_PREFIX);
  const obsoleteProjectCaches = (names, active) => names.filter(name => isProjectCache(name) && !active.includes(name));
  const api = { CACHE_PREFIX, isProjectCache, obsoleteProjectCaches };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SWCachePolicy = api;
})(typeof self !== 'undefined' ? self : globalThis);
