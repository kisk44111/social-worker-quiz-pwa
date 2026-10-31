const test = require('node:test');
const assert = require('node:assert/strict');
const storeApi = require('../data-store.js');

function localStorageSeed(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), data };
}

test('migrates legacy localStorage losslessly and leaves original values in place', async () => {
  const storage = localStorageSeed({ favorites: '["q1","q2"]', wrong: '["q2"]', answered: '12', correct: '9', examType: 'publicSocialWorker' });
  const adapter = storeApi.createMemoryAdapter();
  const store = storeApi.createStore({ storage, adapterFactory: async () => adapter });
  const result = await store.initialize();
  assert.deepEqual(result.state.favorites, ['q1', 'q2']);
  assert.deepEqual(result.state.wrong, ['q2']);
  assert.equal(result.state.answered, 12); assert.equal(result.state.correct, 9);
  assert.equal(storage.getItem('favorites'), '["q1","q2"]');
  assert.equal(result.diagnostics.migrated, true);
  const snapshot = await adapter.getMeta('legacy-localstorage-snapshot-v1');
  assert.equal(snapshot.raw.favorites, '["q1","q2"]');
});

test('recovers safely from corrupt legacy localStorage without throwing', async () => {
  const storage = localStorageSeed({ favorites: '{bad json', wrong: '["q3"]', answered: '4', correct: '12' });
  const store = storeApi.createStore({ storage, adapterFactory: async () => storeApi.createMemoryAdapter() });
  const result = await store.initialize();
  assert.deepEqual(result.state.favorites, []);
  assert.deepEqual(result.state.wrong, ['q3']);
  assert.equal(result.state.correct, 4);
  assert.match(result.diagnostics.warnings.join('\n'), /損毀/);
  assert.equal(storage.getItem('favorites'), '{bad json');
});

test('preserves a corrupt IndexedDB record and recovers from the legacy mirror', async () => {
  const storage = localStorageSeed({ favorites: '["safe-q"]', answered: '2', correct: '1' });
  const adapter = storeApi.createMemoryAdapter();
  await adapter.setState({ schemaVersion: 1, favorites: 'not-an-array', wrong: [], answered: 2, correct: 1, examType: 'socialWorker' });
  const store = storeApi.createStore({ storage, adapterFactory: async () => adapter });
  const result = await store.initialize();
  assert.deepEqual(result.state.favorites, ['safe-q']);
  assert.match(result.diagnostics.warnings.join('\n'), /IndexedDB/);
  const forensicCopy = await adapter.getMeta('invalid-indexeddb-state-v1');
  assert.equal(forensicCopy.value.favorites, 'not-an-array');
});

test('backup import validates its identity and only merges without deleting progress', async () => {
  const store = storeApi.createStore({ storage: localStorageSeed(), adapterFactory: async () => storeApi.createMemoryAdapter() });
  await store.initialize();
  await store.save({ favorites: ['local'], wrong: ['wrong-local'], answered: 10, correct: 8, examType: 'socialWorker' });
  const incoming = storeApi.makeBackup({ favorites: ['remote'], wrong: ['wrong-remote'], answered: 4, correct: 3, examType: 'publicSocialWorker' });
  const merged = await store.importBackup(JSON.stringify(incoming));
  assert.deepEqual(merged.favorites.sort(), ['local', 'remote']);
  assert.deepEqual(merged.wrong.sort(), ['wrong-local', 'wrong-remote']);
  assert.equal(merged.answered, 10); assert.equal(merged.correct, 8);
  await assert.rejects(() => store.importBackup('{"app":"other"}'), /不是社工師題庫/);
});

test('phase-0 v1 backups upgrade without inventing attempt history', async () => {
  const backup = { app: 'social-worker-quiz-pwa', backupVersion: 1, exportedAt: '2026-10-31T00:00:00.000Z', learningState: { schemaVersion: 1, favorites: ['old-q'], wrong: [], answered: 8, correct: 6, examType: 'socialWorker', updatedAt: '2026-10-31T00:00:00.000Z' } };
  const upgraded = storeApi.validateBackup(backup);
  assert.equal(upgraded.backupVersion, 2);
  assert.deepEqual(upgraded.learningState.attempts, []);
  assert.equal(upgraded.learningState.answered, 8);
});

test('backup keeps custom study data', async () => {
  const store = storeApi.createStore({ storage: localStorageSeed(), adapterFactory: async () => storeApi.createMemoryAdapter() });
  await store.initialize();
  await store.save({ notes: { q1: 'note' }, tags: { q1: ['tag'] }, customTags: ['tag'], favorites: [], wrong: [], answered: 0, correct: 0, examType: 'socialWorker', attempts: [], reviews: [], mockExams: [], essayPractices: [], resume: null, plan: { weeklyGoal: 120, startDate: null } });
  const backup = await store.exportBackup();
  assert.equal(backup.learningState.notes.q1, 'note');
});

test('uses legacy localStorage safely when IndexedDB is unavailable', async () => {
  const storage = localStorageSeed({ favorites: '["q1"]' });
  const store = storeApi.createStore({ storage, adapterFactory: async () => { throw new Error('blocked'); } });
  const result = await store.initialize();
  assert.equal(result.diagnostics.backend, 'localStorage');
  assert.deepEqual(result.state.favorites, ['q1']);
});
