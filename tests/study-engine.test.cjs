const test = require('node:test');
const assert = require('node:assert/strict');
const study = require('../study-engine.js');

const question = { id: 'q1', subject: '社會工作', examType: 'socialWorker', answer: 'A' };

test('wrong-answer review starts at one day and correct reviews expand 1, 3, 7, 14 days', () => {
  const now = new Date('2026-10-31T08:00:00Z');
  let item = study.scheduleReview(null, question, false, now);
  assert.equal(item.intervalDays, 1); assert.equal(item.dueAt, '2026-11-01');
  item = study.scheduleReview(item, question, true, new Date('2026-11-01T08:00:00Z'));
  assert.equal(item.intervalDays, 1);
  item = study.scheduleReview(item, question, true, new Date('2026-11-02T08:00:00Z'));
  assert.equal(item.intervalDays, 3);
  item = study.scheduleReview(item, question, false, new Date('2026-11-05T08:00:00Z'));
  assert.equal(item.intervalDays, 1); assert.equal(item.correctStreak, 0);
});

test('subject and seven-day statistics only use recorded attempts', () => {
  const attempts = [
    { subject: '社會工作', examType: 'socialWorker', correct: true, at: '2026-10-31T02:00:00Z' },
    { subject: '社會工作', examType: 'socialWorker', correct: false, at: '2026-10-31T03:00:00Z' },
    { subject: '社會工作研究方法', examType: 'socialWorker', correct: true, at: '2026-10-30T03:00:00Z' },
  ];
  assert.deepEqual(study.subjectStats(attempts)[0], { subject: '社會工作', answered: 2, correct: 1, accuracy: 50 });
  assert.equal(study.lastSevenDays(attempts, new Date('2026-10-31T12:00:00Z')).at(-1).answered, 2);
});

test('mock grade honours officially accepted corrected answers', () => {
  const mock = { questionIds: ['q1'], answers: { q1: 'D' } };
  const result = study.gradeMock(mock, [{ ...question, acceptedAnswers: ['B', 'D'] }]);
  assert.equal(result.choiceScore, 1); assert.equal(result.choiceAccuracy, 100);
});
