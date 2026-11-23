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

test('isValidLearningState and validateBackup reject malformed advanced fields', () => {
  const validBackup = storeApi.makeBackup({
    notes: { q1: '筆記' },
    tags: { q1: ['法規'] },
    customTags: ['法規'],
    errataNotes: { q1: '勘誤' },
    plan: { weeklyGoal: 150, startDate: '2026-11-14' },
    resume: { examType: 'socialWorker', listTitle: '題單', questionIds: ['q1', 'q2'], currentIndex: 1, updatedAt: '2026-11-20T00:00:00.000Z' }
  });
  assert.equal(storeApi.isValidLearningState(validBackup.learningState), true);
  assert.doesNotThrow(() => storeApi.validateBackup(validBackup));

  const badCases = [
    { notes: ['not-a-map'] },
    { notes: { q1: 123 } },
    { notes: JSON.parse('{"__proto__":"pollute"}') },
    { tags: { q1: 'not-an-array' } },
    { tags: { q1: [42] } },
    { customTags: 'not-an-array' },
    { customTags: [null] },
    { errataNotes: null },
    { errataNotes: { q1: false } },
    { plan: null },
    { plan: { weeklyGoal: 0, startDate: null } },
    { plan: { weeklyGoal: -10, startDate: null } },
    { plan: { weeklyGoal: 120, startDate: 20261114 } },
    { resume: 'invalid' },
    { resume: { questionIds: 'q1' } },
    { resume: { questionIds: ['q1'], currentIndex: -1 } }
  ];

  for (const patch of badCases) {
    const broken = { ...validBackup, learningState: { ...validBackup.learningState, ...patch } };
    assert.equal(storeApi.isValidLearningState(broken.learningState), false);
    assert.throws(() => storeApi.validateBackup(broken), /不完整或已損毀/);
  }
});

