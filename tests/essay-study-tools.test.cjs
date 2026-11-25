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
  assert.equal(tools.normaliseSpeechRate(1.75), 1.75);
  assert.equal(tools.normaliseSpeechRate(2.5), 1);
  assert.equal(tools.normaliseSpeechRate('invalid'), 1);
});

test('formatEssayForNaturalAudio produces conversational script without raw brackets or markdown while keeping exam terms', () => {
  const script = tools.formatEssayForNaturalAudio({
    ...sampleEssay,
    year: 2026,
    session: 1,
    subject: '社會工作'
  });
  assert.ok(script.includes('2026年第1次社會工作申論題考前導讀'));
  assert.ok(script.includes('這題在考的核心概念是'));
  assert.ok(script.includes('在理論與法規面向上'));
  assert.ok(script.includes('回到台灣第一線社工實務現場來看'));
  assert.ok(script.includes('最後在結論收尾時'));
  assert.ok(script.includes('考前快速複習這題一定要帶到的核心理論與法規關鍵字'));
  assert.ok(script.includes('兒童及少年福利與權益保障法'));
  assert.ok(script.includes('優勢觀點'));
  assert.ok(script.includes('強化社會安全網第二期計畫'));
  assert.ok(!/[《》【】「」『』()（）*#]/.test(script), 'raw brackets and markdown symbols should be removed');
});

test('buildSubjectNaturalAudioExport and buildNaturalAudioFilename package multiple essays cleanly for NotebookLM', () => {
  const list = [
    { ...sampleEssay, id: 'e1', year: 2026, session: 1, subject: '社會工作' },
    { id: 'm1', type: 'multipleChoice', subject: '社會工作', prompt: '忽略選擇題' },
    {
      id: 'e2',
      type: 'essay',
      year: 2026,
      session: 2,
      subject: '社會工作',
      prompt: '試述任務中心取向。',
      referenceAnswer: '強調短期與具體任務。'
    }
  ];
  const exported = tools.buildSubjectNaturalAudioExport(list, '社會工作', '社工師考試');
  assert.ok(exported.includes('社工師考試｜社會工作 申論題自然口語導讀講稿（共 2 題）'));
  assert.ok(exported.includes('NotebookLM'));
  assert.ok(exported.includes('第 1 題講稿'));
  assert.ok(exported.includes('第 2 題講稿'));
  assert.ok(!exported.includes('忽略選擇題'));
  assert.equal(tools.buildNaturalAudioFilename('社會工作', 24), '社工師口語講稿-社會工作-24題.txt');
});

test('buildNotebookLmPodcastPrompt and shouldSkipSpeechPause support NotebookLM launch and background TTS resilience', () => {
  const prompt = tools.buildNotebookLmPodcastPrompt('社會工作研究方法', '專技社工師');
  assert.ok(prompt.includes('專技社工師'));
  assert.ok(prompt.includes('社會工作研究方法'));
  assert.ok(prompt.includes('起・承・轉・合'));
  assert.ok(prompt.includes('台灣資深社工督導'));

  assert.equal(tools.shouldSkipSpeechPause('hidden'), true);
  assert.equal(tools.shouldSkipSpeechPause('visible'), false);
});

test('extractDriveFileId, buildDriveAudioUrls, resolveEssayAudioEntry, formatAudioTime, and clampSeekTime support Drive MP3 playback', () => {
  assert.equal(
    tools.extractDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr_12/view?usp=sharing'),
    '1AbCdEfGhIjKlMnOpQr_12'
  );
  assert.equal(
    tools.extractDriveFileId('https://drive.google.com/open?id=1ZyXwVuTsRqPoNmLkJi_34'),
    '1ZyXwVuTsRqPoNmLkJi_34'
  );
  assert.equal(tools.extractDriveFileId('1AbCdEfGhIjKlMnOpQr_12'), '1AbCdEfGhIjKlMnOpQr_12');
  assert.equal(tools.extractDriveFileId(''), '');
  assert.equal(tools.extractDriveFileId('short'), '');

  const urls = tools.buildDriveAudioUrls('1AbCdEfGhIjKlMnOpQr_12');
  assert.equal(urls.length, 3);
  assert.equal(urls[0], 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQr_12');
  assert.equal(urls[1], 'https://docs.google.com/uc?export=open&id=1AbCdEfGhIjKlMnOpQr_12');

  const apiUrls = tools.buildDriveAudioUrls('1AbCdEfGhIjKlMnOpQr_12', 'AIzaTestKey123456');
  assert.equal(apiUrls.length, 4);
  assert.equal(apiUrls[0], 'https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOpQr_12?alt=media&key=AIzaTestKey123456');

  const manifest = {
    version: 1,
    driveApiKey: 'AIzaManifestKey999',
    items: {
      '2021-1-0401-E1': {
        directUrl: 'https://github.com/kisk44111/social-worker-quiz-pwa/releases/download/audio-v1/01-01.mp3',
        fileId: '1AbCdEfGhIjKlMnOpQr_12',
        title: '01-任務中心取向',
        subject: '社會工作'
      },
      '2021-1-0401-E2': { fileId: '1ZyXwVuTsRqPoNmLkJi_34', title: '02-新住民', subject: '社會工作' },
      '2021-1-0401-E3': { fileId: '', title: '03-未綁定', subject: '社會工作' }
    }
  };
  const resolvedCdn = tools.resolveEssayAudioEntry(manifest, '2021-1-0401-E1');
  assert.ok(resolvedCdn);
  assert.equal(resolvedCdn.sourceKind, 'cdn');
  assert.equal(resolvedCdn.urls[0], 'https://github.com/kisk44111/social-worker-quiz-pwa/releases/download/audio-v1/01-01.mp3');
  assert.equal(resolvedCdn.urls[1], 'https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOpQr_12?alt=media&key=AIzaManifestKey999');

  const resolvedApi = tools.resolveEssayAudioEntry(manifest, '2021-1-0401-E2');
  assert.ok(resolvedApi);
  assert.equal(resolvedApi.sourceKind, 'driveApi');
  assert.equal(resolvedApi.urls[0], 'https://www.googleapis.com/drive/v3/files/1ZyXwVuTsRqPoNmLkJi_34?alt=media&key=AIzaManifestKey999');

  assert.equal(tools.resolveEssayAudioEntry(manifest, '2021-1-0401-E3'), null);
  assert.equal(tools.resolveEssayAudioEntry(manifest, 'missing-id'), null);

  assert.equal(tools.formatAudioTime(0), '0:00');
  assert.equal(tools.formatAudioTime(65.9), '1:05');
  assert.equal(tools.formatAudioTime(378), '6:18');
  assert.equal(tools.formatAudioTime(NaN), '0:00');

  assert.equal(tools.clampSeekTime(10, -15, 300), 0);
  assert.equal(tools.clampSeekTime(295, 15, 300), 300);
  assert.equal(tools.clampSeekTime(60, 15, 300), 75);
});
