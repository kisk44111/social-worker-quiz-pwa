const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../essay-study-tools.js');

const sampleEssay = {
  id: '2026-1-0301-E1',
  type: 'essay',
  prompt: '試論述《兒童及少年福利與權益保障法》下**優勢觀點（Strengths Perspective）**在脆弱家庭服務中的應用。（25 分）',
  essayGuide: {
    modelAnswer: {
      qi: { title: '破題與核心概念界定', content: '**優勢觀點（Strengths Perspective）**強調看見家庭韌性（含非正式支持）。' },
      cheng: {
        title: '理論依據與法規政策剖析',
        content: '依據《強化社會安全網計畫》：\n1. 重視家庭能力；結合社區支持。\n2. 採公／私協力 vs. 單一處遇，促成復原 → 自立。'
      },
      zhuan: { title: '實務應用與批判反思', content: '（一）實務上須兼顧風險控管，避免忽略安全底線。' },
      he: { title: '總結與展望', content: '綜上，透過賦能合作協助家庭復原。' }
    },
    analysis: {
      focusAndTraps: ['避免只談正向忽略風險評估'],
      theoriesAndLaws: ['優勢觀點（Strengths Perspective）', '《強化社會安全網第二期計畫》'],
      scoringRubric: ['【起】15%']
    }
  }
};

test('cleanSpeechText normalizes book brackets, English parentheticals, list markers, and symbols for natural Chinese TTS', () => {
  const cleanedPrompt = tools.cleanSpeechText(sampleEssay.prompt);
  assert.ok(!cleanedPrompt.includes('《') && !cleanedPrompt.includes('》'));
  assert.ok(!cleanedPrompt.includes('**'));
  assert.ok(!cleanedPrompt.includes('Strengths Perspective'));
  assert.ok(!cleanedPrompt.includes('25 分'));
  assert.ok(cleanedPrompt.includes('優勢觀點'));

  const cleanedQi = tools.cleanSpeechText(sampleEssay.essayGuide.modelAnswer.qi.content);
  assert.ok(!cleanedQi.includes('（') && !cleanedQi.includes('）'));
  assert.ok(cleanedQi.includes('含非正式支持'));

  const cleanedCheng = tools.cleanSpeechText(sampleEssay.essayGuide.modelAnswer.cheng.content);
  assert.ok(cleanedCheng.includes('第一點，重視家庭能力'));
  assert.ok(cleanedCheng.includes('第二點，採公、私協力'));
  assert.ok(cleanedCheng.includes('對照'));
  assert.ok(cleanedCheng.includes('進而自立'));

  const cleanedZhuan = tools.cleanSpeechText(sampleEssay.essayGuide.modelAnswer.zhuan.content);
  assert.ok(cleanedZhuan.startsWith('第一點，實務上須兼顧風險控管'));
});

test('buildEssaySpeechSegments follows prompt -> qi -> cheng -> zhuan -> he -> theories order', () => {
  const segments = tools.buildEssaySpeechSegments(sampleEssay);
  assert.deepEqual(
    segments.map(s => s.key),
    ['prompt', 'qi', 'cheng', 'zhuan', 'he', 'theories']
  );
  assert.ok(segments[5].text.includes('第1項，優勢觀點'));
  assert.ok(segments[5].text.includes('第2項，強化社會安全網第二期計畫'));
});

test('buildEssaySpeechQueue produces layered prosodic pauses for headings, sentences, and clauses', () => {
  const queue = tools.buildEssaySpeechQueue(sampleEssay, 50);
  const headingItem = queue.find(item => item.segmentKey === 'qi' && item.kind === 'heading');
  assert.ok(headingItem, 'stage heading should be emitted as its own prosodic utterance');
  assert.equal(headingItem.pauseAfterMs, tools.PAUSE_MS.HEADING);

  const chengItems = queue.filter(item => item.segmentKey === 'cheng' && item.kind !== 'heading');
  assert.ok(chengItems.some(item => item.kind === 'clause' && item.pauseAfterMs === tools.PAUSE_MS.CLAUSE));
  assert.ok(chengItems.some(item => item.kind === 'sentence' && item.pauseAfterMs === tools.PAUSE_MS.SENTENCE));
  assert.equal(chengItems[chengItems.length - 1].pauseAfterMs, tools.PAUSE_MS.HEADING);

  assert.equal(tools.effectivePauseMs(450, 1), 450);
  assert.ok(tools.effectivePauseMs(450, 1.5) < 450 && tools.effectivePauseMs(450, 1.5) > 300);
});

