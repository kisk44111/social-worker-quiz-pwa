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
  const DEFAULT_CHUNK_LIMIT = 160;

  function cleanSpeechText(text) {
    return String(text || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '。')
      .replace(/\n/g, '，')
      .replace(/([。！？；])[，。]+/g, '$1')
      .trim();
  }

  function splitTextIntoChunks(text, maxChars) {
    const limit = Number.isInteger(maxChars) && maxChars >= 40 ? maxChars : DEFAULT_CHUNK_LIMIT;
    const cleaned = cleanSpeechText(text);
    if (!cleaned) return [];
    if (cleaned.length <= limit) return [cleaned];

    const sentences = cleaned.match(/[^。！？；]+[。！？；]?/g) || [cleaned];
    const chunks = [];
    let current = '';

    const pushPiece = (piece) => {
      if (!piece) return;
      if (piece.length <= limit) {
        if (!current) {
          current = piece;
        } else if (current.length + piece.length <= limit) {
          current += piece;
        } else {
          chunks.push(current.trim());
          current = piece;
        }
        return;
      }
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      const subParts = piece.match(/[^，、：]+[，、：]?/g) || [piece];
      let sub = '';
      for (const part of subParts) {
        if (part.length > limit) {
          if (sub) {
            chunks.push(sub.trim());
            sub = '';
          }
          for (let i = 0; i < part.length; i += limit) {
            chunks.push(part.slice(i, i + limit).trim());
          }
        } else if (!sub) {
          sub = part;
        } else if (sub.length + part.length <= limit) {
          sub += part;
        } else {
          chunks.push(sub.trim());
          sub = part;
        }
      }
      if (sub) chunks.push(sub.trim());
    };

    for (const sentence of sentences) {
      pushPiece(sentence.trim());
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  function buildEssaySpeechSegments(question) {
    if (!question) return [];
    const segments = [];
    const prompt = cleanSpeechText(question.prompt);
    if (prompt) {
      segments.push({
        key: 'prompt',
        label: '題目',
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
          text: `參考擬答。${legacy}`
        });
      }
    }

    const theories = question.essayGuide && question.essayGuide.analysis && Array.isArray(question.essayGuide.analysis.theoriesAndLaws)
      ? question.essayGuide.analysis.theoriesAndLaws.map(cleanSpeechText).filter(Boolean)
      : [];
    if (theories.length) {
      const itemsText = theories.map((item, idx) => `第${idx + 1}項，${item}`).join('。');
      segments.push({
        key: 'theories',
        label: '核心理論與法規清單',
        text: `核心理論與法規清單。${itemsText}。`
      });
    }

    return segments;
  }

  function buildEssaySpeechQueue(question, maxChars) {
    const segments = buildEssaySpeechSegments(question);
    const queue = [];
    for (const seg of segments) {
      const parts = splitTextIntoChunks(seg.text, maxChars);
      for (const text of parts) {
        queue.push({
          segmentKey: seg.key,
          label: seg.label,
          text
        });
      }
    }
    return queue;
  }

  function scoreVoice(voice) {
    if (!voice) return -1;
    const lang = String(voice.lang || '').replace(/_/g, '-').toLowerCase();
    const name = String(voice.name || '');
    const isTwName = /taiwan|臺灣|台灣|國語|meijia|美佳|hsiaochen|yunjhe|yating|han/i.test(name);
    let score = 0;

    if (lang === 'zh-tw' || lang === 'zh-hant-tw') {
      score = 100;
    } else if (lang.startsWith('zh-hant')) {
      score = 80;
    } else if (lang.startsWith('zh') && isTwName) {
      score = 70;
    } else if (lang.startsWith('zh')) {
      score = 40;
    } else {
      return -1;
    }

    if (isTwName) score += 10;
    if (/natural|premium|enhanced|google|meijia|美佳/i.test(name)) score += 6;
    if (voice.localService) score += 3;
    return score;
  }

  function pickPreferredZhTwVoice(voices) {
    if (!Array.isArray(voices) || !voices.length) return null;
    let best = null;
    let bestScore = -1;
    for (const voice of voices) {
      const score = scoreVoice(voice);
      if (score > bestScore) {
        bestScore = score;
        best = voice;
      }
    }
    return bestScore >= 0 ? best : null;
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
    cleanSpeechText,
    splitTextIntoChunks,
    buildEssaySpeechSegments,
    buildEssaySpeechQueue,
    pickPreferredZhTwVoice,
    findNextEssayIndex,
    findPrevEssayIndex,
    essayPositionInfo,
    normaliseSpeechRate,
    toggleRevealedStage
  };
}));
