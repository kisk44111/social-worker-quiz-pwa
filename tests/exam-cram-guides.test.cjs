const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGuides() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('exam-cram-guides.js', 'utf8'), context);
  return context.window.examCramGuides;
}

test('五科考前大補帖含精讀、工作方法、混淆與申論提示', () => {
  const guides = loadGuides();
  const subjects = ['社會工作','人類行為與社會環境','社會工作直接服務','社會工作研究方法','社會政策與社會立法'];
  assert.deepEqual(Array.from(guides, guide => guide.subject), subjects);
  for (const guide of guides) {
    assert.ok(guide.focus && guide.writing);
    assert.ok(guide.sections.length >= 5);
    for (const section of guide.sections) {
      assert.ok(section.title && section.terms.length >= 3);
      assert.ok(section.concept.length >= 1 && section.method.length >= 2);
      assert.ok(section.confusions.length >= 1 && section.essay);
      assert.ok(section.sourceIds.length >= 1);
    }
  }
});

test('每個大補帖單元均可用核心術語於同科歷屆題中找到練習入口', () => {
  const guides = loadGuides();
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
  for (const guide of guides) {
    for (const section of guide.sections) {
      const count = questions.filter(question => question.subject === guide.subject && section.terms.some(term => term !== guide.subject && term.length >= 2 && question.prompt.includes(term))).length;
      assert.ok(count > 0, `${guide.subject}／${section.title} 未連到歷屆題`);
    }
  }
});
