const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadTheoryData() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('historical-theory-dossiers.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('historical-related-concepts.js', 'utf8'), context);
  return context.window;
}

test('歷屆學者理論檔案具備完整精讀結構', () => {
  const dossiers = loadTheoryData().historicalTheoryDossiers;
  assert.ok(dossiers.length >= 20);
  for (const dossier of dossiers) {
    assert.ok(dossier.id && dossier.scholar && dossier.theory && dossier.history && dossier.status);
    assert.ok(dossier.framework.length >= 1 && dossier.points.length >= 1 && dossier.traps.length >= 1);
    assert.ok(dossier.terms.length >= 2);
  }
});

test('每份學者理論檔案都能連回至少一題實際歷屆試題', () => {
  const dossiers = loadTheoryData().historicalTheoryDossiers;
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
  for (const dossier of dossiers) {
    const scholarTerms = dossier.terms.filter(term => /[A-Za-z]/.test(term));
    assert.ok(scholarTerms.length >= 1, `${dossier.id} 缺少可精準比對的具名學者`);
    const count = questions.filter(question => (question.prompt + ' ' + question.options.join(' ')).split('').length && scholarTerms.some(term => (question.prompt + ' ' + question.options.join(' ')).includes(term))).length;
    assert.ok(count > 0, `${dossier.scholar}／${dossier.theory} 未連回歷屆題`);
  }
});

test('每份理論檔案都有可說明的相關概念延伸題，且不混入具名學者原題', () => {
  const { historicalTheoryDossiers: dossiers, historicalTheoryConceptLinks: links } = loadTheoryData();
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
  for (const dossier of dossiers) {
    const link = links[dossier.id];
    assert.ok(link?.explanation && link.terms?.length, `${dossier.id} 缺少概念延伸說明`);
    const scholarTerms = dossier.terms.filter(term => /[A-Za-z]/.test(term));
    const count = questions.filter(question => {
      const text = question.prompt + ' ' + question.options.join(' ');
      return question.subject === dossier.subject && !scholarTerms.some(term => text.includes(term)) && link.terms.some(term => text.includes(term));
    }).length;
    assert.ok(count > 0, `${dossier.theory} 未連回概念延伸題`);
  }
});