test('mergeLearningStates merges all advanced study data losslessly and idempotently', async () => {
  const store = storeApi.createStore({ storage: localStorageSeed(), adapterFactory: async () => storeApi.createMemoryAdapter() });
  await store.initialize();
  await store.save({
    favorites: ['q1'],
    wrong: ['q2'],
    answered: 15,
    correct: 11,
    examType: 'socialWorker',
    reviews: [
      { questionId: 'q1', subject: '社會工作', examType: 'socialWorker', correctStreak: 1, intervalDays: 1, lastResult: 'correct', lastReviewedAt: '2026-11-10T00:00:00.000Z', dueAt: '2026-11-11' },
      { questionId: 'q2', subject: '社會工作', examType: 'socialWorker', correctStreak: 2, intervalDays: 3, lastResult: 'correct', lastReviewedAt: '2026-11-20T00:00:00.000Z', dueAt: '2026-11-23' }
    ],
    essayPractices: [
      { id: 'essay-e1', questionId: 'e1', subject: '社會工作', examType: 'socialWorker', draft: '本地舊草稿', elapsedSeconds: 60, selfCheck: {}, updatedAt: '2026-11-10T00:00:00.000Z', completed: false },
      { id: 'essay-e2', questionId: 'e2', subject: '社會工作', examType: 'socialWorker', draft: '本地重要草稿', elapsedSeconds: 120, selfCheck: {}, updatedAt: '2026-11-12T00:00:00.000Z', completed: true }
    ],
    notes: { q1: '本地筆記 A', q2: '相同筆記', q3: '僅本地筆記' },
    errataNotes: { q1: '本地勘誤 1' },
    tags: { q1: ['法規', '高頻'], q2: ['社會工作'] },
    customTags: ['法規', '高頻', '自訂本地'],
    plan: { weeklyGoal: 140, startDate: '2026-11-14', updatedAt: '2026-11-15T00:00:00.000Z' },
    resume: { examType: 'socialWorker', listTitle: '本地題單', questionIds: ['q1', 'q2'], currentIndex: 1, updatedAt: '2026-11-18T00:00:00.000Z' }
  });

  const incoming = storeApi.makeBackup({
    favorites: ['q3'],
    wrong: ['q4'],
    answered: 12,
    correct: 9,
    examType: 'socialWorker',
    reviews: [
      { questionId: 'q1', subject: '社會工作', examType: 'socialWorker', correctStreak: 3, intervalDays: 7, lastResult: 'correct', lastReviewedAt: '2026-11-19T00:00:00.000Z', dueAt: '2026-11-26' },
      { questionId: 'q2', subject: '社會工作', examType: 'socialWorker', correctStreak: 0, intervalDays: 1, lastResult: 'incorrect', lastReviewedAt: '2026-11-12T00:00:00.000Z', dueAt: '2026-11-13' },
      { questionId: 'q3', subject: '社會工作', examType: 'socialWorker', correctStreak: 0, intervalDays: 1, lastResult: 'incorrect', lastReviewedAt: '2026-11-15T00:00:00.000Z', dueAt: '2026-11-16' }
    ],
    essayPractices: [
      { id: 'essay-e1', questionId: 'e1', subject: '社會工作', examType: 'socialWorker', draft: '匯入較新草稿', elapsedSeconds: 90, selfCheck: {}, updatedAt: '2026-11-21T00:00:00.000Z', completed: true },
      { id: 'essay-e2', questionId: 'e2', subject: '社會工作', examType: 'socialWorker', draft: '   ', elapsedSeconds: 0, selfCheck: {}, updatedAt: '2026-11-22T00:00:00.000Z', completed: false },
      { id: 'essay-e3', questionId: 'e3', subject: '社會工作', examType: 'socialWorker', draft: '匯入獨有草稿', elapsedSeconds: 45, selfCheck: {}, updatedAt: '2026-11-16T00:00:00.000Z', completed: false }
    ],
    notes: { q1: '匯入筆記 B', q2: '相同筆記', q4: '僅匯入筆記' },
    errataNotes: { q1: '匯入勘誤 2', q4: '匯入勘誤 4' },
    tags: { q1: ['高頻', '必考'], q4: ['申論'] },
    customTags: ['必考', '申論'],
    plan: { weeklyGoal: 180, startDate: '2026-11-10', updatedAt: '2026-11-21T00:00:00.000Z' },
    resume: { examType: 'socialWorker', listTitle: '匯入較新題單', questionIds: ['q3', 'q4'], currentIndex: 0, updatedAt: '2026-11-22T00:00:00.000Z' }
  });

  const merged = await store.importBackup(JSON.stringify(incoming));
  assert.deepEqual(merged.notes, {
    q1: '本地筆記 A\n---\n匯入筆記 B',
    q2: '相同筆記',
    q3: '僅本地筆記',
    q4: '僅匯入筆記'
  });
  assert.deepEqual(merged.errataNotes, {
    q1: '本地勘誤 1\n---\n匯入勘誤 2',
    q4: '匯入勘誤 4'
  });
  assert.deepEqual(merged.tags.q1.sort(), ['必考', '法規', '高頻']);
  assert.deepEqual(merged.tags.q2, ['社會工作']);
  assert.deepEqual(merged.tags.q4, ['申論']);
  assert.deepEqual(merged.customTags.sort(), ['必考', '法規', '申論', '自訂本地', '高頻']);

  const reviewById = new Map(merged.reviews.map(item => [item.questionId, item]));
  assert.equal(reviewById.size, 3);
  assert.equal(reviewById.get('q1').intervalDays, 7);
  assert.equal(reviewById.get('q2').intervalDays, 3);
  assert.equal(reviewById.get('q3').dueAt, '2026-11-16');

  const essayById = new Map(merged.essayPractices.map(item => [item.questionId, item]));
  assert.equal(essayById.size, 3);
  assert.equal(essayById.get('e1').draft, '匯入較新草稿');
  assert.equal(essayById.get('e2').draft, '本地重要草稿');
  assert.equal(essayById.get('e3').draft, '匯入獨有草稿');

  assert.equal(merged.plan.weeklyGoal, 180);
  assert.equal(merged.resume.listTitle, '匯入較新題單');

  // Re-importing the exact same backup must be idempotent for merged notes.
  const reimported = await store.importBackup(JSON.stringify(incoming));
  assert.equal(reimported.notes.q1, '本地筆記 A\n---\n匯入筆記 B');
  assert.equal(reimported.errataNotes.q1, '本地勘誤 1\n---\n匯入勘誤 2');
});

