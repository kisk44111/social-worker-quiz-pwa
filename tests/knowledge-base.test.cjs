const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadKnowledgeBase() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('knowledge-base.js', 'utf8'), context);
  return context.window.examKnowledgeBase;
}

test('知識庫卡片具備完整結構與可追溯來源', () => {
  const knowledge = loadKnowledgeBase();
  assert.ok(knowledge.cards.length >= 40);
  assert.ok(knowledge.sources.length >= 17);
  const sourceIds = new Set(knowledge.sources.map(item => item.id));
  for (const card of knowledge.cards) {
    assert.match(card.id, /^[a-z0-9-]+$/);
    assert.ok(['社會工作','人類行為與社會環境','社會工作直接服務','社會工作研究方法','社會政策與社會立法'].includes(card.subject));
    assert.ok(card.title && card.summary && card.domain);
    assert.ok(Array.isArray(card.points) && card.points.length >= 2);
    assert.ok(Array.isArray(card.exam) && card.exam.length >= 1);
    assert.ok(card.sourceIds.every(id => sourceIds.has(id)));
  }
});

test('知識庫涵蓋五大考科且不嵌入教材原始檔案內容', () => {
  const knowledge = loadKnowledgeBase();
  const subjects = new Set(knowledge.cards.map(card => card.subject));
  for (const subject of ['社會工作','人類行為與社會環境','社會工作直接服務','社會工作研究方法','社會政策與社會立法']) assert.ok(subjects.has(subject));
  const sourceFiles = knowledge.sources.map(source => source.file).join(' ');
  assert.doesNotMatch(sourceFiles, /\/Users\//);
  assert.match(knowledge.notice, /濃縮整理/);
});
