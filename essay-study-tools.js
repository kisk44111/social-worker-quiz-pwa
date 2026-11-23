(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.essayStudyTools = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ESSAY_STAGES = [
    ['qi', '起', '破題與核心概念界定'],
    ['cheng', '承', '理論依據與法規政策剖析'],
    ['zhuan', '轉', '實務應用、困境與批判反思'],
    ['he', '合', '總結與具體建議展望']
  ];

  const SPEECH_RATES = [1, 1.25, 1.5];
  const PAUSE_MS = {
    HEADING: 450,
    SENTENCE: 280,
    CLAUSE: 140
  };
  const DEFAULT_CLAUSE_LIMIT = 58;
  const NEURAL_VOICE_PATTERN = /(natural|online|premium|enhanced|neural|進階|優質)/i;
  const TOP_NEURAL_PATTERN = /(natural|online|premium|neural|優質)/i;
  const TW_NAME_PATTERN = /(taiwan|臺灣|台灣|國語|meijia|美佳|hsiaochen|hsiaoyu|yunjhe|yating|han)/i;
  const CN_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  function numberToSpokenOrdinal(numText) {
    const n = Number(numText);
    if (Number.isInteger(n) && n >= 1 && n <= 10) return `第${CN_NUMS[n]}點，`;
    return `第${numText}點，`;
  }

  function cleanSpeechText(text) {
    let s = String(text || '');
    // Strip markdown formatting
    s = s
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '');

    // Remove trailing exam score annotations like （25 分） or (30分)
    s = s.replace(/[（(]\s*\d+\s*分\s*[)）]/g, '');

    // Remove pure Latin/English parentheticals (avoid robotic letter-by-letter spelling)
    s = s.replace(/[（(]\s*[A-Za-z0-9\s\-_/,.;:&+'"]+\s*[)）]/g, '');

    // Convert spoken Chinese list markers: （一）/(一)/一、 and （1）/(1)/1.
    s = s.replace(/(^|[\n。！？；：])\s*[（(]([一二三四五六七八九十])[)）]\s*/g, '$1第$2點，');
    s = s.replace(/(^|[\n。！？；：])\s*([一二三四五六七八九十])、\s*/g, '$1第$2點，');
    s = s.replace(/(^|[\n。！？；：])\s*[（(]([1-9]|10)[)）]\s*/g, (_, prefix, num) => `${prefix}${numberToSpokenOrdinal(num)}`);
    s = s.replace(/(^|[\n。！？；：])\s*([1-9]|10)[.、](?!\d)\s*/g, (_, prefix, num) => `${prefix}${numberToSpokenOrdinal(num)}`);

    // Convert remaining Chinese parentheticals into smooth spoken pauses instead of reading brackets
    s = s.replace(/[（(]([^（）()]+)[)）]/g, '，$1，');

    // Remove book/law/quote brackets that cause awkward pauses or spoken punctuation
    s = s.replace(/[《》〈〉「」『』【】\[\]]/g, '');

    // Smooth common symbols into natural Chinese transitions
    s = s
      .replace(/\bvs\.?\b/gi, '對照')
      .replace(/\s*[→➔➜]\s*/g, '，進而')
      .replace(/([\u4e00-\u9fff])\s*[／/]\s*([\u4e00-\u9fff])/g, '$1、$2')
      .replace(/[｜|]/g, '，')
      .replace(/[ \t]+/g, ' ');

    // Normalize line breaks and repeated punctuation while preserving paragraph breaks for prosody
    s = s
      .replace(/\r\n?/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/[，,]{2,}/g, '，')
      .replace(/([。！？；：])[，,、]+/g, '$1')
      .replace(/[，,、]+([。！？；：])/g, '$1')
      .replace(/^[\s，,、]+/gm, '')
      .replace(/[\s，,、]+$/gm, '')
      .trim();

    return s;
  }

  function splitLongClause(text, limit) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    if (trimmed.length <= limit) return [trimmed];

    const pieces = trimmed.match(/[^，、]+[，、]?/g) || [trimmed];
    const result = [];
    let current = '';

    for (const part of pieces) {
      const piece = part.trim();
      if (!piece) continue;
      if (piece.length > limit) {
        if (current) {
          result.push(current.trim());
          current = '';
        }
        for (let i = 0; i < piece.length; i += limit) {
          const slice = piece.slice(i, i + limit).trim();
          if (slice) result.push(slice);
        }
      } else if (!current) {
        current = piece;
      } else if (current.length + piece.length <= limit) {
        current += piece;
      } else {
        result.push(current.trim());
        current = piece;
      }
    }
    if (current) result.push(current.trim());
    return result;
  }

  function splitTextIntoProsodicItems(text, maxClauseChars) {
    const limit = Number.isInteger(maxClauseChars) && maxClauseChars >= 24 ? maxClauseChars : DEFAULT_CLAUSE_LIMIT;
    const cleaned = cleanSpeechText(text);
    if (!cleaned) return [];

    const items = [];
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const sentences = line.match(/[^。！？]+[。！？]?/g) || [line];
      for (const rawSentence of sentences) {
        const sentence = rawSentence.trim();
        if (!sentence) continue;

        // Split on semicolons and colons for short breathing pauses (~140ms)
        const clauseMatches = sentence.match(/[^；：]+[；：]?/g) || [sentence];
        const expanded = [];
        for (let c = 0; c < clauseMatches.length; c++) {
          const clause = clauseMatches[c].trim();
          if (!clause) continue;
          const isLastClauseOfSentence = c === clauseMatches.length - 1;
          const subPieces = splitLongClause(clause, limit);
          for (let p = 0; p < subPieces.length; p++) {
            const isFinal = isLastClauseOfSentence && p === subPieces.length - 1;
            expanded.push({
              text: subPieces[p],
              kind: isFinal ? 'sentence' : 'clause',
              pauseAfterMs: isFinal ? PAUSE_MS.SENTENCE : PAUSE_MS.CLAUSE
            });
          }
        }
        for (const item of expanded) items.push(item);
      }
    }

    return items;
  }

  function splitTextIntoChunks(text, maxChars) {
    return splitTextIntoProsodicItems(text, maxChars).map(item => item.text);
  }

  function buildEssaySpeechSegments(question) {
    if (!question) return [];
    const segments = [];
    const prompt = cleanSpeechText(question.prompt);
    if (prompt) {
      segments.push({
        key: 'prompt',
        label: '題目',
        heading: '題目',
        body: prompt,
        text: `題目。${prompt}`
      });
    }

    const model = question.essayGuide && question.essayGuide.modelAnswer;
    if (model) {
      for (const [key, badge, fallbackTitle] of ESSAY_STAGES) {
        const part = model[key] || {};
        const heading = cleanSpeechText(part.title || fallbackTitle);
        const body = cleanSpeechText(part.content || '');
        if (body) {
          segments.push({
            key,
            label: `${badge}｜${heading}`,
            heading: `${badge}，${heading}`,
            body,
            text: `${badge}，${heading}。${body}`
          });
        }
      }
    } else {
      const legacy = cleanSpeechText(question.referenceAnswer || question.explanation || '');
      if (legacy) {
        segments.push({
          key: 'legacy',
          label: '參考擬答',
          heading: '參考擬答',
          body: legacy,
          text: `參考擬答。${legacy}`
        });
      }
    }

    const theories = question.essayGuide && question.essayGuide.analysis && Array.isArray(question.essayGuide.analysis.theoriesAndLaws)
      ? question.essayGuide.analysis.theoriesAndLaws.map(cleanSpeechText).filter(Boolean)
      : [];
    if (theories.length) {
      const items = theories.map((item, idx) => `第${idx + 1}項，${item}`);
      segments.push({
        key: 'theories',
        label: '核心理論與法規清單',
        heading: '核心理論與法規清單',
        listItems: items,
        body: `${items.join('。')}。`,
        text: `核心理論與法規清單。${items.join('。')}。`
      });
    }

    return segments;
  }

  function buildEssaySpeechQueue(question, maxClauseChars) {
    const segments = buildEssaySpeechSegments(question);
    const queue = [];

    for (const seg of segments) {
      if (seg.heading) {
        queue.push({
          segmentKey: seg.key,
          label: seg.label,
          text: seg.heading,
          kind: 'heading',
          pauseAfterMs: PAUSE_MS.HEADING
        });
      }

      if (Array.isArray(seg.listItems) && seg.listItems.length) {
        for (let i = 0; i < seg.listItems.length; i++) {
          const sub = splitTextIntoProsodicItems(seg.listItems[i], maxClauseChars);
          for (let j = 0; j < sub.length; j++) {
            const isLastOfList = i === seg.listItems.length - 1 && j === sub.length - 1;
            queue.push({
              segmentKey: seg.key,
              label: seg.label,
              text: sub[j].text,
              kind: sub[j].kind,
              pauseAfterMs: isLastOfList ? PAUSE_MS.HEADING : sub[j].pauseAfterMs
            });
          }
        }
      } else {
        const items = splitTextIntoProsodicItems(seg.body || seg.text, maxClauseChars);
        for (let i = 0; i < items.length; i++) {
          const isLastOfSegment = i === items.length - 1;
          queue.push({
            segmentKey: seg.key,
            label: seg.label,
            text: items[i].text,
            kind: items[i].kind,
            pauseAfterMs: isLastOfSegment ? PAUSE_MS.HEADING : items[i].pauseAfterMs
          });
        }
      }
    }

    return queue;
  }

  function effectivePauseMs(basePauseMs, rate) {
    const base = Number(basePauseMs);
    if (!Number.isFinite(base) || base <= 0) return 0;
    const r = normaliseSpeechRate(rate);
    return Math.round(base / Math.sqrt(r));
  }

  function isNeuralVoice(voice) {
    return Boolean(voice && NEURAL_VOICE_PATTERN.test(String(voice.name || '')));
  }

  function scoreVoice(voice) {
    if (!voice) return -1;
    const lang = String(voice.lang || '').replace(/_/g, '-').toLowerCase();
    const name = String(voice.name || '');
    const isTwName = TW_NAME_PATTERN.test(name);
    const isZhLang = lang.startsWith('zh');
    if (!isZhLang && !/chinese|中文|國語|華語|粵語|普通話/i.test(name)) {
      return -1;
    }

    let score = 0;
    if (lang === 'zh-tw' || lang === 'zh-hant-tw') {
      score = 100;
    } else if (lang.startsWith('zh-hant')) {
      score = 75;
    } else if (isZhLang && isTwName) {
      score = 65;
    } else if (isZhLang) {
      score = 30;
    } else {
      score = 20;
    }

    // Highest priority boost for Natural / Online / Premium / Enhanced / Neural voices
    if (NEURAL_VOICE_PATTERN.test(name)) {
      score += 50;
      if (TOP_NEURAL_PATTERN.test(name)) score += 12;
      else score += 8;
    }

    if (isTwName) score += 6;
    if (/google|meijia|美佳|hsiaochen|yunjhe/i.test(name)) score += 3;
    if (voice.localService && !/online/i.test(name)) score += 1;
    return score;
  }

  function listChineseVoices(voices) {
    if (!Array.isArray(voices) || !voices.length) return [];
    const seen = new Set();
    const scored = [];
    for (const voice of voices) {
      const score = scoreVoice(voice);
      if (score < 0) continue;
      const key = `${voice.voiceURI || voice.name || ''}::${voice.lang || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push({ voice, score });
    }
    scored.sort((a, b) => b.score - a.score || String(a.voice.name || '').localeCompare(String(b.voice.name || '')));
    return scored.map(item => item.voice);
  }

  function pickPreferredZhTwVoice(voices) {
    const ranked = listChineseVoices(voices);
    return ranked.length ? ranked[0] : null;
  }

  function resolveSelectedVoice(voices, preferredVoiceName) {
    const ranked = listChineseVoices(voices);
    if (!ranked.length) return null;
    if (preferredVoiceName) {
      const exact = ranked.find(v => v.name === preferredVoiceName || v.voiceURI === preferredVoiceName);
      if (exact) return exact;
    }
    return ranked[0];
  }

  function formatVoiceOptionLabel(voice) {
    if (!voice) return '';
    const star = isNeuralVoice(voice) ? '★ ' : '';
    const lang = voice.lang ? ` [${voice.lang}]` : '';
    return `${star}${voice.name || '系統語音'}${lang}`;
  }

  function recommendedVoicePitch(voice) {
    return isNeuralVoice(voice) ? 1.0 : 0.98;
  }

  function findNextEssayIndex(list, currentIndex) {
    if (!Array.isArray(list) || !list.length) return -1;
    const start = Number.isInteger(currentIndex) ? currentIndex + 1 : 0;
    for (let i = Math.max(0, start); i < list.length; i++) {
      if (list[i] && list[i].type === 'essay') return i;
    }
    return -1;
  }

  function findPrevEssayIndex(list, currentIndex) {
    if (!Array.isArray(list) || !list.length) return -1;
    const start = Number.isInteger(currentIndex) ? currentIndex - 1 : list.length - 1;
    for (let i = Math.min(list.length - 1, start); i >= 0; i--) {
      if (list[i] && list[i].type === 'essay') return i;
    }
    return -1;
  }

  function essayPositionInfo(list, currentIndex) {
    if (!Array.isArray(list) || !list.length) {
      return { position: 0, total: 0, prevIndex: -1, nextIndex: -1 };
    }
    const indices = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].type === 'essay') indices.push(i);
    }
    const pos = indices.indexOf(currentIndex);
    return {
      position: pos >= 0 ? pos + 1 : 0,
      total: indices.length,
      prevIndex: findPrevEssayIndex(list, currentIndex),
      nextIndex: findNextEssayIndex(list, currentIndex)
    };
  }

  function normaliseSpeechRate(rate) {
    const num = Number(rate);
    return SPEECH_RATES.includes(num) ? num : 1;
  }

  function toggleRevealedStage(revealed, stageKey) {
    const next = new Set(revealed instanceof Set ? revealed : Array.isArray(revealed) ? revealed : []);
    if (!stageKey) return next;
    if (next.has(stageKey)) next.delete(stageKey);
    else next.add(stageKey);
    return next;
  }

  return {
    ESSAY_STAGES,
    SPEECH_RATES,
    PAUSE_MS,
    cleanSpeechText,
    splitTextIntoProsodicItems,
    splitTextIntoChunks,
    buildEssaySpeechSegments,
    buildEssaySpeechQueue,
    effectivePauseMs,
    isNeuralVoice,
    scoreVoice,
    listChineseVoices,
    pickPreferredZhTwVoice,
    resolveSelectedVoice,
    formatVoiceOptionLabel,
    recommendedVoicePitch,
    findNextEssayIndex,
    findPrevEssayIndex,
    essayPositionInfo,
    normaliseSpeechRate,
    toggleRevealedStage
  };
}));
