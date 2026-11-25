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

  const SPEECH_RATES = [1, 1.25, 1.5, 1.75];
  const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
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

  function toConversationalParagraph(text) {
    const cleaned = cleanSpeechText(text);
    if (!cleaned) return '';
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const spokenLines = lines.map((line, idx) => {
      let s = line
        .replace(/^第一點[，,、：:]?\s*/, idx === 0 ? '首先，' : '第一點，')
        .replace(/^第二點[，,、：:]?\s*/, '接著第二點，')
        .replace(/^第三點[，,、：:]?\s*/, '第三點，')
        .replace(/^第四點[，,、：:]?\s*/, '再來第四點，')
        .replace(/^第五點[，,、：:]?\s*/, '第五點，')
        .replace(/^第六點[，,、：:]?\s*/, '第六點，')
        .replace(/[：:]/g, '，')
        .replace(/[；;]/g, '，')
        .replace(/[()（）\[\]【】《》「」『』*#•▪]/g, '')
        .replace(/[，,]{2,}/g, '，')
        .replace(/([。！？])[，,]+/g, '$1')
        .replace(/[，,]+([。！？])/g, '$1')
        .trim();
      if (s && !/[。！？]$/.test(s)) s += '。';
      return s;
    });
    return spokenLines.join(' ');
  }

  function formatEssayForNaturalAudio(question) {
    if (!question) return '';
    const blocks = [];
    const metaBits = [];
    if (question.year) metaBits.push(`${question.year}年`);
    if (question.session) metaBits.push(`第${question.session}次`);
    if (question.subject) metaBits.push(cleanSpeechText(question.subject));
    const intro = metaBits.length ? `${metaBits.join('')}申論題考前導讀。` : '申論題考前導讀。';

    const prompt = toConversationalParagraph(question.prompt);
    blocks.push(`${intro}${prompt ? `先來看一下這題的題目，${prompt}` : ''}`);

    const model = question.essayGuide && question.essayGuide.modelAnswer;
    if (model) {
      const qi = model.qi || {};
      const cheng = model.cheng || {};
      const zhuan = model.zhuan || {};
      const he = model.he || {};

      const qiBody = toConversationalParagraph(qi.content);
      if (qiBody) {
        const title = cleanSpeechText(qi.title || ESSAY_STAGES[0][2]);
        blocks.push(`這題在考的核心概念是${title}。${qiBody}`);
      }

      const chengBody = toConversationalParagraph(cheng.content);
      if (chengBody) {
        const title = cleanSpeechText(cheng.title || ESSAY_STAGES[1][2]);
        blocks.push(`在理論與法規面向上，針對${title}，我們可以從以下幾個重點切入。${chengBody}`);
      }

      const zhuanBody = toConversationalParagraph(zhuan.content);
      if (zhuanBody) {
        const title = cleanSpeechText(zhuan.title || ESSAY_STAGES[2][2]);
        blocks.push(`回到台灣第一線社工實務現場來看，關於${title}，${zhuanBody}`);
      }

      const heBody = toConversationalParagraph(he.content);
      if (heBody) {
        const title = cleanSpeechText(he.title || ESSAY_STAGES[3][2]);
        blocks.push(`最後在結論收尾時，針對${title}，建議提出以下總結。${heBody}`);
      }
    } else {
      const legacyBody = toConversationalParagraph(question.referenceAnswer || question.explanation || '');
      if (legacyBody) {
        blocks.push(`這題的重點作答方向可以這樣切入。${legacyBody}`);
      }
    }

    const theories = question.essayGuide && question.essayGuide.analysis && Array.isArray(question.essayGuide.analysis.theoriesAndLaws)
      ? question.essayGuide.analysis.theoriesAndLaws
          .map(item => cleanSpeechText(item).replace(/[：:；;()（）\[\]【】《》「」『』]/g, '，').replace(/[，,]{2,}/g, '，').replace(/^，|，$/g, '').trim())
          .filter(Boolean)
      : [];
    if (theories.length) {
      blocks.push(`考前快速複習這題一定要帶到的核心理論與法規關鍵字，包括：${theories.join('、')}。`);
    }

    return blocks.filter(Boolean).join('\n\n');
  }

  function buildSubjectNaturalAudioExport(questions, subjectName, examLabel) {
    const list = Array.isArray(questions) ? questions.filter(q => q && q.type === 'essay') : [];
    const subject = cleanSpeechText(subjectName || (list[0] && list[0].subject) || '申論題');
    const exam = cleanSpeechText(examLabel || '社工師考試');
    const header = [
      `${exam}｜${subject} 申論題自然口語導讀講稿（共 ${list.length} 題）`,
      '使用建議：本檔專為 Google NotebookLM 雙人深度對談 Podcast（Audio Overview）與 Gemini 語音朗讀整理，已去除干擾發音之符號並保留所有台灣社工國考專有名詞、理論與法規關鍵字。',
      '非考選部官方標準答案或評分依據；法規與實務請以考試當年度有效規定為準。'
    ].join('\n');

    const body = list.map((q, idx) => {
      const script = formatEssayForNaturalAudio(q);
      return `第 ${idx + 1} 題講稿\n${script}`;
    }).join('\n\n────────────────────\n\n');

    return body ? `${header}\n\n====================\n\n${body}\n` : `${header}\n`;
  }

  function buildNaturalAudioFilename(subjectName, count) {
    const safeSubject = String(subjectName || '申論題').replace(/[\\/:*?"<>|\s]+/g, '');
    const suffix = Number.isInteger(count) && count > 0 ? `-${count}題` : '';
    return `社工師口語講稿-${safeSubject}${suffix}.txt`;
  }

  function buildNotebookLmPodcastPrompt(subjectName, examLabel) {
    const subject = cleanSpeechText(subjectName || '社工師申論題');
    const exam = cleanSpeechText(examLabel || '社工師考試');
    return (
      `請以繁體中文（臺灣用語）製作「${exam}・${subject}」考前申論衝刺深度對談 Podcast。` +
      '設定兩位主持人皆為台灣資深社工督導兼國考閱卷輔導老師，語氣溫暖自然、節奏俐落不照稿唸，逐題拆解：\n' +
      '1. 審題破題與「起・承・轉・合」四段答題骨架；\n' +
      '2. 台灣在地保護性、脆弱家庭、長照或社區第一線實務案例與常見困境反思；\n' +
      '3. 國考必背核心理論、學者觀點、法規名稱與閱卷給分關鍵字，避免空泛口號並於每題結尾用一句話幫考生記憶。'
    );
  }

  function shouldSkipSpeechPause(visibilityState) {
    return visibilityState === 'hidden';
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

  function extractDriveFileId(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const patterns = [
      /\/file\/d\/([A-Za-z0-9_-]{10,128})/,
      /\/d\/([A-Za-z0-9_-]{10,128})/,
      /[?&]id=([A-Za-z0-9_-]{10,128})/
    ];
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m && m[1]) return m[1];
    }
    return DRIVE_ID_PATTERN.test(text) ? text : '';
  }

  function buildDriveApiMediaUrl(fileId, apiKey) {
    const id = extractDriveFileId(fileId);
    const key = String(apiKey || '').trim();
    if (!id || !key) return '';
    return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(key)}`;
  }

  function buildDriveAudioUrls(fileId, apiKey) {
    const id = extractDriveFileId(fileId);
    if (!id) return [];
    const encoded = encodeURIComponent(id);
    const urls = [];
    const apiUrl = buildDriveApiMediaUrl(id, apiKey);
    if (apiUrl) urls.push(apiUrl);
    urls.push(
      `https://drive.google.com/uc?export=download&id=${encoded}`,
      `https://docs.google.com/uc?export=open&id=${encoded}`,
      `https://drive.usercontent.google.com/download?id=${encoded}&export=download&confirm=t`
    );
    return urls;
  }

  function isValidAudioUrl(raw) {
    const text = String(raw || '').trim();
    return /^https?:\/\/\S+$/i.test(text);
  }

  function resolveEssayAudioEntry(manifest, questionId) {
    if (!manifest || typeof manifest !== 'object' || !questionId) return null;
    const items = manifest.items && typeof manifest.items === 'object' ? manifest.items : null;
    if (!items) return null;
    const raw = items[questionId];
    if (!raw || typeof raw !== 'object') return null;

    const directUrl = isValidAudioUrl(raw.directUrl) ? String(raw.directUrl).trim() : '';
    const fileId = extractDriveFileId(raw.fileId);
    const apiKey = String(raw.driveApiKey || manifest.driveApiKey || '').trim();

    const urls = [];
    if (directUrl) urls.push(directUrl);
    if (fileId) {
      for (const u of buildDriveAudioUrls(fileId, apiKey)) {
        if (!urls.includes(u)) urls.push(u);
      }
    }
    if (!urls.length) return null;

    return {
      questionId,
      directUrl,
      fileId,
      title: String(raw.title || ''),
      subject: String(raw.subject || ''),
      filename: String(raw.filename || ''),
      folder: String(raw.folder || ''),
      sourceKind: directUrl ? 'cdn' : (apiKey ? 'driveApi' : 'driveWeb'),
      urls
    };
  }

  function formatAudioTime(seconds) {
    const sec = Number(seconds);
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const whole = Math.floor(sec);
    const mins = Math.floor(whole / 60);
    const rem = whole % 60;
    return `${mins}:${String(rem).padStart(2, '0')}`;
  }

  function clampSeekTime(currentTime, deltaSeconds, duration) {
    const cur = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
    const delta = Number.isFinite(Number(deltaSeconds)) ? Number(deltaSeconds) : 0;
    const target = Math.max(0, cur + delta);
    const dur = Number(duration);
    if (Number.isFinite(dur) && dur > 0) {
      return Math.min(dur, target);
    }
    return target;
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
    formatEssayForNaturalAudio,
    buildSubjectNaturalAudioExport,
    buildNaturalAudioFilename,
    buildNotebookLmPodcastPrompt,
    shouldSkipSpeechPause,
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
    toggleRevealedStage,
    extractDriveFileId,
    buildDriveApiMediaUrl,
    buildDriveAudioUrls,
    resolveEssayAudioEntry,
    formatAudioTime,
    clampSeekTime
  };
}));