test('mergeLearningStates deduplicates attempts/mockExams and enforces retention caps', () => {
  const leftAttempts = [
    { id: 'a-dup', questionId: 'q1', at: '2026-11-01T00:00:00.000Z', answer: 'A', correct: true },
    { questionId: 'q2', at: '2026-11-01T00:01:00.000Z', answer: 'B', correct: false }
  ];
  const rightAttempts = [
    { id: 'a-dup', questionId: 'q1', at: '2026-11-01T00:00:00.000Z', answer: 'A', correct: true },
    { questionId: 'q2', at: '2026-11-01T00:01:00.000Z', answer: 'B', correct: false },
    { id: 'a-new', questionId: 'q3', at: '2026-11-01T00:02:00.000Z', answer: 'C', correct: true }
  ];
  const deduped = storeApi.mergeLearningStates(
    {
      attempts: leftAttempts,
      mockExams: [
        { id: 'mock-1', subject: '社會工作', questionIds: ['q1'], startedAt: '2026-11-01T09:00:00.000Z', elapsedSeconds: 30, answers: {} },
        { id: 'mock-2', subject: '社會工作', questionIds: ['q1'], startedAt: '2026-11-02T09:00:00.000Z', completedAt: '2026-11-02T09:30:00.000Z', choiceScore: 1, choiceTotal: 1, choiceAccuracy: 100 }
      ]
    },
    {
      attempts: rightAttempts,
      mockExams: [
        { id: 'mock-1', subject: '社會工作', questionIds: ['q1'], startedAt: '2026-11-01T09:00:00.000Z', completedAt: '2026-11-01T09:20:00.000Z', choiceScore: 1, choiceTotal: 1, choiceAccuracy: 100 },
        { id: 'mock-2', subject: '社會工作', questionIds: ['q1'], startedAt: '2026-11-02T09:00:00.000Z', elapsedSeconds: 10, answers: {} }
      ]
    }
  );
  assert.equal(deduped.attempts.length, 3);
  assert.equal(deduped.mockExams.length, 2);
  assert.equal(deduped.mockExams.find(item => item.id === 'mock-1').completedAt, '2026-11-01T09:20:00.000Z');
  assert.equal(deduped.mockExams.find(item => item.id === 'mock-2').completedAt, '2026-11-02T09:30:00.000Z');

  // Verify retention caps: attempts <= 5000, mockExams <= 100, essayPractices <= 500 (newest kept).
  const makeIso = offsetMinutes => new Date(Date.UTC(2026, 0, 1, 0, offsetMinutes)).toISOString();
  const manyAttemptsA = Array.from({ length: 3000 }, (_, i) => ({ id: `la-${i}`, questionId: `q-${i}`, at: makeIso(i), answer: 'A', correct: true }));
  const manyAttemptsB = Array.from({ length: 2600 }, (_, i) => ({ id: `ra-${i}`, questionId: `q-${i}`, at: makeIso(3000 + i), answer: 'B', correct: false }));
  const manyMocksA = Array.from({ length: 60 }, (_, i) => ({ id: `lm-${i}`, subject: '社會工作', questionIds: ['q1'], startedAt: makeIso(i), completedAt: makeIso(i + 1) }));
  const manyMocksB = Array.from({ length: 60 }, (_, i) => ({ id: `rm-${i}`, subject: '社會工作', questionIds: ['q1'], startedAt: makeIso(100 + i), completedAt: makeIso(101 + i) }));
  const manyEssaysA = Array.from({ length: 300 }, (_, i) => ({ id: `le-${i}`, questionId: `eq-${i}`, draft: `draft-${i}`, updatedAt: makeIso(i) }));
  const manyEssaysB = Array.from({ length: 260 }, (_, i) => ({ id: `re-${i}`, questionId: `eq-${300 + i}`, draft: `draft-${300 + i}`, updatedAt: makeIso(300 + i) }));

  const capped = storeApi.mergeLearningStates(
    { attempts: manyAttemptsA, mockExams: manyMocksA, essayPractices: manyEssaysA },
    { attempts: manyAttemptsB, mockExams: manyMocksB, essayPractices: manyEssaysB }
  );
  assert.equal(capped.attempts.length, 5000);
  assert.equal(capped.attempts[0].id, 'la-600');
  assert.equal(capped.attempts[4999].id, 'ra-2599');
  assert.equal(capped.mockExams.length, 100);
  assert.equal(capped.mockExams[0].id, 'lm-20');
  assert.equal(capped.mockExams[99].id, 'rm-59');
  assert.equal(capped.essayPractices.length, 500);
  assert.equal(capped.essayPractices[0].questionId, 'eq-60');
  assert.equal(capped.essayPractices[499].questionId, 'eq-559');
});