test('buildEssaySpeechQueue splits long stage text into short TTS-safe utterances preserving segmentKey', () => {
  const longText = `${'這是一段用來測試長篇申論擬答分句切塊的範例文字，確保在各種瀏覽器語音引擎下都不會發生逾時中斷。'.repeat(5)}`;
  const essay = {
    id: 'long-1',
    type: 'essay',
    prompt: '測試長題幹。',
    essayGuide: {
      modelAnswer: {
        qi: { title: '起段', content: longText },
        cheng: { title: '承段', content: '短文。' },
        zhuan: { title: '轉段', content: '短文。' },
        he: { title: '合段', content: '短文。' }
      },
      analysis: { theoriesAndLaws: ['測試理論'] }
    }
  };
  const queue = tools.buildEssaySpeechQueue(essay, 50);
  const qiBody = queue.filter(item => item.segmentKey === 'qi' && item.kind !== 'heading');
  assert.ok(qiBody.length >= 5, 'long stage should be broken into natural short phrases');
  assert.ok(qiBody.every(item => item.text.length <= 50));
});

test('pickPreferredZhTwVoice and listChineseVoices prioritize Natural/Premium/Enhanced zh-TW voices', () => {
  const voices = [
    { name: 'English US', lang: 'en-US', localService: true },
    { name: 'Tingting (Enhanced)', lang: 'zh-CN', localService: true },
    { name: 'Meijia', lang: 'zh-TW', localService: true },
    { name: 'Microsoft Yating - Chinese (Traditional, Taiwan)', lang: 'zh-TW', localService: true },
    { name: 'Meijia (Premium)', lang: 'zh-TW', localService: true },
    { name: 'Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)', lang: 'zh-TW', localService: false }
  ];
  const ranked = tools.listChineseVoices(voices);
  assert.equal(ranked.length, 5, 'non-Chinese voices should be excluded');
  assert.ok(tools.isNeuralVoice(ranked[0]));
  assert.ok(tools.isNeuralVoice(ranked[1]));
  assert.equal(ranked[0].lang, 'zh-TW');
  assert.equal(ranked[1].lang, 'zh-TW');
  assert.ok(tools.formatVoiceOptionLabel(ranked[0]).startsWith('★ '));

  const appleVoices = [
    { name: 'Meijia', lang: 'zh-TW', localService: true },
    { name: '美佳（進階版）', lang: 'zh-TW', localService: true }
  ];
  assert.equal(tools.pickPreferredZhTwVoice(appleVoices).name, '美佳（進階版）');

  assert.equal(tools.recommendedVoicePitch(ranked[0]), 1.0);
  assert.equal(tools.recommendedVoicePitch({ name: 'Meijia', lang: 'zh-TW' }), 0.98);
});

test('resolveSelectedVoice honors saved user voice preference and falls back safely', () => {
  const voices = [
    { name: 'Meijia', lang: 'zh-TW', voiceURI: 'Meijia' },
    { name: 'Microsoft HsiaoChen Online (Natural)', lang: 'zh-TW', voiceURI: 'HsiaoChen' }
  ];
  assert.equal(tools.resolveSelectedVoice(voices, 'Meijia').name, 'Meijia');
  assert.equal(tools.resolveSelectedVoice(voices, 'NonExistentVoice').name, 'Microsoft HsiaoChen Online (Natural)');
  assert.equal(tools.resolveSelectedVoice(voices, '').name, 'Microsoft HsiaoChen Online (Natural)');
});

test('findNextEssayIndex and essayPositionInfo navigate essay items across mixed filtered lists', () => {
  const mixed = [
    { id: 'm1', type: 'multipleChoice' },
    { id: 'e1', type: 'essay' },
    { id: 'm2', type: 'multipleChoice' },
    { id: 'e2', type: 'essay' },
    { id: 'e3', type: 'essay' }
  ];
  assert.equal(tools.findNextEssayIndex(mixed, 1), 3);
  assert.equal(tools.findNextEssayIndex(mixed, 3), 4);
  assert.equal(tools.findNextEssayIndex(mixed, 4), -1);
  assert.deepEqual(tools.essayPositionInfo(mixed, 3), {
    position: 2,
    total: 3,
    prevIndex: 1,
    nextIndex: 4
  });
});

test('toggleRevealedStage and normaliseSpeechRate handle blind recall and speed bounds safely', () => {
  let set = new Set();
  set = tools.toggleRevealedStage(set, 'qi');
  assert.ok(set.has('qi'));
  assert.equal(set.size, 1);
  set = tools.toggleRevealedStage(set, 'cheng');
  assert.ok(set.has('qi') && set.has('cheng'));
  set = tools.toggleRevealedStage(set, 'qi');
  assert.ok(!set.has('qi') && set.has('cheng'));

  assert.equal(tools.normaliseSpeechRate(1.25), 1.25);
  assert.equal(tools.normaliseSpeechRate(1.5), 1.5);
  assert.equal(tools.normaliseSpeechRate(2.5), 1);
  assert.equal(tools.normaliseSpeechRate('invalid'), 1);
});
