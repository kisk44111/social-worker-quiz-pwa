const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../essay-study-tools.js');

const sampleEssay = {
  id: '2026-1-0301-E1',
  type: 'essay',
  prompt: '試論述**優勢觀點**在脆弱家庭服務中的應用。',
  essayGuide: {
    modelAnswer: {
      qi: { title: '破題與核心概念界定', content: '**優勢觀點**強調看見家庭韌性。' },
      cheng: { title: '理論依據與法規政策剖析', content: '依強化社會安全網計畫。\n- 重視家庭能力\n- 結合社區支持' },
      zhuan: { title: '實務應用與批判反思', content: '實務上須兼顧風險控管，避免忽略安全底線。' },
      he: { title: '總結與展望', content: '綜上，透過賦能合作協助家庭復原。' }
    },
    analysis: {
      focusAndTraps: ['避免只談正向忽略風險評估'],
      theoriesAndLaws: ['優勢觀點（Strengths Perspective）', '強化社會安全網第二期計畫'],
      scoringRubric: ['【起】15%']
    }
  }
};

test('buildEssaySpeechSegments follows prompt -> qi -> cheng -> zhuan -> he -> theories order and strips markdown', () => {
  const segments = tools.buildEssaySpeechSegments(sampleEssay);
  assert.deepEqual(
    segments.map(s => s.key),
    ['prompt', 'qi', 'cheng', 'zhuan', 'he', 'theories']
  );
  assert.ok(!segments[0].text.includes('**'));
  assert.ok(segments[0].text.includes('優勢觀點'));
  assert.ok(segments[5].text.includes('第1項，優勢觀點'));
  assert.ok(segments[5].text.includes('第2項，強化社會安全網第二期計畫'));
});

test('buildEssaySpeechQueue splits long stage text into TTS-safe chunks preserving segmentKey', () => {
  const longText = `${'這是一段用來測試長篇申論擬答分句切塊的範例文字，確保在各種瀏覽器語音引擎下都不會發生逾時中斷。'.repeat(6)}`;
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
  const queue = tools.buildEssaySpeechQueue(essay, 100);
  const qiChunks = queue.filter(item => item.segmentKey === 'qi');
  assert.ok(qiChunks.length >= 3, 'long stage should be split into multiple chunks');
  assert.ok(qiChunks.every(item => item.text.length <= 100));
});

test('pickPreferredZhTwVoice prioritizes zh-TW over other Chinese and non-Chinese voices', () => {
  const voices = [
    { name: 'English US', lang: 'en-US', localService: true },
    { name: 'Chinese Mainland', lang: 'zh-CN', localService: true },
    { name: 'Google 國語（臺灣）', lang: 'zh-TW', localService: false },
    { name: 'Hong Kong', lang: 'zh-HK', localService: true }
  ];
  const picked = tools.pickPreferredZhTwVoice(voices);
  assert.equal(picked.lang, 'zh-TW');
  assert.equal(tools.pickPreferredZhTwVoice([{ name: 'English', lang: 'en-US' }]), null);
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