test('importing a legacy v1 backup preserves 100% of existing local v2 advanced study data', async () => {
  const store = storeApi.createStore({ storage: localStorageSeed(), adapterFactory: async () => storeApi.createMemoryAdapter() });
  await store.initialize();
  const localAdvanced = {
    favorites: ['local-fav'],
    wrong: ['local-wrong'],
    answered: 25,
    correct: 20,
    examType: 'socialWorker',
    attempts: [{ id: 'a-1', questionId: 'q1', subject: '社會工作', examType: 'socialWorker', answer: 'A', correct: true, at: '2026-11-20T08:00:00.000Z', mode: 'practice' }],
    reviews: [{ questionId: 'q1', subject: '社會工作', examType: 'socialWorker', correctStreak: 2, intervalDays: 3, lastResult: 'correct', lastReviewedAt: '2026-11-20T08:00:00.000Z', dueAt: '2026-11-23' }],
    mockExams: [{ id: 'mock-local', subject: '社會工作', examType: 'socialWorker', questionIds: ['q1'], startedAt: '2026-11-19T08:00:00.000Z', completedAt: '2026-11-19T08:30:00.000Z', choiceScore: 1, choiceTotal: 1, choiceAccuracy: 100 }],
    essayPractices: [{ id: 'essay-e1', questionId: 'e1', subject: '社會工作', examType: 'socialWorker', draft: '本機申論草稿不可遺失', elapsedSeconds: 180, selfCheck: { 0: true }, updatedAt: '2026-11-20T09:00:00.000Z', completed: true }],
    notes: { q1: '本機筆記不可清空' },
    errataNotes: { q1: '本機勘誤註記' },
    tags: { q1: ['弱點', '必讀'] },
    customTags: ['弱點', '必讀'],
    plan: { weeklyGoal: 160, startDate: '2026-11-14' },
    resume: { examType: 'socialWorker', listTitle: '上次進度', questionIds: ['q1', 'q2'], currentIndex: 1, updatedAt: '2026-11-20T10:00:00.000Z' }
  };
  await store.save(localAdvanced);

  const legacyV1Backup = {
    app: 'social-worker-quiz-pwa',
    backupVersion: 1,
    exportedAt: '2026-10-31T00:00:00.000Z',
    learningState: {
      schemaVersion: 1,
      favorites: ['v1-fav'],
      wrong: ['v1-wrong'],
      answered: 30,
      correct: 18,
      examType: 'socialWorker',
      updatedAt: '2026-10-31T00:00:00.000Z'
    }
  };

  const merged = await store.importBackup(JSON.stringify(legacyV1Backup));
  assert.deepEqual(merged.favorites.sort(), ['local-fav', 'v1-fav']);
  assert.deepEqual(merged.wrong.sort(), ['local-wrong', 'v1-wrong']);
  assert.equal(merged.answered, 30);
  assert.equal(merged.correct, 20);
  assert.deepEqual(merged.attempts, localAdvanced.attempts);
  assert.deepEqual(merged.reviews, localAdvanced.reviews);
  assert.deepEqual(merged.mockExams, localAdvanced.mockExams);
  assert.deepEqual(merged.essayPractices, localAdvanced.essayPractices);
  assert.deepEqual(merged.notes, localAdvanced.notes);
  assert.deepEqual(merged.errataNotes, localAdvanced.errataNotes);
  assert.deepEqual(merged.tags, localAdvanced.tags);
  assert.deepEqual(merged.customTags, localAdvanced.customTags);
  assert.deepEqual(merged.plan, localAdvanced.plan);
  assert.deepEqual(merged.resume, localAdvanced.resume);
});
