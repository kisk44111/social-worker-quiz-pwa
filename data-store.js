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
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_ATTEMPTS = 5000;
  const MAX_MOCK_EXAMS = 100;
  const MAX_ESSAY_PRACTICES = 500;
  const NOTE_MERGE_SEPARATOR = '\n---\n';

  const defaultState = () => ({
    schemaVersion: SCHEMA_VERSION,
    favorites: [], wrong: [], answered: 0, correct: 0,
    examType: 'socialWorker', attempts: [], reviews: [], mockExams: [], essayPractices: [],
    resume: null, plan: { weeklyGoal: 120, startDate: null }, notes: {}, tags: {}, customTags: [], errataNotes: {}, updatedAt: new Date().toISOString()
  });

  const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isSafeKey = key => typeof key === 'string' && key.trim() !== '' && !UNSAFE_KEYS.has(key);
  const uniqueStrings = value => Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]
    : [];
  const nonNegativeInteger = value => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value)) : 0;
  const toTimestamp = value => {
    if (typeof value !== 'string' || !value) return -1;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : -1;
  };
  const normaliseStringMap = value => {
    if (!isPlainObject(value)) return {};
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSafeKey(key) && typeof item === 'string') out[key] = item;
    }
    return out;
  };
  const normaliseTagMap = value => {
    if (!isPlainObject(value)) return {};
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSafeKey(key) && Array.isArray(item)) out[key] = uniqueStrings(item);
    }
    return out;
  };
  const normaliseResume = value => {
    if (!isPlainObject(value) || !Array.isArray(value.questionIds)) return null;
    const questionIds = value.questionIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim());
    return {
      ...value,
      questionIds,
      currentIndex: nonNegativeInteger(value.currentIndex)
    };
  };
  const normalisePlan = (value, fallback) => {
    if (!isPlainObject(value)) return { ...fallback };
    const plan = {
      weeklyGoal: nonNegativeInteger(value.weeklyGoal) || 120,
      startDate: typeof value.startDate === 'string' && value.startDate.trim() ? value.startDate.trim() : null
    };
    if (typeof value.updatedAt === 'string' && value.updatedAt) plan.updatedAt = value.updatedAt;
    return plan;
  };

  function normaliseLearningState(value) {
    const base = defaultState();
    const source = isPlainObject(value) ? value : {};
    const answered = nonNegativeInteger(source.answered);
    const correct = Math.min(answered, nonNegativeInteger(source.correct));
    return {
      schemaVersion: SCHEMA_VERSION,
      favorites: uniqueStrings(source.favorites),
      wrong: uniqueStrings(source.wrong),
      answered,
      correct,
      examType: EXAM_TYPES.has(source.examType) ? source.examType : base.examType,
      attempts: Array.isArray(source.attempts) ? source.attempts.filter(item => isPlainObject(item) && typeof item.questionId === 'string' && typeof item.at === 'string' && typeof item.correct === 'boolean').slice(-MAX_ATTEMPTS) : [],
      reviews: Array.isArray(source.reviews) ? source.reviews.filter(item => isPlainObject(item) && typeof item.questionId === 'string' && typeof item.dueAt === 'string') : [],
      mockExams: Array.isArray(source.mockExams) ? source.mockExams.filter(item => isPlainObject(item) && typeof item.id === 'string' && Array.isArray(item.questionIds)).slice(-MAX_MOCK_EXAMS) : [],
      essayPractices: Array.isArray(source.essayPractices) ? source.essayPractices.filter(item => isPlainObject(item) && typeof item.id === 'string' && typeof item.questionId === 'string').slice(-MAX_ESSAY_PRACTICES) : [],
      resume: normaliseResume(source.resume),
      plan: normalisePlan(source.plan, base.plan),
      notes: normaliseStringMap(source.notes),
      tags: normaliseTagMap(source.tags),
      customTags: uniqueStrings(source.customTags),
      errataNotes: normaliseStringMap(source.errataNotes),
      updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : base.updatedAt
    };
  }

  const isStringMap = value => isPlainObject(value)
    && Object.entries(value).every(([key, item]) => isSafeKey(key) && typeof item === 'string');
  const isStringArrayMap = value => isPlainObject(value)
    && Object.entries(value).every(([key, item]) => isSafeKey(key) && Array.isArray(item) && item.every(tag => typeof tag === 'string'));
  const isValidPlan = value => isPlainObject(value)
    && Number.isInteger(value.weeklyGoal) && value.weeklyGoal > 0
    && (value.startDate === null || value.startDate === undefined || typeof value.startDate === 'string')
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string');
  const isValidResume = value => value === null || (
    isPlainObject(value)
    && Array.isArray(value.questionIds)
    && value.questionIds.every(id => typeof id === 'string')
    && (value.currentIndex === undefined || (Number.isInteger(value.currentIndex) && value.currentIndex >= 0))
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
  );

  function isValidLearningState(value) {
    if (!isPlainObject(value) || value.schemaVersion !== SCHEMA_VERSION) return false;
    if (!Array.isArray(value.favorites) || !Array.isArray(value.wrong)) return false;
    if (!value.favorites.every(item => typeof item === 'string') || !value.wrong.every(item => typeof item === 'string')) return false;
    if (!(Number.isInteger(value.answered) && value.answered >= 0
      && Number.isInteger(value.correct) && value.correct >= 0 && value.correct <= value.answered
      && EXAM_TYPES.has(value.examType) && typeof value.updatedAt === 'string')) return false;
    if (!Array.isArray(value.attempts) || !value.attempts.every(item => isPlainObject(item) && typeof item.questionId === 'string' && typeof item.at === 'string' && typeof item.correct === 'boolean')) return false;
    if (!Array.isArray(value.reviews) || !value.reviews.every(item => isPlainObject(item) && typeof item.questionId === 'string' && typeof item.dueAt === 'string')) return false;
    if (!Array.isArray(value.mockExams) || !value.mockExams.every(item => isPlainObject(item) && typeof item.id === 'string' && Array.isArray(item.questionIds) && item.questionIds.every(id => typeof id === 'string'))) return false;
    if (!Array.isArray(value.essayPractices) || !value.essayPractices.every(item => isPlainObject(item) && typeof item.id === 'string' && typeof item.questionId === 'string')) return false;
    if (value.resume !== undefined && !isValidResume(value.resume)) return false;
    if (value.plan !== undefined && !isValidPlan(value.plan)) return false;
    if (value.notes !== undefined && !isStringMap(value.notes)) return false;
    if (value.tags !== undefined && !isStringArrayMap(value.tags)) return false;
    if (value.customTags !== undefined && (!Array.isArray(value.customTags) || !value.customTags.every(item => typeof item === 'string'))) return false;
    if (value.errataNotes !== undefined && !isStringMap(value.errataNotes)) return false;
    return true;
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

  function mergeAttempts(leftAttempts, rightAttempts) {
    const byKey = new Map();
    const attemptKey = item => (typeof item.id === 'string' && item.id.trim())
      ? `id:${item.id.trim()}`
      : `fallback:${item.questionId}|${item.at}|${item.answer ?? ''}`;
    for (const item of [...leftAttempts, ...rightAttempts]) {
      const key = attemptKey(item);
      if (!byKey.has(key)) byKey.set(key, { ...item });
    }
    return [...byKey.values()]
      .sort((a, b) => (toTimestamp(a.at) - toTimestamp(b.at)) || String(a.at).localeCompare(String(b.at)))
      .slice(-MAX_ATTEMPTS);
  }

  function mergeReviews(leftReviews, rightReviews) {
    const byQuestion = new Map();
    const reviewTime = item => {
      const reviewed = toTimestamp(item.lastReviewedAt);
      if (reviewed >= 0) return reviewed;
      const updated = toTimestamp(item.updatedAt);
      if (updated >= 0) return updated;
      return toTimestamp(item.dueAt);
    };
    for (const item of [...leftReviews, ...rightReviews]) {
      const existing = byQuestion.get(item.questionId);
      if (!existing || reviewTime(item) > reviewTime(existing)) {
        byQuestion.set(item.questionId, { ...item });
      }
    }
    return [...byQuestion.values()];
  }

  function mergeMockExams(leftMocks, rightMocks) {
    const byId = new Map();
    const mockTime = item => {
      const completed = toTimestamp(item.completedAt);
      if (completed >= 0) return completed;
      const updated = toTimestamp(item.updatedAt);
      if (updated >= 0) return updated;
      return toTimestamp(item.startedAt);
    };
    const isCompleted = item => typeof item.completedAt === 'string' && item.completedAt.trim() !== '';
    const answerCount = item => isPlainObject(item.answers) ? Object.keys(item.answers).length : 0;
    const shouldReplace = (existing, candidate) => {
      if (isCompleted(candidate) && !isCompleted(existing)) return true;
      if (isCompleted(existing) && !isCompleted(candidate)) return false;
      const diff = mockTime(candidate) - mockTime(existing);
      if (diff !== 0) return diff > 0;
      const elapsedDiff = nonNegativeInteger(candidate.elapsedSeconds) - nonNegativeInteger(existing.elapsedSeconds);
      if (elapsedDiff !== 0) return elapsedDiff > 0;
      return answerCount(candidate) > answerCount(existing);
    };
    for (const item of [...leftMocks, ...rightMocks]) {
      const existing = byId.get(item.id);
      if (!existing || shouldReplace(existing, item)) {
        byId.set(item.id, { ...item });
      }
    }
    return [...byId.values()]
      .sort((a, b) => (mockTime(a) - mockTime(b)) || a.id.localeCompare(b.id))
      .slice(-MAX_MOCK_EXAMS);
  }

  function mergeEssayPractices(leftEssays, rightEssays) {
    const byQuestion = new Map();
    const hasDraft = item => typeof item.draft === 'string' && item.draft.trim().length > 0;
    const shouldReplace = (existing, candidate) => {
      if (hasDraft(candidate) && !hasDraft(existing)) return true;
      if (hasDraft(existing) && !hasDraft(candidate)) return false;
      const diff = toTimestamp(candidate.updatedAt) - toTimestamp(existing.updatedAt);
      if (diff !== 0) return diff > 0;
      if (Boolean(candidate.completed) !== Boolean(existing.completed)) return Boolean(candidate.completed);
      return nonNegativeInteger(candidate.elapsedSeconds) > nonNegativeInteger(existing.elapsedSeconds);
    };
    for (const item of [...leftEssays, ...rightEssays]) {
      const existing = byQuestion.get(item.questionId);
      if (!existing || shouldReplace(existing, item)) {
        byQuestion.set(item.questionId, { ...item });
      }
    }
    return [...byQuestion.values()]
      .sort((a, b) => (toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt)) || a.questionId.localeCompare(b.questionId))
      .slice(-MAX_ESSAY_PRACTICES);
  }

  function mergeTextMaps(leftMap, rightMap) {
    const merged = {};
    const keys = new Set([...Object.keys(leftMap), ...Object.keys(rightMap)]);
    const splitSegments = text => text.split(NOTE_MERGE_SEPARATOR).map(part => part.trim()).filter(Boolean);
    for (const key of keys) {
      if (!isSafeKey(key)) continue;
      const leftText = typeof leftMap[key] === 'string' ? leftMap[key].trim() : '';
      const rightText = typeof rightMap[key] === 'string' ? rightMap[key].trim() : '';
      if (!leftText && !rightText) continue;
      if (leftText && !rightText) { merged[key] = leftMap[key]; continue; }
      if (!leftText && rightText) { merged[key] = rightMap[key]; continue; }
      if (leftText === rightText) { merged[key] = leftMap[key]; continue; }
      const segments = splitSegments(leftText);
      const seen = new Set(segments);
      for (const part of splitSegments(rightText)) {
        if (!seen.has(part)) {
          segments.push(part);
          seen.add(part);
        }
      }
      merged[key] = segments.join(NOTE_MERGE_SEPARATOR);
    }
    return merged;
  }

  function mergeTagMaps(leftMap, rightMap) {
    const merged = {};
    const keys = new Set([...Object.keys(leftMap), ...Object.keys(rightMap)]);
    for (const key of keys) {
      if (!isSafeKey(key)) continue;
      const tags = uniqueStrings([...(leftMap[key] || []), ...(rightMap[key] || [])]);
      if (tags.length) merged[key] = tags;
    }
    return merged;
  }

  function mergeResume(leftResume, rightResume, leftUpdatedAt, rightUpdatedAt) {
    const leftValid = Boolean(leftResume && leftResume.questionIds.length);
    const rightValid = Boolean(rightResume && rightResume.questionIds.length);
    if (!leftValid && !rightValid) return leftResume || rightResume || null;
    if (leftValid && !rightValid) return { ...leftResume };
    if (!leftValid && rightValid) return { ...rightResume };
    const leftTime = toTimestamp(leftResume.updatedAt);
    const rightTime = toTimestamp(rightResume.updatedAt);
    if (leftTime >= 0 || rightTime >= 0) {
      return rightTime > leftTime ? { ...rightResume } : { ...leftResume };
    }
    return rightUpdatedAt > leftUpdatedAt ? { ...rightResume } : { ...leftResume };
  }

  function mergePlan(leftPlan, rightPlan, leftUpdatedAt, rightUpdatedAt) {
    const isDefault = plan => !plan || (plan.weeklyGoal === 120 && plan.startDate === null);
    const leftDefault = isDefault(leftPlan);
    const rightDefault = isDefault(rightPlan);
    if (leftDefault && rightDefault) return { ...leftPlan };
    if (!leftDefault && rightDefault) return { ...leftPlan };
    if (leftDefault && !rightDefault) return { ...rightPlan };
    const leftTime = toTimestamp(leftPlan.updatedAt) >= 0 ? toTimestamp(leftPlan.updatedAt) : leftUpdatedAt;
    const rightTime = toTimestamp(rightPlan.updatedAt) >= 0 ? toTimestamp(rightPlan.updatedAt) : rightUpdatedAt;
    return rightTime > leftTime ? { ...rightPlan } : { ...leftPlan };
  }

  function mergeLearningStates(current, incoming) {
    const leftUpdatedAt = toTimestamp(isPlainObject(current) ? current.updatedAt : '');
    const rightUpdatedAt = toTimestamp(isPlainObject(incoming) ? incoming.updatedAt : '');
    const left = normaliseLearningState(current), right = normaliseLearningState(incoming);
    return normaliseLearningState({
      favorites: [...left.favorites, ...right.favorites],
      wrong: [...left.wrong, ...right.wrong],
      // Counters cannot be safely added without per-attempt history. Keep the
      // larger verified summary so an import never reduces local progress.
      answered: Math.max(left.answered, right.answered),
      correct: Math.max(left.correct, right.correct),
      examType: right.examType || left.examType,
      attempts: mergeAttempts(left.attempts, right.attempts),
      reviews: mergeReviews(left.reviews, right.reviews),
      mockExams: mergeMockExams(left.mockExams, right.mockExams),
      essayPractices: mergeEssayPractices(left.essayPractices, right.essayPractices),
      resume: mergeResume(left.resume, right.resume, leftUpdatedAt, rightUpdatedAt),
      plan: mergePlan(left.plan, right.plan, leftUpdatedAt, rightUpdatedAt),
      notes: mergeTextMaps(left.notes, right.notes),
      tags: mergeTagMaps(left.tags, right.tags),
      customTags: [...left.customTags, ...right.customTags],
      errataNotes: mergeTextMaps(left.errataNotes, right.errataNotes),
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
