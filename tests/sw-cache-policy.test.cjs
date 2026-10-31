const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../sw-cache-policy.js');

test('cache cleanup only selects this app namespace and preserves other GitHub Pages projects', () => {
  const names = [
    'social-worker-quiz-pwa-assets-v14', 'social-worker-quiz-pwa-data-v14',
    'social-worker-quiz-pwa-assets-v15', 'social-worker-quiz-pwa-data-v15',
    'social-worker-quiz-v14', 'another-project-v7', 'workbox-precache-v2'
  ];
  assert.deepEqual(policy.obsoleteProjectCaches(names, ['social-worker-quiz-pwa-assets-v15', 'social-worker-quiz-pwa-data-v15']), [
    'social-worker-quiz-pwa-assets-v14', 'social-worker-quiz-pwa-data-v14'
  ]);
  assert.equal(policy.isProjectCache('another-project-v7'), false);
});
