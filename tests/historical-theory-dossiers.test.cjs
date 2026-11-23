const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadTheoryData() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('historical-theory-dossiers.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('historical-related-concepts.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('historical-theory-content.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('historical-theory-primers.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('theory-completion.js', 'utf8'), context);
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

test('架構型理論有完整對照，且題庫缺漏理論均有可追溯的歷屆題連結', () => {
  const data = loadTheoryData();
  for (const [id, completion] of Object.entries(data.theoryArchitectureCompletions)) {
    assert.ok(completion.title && completion.items.length >= 2, `${id} 缺少完整架構對照`);
  }
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
  for (const dossier of data.additionalTheoryDossiers) {
    const count = questions.filter(question => dossier.directTerms.some(term => (question.prompt + ' ' + question.options.join(' ')).includes(term))).length;
    assert.ok(count > 0, `${dossier.theory} 未連回任何歷屆題`);
    assert.ok(dossier.content.length >= 20 && dossier.framework.length >= 3, `${dossier.theory} 內容不足`);
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

test('每份理論檔案都有可連貫閱讀的理論內容、運作機制與應用說明', () => {
  const { historicalTheoryDossiers: dossiers, historicalTheoryContent: contents } = loadTheoryData();
  for (const dossier of dossiers) {
    const content = contents[dossier.id];
    assert.ok(content?.claim?.length >= 35, `${dossier.id} 缺少核心主張說明`);
    assert.ok(content?.mechanism?.length >= 35, `${dossier.id} 缺少運作機制說明`);
    assert.ok(content?.practice?.length >= 35, `${dossier.id} 缺少實務／答題應用說明`);
  }
});

test('每份理論檔案都有適合初學者的歷史脈絡、白話導讀與例子', () => {
  const { historicalTheoryDossiers: dossiers, historicalTheoryPrimers: primers } = loadTheoryData();
  for (const dossier of dossiers) {
    const primer = primers[dossier.id];
    assert.ok(primer?.background?.length >= 35, `${dossier.id} 缺少歷史脈絡導讀`);
    assert.ok(primer?.plain?.length >= 45, `${dossier.id} 缺少白話核心說明`);
    assert.ok(primer?.example?.length >= 35, `${dossier.id} 缺少入門例子`);
  }
});
