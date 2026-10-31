(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.studyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const INTERVALS = [1, 3, 7, 14];
  const day = value => new Date(value).toISOString().slice(0, 10);
  const plusDays = (value, days) => { const date = new Date(value); date.setUTCDate(date.getUTCDate() + days); return day(date); };
  const isCorrect = (question, answer) => (question.acceptedAnswers || [question.answer]).includes(answer);
  function scheduleReview(previous, question, correct, now = new Date()) {
    const old = previous || { questionId: question.id, correctStreak: 0, intervalDays: 0 };
    const correctStreak = correct ? old.correctStreak + 1 : 0;
    const intervalDays = correct ? INTERVALS[Math.min(correctStreak - 1, INTERVALS.length - 1)] : INTERVALS[0];
    return { questionId: question.id, subject: question.subject, examType: question.examType || 'socialWorker',
      correctStreak, intervalDays, lastResult: correct ? 'correct' : 'incorrect', lastReviewedAt: now.toISOString(), dueAt: plusDays(now, intervalDays) };
  }
  function dueReviews(reviews, now = new Date(), examType = 'socialWorker') {
    const today = day(now);
    return reviews.filter(item => item.examType === examType && item.dueAt <= today);
  }
  function subjectStats(attempts, examType = 'socialWorker') {
    const map = new Map();
    for (const item of attempts.filter(attempt => attempt.examType === examType)) {
      const current = map.get(item.subject) || { subject: item.subject, answered: 0, correct: 0 };
      current.answered += 1; if (item.correct) current.correct += 1; map.set(item.subject, current);
    }
    return [...map.values()].map(item => ({ ...item, accuracy: item.answered ? Math.round(item.correct / item.answered * 100) : 0 })).sort((a, b) => a.accuracy - b.accuracy || b.answered - a.answered);
  }
  function lastSevenDays(attempts, now = new Date()) {
    const dates = Array.from({ length: 7 }, (_, index) => plusDays(now, index - 6));
    return dates.map(date => {
      const items = attempts.filter(item => day(item.at) === date);
      const correct = items.filter(item => item.correct).length;
      return { date, answered: items.length, correct, accuracy: items.length ? Math.round(correct / items.length * 100) : null };
    });
  }
  function gradeMock(mock, questions) {
    const byId = new Map(questions.map(question => [question.id, question]));
    let correct = 0;
    const results = mock.questionIds.map(id => {
      const question = byId.get(id), selected = mock.answers[id] || null, passed = !!question && isCorrect(question, selected);
      if (passed) correct += 1;
      return { questionId: id, selected, correct: passed, answer: question?.answer || null };
    });
    return { ...mock, completedAt: new Date().toISOString(), choiceScore: correct, choiceTotal: mock.questionIds.length, choiceAccuracy: Math.round(correct / mock.questionIds.length * 100), results };
  }
  function weightedRecommendation(questions, learning, examType = 'socialWorker', count = 40, now = new Date()) {
    const due = new Set(dueReviews(learning.reviews || [], now, examType).map(item => item.questionId));
    const attempted = new Set((learning.attempts || []).filter(item => item.examType === examType).map(item => item.questionId));
    const wrong = new Set(learning.wrong || []), weak = new Set(subjectStats(learning.attempts || [], examType).slice(0, 2).map(item => item.subject));
    const pool = questions.filter(question => (question.examType || 'socialWorker') === examType && question.type === 'multipleChoice');
    const scored = pool.map(question => ({ question, score: 1 + (due.has(question.id) ? 12 : 0) + (wrong.has(question.id) ? 7 : 0) + (!attempted.has(question.id) ? 5 : 0) + (weak.has(question.subject) ? 3 : 0) + Math.random() * 2 }));
    return scored.sort((a, b) => b.score - a.score).slice(0, count).map(item => item.question);
  }
  function weeklyTrend(attempts, now = new Date(), weeks = 8) {
    const end = new Date(now); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() - end.getUTCDay());
    return Array.from({ length: weeks }, (_, index) => {
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - (weeks - 1 - index) * 7);
      const finish = new Date(start); finish.setUTCDate(finish.getUTCDate() + 7);
      const items = attempts.filter(item => new Date(item.at) >= start && new Date(item.at) < finish);
      return { week: day(start), answered: items.length, correct: items.filter(item => item.correct).length, accuracy: items.length ? Math.round(items.filter(item => item.correct).length / items.length * 100) : null };
    });
  }
  function dailyTasks(learning, now = new Date()) {
    const stats = subjectStats(learning.attempts || []), weakest = stats.slice(0, 2).map(item => item.subject);
    const due = dueReviews(learning.reviews || [], now).length;
    return [{ kind: 'review', label: `複習到期錯題 ${due} 題`, count: Math.min(Math.max(due, 10), 30) }, { kind: 'weak', label: `${weakest[0] || '社會工作'} 弱科練習`, count: 20 }, { kind: 'essay', label: '申論結構練習', count: 1 }];
  }
  return { INTERVALS, day, isCorrect, scheduleReview, dueReviews, subjectStats, lastSevenDays, gradeMock, weightedRecommendation, weeklyTrend, dailyTasks };
});
