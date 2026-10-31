/* Learning-data persistence: IndexedDB first, with a non-destructive legacy
 * localStorage migration. This file is also CommonJS-loadable for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.learningDataStore = api.createStore();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP_ID = 'social-worker-quiz-pwa';
  const SCHEMA_VERSION = 2;
  const BACKUP_VERSION = 2;
  const DB_NAME = 'social-worker-quiz-pwa';
  const DB_VERSION = 1;
  const STATE_KEY = 'learning-state';
  const META_SNAPSHOT_KEY = 'legacy-localstorage-snapshot-v1';
  const LEGACY_KEYS = Object.freeze({
    favorites: 'favorites', wrong: 'wrong', answered: 'answered', correct: 'correct', examType: 'examType'
  });
  const EXAM_TYPES = new Set(['socialWorker', 'publicSocialWorker']);

  const defaultState = () => ({
    schemaVersion: SCHEMA_VERSION,
    favorites: [], wrong: [], answered: 0, correct: 0,
    examType: 'socialWorker', attempts: [], reviews: [], mockExams: [], essayPractices: [],
    resume: null, plan: { weeklyGoal: 120, startDate: null }, notes: {}, tags: {}, customTags: [], errataNotes: {}, updatedAt: new Date().toISOString()
  });

  const uniqueStrings = value => Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]
    : [];
  const nonNegativeInteger = value => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value)) : 0;

  function normaliseLearningState(value) {
    const base = defaultState();
    const source = value && typeof value === 'object' ? value : {};
    const answered = nonNegativeInteger(source.answered);
    const correct = Math.min(answered, nonNegativeInteger(source.correct));
    return {
      schemaVersion: SCHEMA_VERSION,
      favorites: uniqueStrings(source.favorites),
      wrong: uniqueStrings(source.wrong),
      answered,
      correct,
      examType: EXAM_TYPES.has(source.examType) ? source.examType : base.examType,
      attempts: Array.isArray(source.attempts) ? source.attempts.filter(item => item && typeof item.questionId === 'string' && typeof item.at === 'string' && typeof item.correct === 'boolean').slice(-5000) : [],
      reviews: Array.isArray(source.reviews) ? source.reviews.filter(item => item && typeof item.questionId === 'string' && typeof item.dueAt === 'string') : [],
      mockExams: Array.isArray(source.mockExams) ? source.mockExams.filter(item => item && typeof item.id === 'string' && Array.isArray(item.questionIds)).slice(-100) : [],
      essayPractices: Array.isArray(source.essayPractices) ? source.essayPractices.filter(item => item && typeof item.id === 'string' && typeof item.questionId === 'string').slice(-500) : [],
      resume: source.resume && typeof source.resume === 'object' && Array.isArray(source.resume.questionIds) ? source.resume : null,
      plan: source.plan && typeof source.plan === 'object' ? { weeklyGoal: nonNegativeInteger(source.plan.weeklyGoal) || 120, startDate: typeof source.plan.startDate === 'string' ? source.plan.startDate : null } : base.plan,
      notes: source.notes && typeof source.notes === 'object' && !Array.isArray(source.notes) ? source.notes : {},
      tags: source.tags && typeof source.tags === 'object' && !Array.isArray(source.tags) ? source.tags : {},
      customTags: uniqueStrings(source.customTags),
      errataNotes: source.errataNotes && typeof source.errataNotes === 'object' && !Array.isArray(source.errataNotes) ? source.errataNotes : {},
      updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : base.updatedAt
    };
  }

  function isValidLearningState(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION) return false;
    if (!Array.isArray(value.favorites) || !Array.isArray(value.wrong)) return false;
    if (!value.favorites.every(item => typeof item === 'string') || !value.wrong.every(item => typeof item === 'string')) return false;
    return Number.isInteger(value.answered) && value.answered >= 0
      && Number.isInteger(value.correct) && value.correct >= 0 && value.correct <= value.answered
      && EXAM_TYPES.has(value.examType) && typeof value.updatedAt === 'string'
      && Array.isArray(value.attempts) && Array.isArray(value.reviews) && Array.isArray(value.mockExams)
      && Array.isArray(value.essayPractices);
  }

  function readLegacy(storage) {
    const raw = {}, warnings = [];
    for (const [name, key] of Object.entries(LEGACY_KEYS)) {
      try { raw[name] = storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null; }
      catch (_) { raw[name] = null; warnings.push(`無法讀取舊資料：${key}`); }
    }
    const parseList = name => {
      if (raw[name] === null || raw[name] === '') return [];
      try {
        const parsed = JSON.parse(raw[name]);
        if (!Array.isArray(parsed)) throw new Error('not array');
        return parsed;
      } catch (_) {
        warnings.push(`偵測到損毀的舊資料：${LEGACY_KEYS[name]}；已保留原始值供復原。`);
        return [];
      }
    };
    return {
      state: normaliseLearningState({
        favorites: parseList('favorites'), wrong: parseList('wrong'),
        answered: raw.answered, correct: raw.correct, examType: raw.examType
      }), raw, warnings
    };
  }

  function mergeLearningStates(current, incoming) {
    const left = normaliseLearningState(current), right = normaliseLearningState(incoming);
    return normaliseLearningState({
      favorites: [...left.favorites, ...right.favorites],
      wrong: [...left.wrong, ...right.wrong],
      // Counters cannot be safely added without per-attempt history. Keep the
      // larger verified summary so an import never reduces local progress.
      answered: Math.max(left.answered, right.answered),
      correct: Math.max(left.correct, right.correct),
      examType: right.examType || left.examType,
      updatedAt: new Date().toISOString()
    });
  }

  function makeBackup(state) {
    return {
      app: APP_ID,
      backupVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      learningState: normaliseLearningState(state)
    };
  }

  function validateBackup(value) {
    let payload = value;
    if (typeof value === 'string') {
      try { payload = JSON.parse(value); }
      catch (_) { throw new Error('備份檔不是有效的 JSON。'); }
    }
    if (!payload || typeof payload !== 'object') throw new Error('備份檔格式不正確。');
    if (payload.app !== APP_ID) throw new Error('這不是社工師題庫的備份檔。');
    if (![1, BACKUP_VERSION].includes(payload.backupVersion)) throw new Error('此備份版本尚不支援。');
    // v1 was the phase-0 backup shape. It has no per-attempt records, so it
    // is deliberately upgraded as an empty-history summary rather than guessed history.
    if (payload.backupVersion === 1) {
      const legacy = payload.learningState;
      if (!legacy || !Array.isArray(legacy.favorites) || !Array.isArray(legacy.wrong) || !Number.isInteger(legacy.answered) || !Number.isInteger(legacy.correct)) throw new Error('備份中的學習資料不完整或已損毀。');
      return { ...payload, backupVersion: BACKUP_VERSION, learningState: normaliseLearningState(legacy) };
    }
    if (!isValidLearningState(payload.learningState)) throw new Error('備份中的學習資料不完整或已損毀。');
    return payload;
  }

  function createMemoryAdapter() {
    let state, meta = new Map();
    return {
      async getState() { return state; }, async setState(value) { state = value; },
      async setMeta(key, value) { meta.set(key, value); }, async getMeta(key) { return meta.get(key); }
    };
  }

  function createIndexedDbAdapter(indexedDB) {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onsuccess = () => {
        const db = request.result;
        const read = (storeName, key) => new Promise((resolveRead, rejectRead) => {
          const tx = db.transaction(storeName, 'readonly');
          const get = tx.objectStore(storeName).get(key);
          get.onsuccess = () => resolveRead(get.result && get.result.value);
          get.onerror = () => rejectRead(get.error);
        });
        const write = (storeName, key, value) => new Promise((resolveWrite, rejectWrite) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put({ key, value });
          tx.oncomplete = () => resolveWrite(); tx.onerror = () => rejectWrite(tx.error);
        });
        resolve({ getState: () => read('state', STATE_KEY), setState: value => write('state', STATE_KEY, value),
          getMeta: key => read('meta', key), setMeta: (key, value) => write('meta', key, value) });
      };
    });
  }

  function createStore(options = {}) {
    const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const adapterFactory = options.adapterFactory || (() => createIndexedDbAdapter(typeof indexedDB !== 'undefined' ? indexedDB : null));
    let adapter = null, current = defaultState(), diagnostics = { backend: 'localStorage', warnings: [], migrated: false };

    const mirrorLegacy = state => {
      if (!storage || typeof storage.setItem !== 'function') return;
      try {
        storage.setItem(LEGACY_KEYS.favorites, JSON.stringify(state.favorites));
        storage.setItem(LEGACY_KEYS.wrong, JSON.stringify(state.wrong));
        storage.setItem(LEGACY_KEYS.answered, String(state.answered));
        storage.setItem(LEGACY_KEYS.correct, String(state.correct));
        storage.setItem(LEGACY_KEYS.examType, state.examType);
      } catch (_) { diagnostics.warnings.push('無法同步舊版本機資料；IndexedDB 資料未受影響。'); }
    };

    return {
      async initialize() {
        const legacy = readLegacy(storage);
        diagnostics.warnings.push(...legacy.warnings);
        try {
          adapter = await adapterFactory(); diagnostics.backend = 'IndexedDB';
          const saved = await adapter.getState();
          if (isValidLearningState(saved)) current = normaliseLearningState(saved);
          else {
            if (saved !== undefined) {
              await adapter.setMeta('invalid-indexeddb-state-v1', { value: saved, recoveredAt: new Date().toISOString() });
              diagnostics.warnings.push('偵測到損毀的 IndexedDB 資料；已保留原始值並從舊版資料復原。');
            }
            current = legacy.state;
            await adapter.setMeta(META_SNAPSHOT_KEY, { raw: legacy.raw, migratedAt: new Date().toISOString() });
            await adapter.setState(current); diagnostics.migrated = true;
          }
        } catch (_) {
          adapter = null; current = legacy.state;
          diagnostics.warnings.push('此瀏覽器無法使用 IndexedDB；暫時以舊版本機資料保存。');
        }
        return { state: { ...current, favorites: [...current.favorites], wrong: [...current.wrong] }, diagnostics: { ...diagnostics, warnings: [...diagnostics.warnings] } };
      },
      async save(next) {
        current = normaliseLearningState({ ...next, updatedAt: new Date().toISOString() });
        if (adapter) await adapter.setState(current);
        mirrorLegacy(current);
        return current;
      },
      async exportBackup() { return makeBackup(current); },
      async importBackup(value) {
        const backup = validateBackup(value);
        current = mergeLearningStates(current, backup.learningState);
        if (adapter) await adapter.setState(current);
        mirrorLegacy(current);
        return current;
      },
      getDiagnostics() { return { ...diagnostics, warnings: [...diagnostics.warnings] }; }
    };
  }

  return { APP_ID, SCHEMA_VERSION, BACKUP_VERSION, defaultState, normaliseLearningState, isValidLearningState,
    readLegacy, mergeLearningStates, makeBackup, validateBackup, createMemoryAdapter, createIndexedDbAdapter, createStore };
});
