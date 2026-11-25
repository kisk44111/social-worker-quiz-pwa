const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SPEECH_VOICE_PREF_KEY = 'swq_essay_speech_voice';
const ESSAY_AUTO_NEXT_PREF_KEY = 'swq_essay_auto_next';
function loadPreferredVoiceName(){try{return localStorage.getItem(SPEECH_VOICE_PREF_KEY)||''}catch(_){return ''}}
function savePreferredVoiceName(name){try{if(name)localStorage.setItem(SPEECH_VOICE_PREF_KEY,name);else localStorage.removeItem(SPEECH_VOICE_PREF_KEY)}catch(_){}}
function loadPreferredAutoNext(){try{const v=localStorage.getItem(ESSAY_AUTO_NEXT_PREF_KEY);return v===null?true:v==='1'}catch(_){return true}}
function savePreferredAutoNext(enabled){try{localStorage.setItem(ESSAY_AUTO_NEXT_PREF_KEY,enabled?'1':'0')}catch(_){}}
const state = {
  questions: [], essayAudioManifest: { version: 1, items: {} }, view: 'library', stack: [], currentList: [], currentIndex: 0,
  favorites: new Set(), wrong: new Set(), answered: 0, correct: 0, attempts: [], reviews: [], mockExams: [], essayPractices: [], resume: null, plan: {weeklyGoal:120,startDate:null}, notes:{}, tags:{}, customTags:[], errataNotes:{}, filters:{},
  selected: null, submitted: false, examType: 'socialWorker', activeMockId: null, mockIndex: 0, essayStartedAt: null, essayInterval: null,
  essayBlindMode: false, essayRevealedStages: new Set(), essayLastQuestionId: null,
  essaySpeech: { status: 'idle', mode: 'tts', rate: 1, continuous: loadPreferredAutoNext(), voiceName: loadPreferredVoiceName(), activeSegment: null, activeLabel: '', statusNote: '', mp3Failed: false, chunks: [], chunkIndex: 0, sessionId: 0, questionId: null, autoNextTimer: null, pauseTimer: null, audioEntry: null, audioUrls: [], audioUrlIndex: 0, currentTime: 0, duration: 0, seeking: false }
};
const socialSubjects = ['社會工作','人類行為與社會環境','社會工作直接服務','社會工作研究方法','社會政策與社會立法'];
const publicSubjects = ['社會福利政策與法規','社會工作實務'];
const examConfigs = {
  socialWorker:{label:'社工師考試',short:'社工師',title:'台灣社工師歷屆題庫',period:'2021–2026',subjects:socialSubjects,accent:'professional'},
  publicSocialWorker:{label:'公職社工師考試',short:'公職社工師',title:'公職社工師歷屆題庫',period:'2022–2026',subjects:publicSubjects,accent:'public'}
};
const subjectInfo = {
  '社會工作':['基礎','理解核心理論與專業價值'],
  '人類行為與社會環境':['發展','掌握生命歷程與環境系統'],
  '社會工作直接服務':['實務','熟悉個案、團體與家庭工作'],
  '社會工作研究方法':['研究','建立研究設計與統計概念'],
  '社會政策與社會立法':['政策','統整制度、法規與福利服務']
  ,'社會福利政策與法規':['法規','行政法、福利政策與法規申論']
  ,'社會工作實務':['公職實務','案例評估、方案與跨網絡服務']
};
const title = $('#title'), app = $('#app'), back = $('#back'), tabs = $('#tabs');
const examOf=q=>q.examType||'socialWorker';
const examQuestions=()=>state.questions.filter(q=>examOf(q)===state.examType);
const activeConfig=()=>examConfigs[state.examType];
function buildPlan(){const focuses=['社會工作與直接服務基礎','人類行為與社會環境','社會政策與社會立法','社會工作研究方法','五科循環複習','社會工作與直接服務題組','人類行為與社會環境題組','政策、法規與研究方法題組','第一次分科模擬','錯題與弱科補強','第二次分科模擬','申論題限時練習','全科總複習','考前錯題與重點回顧'];return focuses.map((focus,index)=>({week:index+1,focus,count:state.plan.weeklyGoal}))}

function learningSnapshot(){return {favorites:[...state.favorites],wrong:[...state.wrong],answered:state.answered,correct:state.correct,examType:state.examType,attempts:state.attempts,reviews:state.reviews,mockExams:state.mockExams,essayPractices:state.essayPractices,resume:state.resume,plan:state.plan,notes:state.notes,tags:state.tags,customTags:state.customTags,errataNotes:state.errataNotes}}
function applyLearningState(saved){state.favorites=new Set(saved.favorites);state.wrong=new Set(saved.wrong);state.answered=saved.answered;state.correct=saved.correct;state.examType=saved.examType;state.attempts=saved.attempts||[];state.reviews=saved.reviews||[];state.mockExams=saved.mockExams||[];state.essayPractices=saved.essayPractices||[];state.resume=saved.resume||null;state.plan=saved.plan||{weeklyGoal:120,startDate:null};state.notes=saved.notes||{};state.tags=saved.tags||{};state.customTags=saved.customTags||[];state.errataNotes=saved.errataNotes||{}}
function save(){window.learningDataStore.save(learningSnapshot()).catch(()=>{});}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function push(view, data={}){if(state.view==='question'&&view!=='question')stopEssaySpeech();state.stack.push({view:state.view});Object.assign(state,data);state.view=view;render()}
function root(view){stopEssaySpeech();state.view=view;state.stack=[];state.selected=null;state.submitted=false;render()}
function render(){
  app.dataset.view=state.view;
  back.classList.toggle('hidden', !state.stack.length); tabs.classList.toggle('hidden', state.view==='question');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.view));
  ({library:renderLibrary,wrong:()=>renderList('錯題複習',examQuestions().filter(q=>state.wrong.has(q.id))),favorites:()=>renderList('收藏題目',examQuestions().filter(q=>state.favorites.has(q.id))),knowledge:renderKnowledge,stats:renderStats,subject:renderSubject,list:()=>renderList(state.listTitle,state.currentList),question:renderQuestion,data:renderDataManagement,mockSetup:renderMockSetup,mock:renderMock,mockResult:renderMockResult}[state.view]||renderLibrary)();
  scrollTo(0,0);
}
function renderKnowledge(){
  const kb=window.examKnowledgeBase||{cards:[],sources:[],notice:'知識庫資料尚未載入。'}, guides=window.examCramGuides||[], dossiers=[...(window.historicalTheoryDossiers||[]),...(window.additionalTheoryDossiers||[]),...(window.theoryGapDossiers||[]),...(window.thirdRoundTheoryDossiers||[])], conceptLinks=window.historicalTheoryConceptLinks||{}, theoryContent=window.historicalTheoryContent||{}, theoryPrimers=window.historicalTheoryPrimers||{}, architectureCompletions=window.theoryArchitectureCompletions||{}, subjects=['全部科目',...socialSubjects];let activeGuide=guides[0]?.subject||socialSubjects[0], activeDossierSubject='全部考科';
  title.textContent='考科知識庫';
  app.innerHTML=`<section class="knowledge-hero"><span class="eyebrow">離線知識庫</span><h2>理論、工作方法與考點</h2><p>考前大補帖提供精讀架構、工作步驟、常見混淆與申論寫作提示；知識卡可用於快速複習。</p><div><strong>${kb.cards.length}</strong> 張知識卡　<span>${kb.sources.length}</span> 份來源索引</div></section><section class="cram-intro"><span class="eyebrow">考前大補帖</span><h2>五科精讀與歷屆題連結</h2><p>每個單元均可直接開啟題庫中以核心術語比對的歷屆題，便於讀完立刻練習。</p></section><div class="cram-tabs">${guides.map((guide,index)=>`<button class="${index===0?'active':''}" data-guide-subject="${esc(guide.subject)}">${esc(guide.subject)}</button>`).join('')}</div><section id="cramGuide"></section><section class="dossier-intro"><span class="eyebrow">歷屆考點檔案</span><h2>學者、理論、核心架構與題號</h2><p>依歷屆題實際出現的學者與理論建立檔案；點選後可查看歷史脈絡、架構、易混淆觀念與相對應題目。</p></section><div class="dossier-filter">${['全部考科',...socialSubjects].map((subject,index)=>`<button class="${index===0?'active':''}" data-dossier-subject="${esc(subject)}">${esc(subject)}</button>`).join('')}</div><p class="dossier-index-note">題數以題幹與選項中的具名學者／理論比對；同題可能同時出現在多個檔案。</p><section id="dossierResults"></section><section class="knowledge-controls card"><label class="search-wrap"><span>⌕</span><input id="knowledgeSearch" class="search" type="search" placeholder="搜尋概念、方法、考點或來源"></label><div class="knowledge-filter">${subjects.map((subject,index)=>`<button class="${index===0?'active':''}" data-kb-subject="${esc(subject)}">${esc(subject)}</button>`).join('')}</div></section><p class="knowledge-notice">${esc(kb.notice)}</p><section id="knowledgeResults" class="knowledge-grid"></section><details class="card knowledge-sources"><summary>教材來源與整理原則</summary><p>來源檔案僅用於本機整理；網站提供的是原創濃縮筆記與來源索引，不提供教材全文。</p>${kb.sources.map(source=>`<div><strong>${esc(source.title)}</strong><br><small>${esc(source.file)}</small></div>`).join('')}</details>`;
  const results=$('#knowledgeResults'), search=$('#knowledgeSearch'), cram=$('#cramGuide'), dossierResults=$('#dossierResults');let selectedSubject='全部科目';
  $('.dossier-index-note').textContent='題數以題幹與選項中的具名學者姓名精準比對；同題可能同時出現在多個檔案。理論關鍵詞用於閱讀，不另擴大題數。';
  // 先呈現歷屆考點檔案；使用者可由考題理論進入，再選擇補帖或知識卡深化。
  // 將同一組節點一次移到 main 的第一位；避免重繪後落在大補帖之下。
  const dossierNodes=[$('.dossier-intro'),$('.dossier-filter'),$('.dossier-index-note'),dossierResults];
  app.prepend(...dossierNodes);
  const relatedQuestions=(guide,section)=>state.questions.filter(question=>question.examType!=='publicSocialWorker'&&question.subject===guide.subject&&section.terms.filter(term=>term!==guide.subject&&term.length>=2).some(term=>question.prompt.includes(term)));
  const renderGuide=()=>{const guide=guides.find(item=>item.subject===activeGuide);if(!guide){cram.innerHTML='';return}cram.innerHTML=`<section class="card cram-focus"><strong>${esc(guide.subject)}｜讀題切入點</strong><br>${esc(guide.focus)}</section><section class="card cram-writing"><strong>申論寫作架構</strong><br>${esc(guide.writing)}</section><section class="cram-sections">${guide.sections.map((section,index)=>{const related=relatedQuestions(guide,section);return `<details class="cram-section" ${index===0?'open':''}><summary>${esc(section.title)}</summary><div class="cram-body"><div class="cram-terms">${section.terms.map(term=>`<span>${esc(term)}</span>`).join('')}</div><h4>觀念與理論</h4><ul>${section.concept.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h4>工作方法／作答程序</h4><ul>${section.method.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h4>常見混淆</h4><ul>${section.confusions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h4>申論提醒</h4><p>${esc(section.essay)}</p><button class="cram-question-link" data-guide-section="${index}" ${related.length?'':'disabled'}>${related.length?`練習相關歷屆題（${related.length} 題）`:'尚未以此術語比對到題目'}</button><p class="cram-source">整理來源：${section.sourceIds.map(id=>esc(kb.sources.find(source=>source.id===id)?.title||id)).join('、')}</p></div></details>`}).join('')}</section>`;document.querySelectorAll('[data-guide-section]').forEach(button=>button.onclick=()=>{const section=guide.sections[Number(button.dataset.guideSection)],related=relatedQuestions(guide,section);if(related.length)openList(`${guide.subject}｜${section.title}｜相關歷屆題`,related)});};
  // 題單以具名學者的拉丁字母姓名精準比對，避免「認同」、「功能」等
  // 一般概念詞把不相干題目也算入。terms 仍保留作為知識檔案的檢索關鍵字。
  const namedDossierQuestions=dossier=>{const scholarTerms=dossier.directTerms||dossier.terms.filter(term=>/[A-Za-z]/.test(term));return state.questions.filter(question=>question.examType!=='publicSocialWorker'&&scholarTerms.some(term=>(question.prompt+' '+question.options.join(' ')).includes(term)))};
  const relatedConceptQuestions=dossier=>{const link=conceptLinks[dossier.id];if(!link)return[];const namedIds=new Set(namedDossierQuestions(dossier).map(question=>question.id));return state.questions.filter(question=>question.examType!=='publicSocialWorker'&&question.subject===dossier.subject&&!namedIds.has(question.id)&&link.terms.some(term=>(question.prompt+' '+question.options.join(' ')).includes(term))).map(question=>({...question,conceptLink:{theory:dossier.theory,scholar:dossier.scholar,terms:link.terms.filter(term=>(question.prompt+' '+question.options.join(' ')).includes(term)),explanation:link.explanation}}))};
  const renderDossiers=()=>{
    const shown=dossiers.filter(dossier=>activeDossierSubject==='全部考科'||dossier.subject===activeDossierSubject);
    dossierResults.innerHTML=shown.map((dossier,index)=>{
      const named=namedDossierQuestions(dossier), related=relatedConceptQuestions(dossier), link=conceptLinks[dossier.id], content=theoryContent[dossier.id]||dossier.content&&{claim:dossier.content,mechanism:dossier.framework.join(' '),practice:dossier.points.join(' ')}, primer=theoryPrimers[dossier.id]||dossier.primer, completion=architectureCompletions[dossier.id];
      const primerHtml=primer?`<section class="theory-primer"><h4>從零開始讀這個理論</h4><h5>它為何會出現？</h5><p>${esc(primer.background)}</p><h5>用白話理解</h5><p>${esc(primer.plain)}</p><h5>先用一個例子想像</h5><p>${esc(primer.example)}</p></section>`:'';
      const contentHtml=content?`<section class="theory-content"><h4>理論內容：核心主張與運作機制</h4><h5>核心主張</h5><p>${esc(content.claim)}</p><h5>概念如何運作</h5><p>${esc(content.mechanism)}</p><h5>實務／答題如何使用</h5><p>${esc(content.practice)}</p></section>`:'<div class="dossier-status">理論內容整理尚待補充。</div>';
      const completionHtml=completion?`<section class="architecture-completion"><h4>${esc(completion.title)}</h4><ol>${completion.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ol></section>`:'';
      return `<details class="dossier" ${index===0?'open':''}><summary><span class="dossier-title">${esc(dossier.theory)}</span><span class="dossier-scholar">${esc(dossier.scholar)}</span><span class="dossier-meta">${esc(dossier.subject)}・具名學者 ${named.length} 題／概念延伸 ${related.length} 題</span></summary><div class="dossier-body"><h4>歷史脈絡與定位</h4><p>${esc(dossier.history)}</p>${primerHtml}${contentHtml}${completionHtml}<h4>核心架構</h4><ul>${dossier.framework.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h4>重要觀念與應用</h4><ul>${dossier.points.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h4>常見混淆與陷阱</h4><ul>${dossier.traps.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><div class="dossier-status">教材對照：${esc(dossier.status)}</div><button class="dossier-questions" data-dossier-id="${esc(dossier.id)}" ${named.length?'':'disabled'}>${named.length?`開啟具名學者原題（${named.length} 題）`:'尚未比對到具名學者原題'}</button>${link?`<div class="concept-extension"><strong>相關概念延伸題</strong><p>${esc(link.explanation)}</p><button class="dossier-questions related-concept-button" data-concept-id="${esc(dossier.id)}" ${related.length?'':'disabled'}>${related.length?`開啟概念延伸題（${related.length} 題）`:'尚未比對到概念延伸題'}</button></div>`:''}</div></details>`
    }).join('')||'<div class="empty">此考科尚無檔案。</div>';
    document.querySelectorAll('[data-dossier-id]').forEach(button=>button.onclick=()=>{const dossier=dossiers.find(item=>item.id===button.dataset.dossierId),named=namedDossierQuestions(dossier);if(named.length)openList(`${dossier.scholar}｜${dossier.theory}｜具名學者原題`,named)});
    document.querySelectorAll('[data-concept-id]').forEach(button=>button.onclick=()=>{const dossier=dossiers.find(item=>item.id===button.dataset.conceptId),related=relatedConceptQuestions(dossier);if(related.length)openList(`${dossier.theory}｜相關概念延伸題`,related)});
  };
  const show=()=>{const keyword=search.value.trim().toLowerCase();const cards=kb.cards.filter(card=>{const text=[card.title,card.summary,card.domain,...card.points,...card.exam].join(' ').toLowerCase();return (selectedSubject==='全部科目'||card.subject===selectedSubject)&&(!keyword||text.includes(keyword))});results.innerHTML=cards.length?cards.map(card=>`<article class="knowledge-card"><div class="knowledge-card-meta"><span>${esc(card.subject)}</span><small>${esc(card.domain)}</small></div><h3>${esc(card.title)}</h3><p>${esc(card.summary)}</p><details><summary>重點與應試提示</summary><h4>核心重點</h4><ul>${card.points.map(point=>`<li>${esc(point)}</li>`).join('')}</ul><h4>應試提示</h4><ul>${card.exam.map(point=>`<li>${esc(point)}</li>`).join('')}</ul><p class="knowledge-source">整理來源：${card.sourceIds.map(id=>esc(kb.sources.find(source=>source.id===id)?.title||id)).join('、')}</p></details></article>`).join(''):'<div class="empty">找不到符合的知識卡，請調整關鍵字或科目。</div>'};
  search.oninput=show;document.querySelectorAll('[data-kb-subject]').forEach(button=>button.onclick=()=>{selectedSubject=button.dataset.kbSubject;document.querySelectorAll('[data-kb-subject]').forEach(item=>item.classList.toggle('active',item===button));show()});document.querySelectorAll('[data-guide-subject]').forEach(button=>button.onclick=()=>{activeGuide=button.dataset.guideSubject;document.querySelectorAll('[data-guide-subject]').forEach(item=>item.classList.toggle('active',item===button));renderGuide()});document.querySelectorAll('[data-dossier-subject]').forEach(button=>button.onclick=()=>{activeDossierSubject=button.dataset.dossierSubject;document.querySelectorAll('[data-dossier-subject]').forEach(item=>item.classList.toggle('active',item===button));renderDossiers()});renderGuide();renderDossiers();show();
}
function renderLibrary(){
  const config=activeConfig(),questions=examQuestions(),subjects=config.subjects,isPublic=state.examType==='publicSocialWorker';
  const today=new Date(),days=Math.max(0,Math.ceil((Date.UTC(2027,1,20)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000)),due=studyEngine.dueReviews(state.reviews,today,state.examType),weak=studyEngine.subjectStats(state.attempts,state.examType)[0],resume=state.resume&&state.resume.examType===state.examType?state.resume:null;
  title.textContent=config.label;
  const accuracy=state.answered?Math.round(state.correct/state.answered*100):0;
  app.innerHTML=`<section class="exam-switcher" aria-label="選擇考試類別"><div><span class="eyebrow">考試類別</span><strong>選擇你的備考目標</strong></div>${Object.entries(examConfigs).map(([key,c])=>`<button class="exam-choice ${key===state.examType?'active':''} ${c.accent}" data-exam="${key}"><span class="exam-choice-icon">${key==='socialWorker'?'社':'公'}</span><span><b>${c.label}</b><small>${key==='socialWorker'?'專技高考・五大科目':'高考三級・兩大專業科目'}</small></span><i>${key===state.examType?'✓':'→'}</i></button>`).join('')}</section>
  ${state.examType==='socialWorker'?`<section class="study-dashboard"><div><span>116年第一次考試倒數</span><strong>${days} 天</strong><small>2027 年 2 月 20 日</small></div><button id="reviewDue"><span>今日待複習</span><strong>${due.length} 題</strong><small>${weak?`優先：${esc(weak.subject)}`:'先完成第一題練習'}</small></button><div><span>本週目標</span><strong>${state.plan.weeklyGoal} 題</strong><button id="editPlan">調整 14 週計畫</button></div></section><section class="card daily-tasks"><h3>今日任務</h3>${studyEngine.dailyTasks(learningSnapshot()).map(task=>`<button class="row task" data-task="${task.kind}">${esc(task.label)} <strong>${task.count}</strong></button>`).join('')}<button id="sprintMode" class="row task">考前衝刺模式：弱科＋到期錯題</button></section><details class="card plan-card"><summary>14 週每日備考計畫</summary><p class="muted">起始日：${esc(state.plan.startDate||'2026-11-14')}・每週目標：${state.plan.weeklyGoal} 題；每日約 ${Math.ceil(state.plan.weeklyGoal/6)} 題，並依錯題與弱科動態調整。</p>${buildPlan().map(item=>`<div>第 ${item.week} 週｜${esc(item.focus)}｜每日 ${Math.ceil(item.count/6)} 題＋1 題申論</div>`).join('')}</details>${resume?`<button class="row resume-card" id="resume"><span class="quick-icon">↺</span><div><span class="eyebrow">接續練習</span><h3>${esc(resume.listTitle||'上次題單')}</h3><p>從第 ${resume.currentIndex+1} 題繼續</p></div><b>繼續 →</b></button>`:''}`:''}
  <section class="hero ${config.accent}"><div><span class="eyebrow">${config.period} ${config.label}</span><h2>${isPublic?'準備公職社工師，從歷屆申論開始':'今天想從哪裡開始？'}</h2><p>${isPublic?'收錄考選部近五年正式試題，附 AI 擬答方向與參考答案。':'整合 2021–2026 歷屆試題、完整詳解與申論擬答。'}</p></div><div class="hero-stats"><div><strong>${questions.length.toLocaleString()}</strong><span>收錄題數</span></div><div><strong>${subjects.length}</strong><span>專業科目</span></div><div><strong>${config.period}</strong><span>收錄年度</span></div></div></section>
  <div class="desktop-toolbar"><div><h2>題庫總覽</h2><p>依科目練習，或直接開始今日測驗</p></div><label class="search-wrap"><span>⌕</span><input class="search" id="search" type="search" placeholder="搜尋題目、筆記或標籤"></label></div>
  <section class="filter-panel"><select id="filterSubject"><option value="">全部科目</option>${subjects.map(s=>`<option>${esc(s)}</option>`).join('')}</select><select id="filterYear"><option value="">全部年度</option>${[...new Set(questions.map(q=>q.year))].sort((a,b)=>b-a).map(y=>`<option value="${y}">${y} 年</option>`).join('')}</select><select id="filterType"><option value="">全部題型</option><option value="multipleChoice">選擇題</option><option value="essay">申論題</option></select><select id="filterStatus"><option value="">全部學習狀態</option><option value="unanswered">未作答</option><option value="wrong">錯題</option><option value="favorite">收藏</option><option value="due">到期複習</option></select><button class="row" id="applyFilters">搜尋／篩選</button></section>
  <section class="quick-grid"><button class="row quick-card primary-quick" id="random"><span class="quick-icon">↝</span><div><span class="eyebrow">快速開始</span><h3>${isPublic?'10 題隨機申論複習':'40 題隨機練習'}</h3><p>${isPublic?'從兩科近五年試題隨機抽題':'從所有歷屆選擇題智慧抽題'}</p></div><b>開始 →</b></button>
  <button class="row quick-card" id="essays"><span class="quick-icon">✎</span><div><span class="eyebrow">申論專區</span><h3>申論題總覽</h3><p>查看 AI 擬答架構與參考答案</p></div><b>瀏覽 →</b></button>
  <button class="row quick-card" id="mockStart"><span class="quick-icon">◷</span><div><span class="eyebrow">國考模擬</span><h3>40 題分科模擬</h3><p>計時、標記待檢查，交卷後查看詳解</p></div><b>開始 →</b></button>
  <button class="row quick-card" id="dataManagement"><span class="quick-icon">⇅</span><div><span class="eyebrow">資料保護</span><h3>備份與還原</h3><p>匯出或合併匯入本機學習紀錄</p></div><b>管理 →</b></button></section>
  <div class="section-heading"><div><span class="section-title">${isPublic?'兩大專業科目':'五大科目'}</span><p>選擇科目查看歷屆試題與隨機練習</p></div><span class="desktop-only">${config.period.replace('–',' — ')}</span></div><section class="subject-grid ${isPublic?'public-subject-grid':''}">${subjects.map((s,i)=>`<button class="row subject ${isPublic?'public-subject':''}" data-subject="${esc(s)}"><span class="subject-index">0${i+1}</span><div class="subject-copy"><span class="subject-kind">${subjectInfo[s][0]}</span><h3>${esc(s)}</h3><p>${subjectInfo[s][1]}</p></div><div class="subject-tail"><strong>${questions.filter(q=>q.subject===s).length}</strong><span>題</span><i>→</i></div></button>`).join('')}</section>`;
  document.querySelectorAll('.exam-choice').forEach(b=>b.onclick=()=>{state.examType=b.dataset.exam;save();state.stack=[];render()});
  $('#random').onclick=()=>openList(isPublic?'10 題隨機申論複習':'智慧推薦 40 題',isPublic?shuffle(questions.filter(q=>q.type==='essay')).slice(0,10):studyEngine.weightedRecommendation(state.questions,learningSnapshot(),state.examType,40));
  $('#essays').onclick=()=>openList('申論題總覽',questions.filter(q=>q.type==='essay'));
  $('#mockStart').onclick=()=>push('mockSetup');
  $('#dataManagement').onclick=()=>push('data');
  if($('#resume'))$('#resume').onclick=()=>{const list=resume.questionIds.map(id=>state.questions.find(q=>q.id===id)).filter(Boolean);if(list.length){state.currentList=list;state.currentIndex=Math.min(resume.currentIndex,list.length-1);push('question')}};
  if($('#reviewDue'))$('#reviewDue').onclick=()=>{const reviewQuestions=due.map(item=>state.questions.find(q=>q.id===item.questionId)).filter(Boolean);if(reviewQuestions.length)openList('今日錯題複習',reviewQuestions);else if(weak){openList(`${weak.subject} 今日推薦`,shuffle(questions.filter(q=>q.subject===weak.subject&&q.type==='multipleChoice')).slice(0,10));}else openList('今日推薦練習',shuffle(questions.filter(q=>q.type==='multipleChoice')).slice(0,10));};
  document.querySelectorAll('[data-task]').forEach(button=>button.onclick=()=>{const task=button.dataset.task;if(task==='review')$('#reviewDue').click();else if(task==='essay')openList('今日申論任務',shuffle(questions.filter(q=>q.type==='essay')).slice(0,1));else openList('弱科每日任務',studyEngine.weightedRecommendation(state.questions,learningSnapshot(),state.examType,20))});
  if($('#sprintMode'))$('#sprintMode').onclick=()=>openList('考前衝刺：到期錯題與弱科',studyEngine.weightedRecommendation(state.questions,learningSnapshot(),state.examType,60));
  if($('#editPlan'))$('#editPlan').onclick=()=>{const value=prompt('每週預計完成幾題？',state.plan.weeklyGoal);if(value&&Number(value)>0){const start=prompt('14 週計畫起始日（YYYY-MM-DD）',state.plan.startDate||'2026-11-14');state.plan.weeklyGoal=Math.floor(Number(value));if(/^\d{4}-\d{2}-\d{2}$/.test(start||''))state.plan.startDate=start;save();render()}};
  document.querySelectorAll('.subject').forEach(b=>b.onclick=()=>push('subject',{activeSubject:b.dataset.subject}));
  const applyFilters=()=>{const keyword=$('#search').value.trim().toLowerCase(),subject=$('#filterSubject').value,year=$('#filterYear').value,type=$('#filterType').value,status=$('#filterStatus').value,dueIds=new Set(studyEngine.dueReviews(state.reviews,new Date(),state.examType).map(item=>item.questionId)),attempted=new Set(state.attempts.map(item=>item.questionId));const result=questions.filter(q=>{const searchable=[q.prompt,state.notes[q.id]||'',...(state.tags[q.id]||[])].join(' ').toLowerCase();const statusMatches=!status||(status==='unanswered'&&!attempted.has(q.id))||(status==='wrong'&&state.wrong.has(q.id))||(status==='favorite'&&state.favorites.has(q.id))||(status==='due'&&dueIds.has(q.id));return (!keyword||searchable.includes(keyword))&&(!subject||q.subject===subject)&&(!year||String(q.year)===year)&&(!type||q.type===type)&&statusMatches});openList('搜尋／篩選結果',result,false)};
  $('#applyFilters').onclick=applyFilters;$('#search').onkeydown=e=>{if(e.key==='Enter')applyFilters()};
}
function renderSubject(){
  const s=state.activeSubject, qs=examQuestions().filter(q=>q.subject===s),isPublic=state.examType==='publicSocialWorker'; title.textContent=s;
  const groups={}; qs.forEach(q=>{const k=`${q.year}-${q.session}`;(groups[k]??=[]).push(q)});
  app.innerHTML=`<section class="subject-hero ${isPublic?'public':''}"><span class="eyebrow">${activeConfig().label}・科目題庫</span><h2>${esc(s)}</h2><p>${subjectInfo[s]?.[1]||'歷屆試題完整收錄'}</p><div><strong>${qs.length}</strong> 題收錄・${activeConfig().period}</div></section><button class="row subject-random" id="subjectRandom"><span class="quick-icon">↝</span><div><span class="eyebrow">快速練習</span><h3>${isPublic?'隨機申論複習':'40 題科目隨機測驗'}</h3><p>${isPublic?'從本科近五年申論題隨機排序':'從本科歷屆選擇題隨機抽題'}</p></div><b>開始 →</b></button><div class="section-heading"><div><span class="section-title">歷年題庫</span><p>依考試年度與梯次瀏覽</p></div></div><section class="exam-grid">`+
    Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,v])=>`<button class="row exam" data-key="${k}"><h3>${v[0].year} 年・第 ${v[0].session} 次</h3><p>${v.length} 題</p></button>`).join('');
  app.innerHTML+='</section>';
  $('#subjectRandom').onclick=()=>openList(`${s}隨機練習`,shuffle(qs.filter(q=>isPublic?q.type==='essay':q.type==='multipleChoice')).slice(0,isPublic?10:40));
  document.querySelectorAll('.exam').forEach(b=>b.onclick=()=>openList(`${groups[b.dataset.key][0].year} 第 ${groups[b.dataset.key][0].session} 次`,groups[b.dataset.key]));
}
function openList(name,items,navigate=true){state.currentList=items;state.listTitle=name;if(navigate)push('list');else{state.stack.push({view:'library'});state.view='list';render()}}
function renderList(name,items){
  title.textContent=name;
  const config=activeConfig();
  const choices=items.filter(q=>q.type==='multipleChoice');
  app.innerHTML=items.length?`<div class="list-summary"><div><span class="track-chip ${config.accent}">${config.label}</span><span class="eyebrow">練習題單</span><h2>${esc(name)}</h2></div><strong>${items.length}<small> 題</small></strong></div>${choices.length===40?'<button class="primary" id="paperMode">以完整歷屆試卷作答</button>':''}<section class="question-grid">${items.map((q,i)=>`<button class="row question-link ${q.type==='essay'?'essay':''}" data-i="${i}"><div class="question-number">${q.type==='essay'?'✎':String(i+1).padStart(2,'0')}</div><div class="question-preview"><span class="badge">${q.type==='essay'?'申論・含 AI 擬答與參考答案':'官方第 '+q.number+' 題・題單 '+(i+1)}</span><p>${esc(q.prompt)}</p><div class="meta">${q.year}・第 ${q.session} 次・${esc(q.subject)}</div></div><span class="row-arrow">→</span></button>`).join('')}</section>`:'<div class="empty">目前沒有題目</div>';
  document.querySelectorAll('.question-link').forEach(b=>b.onclick=()=>{state.currentList=items;state.currentIndex=+b.dataset.i;state.selected=null;state.submitted=false;saveResume();push('question')});
  if($('#paperMode'))$('#paperMode').onclick=()=>{const mock={id:`paper-${Date.now()}`,subject:choices[0].subject,examType:examOf(choices[0]),questionIds:choices.map(q=>q.id),answers:{},flagged:[],startedAt:new Date().toISOString(),elapsedSeconds:0,paperTitle:name,mode:'historicalPaper'};state.mockExams.push(mock);state.activeMockId=mock.id;state.mockIndex=0;save();push('mock')};
}
const ESSAY_STAGES=(window.essayStudyTools?.ESSAY_STAGES)||[
  ['qi','起','破題與核心概念界定'],
  ['cheng','承','理論依據與法規政策剖析'],
  ['zhuan','轉','實務應用、困境與批判反思'],
  ['he','合','總結與具體建議展望']
];
const SPEECH_RATES=(window.essayStudyTools?.SPEECH_RATES)||[1,1.25,1.5,1.75];
function getEssayAudioEntry(q){
  if(!q||q.type!=='essay')return null;
  if(window.essayStudyTools?.resolveEssayAudioEntry)return window.essayStudyTools.resolveEssayAudioEntry(state.essayAudioManifest,q.id);
  return null;
}
function formatAudioTimeText(sec){
  return window.essayStudyTools?.formatAudioTime?window.essayStudyTools.formatAudioTime(sec):'0:00';
}
function formatRateLabel(rate){
  const n=Number(rate)||1;
  return n===1?'1.0x':`${n}x`;
}
let lectureAudioEl=null, lectureAudioSwitching=false;
function getLectureAudioEl(){
  if(lectureAudioEl)return lectureAudioEl;
  if(typeof document==='undefined')return null;
  const el=document.createElement('audio');
  el.preload='auto';
  el.playsInline=true;
  el.setAttribute('playsinline','');
  el.setAttribute('webkit-playsinline','');
  el.addEventListener('loadedmetadata',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3')return;
    sp.duration=Number.isFinite(el.duration)?el.duration:0;
    sp.currentTime=Number.isFinite(el.currentTime)?el.currentTime:0;
    try{el.playbackRate=sp.rate}catch(_){}
    syncEssayAudioProgressUI();
    updateMediaSessionPositionState();
  });
  el.addEventListener('durationchange',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3')return;
    sp.duration=Number.isFinite(el.duration)?el.duration:0;
    syncEssayAudioProgressUI();
    updateMediaSessionPositionState();
  });
  el.addEventListener('timeupdate',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3'||sp.seeking)return;
    sp.currentTime=Number.isFinite(el.currentTime)?el.currentTime:0;
    if(Number.isFinite(el.duration)&&el.duration>0)sp.duration=el.duration;
    syncEssayAudioProgressUI();
  });
  el.addEventListener('playing',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3')return;
    lectureAudioSwitching=false;
    sp.status='playing';
    sp.statusNote='';
    const cur=state.currentList[state.currentIndex];
    updateEssayMediaSession(cur&&cur.type==='essay'?cur:null,'playing');
    updateMediaSessionPositionState();
    syncEssaySpeechUI(false);
  });
  el.addEventListener('pause',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3'||lectureAudioSwitching||el.ended||sp.status==='idle')return;
    sp.status='paused';
    sp.statusNote='';
    const cur=state.currentList[state.currentIndex];
    updateEssayMediaSession(cur&&cur.type==='essay'?cur:null,'paused');
    updateMediaSessionPositionState();
    syncEssaySpeechUI(false);
  });
  el.addEventListener('seeked',()=>updateMediaSessionPositionState());
  el.addEventListener('ratechange',()=>updateMediaSessionPositionState());
  el.addEventListener('ended',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3'||sp.status==='idle')return;
    handleLectureAudioEnded();
  });
  el.addEventListener('error',()=>{
    const sp=state.essaySpeech;
    if(sp.mode!=='mp3'||lectureAudioSwitching||sp.status==='idle')return;
    handleLectureAudioError();
  });
  lectureAudioEl=el;
  return el;
}
function syncEssayAudioProgressUI(){
  const sp=state.essaySpeech;
  const curEl=$('#essayAudioCurrent'), durEl=$('#essayAudioDuration'), seekEl=$('#essayAudioSeek');
  const curQ=state.currentList[state.currentIndex];
  const isCurrentTrack=Boolean(curQ&&sp.questionId===curQ.id&&sp.mode==='mp3');
  const cur=isCurrentTrack?sp.currentTime:0;
  const dur=isCurrentTrack?sp.duration:0;
  if(curEl)curEl.textContent=formatAudioTimeText(cur);
  if(durEl)durEl.textContent=formatAudioTimeText(dur);
  if(seekEl&&!sp.seeking){
    seekEl.value=dur>0?String(Math.min(1000,Math.max(0,Math.round((cur/dur)*1000)))):'0';
    seekEl.disabled=!(isCurrentTrack&&dur>0);
  }
  const backBtn=$('#essayAudioSeekBack'), fwdBtn=$('#essayAudioSeekFwd');
  if(backBtn)backBtn.disabled=!(isCurrentTrack&&dur>0);
  if(fwdBtn)fwdBtn.disabled=!(isCurrentTrack&&dur>0);
}
function updateMediaSessionPositionState(){
  if(typeof navigator==='undefined'||!('mediaSession'in navigator)||typeof navigator.mediaSession.setPositionState!=='function')return;
  const sp=state.essaySpeech;
  if(sp.mode!=='mp3'||!lectureAudioEl)return;
  const duration=Number.isFinite(lectureAudioEl.duration)&&lectureAudioEl.duration>0?lectureAudioEl.duration:0;
  if(!duration)return;
  const position=Math.min(duration,Math.max(0,Number.isFinite(lectureAudioEl.currentTime)?lectureAudioEl.currentTime:0));
  try{
    navigator.mediaSession.setPositionState({duration,playbackRate:lectureAudioEl.playbackRate||sp.rate||1,position});
  }catch(_){}
}
function seekLectureAudioBy(deltaSeconds){
  const sp=state.essaySpeech;
  if(sp.mode!=='mp3'||!lectureAudioEl)return;
  const dur=Number.isFinite(lectureAudioEl.duration)?lectureAudioEl.duration:sp.duration;
  if(!dur||dur<=0)return;
  const nextTime=window.essayStudyTools?.clampSeekTime
    ? window.essayStudyTools.clampSeekTime(lectureAudioEl.currentTime,deltaSeconds,dur)
    : Math.min(dur,Math.max(0,(lectureAudioEl.currentTime||0)+deltaSeconds));
  try{lectureAudioEl.currentTime=nextTime}catch(_){}
  sp.currentTime=nextTime;
  syncEssayAudioProgressUI();
  updateMediaSessionPositionState();
}
function handleLectureAudioError(){
  const sp=state.essaySpeech;
  const cur=state.currentList[state.currentIndex];
  if(!cur||cur.id!==sp.questionId)return;
  if(sp.audioUrlIndex+1<sp.audioUrls.length){
    sp.audioUrlIndex++;
    const nextUrl=sp.audioUrls[sp.audioUrlIndex];
    const el=getLectureAudioEl();
    if(el){
      lectureAudioSwitching=true;
      sp.statusNote=`主線路載入異常，自動切換備用串流線路（${sp.audioUrlIndex+1}/${sp.audioUrls.length}）⋯`;
      syncEssaySpeechUI(false);
      el.src=nextUrl;
      el.playbackRate=sp.rate;
      lectureAudioSwitching=false;
      const p=el.play();
      if(p&&typeof p.catch==='function')p.catch(err=>{
        if(err&&err.name==='AbortError')return;
        handleLectureAudioError();
      });
      return;
    }
  }
  // All MP3 stream URLs failed -> show clear error + one-click TTS fallback button (never hang in loading state)
  stopLectureAudioOnly();
  updateEssayMediaSession(null,'none');
  sp.status='idle';
  sp.mode='tts';
  sp.mp3Failed=true;
  sp.statusNote=navigator.onLine===false
    ? '目前離線無法載入雲端 MP3，請點下方按鈕改用內建語音朗讀'
    : '雲端 MP3 全部串流線路載入失敗（可能網路受限或來源暫時異常），可點下方按鈕改用內建語音朗讀';
  syncEssaySpeechUI(false);
}
function handleLectureAudioEnded(){
  const sp=state.essaySpeech;
  if(!sp.continuous){
    stopEssaySpeech('✓ 本題名師有聲課播放完成');
    return;
  }
  const nextIdx=window.essayStudyTools?window.essayStudyTools.findNextEssayIndex(state.currentList,state.currentIndex):-1;
  if(nextIdx<0){
    stopEssaySpeech('✓ 已完成目前題單全部申論有聲課');
    return;
  }
  // CRITICAL for iOS lock-screen auto-advance: switch src & call play() SYNCHRONOUSLY
  // on the exact same persistent <audio> element before re-rendering DOM!
  navigateEssayForSpeech(nextIdx);
}
let cachedChineseVoices=[];
function isSpeechSupported(){
  return typeof window!=='undefined'&&'speechSynthesis'in window&&typeof window.SpeechSynthesisUtterance==='function';
}
function refreshChineseVoices(){
  if(!isSpeechSupported())return [];
  try{
    const voices=window.speechSynthesis.getVoices()||[];
    if(voices.length){
      cachedChineseVoices=window.essayStudyTools?window.essayStudyTools.listChineseVoices(voices):voices;
    }
  }catch(_){cachedChineseVoices=[]}
  return cachedChineseVoices;
}
function resolveActiveVoice(){
  const voices=refreshChineseVoices();
  if(!voices.length)return null;
  if(window.essayStudyTools)return window.essayStudyTools.resolveSelectedVoice(voices,state.essaySpeech.voiceName);
  return voices[0]||null;
}
function buildVoiceOptionsHtml(){
  const voices=refreshChineseVoices();
  const autoVoice=voices[0]||null;
  const autoLabel=autoVoice&&window.essayStudyTools
    ? `自動推薦：${window.essayStudyTools.formatVoiceOptionLabel(autoVoice)}`
    : '自動推薦（優先高擬真 zh-TW 語音）';
  const selected=state.essaySpeech.voiceName||'';
  const options=[`<option value="" ${!selected?'selected':''}>${esc(autoLabel)}</option>`];
  for(const v of voices){
    const val=v.name||v.voiceURI||'';
    const label=window.essayStudyTools?window.essayStudyTools.formatVoiceOptionLabel(v):`${v.name} [${v.lang}]`;
    const isSel=Boolean(selected&&(selected===v.name||selected===v.voiceURI));
    options.push(`<option value="${esc(val)}" ${isSel?'selected':''}>${esc(label)}</option>`);
  }
  return options.join('');
}
function populateEssayVoiceSelect(){
  const select=$('#essayVoiceSelect');
  if(!select)return;
  select.innerHTML=buildVoiceOptionsHtml();
}
if(isSpeechSupported()){
  refreshChineseVoices();
  try{
    window.speechSynthesis.addEventListener?.('voiceschanged',()=>{
      refreshChineseVoices();
      populateEssayVoiceSelect();
    });
  }catch(_){}
}
function syncEssaySpeechUI(scrollActive=false){
  const sp=state.essaySpeech;
  const curQ=state.currentList[state.currentIndex];
  const mp3Entry=getEssayAudioEntry(curQ);
  const usingMp3=sp.status!=='idle'&&sp.questionId===curQ?.id?sp.mode==='mp3':Boolean(mp3Entry);
  const isPlaying=sp.status==='playing', isPaused=sp.status==='paused';
  const playBtn=$('#essaySpeechPlay'), pauseBtn=$('#essaySpeechPause'), stopBtn=$('#essaySpeechStop'), statusEl=$('#essaySpeechStatus');
  if(playBtn){
    playBtn.classList.toggle('is-active',isPlaying);
    playBtn.setAttribute('aria-pressed',String(isPlaying));
    if(usingMp3){
      playBtn.textContent=isPlaying?'🎧 播放中':(isPaused?'▶ 繼續播放':'🎧 播放名師有聲課');
    }else{
      playBtn.textContent=isPlaying?'🔊 朗讀中':(isPaused?'▶ 繼續朗讀':'🔊 朗讀本題');
    }
  }
  if(pauseBtn){
    pauseBtn.disabled=sp.status==='idle';
    pauseBtn.textContent=isPaused?'▶ 繼續':'⏸ 暫停';
  }
  if(stopBtn){
    stopBtn.disabled=sp.status==='idle';
  }
  document.querySelectorAll('[data-speech-rate]').forEach(btn=>{
    const active=Number(btn.dataset.speechRate)===sp.rate;
    btn.classList.toggle('is-active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  const commuteToggle=$('#essayCommuteToggle');
  if(commuteToggle)commuteToggle.checked=Boolean(sp.continuous);
  const badgeEl=$('#essayAudioModeBadge');
  if(badgeEl){
    if(usingMp3){
      badgeEl.className='essay-audio-badge is-mp3';
      badgeEl.textContent='🎧 名師有聲課（MP3）';
    }else{
      badgeEl.className='essay-audio-badge is-tts';
      badgeEl.textContent=mp3Entry?'🎙 內建朗讀備援中':'🎙 內建語音朗讀';
    }
  }
  if(statusEl){
    if(sp.statusNote)statusEl.textContent=sp.statusNote;
    else if(isPlaying&&sp.mode==='mp3')statusEl.textContent=`🎧 名師有聲課播放中（${formatRateLabel(sp.rate)}｜支援 iPhone 鎖屏連播）`;
    else if(isPaused&&sp.mode==='mp3')statusEl.textContent=`⏸ 已暫停於 ${formatAudioTimeText(sp.currentTime)} / ${formatAudioTimeText(sp.duration)}`;
    else if(isPlaying&&sp.activeLabel)statusEl.textContent=`▶ 正在朗讀：${sp.activeLabel}（${formatRateLabel(sp.rate)}）`;
    else if(isPaused&&sp.activeLabel)statusEl.textContent=`⏸ 已暫停於：${sp.activeLabel}`;
    else if(mp3Entry)statusEl.textContent=mp3Entry.sourceKind==='cdn'
      ? '已連結永久高速 CDN 名師有聲課 MP3，鎖屏放口袋可自動連播下一題'
      : '已連結雲端名師有聲課 MP3，鎖屏放口袋可自動連播下一題';
    else statusEl.textContent='依序朗讀：題目 → 起 → 承 → 轉 → 合 → 核心理論與法規清單';
  }
  const fallbackBtn=$('#essayUseTtsFallback');
  if(fallbackBtn)fallbackBtn.classList.toggle('hidden',!(sp.mp3Failed&&isSpeechSupported()));
  syncEssayAudioProgressUI();
  let activeEl=null;
  document.querySelectorAll('[data-speech-segment]').forEach(el=>{
    const match=Boolean(sp.mode==='tts'&&sp.activeSegment&&el.dataset.speechSegment===sp.activeSegment);
    el.classList.toggle('is-speaking',match);
    if(match)activeEl=el;
  });
  if(scrollActive&&activeEl){
    const modelBody=$('#essayModelBody');
    if(modelBody&&modelBody.classList.contains('collapsed')&&['qi','cheng','zhuan','he','legacy'].includes(sp.activeSegment)){
      modelBody.classList.remove('collapsed');
      const toggleBtn=$('#toggleEssayModel');
      if(toggleBtn){toggleBtn.setAttribute('aria-expanded','true');toggleBtn.textContent='收合擬答'}
    }
    try{activeEl.scrollIntoView({behavior:'smooth',block:'nearest'})}catch(_){}
  }
}
let keepAliveAudioCtx=null, keepAliveGain=null, keepAliveOsc=null, keepAliveAudioEl=null, keepAliveBlobUrl=null;
function buildSilentWavBlobUrl(){
  if(keepAliveBlobUrl)return keepAliveBlobUrl;
  const sampleRate=8000, numSamples=sampleRate, buffer=new ArrayBuffer(44+numSamples), view=new DataView(buffer);
  const writeStr=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i))};
  writeStr(0,'RIFF');view.setUint32(4,36+numSamples,true);writeStr(8,'WAVE');
  writeStr(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate,true);view.setUint16(32,1,true);view.setUint16(34,8,true);
  writeStr(36,'data');view.setUint32(40,numSamples,true);
  new Uint8Array(buffer,44).fill(128);
  keepAliveBlobUrl=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
  return keepAliveBlobUrl;
}
function startSilentAudioKeepAlive(){
  try{
    if(typeof Audio==='function'){
      if(!keepAliveAudioEl){
        keepAliveAudioEl=new Audio(buildSilentWavBlobUrl());
        keepAliveAudioEl.loop=true;
        keepAliveAudioEl.volume=0.001;
        keepAliveAudioEl.setAttribute('playsinline','');
      }
      const p=keepAliveAudioEl.play();
      if(p&&typeof p.catch==='function')p.catch(()=>{});
    }
  }catch(_){}
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(AudioCtx){
      if(!keepAliveAudioCtx){
        keepAliveAudioCtx=new AudioCtx();
        keepAliveGain=keepAliveAudioCtx.createGain();
        keepAliveGain.gain.value=0.0001;
        keepAliveOsc=keepAliveAudioCtx.createOscillator();
        keepAliveOsc.frequency.value=200;
        keepAliveOsc.connect(keepAliveGain);
        keepAliveGain.connect(keepAliveAudioCtx.destination);
        keepAliveOsc.start();
      }
      if(keepAliveAudioCtx.state==='suspended')keepAliveAudioCtx.resume().catch(()=>{});
    }
  }catch(_){}
}
function stopSilentAudioKeepAlive(){
  try{if(keepAliveAudioEl){keepAliveAudioEl.pause();keepAliveAudioEl.currentTime=0}}catch(_){}
  try{if(keepAliveAudioCtx&&keepAliveAudioCtx.state==='running')keepAliveAudioCtx.suspend().catch(()=>{})}catch(_){}
}
function navigateEssayForSpeech(targetIndex){
  if(targetIndex<0||targetIndex>=state.currentList.length)return;
  const sp=state.essaySpeech;
  clearSpeechTimers();
  sp.sessionId++;
  if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
  state.currentIndex=targetIndex;
  saveResume();
  const nextQ=state.currentList[state.currentIndex];
  if(!nextQ||nextQ.type!=='essay'){stopEssaySpeech();return}
  sp.questionId=nextQ.id;
  // Start next track synchronously on the SAME <audio> element BEFORE re-rendering DOM
  // so iOS Safari keeps lock-screen background audio session alive seamlessly.
  const nextEntry=getEssayAudioEntry(nextQ);
  if(nextEntry){
    startMp3EssayAudio(nextQ,nextEntry);
    renderQuestion();
  }else{
    renderQuestion();
    startTtsEssaySpeech(nextQ);
  }
}
function updateEssayMediaSession(q,playbackState){
  if(typeof navigator==='undefined'||!('mediaSession'in navigator))return;
  try{
    const ms=navigator.mediaSession;
    ms.playbackState=playbackState;
    if(q&&typeof window.MediaMetadata==='function'){
      const examLabel=examConfigs[examOf(q)]?.label||'社工師考試';
      const sp=state.essaySpeech;
      const entry=sp.mode==='mp3'?(sp.audioEntry||getEssayAudioEntry(q)):null;
      const stageInfo=sp.mode==='mp3'
        ? (entry?.title?`・${entry.title}`:'・名師有聲課')
        : (sp.activeLabel?`・${sp.activeLabel}`:'');
      ms.metadata=new window.MediaMetadata({
        title:`${q.year}第${q.session}次｜${q.subject}${stageInfo}`,
        artist:sp.mode==='mp3'?'2027 社工師申論名師有聲課（MP3）':'台灣社工師歷屆題庫・申論聽讀',
        album:examLabel,
        artwork:[
          {src:'./icon-192.png',sizes:'192x192',type:'image/png'},
          {src:'./icon-512.png',sizes:'512x512',type:'image/png'}
        ]
      });
    }
    const safeHandler=(action,fn)=>{try{ms.setActionHandler(action,fn)}catch(_){}};
    if(playbackState==='none'){
      ['play','pause','stop','previoustrack','nexttrack','seekbackward','seekforward','seekto'].forEach(a=>safeHandler(a,null));
      return;
    }
    safeHandler('play',()=>{
      const cur=state.currentList[state.currentIndex];
      if(cur&&cur.type==='essay')resumeEssaySpeech(cur);
    });
    safeHandler('pause',()=>pauseEssaySpeech());
    safeHandler('stop',()=>stopEssaySpeech());
    safeHandler('previoustrack',()=>{
      const pos=window.essayStudyTools?window.essayStudyTools.essayPositionInfo(state.currentList,state.currentIndex):{prevIndex:-1};
      if(pos.prevIndex>=0)navigateEssayForSpeech(pos.prevIndex);
      else{const cur=state.currentList[state.currentIndex];if(cur&&cur.type==='essay')startEssaySpeech(cur)}
    });
    safeHandler('nexttrack',()=>{
      const pos=window.essayStudyTools?window.essayStudyTools.essayPositionInfo(state.currentList,state.currentIndex):{nextIndex:-1};
      if(pos.nextIndex>=0)navigateEssayForSpeech(pos.nextIndex);
    });
    safeHandler('seekbackward',details=>seekLectureAudioBy(-(details?.seekOffset||15)));
    safeHandler('seekforward',details=>seekLectureAudioBy(details?.seekOffset||15));
    safeHandler('seekto',details=>{
      const sp=state.essaySpeech;
      if(sp.mode!=='mp3'||!lectureAudioEl||typeof details?.seekTime!=='number')return;
      const dur=Number.isFinite(lectureAudioEl.duration)?lectureAudioEl.duration:sp.duration;
      if(!dur||dur<=0)return;
      const clamped=Math.min(dur,Math.max(0,details.seekTime));
      try{lectureAudioEl.currentTime=clamped}catch(_){}
      sp.currentTime=clamped;
      syncEssayAudioProgressUI();
      updateMediaSessionPositionState();
    });
  }catch(_){}
}
function clearSpeechTimers(){
  const sp=state.essaySpeech;
  if(sp.autoNextTimer){clearTimeout(sp.autoNextTimer);sp.autoNextTimer=null}
  if(sp.pauseTimer){clearTimeout(sp.pauseTimer);sp.pauseTimer=null}
}
function stopLectureAudioOnly(){
  if(!lectureAudioEl)return;
  lectureAudioSwitching=true;
  try{lectureAudioEl.pause()}catch(_){}
  try{lectureAudioEl.currentTime=0}catch(_){}
  lectureAudioSwitching=false;
}
function stopEssaySpeech(note=''){
  const sp=state.essaySpeech;
  clearSpeechTimers();
  stopSilentAudioKeepAlive();
  stopLectureAudioOnly();
  updateEssayMediaSession(null,'none');
  sp.sessionId++;
  if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
  sp.status='idle';
  sp.mode='tts';
  sp.activeSegment=null;
  sp.activeLabel='';
  sp.statusNote=note;
  sp.mp3Failed=false;
  sp.chunks=[];
  sp.chunkIndex=0;
  sp.questionId=null;
  sp.audioEntry=null;
  sp.audioUrls=[];
  sp.audioUrlIndex=0;
  sp.currentTime=0;
  sp.duration=0;
  sp.seeking=false;
  syncEssaySpeechUI(false);
}
function speakCurrentEssayChunk(q){
  const sp=state.essaySpeech;
  if(!isSpeechSupported()||state.view!=='question'||state.currentList[state.currentIndex]?.id!==q.id){
    stopEssaySpeech();
    return;
  }
  if(sp.chunkIndex>=sp.chunks.length){
    if(sp.continuous){
      const nextIdx=window.essayStudyTools?window.essayStudyTools.findNextEssayIndex(state.currentList,state.currentIndex):-1;
      if(nextIdx>=0){
        const isHidden=window.essayStudyTools?window.essayStudyTools.shouldSkipSpeechPause(document.visibilityState):document.visibilityState==='hidden';
        if(isHidden){
          navigateEssayForSpeech(nextIdx);
          return;
        }
        const mySession=sp.sessionId;
        sp.statusNote='本題朗讀完成，即將連播下一題⋯';
        sp.activeSegment=null;
        syncEssaySpeechUI(false);
        sp.autoNextTimer=setTimeout(()=>{
          if(sp.sessionId!==mySession||state.view!=='question')return;
          sp.autoNextTimer=null;
          navigateEssayForSpeech(nextIdx);
        },650);
        return;
      }
      stopEssaySpeech('✓ 已完成目前題單全部申論朗讀');
      return;
    }
    stopEssaySpeech('✓ 本題朗讀完成');
    return;
  }
  const chunk=sp.chunks[sp.chunkIndex];
  const segmentChanged=sp.activeSegment!==chunk.segmentKey;
  sp.status='playing';
  sp.activeSegment=chunk.segmentKey;
  sp.activeLabel=chunk.label;
  sp.statusNote='';
  syncEssaySpeechUI(segmentChanged);
  updateEssayMediaSession(q,'playing');
  const utter=new window.SpeechSynthesisUtterance(chunk.text);
  const voice=resolveActiveVoice();
  utter.lang=voice?.lang||'zh-TW';
  utter.rate=sp.rate;
  utter.pitch=window.essayStudyTools?window.essayStudyTools.recommendedVoicePitch(voice):0.98;
  if(voice)utter.voice=voice;
  const mySession=sp.sessionId;
  utter.onend=()=>{
    if(sp.sessionId!==mySession||sp.status!=='playing')return;
    sp.chunkIndex++;
    if(sp.chunkIndex>=sp.chunks.length){
      speakCurrentEssayChunk(q);
      return;
    }
    const skipPause=window.essayStudyTools?window.essayStudyTools.shouldSkipSpeechPause(document.visibilityState):document.visibilityState==='hidden';
    const pauseMs=skipPause?0:(window.essayStudyTools?window.essayStudyTools.effectivePauseMs(chunk.pauseAfterMs,sp.rate):200);
    if(pauseMs>0){
      sp.pauseTimer=setTimeout(()=>{
        if(sp.sessionId!==mySession||sp.status!=='playing')return;
        sp.pauseTimer=null;
        speakCurrentEssayChunk(q);
      },pauseMs);
    }else{
      speakCurrentEssayChunk(q);
    }
  };
  utter.onerror=event=>{
    if(sp.sessionId!==mySession)return;
    const code=event?.error||'';
    if(code==='interrupted'||code==='canceled')return;
    stopEssaySpeech('語音播放中斷，請再點一次朗讀本題');
  };
  try{window.speechSynthesis.speak(utter)}
  catch(_){stopEssaySpeech('目前瀏覽器無法啟動語音合成')}
}
function startMp3EssayAudio(q,entry){
  const el=getLectureAudioEl();
  if(!el||!entry||!entry.urls?.length){
    startTtsEssaySpeech(q);
    return;
  }
  const sp=state.essaySpeech;
  clearSpeechTimers();
  stopSilentAudioKeepAlive();
  if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
  sp.sessionId++;
  sp.mode='mp3';
  sp.questionId=q.id;
  sp.audioEntry=entry;
  sp.audioUrls=entry.urls;
  sp.audioUrlIndex=0;
  sp.currentTime=0;
  sp.duration=0;
  sp.seeking=false;
  sp.activeSegment=null;
  sp.activeLabel='';
  sp.chunks=[];
  sp.chunkIndex=0;
  sp.mp3Failed=false;
  sp.status='playing';
  sp.statusNote=entry.sourceKind==='cdn'?'正在載入高速名師有聲課 MP3⋯':'正在載入雲端名師有聲課 MP3⋯';
  lectureAudioSwitching=true;
  el.src=entry.urls[0];
  el.playbackRate=sp.rate;
  lectureAudioSwitching=false;
  updateEssayMediaSession(q,'playing');
  syncEssaySpeechUI(false);
  const playPromise=el.play();
  if(playPromise&&typeof playPromise.catch==='function'){
    playPromise.catch(err=>{
      if(err&&err.name==='AbortError')return;
      if(sp.mode==='mp3'&&sp.questionId===q.id)handleLectureAudioError();
    });
  }
}
function startTtsEssaySpeech(q,fallbackNote=''){
  if(!isSpeechSupported()||!q){
    if(fallbackNote)stopEssaySpeech(fallbackNote);
    return;
  }
  const queue=window.essayStudyTools?window.essayStudyTools.buildEssaySpeechQueue(q):[];
  if(!queue.length){stopEssaySpeech('本題尚無可朗讀文字');return}
  const sp=state.essaySpeech;
  clearSpeechTimers();
  stopLectureAudioOnly();
  startSilentAudioKeepAlive();
  sp.sessionId++;
  try{window.speechSynthesis.cancel()}catch(_){}
  sp.mode='tts';
  sp.questionId=q.id;
  sp.audioEntry=null;
  sp.audioUrls=[];
  sp.audioUrlIndex=0;
  sp.currentTime=0;
  sp.duration=0;
  sp.chunks=queue;
  sp.chunkIndex=0;
  sp.activeSegment=null;
  sp.activeLabel='';
  sp.mp3Failed=false;
  sp.statusNote=fallbackNote;
  sp.status='playing';
  speakCurrentEssayChunk(q);
}
function startEssaySpeech(q){
  if(!q)return;
  const entry=getEssayAudioEntry(q);
  if(entry&&navigator.onLine!==false){
    startMp3EssayAudio(q,entry);
    return;
  }
  if(entry&&navigator.onLine===false&&isSpeechSupported()){
    startTtsEssaySpeech(q,'目前為離線狀態，已自動降級為內建語音朗讀');
    return;
  }
  startTtsEssaySpeech(q);
}
function pauseEssaySpeech(){
  const sp=state.essaySpeech;
  if(sp.status!=='playing')return;
  if(sp.mode==='mp3'&&lectureAudioEl){
    lectureAudioSwitching=true;
    try{lectureAudioEl.pause()}catch(_){}
    lectureAudioSwitching=false;
    sp.status='paused';
    sp.statusNote='';
    const cur=state.currentList[state.currentIndex];
    updateEssayMediaSession(cur&&cur.type==='essay'?cur:null,'paused');
    updateMediaSessionPositionState();
    syncEssaySpeechUI(false);
    return;
  }
  clearSpeechTimers();
  stopSilentAudioKeepAlive();
  sp.sessionId++;
  if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
  sp.status='paused';
  sp.statusNote='';
  const cur=state.currentList[state.currentIndex];
  updateEssayMediaSession(cur&&cur.type==='essay'?cur:null,'paused');
  syncEssaySpeechUI(false);
}
function resumeEssaySpeech(q){
  const sp=state.essaySpeech;
  if(sp.mode==='mp3'&&sp.status==='paused'&&sp.questionId===q.id&&lectureAudioEl&&lectureAudioEl.src){
    sp.status='playing';
    sp.statusNote='';
    try{lectureAudioEl.playbackRate=sp.rate}catch(_){}
    const p=lectureAudioEl.play();
    if(p&&typeof p.catch==='function')p.catch(err=>{
      if(err&&err.name==='AbortError')return;
      handleLectureAudioError();
    });
    updateEssayMediaSession(q,'playing');
    syncEssaySpeechUI(false);
    return;
  }
  if(sp.mode==='tts'&&sp.status==='paused'&&sp.questionId===q.id&&sp.chunks.length){
    clearSpeechTimers();
    startSilentAudioKeepAlive();
    sp.sessionId++;
    sp.status='playing';
    sp.statusNote='';
    speakCurrentEssayChunk(q);
    return;
  }
  startEssaySpeech(q);
}
if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')return;
    const sp=state.essaySpeech;
    if(sp.mode==='mp3'){syncEssaySpeechUI(false);return}
    if(sp.status!=='playing'||!isSpeechSupported()||state.view!=='question')return;
    const cur=state.currentList[state.currentIndex];
    if(!cur||cur.id!==sp.questionId||!sp.chunks.length)return;
    if(sp.pauseTimer||sp.autoNextTimer)return;
    if(!window.speechSynthesis.speaking&&!window.speechSynthesis.pending){
      sp.sessionId++;
      try{window.speechSynthesis.cancel()}catch(_){}
      startSilentAudioKeepAlive();
      speakCurrentEssayChunk(cur);
    }
  });
}
function setEssaySpeechRate(rate,q){
  const sp=state.essaySpeech;
  sp.rate=window.essayStudyTools?window.essayStudyTools.normaliseSpeechRate(rate):Number(rate)||1;
  if(sp.mode==='mp3'&&lectureAudioEl){
    try{lectureAudioEl.playbackRate=sp.rate}catch(_){}
    updateMediaSessionPositionState();
    syncEssaySpeechUI(false);
    return;
  }
  if(sp.status==='playing'&&sp.questionId===q.id&&sp.chunks.length){
    clearSpeechTimers();
    sp.sessionId++;
    if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
    speakCurrentEssayChunk(q);
  }else{
    syncEssaySpeechUI(false);
  }
}
function setEssaySpeechVoice(voiceName,q){
  const sp=state.essaySpeech;
  sp.voiceName=voiceName||'';
  savePreferredVoiceName(sp.voiceName);
  if(sp.status==='playing'&&sp.questionId===q.id&&sp.chunks.length){
    clearSpeechTimers();
    sp.sessionId++;
    if(isSpeechSupported()){try{window.speechSynthesis.cancel()}catch(_){}}
    speakCurrentEssayChunk(q);
  }else{
    syncEssaySpeechUI(false);
  }
}
function buildEssayCopyText(q){
  const model=q.essayGuide?.modelAnswer;
  if(model){
    return ESSAY_STAGES.map(([key,badge,fallbackTitle])=>{
      const part=model[key]||{};
      const heading=part.title||fallbackTitle;
      const body=(part.content||'').trim();
      return body?`【${badge}｜${heading}】\n${body}`:'';
    }).filter(Boolean).join('\n\n');
  }
  return (q.referenceAnswer||q.explanation||'').trim();
}
function renderEssayModelInnerHtml(q){
  const guide=q.essayGuide, model=guide?.modelAnswer, analysis=guide?.analysis;
  if(!model)return `<div class="essay-legacy-text" data-speech-segment="legacy">${esc(q.referenceAnswer||'待補充')}</div>`;
  const blind=Boolean(state.essayBlindMode);
  const revealedCount=ESSAY_STAGES.filter(([key])=>state.essayRevealedStages.has(key)).length;
  const allRevealed=revealedCount===ESSAY_STAGES.length;
  const theoryHints=analysis?.theoriesAndLaws||[];
  const blindBanner=blind
    ? `<div class="essay-blind-banner" role="region" aria-label="盲測主動回憶提示">
        <div class="essay-blind-head">
          <div><strong>🧠 骨架盲測練習中</strong><span>先看題目、段落標題與理論清單在腦中構思大綱，點擊單段卡片即可揭曉比對（已揭曉 ${revealedCount} / ${ESSAY_STAGES.length} 段）</span></div>
          <button type="button" class="essay-action-btn" id="toggleRevealAllStages">${allRevealed?'全部重遮':'全部揭曉'}</button>
        </div>
        ${theoryHints.length?`<div class="essay-blind-hints"><small>💡 盲測回憶提示：核心理論與法規清單</small><div class="essay-chip-list">${theoryHints.map(item=>`<span class="essay-concept-chip">${esc(item)}</span>`).join('')}</div></div>`:''}
      </div>`
    : '';
  const stagesHtml=`<div class="essay-stages">${ESSAY_STAGES.map(([key,badge,fallbackTitle])=>{
    const part=model[key]||{};
    const heading=part.title||fallbackTitle;
    const isRevealed=!blind||state.essayRevealedStages.has(key);
    if(blind&&!isRevealed){
      return `<article class="essay-stage essay-stage-${key} is-blind-masked" data-speech-segment="${key}" data-blind-stage="${key}" role="button" tabindex="0" aria-expanded="false" aria-label="點擊揭曉${badge}段：${esc(heading)}">
        <header class="essay-stage-head"><span class="essay-stage-badge">${badge}</span><strong>${esc(heading)}</strong><span class="essay-stage-pill">點擊揭曉</span></header>
        <div class="essay-stage-mask"><span class="essay-mask-icon">👁</span><span>內文已遮蔽 — 先在腦中回想「${badge}｜${esc(heading)}」要點，點擊此卡片即可揭曉比對</span></div>
      </article>`;
    }
    return `<article class="essay-stage essay-stage-${key} ${blind?'is-blind-revealed':''}" data-speech-segment="${key}" data-blind-stage="${key}">
      <header class="essay-stage-head"><span class="essay-stage-badge">${badge}</span><strong>${esc(heading)}</strong>${blind?`<button type="button" class="essay-remask-btn" data-remask-stage="${key}">重新遮蔽</button>`:''}</header>
      <div class="essay-stage-text">${esc(part.content||'待補充')}</div>
    </article>`;
  }).join('')}</div>`;
  return `${blindBanner}${stagesHtml}`;
}
function bindEssayModelEvents(q){
  const body=$('#essayModelBody');
  if(!body)return;
  const rerenderModel=()=>{
    body.innerHTML=renderEssayModelInnerHtml(q);
    bindEssayModelEvents(q);
    syncEssaySpeechUI(false);
  };
  const revealAllBtn=$('#toggleRevealAllStages');
  if(revealAllBtn){
    revealAllBtn.onclick=()=>{
      const allDone=ESSAY_STAGES.every(([key])=>state.essayRevealedStages.has(key));
      state.essayRevealedStages=allDone?new Set():new Set(ESSAY_STAGES.map(([key])=>key));
      rerenderModel();
    };
  }
  body.querySelectorAll('.essay-stage.is-blind-masked[data-blind-stage]').forEach(card=>{
    const reveal=()=>{
      state.essayRevealedStages=window.essayStudyTools
        ? window.essayStudyTools.toggleRevealedStage(state.essayRevealedStages,card.dataset.blindStage)
        : new Set([...state.essayRevealedStages,card.dataset.blindStage]);
      rerenderModel();
    };
    card.onclick=reveal;
    card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();reveal()}};
  });
  body.querySelectorAll('[data-remask-stage]').forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      state.essayRevealedStages.delete(btn.dataset.remaskStage);
      rerenderModel();
    };
  });
}
function getSubjectExportEssays(q){
  const targetExam=examOf(q);
  const inList=state.currentList.filter(item=>item&&item.type==='essay'&&examOf(item)===targetExam&&item.subject===q.subject);
  if(inList.length>1)return inList;
  const allInSubject=state.questions.filter(item=>item&&item.type==='essay'&&examOf(item)===targetExam&&item.subject===q.subject);
  return allInSubject.length?allInSubject:[q];
}
async function copyTextToClipboard(text){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta=document.createElement('textarea');
  ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
}
function renderEssaySprintBarHtml(q){
  const speechOk=isSpeechSupported();
  const sp=state.essaySpeech;
  const mp3Entry=getEssayAudioEntry(q);
  const hasAnyAudio=Boolean(mp3Entry||speechOk);
  const isThisMp3Active=Boolean(sp.questionId===q.id&&sp.mode==='mp3');
  const pos=window.essayStudyTools?window.essayStudyTools.essayPositionInfo(state.currentList,state.currentIndex):{position:1,total:1,prevIndex:-1,nextIndex:-1};
  const hasModel=Boolean(q.essayGuide?.modelAnswer);
  const exportEssays=getSubjectExportEssays(q);
  const progressBarHtml=mp3Entry
    ? `<div class="essay-audio-progress-row" aria-label="名師有聲課播放進度">
        <button type="button" class="essay-seek-btn" id="essayAudioSeekBack" aria-label="倒退 15 秒" ${isThisMp3Active&&sp.duration>0?'':'disabled'}>↺ 15s</button>
        <span class="essay-audio-time" id="essayAudioCurrent">${formatAudioTimeText(isThisMp3Active?sp.currentTime:0)}</span>
        <input type="range" id="essayAudioSeek" class="essay-seek-bar" min="0" max="1000" step="1" value="${isThisMp3Active&&sp.duration>0?Math.round((sp.currentTime/sp.duration)*1000):0}" aria-label="拖曳調整播放進度" ${isThisMp3Active&&sp.duration>0?'':'disabled'}>
        <span class="essay-audio-time" id="essayAudioDuration">${formatAudioTimeText(isThisMp3Active?sp.duration:0)}</span>
        <button type="button" class="essay-seek-btn" id="essayAudioSeekFwd" aria-label="快轉 15 秒" ${isThisMp3Active&&sp.duration>0?'':'disabled'}>15s ↻</button>
      </div>`
    : '';
  const voicePickerInner=speechOk
    ? `<div class="essay-voice-row">
        <label class="essay-voice-picker" for="essayVoiceSelect">
          <span>🎙 內建朗讀聲音</span>
          <select id="essayVoiceSelect" class="essay-voice-select" aria-label="選擇中文朗讀聲音">${buildVoiceOptionsHtml()}</select>
        </label>
        <p class="essay-voice-tip">💡 離線或尚未綁定雲端 MP3 時自動使用瀏覽器內建語音；Edge 可選「★ HsiaoChen Online (Natural)」，iOS/Mac 可於系統「輔助使用＞語音內容」下載進階版聲音。</p>
      </div>`
    : '';
  const voiceBlockHtml=mp3Entry&&speechOk
    ? `<details class="essay-tts-fallback-box"><summary>內建語音朗讀備援設定（離線自動降級）</summary>${voicePickerInner}</details>`
    : voicePickerInner;
  const speechControls=hasAnyAudio
    ? `<div class="essay-audio-head">
        <span id="essayAudioModeBadge" class="essay-audio-badge ${mp3Entry?'is-mp3':'is-tts'}">${mp3Entry?'🎧 名師有聲課（MP3）':'🎙 內建語音朗讀'}</span>
        ${mp3Entry&&mp3Entry.title?`<small class="essay-audio-track-title">${esc(mp3Entry.title)}</small>`:''}
      </div>
      <div class="essay-speech-row">
        <button type="button" class="essay-sprint-btn essay-speech-play ${sp.status==='playing'?'is-active':''}" id="essaySpeechPlay" aria-pressed="${sp.status==='playing'}">${mp3Entry?(sp.status==='playing'?'🎧 播放中':(sp.status==='paused'?'▶ 繼續播放':'🎧 播放名師有聲課')):(sp.status==='playing'?'🔊 朗讀中':(sp.status==='paused'?'▶ 繼續朗讀':'🔊 朗讀本題'))}</button>
        <button type="button" class="essay-sprint-btn" id="essaySpeechPause" ${sp.status==='idle'?'disabled':''}>${sp.status==='paused'?'▶ 繼續':'⏸ 暫停'}</button>
        <button type="button" class="essay-sprint-btn" id="essaySpeechStop" ${sp.status==='idle'?'disabled':''}>⏹ 停止</button>
        <div class="speech-rate-group" role="group" aria-label="播放語速">${SPEECH_RATES.map(r=>`<button type="button" class="speech-rate-btn ${sp.rate===r?'is-active':''}" data-speech-rate="${r}" aria-pressed="${sp.rate===r}">${formatRateLabel(r)}</button>`).join('')}</div>
      </div>
      ${progressBarHtml}
      <div class="essay-commute-row">
        <label class="commute-toggle"><input type="checkbox" id="essayCommuteToggle" ${sp.continuous?'checked':''}><span>🔁 自動連播下一題（iPhone 鎖屏無縫續播）</span></label>
        <div class="essay-status-wrap">
          <span id="essaySpeechStatus" class="speech-status" aria-live="polite">${mp3Entry?(mp3Entry.sourceKind==='cdn'?'已連結永久高速 CDN 名師有聲課 MP3，鎖屏放口袋可自動連播下一題':'已連結雲端名師有聲課 MP3，鎖屏放口袋可自動連播下一題'):'依序朗讀：題目 → 起 → 承 → 轉 → 合 → 核心理論與法規清單'}</span>
          ${speechOk?`<button type="button" id="essayUseTtsFallback" class="essay-sprint-btn essay-fallback-btn ${sp.mp3Failed?'':'hidden'}">🔊 改用內建語音朗讀本題</button>`:''}
        </div>
      </div>
      ${voiceBlockHtml}`
    : '';
  const exportControls=`<div class="essay-export-row">
    <div class="essay-export-head"><span>🎧 匯出自然口語講稿（適配 NotebookLM / Gemini 聽讀）</span></div>
    <div class="essay-export-actions">
      <button type="button" class="essay-sprint-btn essay-export-primary" id="copyAndOpenNotebookLm">🚀 複製講稿並開啟 NotebookLM</button>
      <button type="button" class="essay-sprint-btn essay-export-btn" id="copyPodcastPrompt">🎙 複製 Podcast 雙人對談提示詞</button>
      <button type="button" class="essay-sprint-btn essay-export-btn" id="copyNaturalAudio">📋 複製單題口語講稿</button>
      <button type="button" class="essay-sprint-btn essay-export-btn" id="exportSubjectAudioTxt">📦 匯出本考科講稿（${exportEssays.length} 題 .txt）</button>
    </div>
    <p id="essayExportFeedback" class="essay-export-feedback hidden" role="status" aria-live="polite"></p>
  </div>`;
  const navControls=pos.total>1
    ? `<div class="essay-nav-inline">
        <button type="button" class="essay-action-btn" id="essayPrevBtn" ${pos.prevIndex<0?'disabled':''}>‹ 上一題</button>
        <span class="essay-nav-count">題單申論 ${pos.position} / ${pos.total}</span>
        <button type="button" class="essay-action-btn" id="essayNextBtn" ${pos.nextIndex<0?'disabled':''}>下一題 ›</button>
      </div>`
    : '';
  return `<section class="essay-sprint-bar card" aria-label="申論衝刺訓練控制列">
    <div class="essay-sprint-top">
      <div class="essay-sprint-title"><span class="eyebrow">考前衝刺工具</span><strong>聽讀記憶與主動回憶</strong></div>
      <div class="essay-sprint-quick">
        ${hasModel?`<button type="button" class="essay-sprint-btn essay-blind-toggle ${state.essayBlindMode?'is-active':''}" id="toggleBlindMode" aria-pressed="${state.essayBlindMode}">${state.essayBlindMode?'🧠 盲測模式：開啟':'🧠 盲測練習模式'}</button>`:''}
        ${navControls}
      </div>
    </div>
    ${speechControls}
    ${exportControls}
  </section>`;
}
function renderEssayAnswersHtml(q){
  const guide=q.essayGuide, model=guide?.modelAnswer, analysis=guide?.analysis;
  const notice=q.aiContent?.limitations||'非考選部官方標準答案或評分依據；法規與實務請以考試當年度有效規定為準。';
  const analysisContent=analysis
    ? `<div class="essay-analysis-grid">
        <section class="essay-analysis-block"><h4><span>🎯</span> 審題與破題關鍵</h4><ul>${(analysis.focusAndTraps||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>
        <section class="essay-analysis-block" data-speech-segment="theories"><h4><span>📚</span> 核心理論與法規清單</h4><div class="essay-chip-list">${(analysis.theoriesAndLaws||[]).map(item=>`<span class="essay-concept-chip">${esc(item)}</span>`).join('')}</div></section>
        <section class="essay-analysis-block"><h4><span>✦</span> 架構與配分要點</h4><ul>${(analysis.scoringRubric||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>
      </div>`
    : `<div class="essay-legacy-text">${esc(q.explanation||'待補充')}</div>`;
  return `<div class="essay-answers">
    <section class="answer-box essay-model-card">
      <div class="essay-card-head">
        <h3><span>01</span> AI 參考擬答（起・承・轉・合）</h3>
        <div class="essay-card-actions">
          <button type="button" class="essay-action-btn" id="toggleEssayModel" aria-expanded="true">收合擬答</button>
          <button type="button" class="essay-action-btn" id="copyEssayModel">複製擬答</button>
        </div>
      </div>
      <p class="essay-disclaimer">${model?'結構化四段式參考擬答｜':'參考擬答（舊版格式）｜'}${esc(notice)}</p>
      <div id="essayModelBody" class="essay-model-body">${renderEssayModelInnerHtml(q)}</div>
    </section>
    <section class="answer-box essay-analysis-card">
      <div class="essay-card-head">
        <h3><span>02</span> 答題解析與得分要點</h3>
      </div>
      ${analysisContent}
      <p class="essay-disclaimer essay-disclaimer-foot">${esc(notice)}</p>
    </section>
  </div>`;
}
function renderEssayHtml(q,context){
  if(state.essayLastQuestionId!==q.id){
    state.essayRevealedStages=new Set();
    state.essayLastQuestionId=q.id;
  }
  const existing=state.essayPractices.find(item=>item.questionId===q.id)||{id:`essay-${q.id}`,questionId:q.id,draft:'',elapsedSeconds:0,selfCheck:{}};
  state.essayStartedAt=Date.now();
  return `${context}${renderEssaySprintBarHtml(q)}<div class="essay-layout"><article class="question-panel" data-speech-segment="prompt"><span class="eyebrow">申論題</span><p class="question-text">${esc(q.prompt)}</p><div class="essay-timer">作答計時：<strong id="essayTimer">${Math.floor(existing.elapsedSeconds/60)}:${String(existing.elapsedSeconds%60).padStart(2,'0')}</strong></div><label class="essay-label" for="essayDraft">我的擬答（自動暫存）</label><textarea id="essayDraft" class="essay-draft" placeholder="在此輸入擬答；內容只儲存在這台裝置。">${esc(existing.draft)}</textarea><div class="self-check"><strong>自評檢核</strong>${['回應題幹每個小問','說明概念或法規依據','提出可執行的實務作法','補充倫理、限制或配套','結論回扣題旨'].map((label,index)=>`<label><input type="checkbox" data-check="${index}" ${existing.selfCheck?.[index]?'checked':''}>${label}</label>`).join('')}</div><button class="primary" id="saveEssay">儲存本次練習</button></article>${renderEssayAnswersHtml(q)}</div>`;
}
function saveEssayPractice(q,completed=false){
  const draft=$('#essayDraft')?.value||'', current=state.essayPractices.find(item=>item.questionId===q.id), selfCheck={};document.querySelectorAll('[data-check]').forEach(item=>selfCheck[item.dataset.check]=item.checked);
  const record={id:current?.id||`essay-${q.id}`,questionId:q.id,subject:q.subject,examType:examOf(q),draft,elapsedSeconds:(current?.elapsedSeconds||0)+Math.max(0,Math.floor((Date.now()-state.essayStartedAt)/1000)),selfCheck,updatedAt:new Date().toISOString(),completed};
  const index=state.essayPractices.findIndex(item=>item.questionId===q.id);if(index>=0)state.essayPractices[index]=record;else state.essayPractices.push(record);save();return record;
}
function questionTools(q){const tags=state.tags[q.id]||[],source=q.source;return `<section class="question-tools card"><h3>學習筆記與標籤</h3><textarea id="questionNote" class="essay-draft" placeholder="記下易錯觀念、法規年份或複習提醒">${esc(state.notes[q.id]||'')}</textarea><div class="tag-list">${tags.map(tag=>`<button class="tag" data-remove-tag="${esc(tag)}">${esc(tag)} ×</button>`).join('')}</div><div class="tag-input"><input id="tagInput" placeholder="新增自訂標籤"><button id="addTag" class="row">加入</button></div>${source?`<details class="source-details"><summary>官方試題／答案來源</summary><p><a href="${esc(source.sourceUrl)}" target="_blank" rel="noopener">官方試題</a>　<a href="${esc(source.answerSourceUrl)}" target="_blank" rel="noopener">官方答案</a></p><p>答案版本：${esc(source.answerVersion)}；核對日期：${esc(source.verifiedAt)}</p>${source.correctionSourceUrl?`<p><a href="${esc(source.correctionSourceUrl)}" target="_blank" rel="noopener">官方更正答案</a></p>`:''}</details>`:''}${q.acceptedAnswers?`<div class="errata-note">勘誤註記：依官方更正，本題作答 ${esc(q.acceptedAnswers.join(' 或 '))} 均給分。</div>`:''}${state.errataNotes[q.id]?`<div class="errata-note">我的勘誤註記：${esc(state.errataNotes[q.id])}</div>`:''}</section>`}
function bindQuestionTools(q){let timer;$('#questionNote').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{state.notes[q.id]=$('#questionNote').value;save()},400)};$('#addTag').onclick=()=>{const tag=$('#tagInput').value.trim();if(tag){state.tags[q.id]=[...new Set([...(state.tags[q.id]||[]),tag])];state.customTags=[...new Set([...state.customTags,tag])];save();renderQuestion()}};document.querySelectorAll('[data-remove-tag]').forEach(button=>button.onclick=()=>{state.tags[q.id]=(state.tags[q.id]||[]).filter(tag=>tag!==button.dataset.removeTag);save();renderQuestion()})}
function saveResume(){state.resume={examType:state.examType,listTitle:state.listTitle||'練習題單',questionIds:state.currentList.map(q=>q.id),currentIndex:state.currentIndex,updatedAt:new Date().toISOString()};save()}
function recordPracticeAttempt(q,answer,correct){
  state.attempts.push({id:`a-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,questionId:q.id,subject:q.subject,examType:examOf(q),answer,correct,at:new Date().toISOString(),mode:'practice'});
  if(state.attempts.length>5000)state.attempts=state.attempts.slice(-5000);
  const index=state.reviews.findIndex(item=>item.questionId===q.id);
  if(!correct||index>=0){const scheduled=studyEngine.scheduleReview(index>=0?state.reviews[index]:null,q,correct);if(index>=0)state.reviews[index]=scheduled;else state.reviews.push(scheduled)}
}
function renderQuestion(){
  if(state.essayInterval){clearInterval(state.essayInterval);state.essayInterval=null}
  const q=state.currentList[state.currentIndex], letters=['A','B','C','D'];
  if(state.essaySpeech.status!=='idle'&&state.essaySpeech.questionId!==q.id)stopEssaySpeech();
  title.textContent=q.type==='essay'?'申論題':`第 ${state.currentIndex+1}／${state.currentList.length} 題`;
  const accepted=q.acceptedAnswers||[q.answer],passed=accepted.includes(state.selected);const opts=q.options.map((o,i)=>{const l=letters[i];let cls=state.selected===l?'selected ':'';if(state.submitted&&accepted.includes(l))cls+='correct';else if(state.submitted&&l===state.selected)cls+='incorrect';return `<button class="row option ${cls}" data-letter="${l}" ${state.submitted?'disabled':''}><span class="letter">${l}</span><span>${esc(o)}</span></button>`}).join('');
  const result=state.submitted?`<div class="result ${passed?'good':'bad'}">${passed?'✓ 答對了':'✕ 正確答案：'+esc(accepted.join(' 或 '))}</div>${q.explanation?`<div class="answer-box"><h3>💡 完整詳解</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.explanation)}</div><p class="muted">詳解為學習輔助；選擇題答案以考選部公告及更正答案為準。法規題請以該考試年度有效法規為準。</p></div>`:''}`:'';
  const progress=Math.round((state.currentIndex+1)/state.currentList.length*100);
  const questionExam=examConfigs[examOf(q)];
  const conceptContext=q.conceptLink?`<aside class="concept-question-context"><span class="eyebrow">概念延伸題</span><h3>連結：${esc(q.conceptLink.theory)}</h3><p>本題命中「${esc(q.conceptLink.terms.join('、'))}」。${esc(q.conceptLink.explanation)}</p><small>此題未直接提及 ${esc(q.conceptLink.scholar)}；此連結僅供理論統整與複習，不改變官方題意或答案。</small></aside>`:'';
  const context=`${conceptContext}<div class="question-context"><span class="track-chip ${questionExam.accent}">${questionExam.label}</span><span>${q.year} 第 ${q.session} 次</span><span>${esc(q.subject)}</span><button class="star" id="star" aria-label="收藏">${state.favorites.has(q.id)?'★':'☆'}</button></div>`;
  const progressCard=`<aside class="progress-card"><div class="progress-heading"><span>練習進度</span><strong>${state.currentIndex+1} / ${state.currentList.length}</strong></div><div class="progress-track"><i style="width:${progress}%"></i></div><p>${state.submitted?'已完成本題解析，可前往下一題。':'選擇答案後送出，即可查看完整詳解。'}</p></aside>`;
  app.innerHTML=(q.type==='essay'?renderEssayHtml(q,context):`${context}<div class="question-layout"><section class="question-panel"><div class="question-kicker"><span>單選題</span><strong>題單位置 ${state.currentIndex+1} / ${state.currentList.length}・官方第 ${q.number} 題</strong></div><p class="question-text">${esc(q.prompt)}</p><div class="options">${opts}</div><button id="submit" class="primary" ${!state.selected&&!state.submitted?'disabled':''}>${state.submitted?(state.currentIndex+1<state.currentList.length?'下一題 →':'完成練習'):'確認答案'}</button></section><aside class="answer-column">${result||progressCard}</aside></div>`)+questionTools(q);
  $('#star').onclick=()=>{state.favorites.has(q.id)?state.favorites.delete(q.id):state.favorites.add(q.id);save();renderQuestion()};
  if(q.type==='essay'){
    let draftTimer;$('#essayDraft').oninput=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveEssayPractice(q),500)};
    $('#saveEssay').onclick=()=>{saveEssayPractice(q,true);$('#saveEssay').textContent='已儲存';};
    bindEssayModelEvents(q);
    syncEssaySpeechUI(false);
    if($('#essaySpeechPlay'))$('#essaySpeechPlay').onclick=()=>{
      if(state.essaySpeech.status==='playing'&&state.essaySpeech.questionId===q.id)pauseEssaySpeech();
      else if(state.essaySpeech.status==='paused'&&state.essaySpeech.questionId===q.id)resumeEssaySpeech(q);
      else startEssaySpeech(q);
    };
    if($('#essaySpeechPause'))$('#essaySpeechPause').onclick=()=>{
      if(state.essaySpeech.status==='playing')pauseEssaySpeech();
      else if(state.essaySpeech.status==='paused')resumeEssaySpeech(q);
    };
    if($('#essaySpeechStop'))$('#essaySpeechStop').onclick=()=>stopEssaySpeech();
    if($('#essayUseTtsFallback'))$('#essayUseTtsFallback').onclick=()=>startTtsEssaySpeech(q,'已切換為內建語音朗讀本題');
    document.querySelectorAll('[data-speech-rate]').forEach(btn=>btn.onclick=()=>setEssaySpeechRate(Number(btn.dataset.speechRate),q));
    if($('#essayVoiceSelect')){
      populateEssayVoiceSelect();
      $('#essayVoiceSelect').onchange=e=>setEssaySpeechVoice(e.target.value,q);
    }
    if($('#essayCommuteToggle'))$('#essayCommuteToggle').onchange=e=>{state.essaySpeech.continuous=Boolean(e.target.checked);savePreferredAutoNext(state.essaySpeech.continuous)};
    if($('#essayAudioSeekBack'))$('#essayAudioSeekBack').onclick=()=>seekLectureAudioBy(-15);
    if($('#essayAudioSeekFwd'))$('#essayAudioSeekFwd').onclick=()=>seekLectureAudioBy(15);
    if($('#essayAudioSeek')){
      const seekEl=$('#essayAudioSeek');
      seekEl.oninput=()=>{
        const sp=state.essaySpeech;
        if(sp.mode!=='mp3'||!sp.duration)return;
        sp.seeking=true;
        const previewSec=(Number(seekEl.value)/1000)*sp.duration;
        if($('#essayAudioCurrent'))$('#essayAudioCurrent').textContent=formatAudioTimeText(previewSec);
      };
      seekEl.onchange=()=>{
        const sp=state.essaySpeech;
        sp.seeking=false;
        if(sp.mode!=='mp3'||!lectureAudioEl||!sp.duration)return;
        const targetSec=(Number(seekEl.value)/1000)*sp.duration;
        try{lectureAudioEl.currentTime=targetSec}catch(_){}
        sp.currentTime=targetSec;
        syncEssayAudioProgressUI();
        updateMediaSessionPositionState();
      };
    }
    if($('#toggleBlindMode'))$('#toggleBlindMode').onclick=()=>{
      state.essayBlindMode=!state.essayBlindMode;
      state.essayRevealedStages=new Set();
      const btn=$('#toggleBlindMode'), body=$('#essayModelBody'), toggleBtn=$('#toggleEssayModel');
      if(btn){
        btn.classList.toggle('is-active',state.essayBlindMode);
        btn.setAttribute('aria-pressed',String(state.essayBlindMode));
        btn.textContent=state.essayBlindMode?'🧠 盲測模式：開啟':'🧠 盲測練習模式';
      }
      if(body){
        if(state.essayBlindMode&&body.classList.contains('collapsed')){
          body.classList.remove('collapsed');
          if(toggleBtn){toggleBtn.setAttribute('aria-expanded','true');toggleBtn.textContent='收合擬答'}
        }
        body.innerHTML=renderEssayModelInnerHtml(q);
        bindEssayModelEvents(q);
        syncEssaySpeechUI(false);
      }
    };
    const pos=window.essayStudyTools?window.essayStudyTools.essayPositionInfo(state.currentList,state.currentIndex):{prevIndex:-1,nextIndex:-1};
    if($('#essayPrevBtn'))$('#essayPrevBtn').onclick=()=>{if(pos.prevIndex>=0){stopEssaySpeech();state.currentIndex=pos.prevIndex;saveResume();renderQuestion();scrollTo(0,0)}};
    if($('#essayNextBtn'))$('#essayNextBtn').onclick=()=>{if(pos.nextIndex>=0){stopEssaySpeech();state.currentIndex=pos.nextIndex;saveResume();renderQuestion();scrollTo(0,0)}};
    const showExportFeedback=msg=>{
      const fb=$('#essayExportFeedback');
      if(!fb)return;
      fb.textContent=msg;
      fb.classList.remove('hidden');
    };
    if($('#copyAndOpenNotebookLm'))$('#copyAndOpenNotebookLm').onclick=async()=>{
      const btn=$('#copyAndOpenNotebookLm');
      const exportEssays=getSubjectExportEssays(q);
      const examLabel=examConfigs[examOf(q)]?.label||'社工師考試';
      const content=window.essayStudyTools
        ? window.essayStudyTools.buildSubjectNaturalAudioExport(exportEssays,q.subject,examLabel)
        : exportEssays.map(buildEssayCopyText).join('\n\n---\n\n');
      try{
        await copyTextToClipboard(content);
        btn.textContent='✓ 已複製講稿並開啟 NotebookLM';
        showExportFeedback(`已複製「${q.subject}」（共 ${exportEssays.length} 題）口語講稿並開啟 NotebookLM！進入筆記本後點選「新增來源 → 貼上的文字」即可貼上`);
      }catch(_){
        showExportFeedback('已為您開啟 NotebookLM；若剪貼簿受限，可改按「匯出本考科講稿（.txt）」直接上傳檔案。');
      }
      window.open('https://notebooklm.google.com/','_blank','noopener');
      setTimeout(()=>{if($('#copyAndOpenNotebookLm'))$('#copyAndOpenNotebookLm').textContent='🚀 複製講稿並開啟 NotebookLM'},2800);
    };
    if($('#copyPodcastPrompt'))$('#copyPodcastPrompt').onclick=async()=>{
      const btn=$('#copyPodcastPrompt');
      const examLabel=examConfigs[examOf(q)]?.label||'社工師考試';
      const promptText=window.essayStudyTools
        ? window.essayStudyTools.buildNotebookLmPodcastPrompt(q.subject,examLabel)
        : `請以繁體中文製作「${examLabel}・${q.subject}」雙人深度對談 Podcast。`;
      try{
        await copyTextToClipboard(promptText);
        btn.textContent='✓ 已複製對談提示詞';
        showExportFeedback('已複製 Podcast 雙人對談提示詞！可在 NotebookLM 右側「語音摘要 → 自訂」中直接貼上');
        setTimeout(()=>{if($('#copyPodcastPrompt'))$('#copyPodcastPrompt').textContent='🎙 複製 Podcast 雙人對談提示詞'},2400);
      }catch(_){
        btn.textContent='複製失敗';
        setTimeout(()=>{if($('#copyPodcastPrompt'))$('#copyPodcastPrompt').textContent='🎙 複製 Podcast 雙人對談提示詞'},2400);
      }
    };
    if($('#copyNaturalAudio'))$('#copyNaturalAudio').onclick=async()=>{
      const btn=$('#copyNaturalAudio');
      const text=window.essayStudyTools?window.essayStudyTools.formatEssayForNaturalAudio(q):buildEssayCopyText(q);
      if(!text)return;
      try{
        await copyTextToClipboard(text);
        btn.textContent='✓ 已複製口語講稿';
        showExportFeedback('已複製口語講稿！可直接貼入 Gemini App 或 NotebookLM 生成真人語音');
        setTimeout(()=>{if($('#copyNaturalAudio'))$('#copyNaturalAudio').textContent='📋 複製單題口語講稿'},2400);
      }catch(_){
        btn.textContent='複製失敗';
        showExportFeedback('無法存取剪貼簿，請改用「匯出本考科講稿（.txt）」下載。');
        setTimeout(()=>{if($('#copyNaturalAudio'))$('#copyNaturalAudio').textContent='📋 複製單題口語講稿'},2400);
      }
    };
    if($('#exportSubjectAudioTxt'))$('#exportSubjectAudioTxt').onclick=()=>{
      const exportEssays=getSubjectExportEssays(q);
      const examLabel=examConfigs[examOf(q)]?.label||'社工師考試';
      const content=window.essayStudyTools
        ? window.essayStudyTools.buildSubjectNaturalAudioExport(exportEssays,q.subject,examLabel)
        : exportEssays.map(buildEssayCopyText).join('\n\n---\n\n');
      const filename=window.essayStudyTools
        ? window.essayStudyTools.buildNaturalAudioFilename(q.subject,exportEssays.length)
        : `社工師口語講稿-${q.subject}.txt`;
      const blob=new Blob([content],{type:'text/plain;charset=utf-8'});
      const link=document.createElement('a');
      link.href=URL.createObjectURL(blob);
      link.download=filename;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(link.href),0);
      showExportFeedback(`已下載「${filename}」（共 ${exportEssays.length} 題）！可直接上傳至 Google NotebookLM 生成雙人深度對談 Podcast`);
    };
    if($('#toggleEssayModel'))$('#toggleEssayModel').onclick=()=>{
      const body=$('#essayModelBody'),btn=$('#toggleEssayModel');
      const collapsed=body.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded',String(!collapsed));
      btn.textContent=collapsed?'展開擬答':'收合擬答';
    };
    if($('#copyEssayModel'))$('#copyEssayModel').onclick=async()=>{
      const text=buildEssayCopyText(q),btn=$('#copyEssayModel');
      if(!text)return;
      try{
        await copyTextToClipboard(text);
        btn.textContent='已複製 ✓';setTimeout(()=>{if($('#copyEssayModel'))$('#copyEssayModel').textContent='複製擬答'},1800);
      }catch(_){btn.textContent='複製失敗';setTimeout(()=>{if($('#copyEssayModel'))$('#copyEssayModel').textContent='複製擬答'},1800);}
    };
    state.essayInterval=setInterval(()=>{if($('#essayTimer')){const current=state.essayPractices.find(item=>item.questionId===q.id);const seconds=(current?.elapsedSeconds||0)+Math.max(0,Math.floor((Date.now()-state.essayStartedAt)/1000));$('#essayTimer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}},1000);
  }
  bindQuestionTools(q);
  document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{if(!state.submitted){state.selected=b.dataset.letter;renderQuestion()}});
  if($('#submit'))$('#submit').onclick=()=>{if(state.submitted){if(++state.currentIndex<state.currentList.length){state.selected=null;state.submitted=false;saveResume();render()}else{state.resume=null;save();back.click()}}else{state.submitted=true;state.answered++;if(passed){state.correct++}else state.wrong.add(q.id);recordPracticeAttempt(q,state.selected,passed);saveResume();save();renderQuestion()}};
}
function renderDataManagement(){
  title.textContent='備份與還原';
  const info=window.learningDataStore.getDiagnostics(), warnings=info.warnings.length?`<div class="card"><h3>資料狀態提醒</h3><p>${esc(info.warnings.join(' '))}</p></div>`:'';
  app.innerHTML=`<section class="subject-hero"><span class="eyebrow">資料保護</span><h2>備份與還原</h2><p>學習紀錄儲存在此裝置。匯入只會合併收藏與錯題，且不會降低既有累計作答紀錄。</p><div><strong>${info.backend}</strong>・資料格式 v2</div></section><section class="quick-grid"><button class="row quick-card primary-quick" id="exportData"><span class="quick-icon">↓</span><div><span class="eyebrow">備份</span><h3>匯出學習紀錄</h3><p>下載 JSON 檔，供更換裝置或更新前保存。</p></div><b>匯出 →</b></button><label class="row quick-card" for="importData"><span class="quick-icon">↑</span><div><span class="eyebrow">還原</span><h3>合併匯入備份</h3><p>不會刪除本機既有收藏、錯題或累計紀錄。</p></div><b>選擇檔案 →</b><input id="importData" type="file" accept="application/json,.json" hidden></label></section><div id="dataNotice" class="card muted">${info.migrated?'已完成舊版本機資料遷移，原始資料仍保留。':'可隨時匯出一份備份檔。'}</div>${warnings}`;
  $('#exportData').onclick=async()=>{
    const backup=await window.learningDataStore.exportBackup();
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=`social-worker-quiz-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);
    $('#dataNotice').textContent='備份檔已下載。請將檔案存放在安全位置。';
  };
  $('#importData').onchange=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{applyLearningState(await window.learningDataStore.importBackup(await file.text()));$('#dataNotice').textContent='已完成安全合併匯入；既有紀錄沒有被刪除。';}
    catch(error){$('#dataNotice').textContent=`無法匯入：${error.message}`;}
    event.target.value='';
  };
}
function renderMockSetup(){
  title.textContent='分科模擬考';const subjects=socialSubjects;
  app.innerHTML=`<section class="subject-hero"><span class="eyebrow">國考模擬</span><h2>40 題分科模擬</h2><p>交卷前不顯示答案。完成後僅呈現選擇題成績，不能當作整科國考成績。</p></section><button class="row subject-random" id="fullMock"><span class="quick-icon">◎</span><div><span class="eyebrow">五科連續模擬</span><h3>200 題完整測驗題模擬</h3><p>依五科各 40 題出卷；結果分科分析，不等同完整國考成績。</p></div><b>開始 →</b></button><section class="exam-grid">${subjects.map(subject=>`<button class="row exam mock-choice" data-subject="${esc(subject)}"><h3>${esc(subject)}</h3><p>40 題・60 分測驗題練習</p></button>`).join('')}</section><div class="section-title">歷次模擬紀錄</div><section>${state.mockExams.filter(mock=>mock.completedAt).slice(-10).reverse().map(mock=>`<div class="card"><strong>${esc(mock.subject)}</strong><p class="muted">${new Date(mock.completedAt).toLocaleString('zh-TW')}・選擇題 ${mock.choiceScore}/${mock.choiceTotal}（${mock.choiceAccuracy}%）</p></div>`).join('')||'<div class="empty">尚無已完成模擬考</div>'}</section>`;
  document.querySelectorAll('.mock-choice').forEach(button=>button.onclick=()=>{
    const pool=examQuestions().filter(q=>q.subject===button.dataset.subject&&q.type==='multipleChoice');
    const mock={id:`mock-${Date.now()}`,subject:button.dataset.subject,examType:'socialWorker',questionIds:shuffle(pool).slice(0,40).map(q=>q.id),answers:{},flagged:[],startedAt:new Date().toISOString(),elapsedSeconds:0};
    state.mockExams.push(mock);state.activeMockId=mock.id;state.mockIndex=0;save();push('mock');
  });
  $('#fullMock').onclick=()=>{const ids=socialSubjects.flatMap(subject=>shuffle(examQuestions().filter(q=>q.subject===subject&&q.type==='multipleChoice')).slice(0,40).map(q=>q.id));const mock={id:`full-${Date.now()}`,subject:'五科連續模擬',examType:'socialWorker',questionIds:ids,answers:{},flagged:[],startedAt:new Date().toISOString(),elapsedSeconds:0,mode:'fullMock'};state.mockExams.push(mock);state.activeMockId=mock.id;state.mockIndex=0;save();push('mock')};
}
function activeMock(){return state.mockExams.find(mock=>mock.id===state.activeMockId)}
function renderMock(){
  const mock=activeMock();if(!mock){root('mockSetup');return}const questions=mock.questionIds.map(id=>state.questions.find(q=>q.id===id)).filter(Boolean),q=questions[state.mockIndex];if(!q){root('mockSetup');return}
  title.textContent=`模擬考 ${state.mockIndex+1}/${questions.length}`;const letters=['A','B','C','D'],elapsed=(mock.elapsedSeconds||0)+Math.floor((Date.now()-new Date(mock.startedAt))/1000);
  app.innerHTML=`<div class="question-context"><span>模擬考・${esc(mock.subject)}</span><span id="mockTimer">${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}</span></div><section class="question-panel"><div class="question-kicker"><span>單選題</span><strong>交卷前不顯示答案</strong></div><p class="question-text">${esc(q.prompt)}</p><div class="options">${q.options.map((option,index)=>`<button class="row option ${mock.answers[q.id]===letters[index]?'selected':''}" data-option="${letters[index]}"><span class="letter">${letters[index]}</span><span>${esc(option)}</span></button>`).join('')}</div><div class="mock-actions"><button id="flagMock" class="row">${mock.flagged.includes(q.id)?'★ 已標記待檢查':'☆ 標記待檢查'}</button><button id="submitMock" class="primary">交卷並查看結果</button></div></section><section class="mock-nav">${questions.map((question,index)=>`<button class="${index===state.mockIndex?'active':''} ${mock.answers[question.id]?'answered':''} ${mock.flagged.includes(question.id)?'flagged':''}" data-index="${index}">${index+1}</button>`).join('')}</section>`;
  document.querySelectorAll('[data-option]').forEach(button=>button.onclick=()=>{mock.answers[q.id]=button.dataset.option;save();renderMock()});
  document.querySelectorAll('[data-index]').forEach(button=>button.onclick=()=>{state.mockIndex=+button.dataset.index;save();renderMock()});
  $('#flagMock').onclick=()=>{mock.flagged.includes(q.id)?mock.flagged=mock.flagged.filter(id=>id!==q.id):mock.flagged.push(q.id);save();renderMock()};
  $('#submitMock').onclick=()=>{if(confirm(`確定交卷？尚有 ${questions.length-Object.keys(mock.answers).length} 題未作答。`)){mock.elapsedSeconds=(mock.elapsedSeconds||0)+Math.floor((Date.now()-new Date(mock.startedAt))/1000);const result=studyEngine.gradeMock(mock,questions);Object.assign(mock,result);for(const item of result.results){const question=state.questions.find(x=>x.id===item.questionId);if(question){state.attempts.push({id:`m-${Date.now()}-${item.questionId}`,questionId:question.id,subject:question.subject,examType:'socialWorker',answer:item.selected,correct:item.correct,at:new Date().toISOString(),mode:'mock'});if(!item.correct){state.wrong.add(question.id);const old=state.reviews.find(review=>review.questionId===question.id),scheduled=studyEngine.scheduleReview(old,question,false);if(old)Object.assign(old,scheduled);else state.reviews.push(scheduled)}}}save();push('mockResult')}};
}
function renderMockResult(){
  const mock=activeMock();if(!mock?.completedAt){root('mockSetup');return}title.textContent='模擬考結果';const wrong=(mock.results||[]).filter(item=>!item.correct).map(item=>state.questions.find(q=>q.id===item.questionId)).filter(Boolean);
  const bySubject={};(mock.results||[]).forEach(item=>{const q=state.questions.find(question=>question.id===item.questionId);if(q){const value=bySubject[q.subject]||{correct:0,total:0};value.total++;if(item.correct)value.correct++;bySubject[q.subject]=value}});
  app.innerHTML=`<section class="subject-hero"><span class="eyebrow">模擬結果</span><h2>${esc(mock.subject)}</h2><p>選擇題 ${mock.choiceScore}/${mock.choiceTotal} 題・${mock.choiceAccuracy}%</p><div>本結果僅為測驗題成績（60 分部分），不等同完整整科國考成績。</div></section><button class="primary" id="reviewMockWrong">檢視錯題與詳解</button><div class="section-title">分科成績分析</div>${Object.entries(bySubject).map(([subject,value])=>`<div class="card"><strong>${esc(subject)}</strong><p class="muted">${value.correct}/${value.total} 題・${Math.round(value.correct/value.total*100)}%</p></div>`).join('')}<div class="section-title">作答摘要</div><div class="card">作答時間：約 ${Math.ceil((mock.elapsedSeconds||0)/60)} 分鐘・標記待檢查 ${mock.flagged.length} 題</div>`;
  $('#reviewMockWrong').onclick=()=>openList('模擬考錯題',wrong);
}
function renderStats(){
  title.textContent='學習統計';const accuracy=state.answered?Math.round(state.correct/state.answered*100):0,config=activeConfig(),questions=examQuestions(),isPublic=state.examType==='publicSocialWorker',stats=studyEngine.subjectStats(state.attempts,state.examType),last7=studyEngine.lastSevenDays(state.attempts),weekly=studyEngine.weeklyTrend(state.attempts),bySubject=new Map(stats.map(item=>[item.subject,item]));
  app.innerHTML=`<div class="exam-context-badge">目前顯示：${config.label}</div><div class="stat-grid"><div class="card stat"><strong>${state.answered}</strong>累計作答</div><div class="card stat"><strong>${state.correct}</strong>答對題數</div><div class="card stat"><strong>${accuracy}%</strong>正確率</div><div class="card stat"><strong>${studyEngine.dueReviews(state.reviews,new Date(),state.examType).length}</strong>待複習錯題</div></div><div class="section-title">${isPublic?'科目表現':'五科學習表現'}</div><section>${config.subjects.map(subject=>{const item=bySubject.get(subject)||{answered:0,correct:0,accuracy:0};return `<div class="card"><strong>${esc(subject)}</strong><p class="muted">${item.answered} 題・答對 ${item.correct} 題・正確率 ${item.accuracy}%</p></div>`}).join('')}</section><div class="section-title">每週趨勢</div><div class="card">${weekly.map(item=>`${item.week.slice(5)}：${item.answered} 題${item.accuracy===null?'':'・'+item.accuracy+'%'}`).join('　')}</div><div class="section-title">近 7 天學習</div><div class="card">${last7.map(item=>`${item.date.slice(5)}：${item.answered} 題${item.accuracy===null?'':'・'+item.accuracy+'%'}`).join('　')}</div><div class="section-title">資料說明</div><div class="card">${isPublic?`收錄 ${config.period} 年公職社工師兩科考選部正式試題，共 ${questions.length} 題申論題。`:`收錄 2021–2026 年社工師五科考選部試題，共 ${questions.length.toLocaleString()} 題。`}<p class="muted">舊版只有累計資料，僅列為總摘要；各科與趨勢只從本次更新後的新作答紀錄開始計算。</p></div>`;
}
back.onclick=()=>{stopEssaySpeech();const last=state.stack.pop();state.view=last?.view||'library';state.selected=null;state.submitted=false;render()};
window.addEventListener('pagehide',()=>stopEssaySpeech());
window.addEventListener('beforeunload',()=>stopEssaySpeech());
tabs.onclick=e=>{const b=e.target.closest('[data-tab]');if(b)root(b.dataset.tab)};
window.addEventListener('online',()=>$('#offline').classList.add('hidden'));window.addEventListener('offline',()=>$('#offline').classList.remove('hidden'));
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').classList.remove('hidden')});
$('#install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#install').classList.add('hidden')}};
if('serviceWorker'in navigator){
  let reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;location.reload()}});
  navigator.serviceWorker.register('./service-worker.js').then(registration=>{
    const offerUpdate=()=>{if(registration.waiting){$('#update').classList.remove('hidden');$('#update').onclick=()=>registration.waiting.postMessage({type:'SKIP_WAITING'})}};
    offerUpdate();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',()=>{if(registration.installing?.state==='installed'&&navigator.serviceWorker.controller)offerUpdate()}));
  });
}
if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!navigator.standalone){setTimeout(()=>$('#safariInstall').classList.remove('hidden'),1200)}
async function loadQuestions(attempt=1){
  try {
    const response=await fetch('./questions.json',{cache:'no-cache'});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Invalid question data');
    const questions=await response.json();
    if(!Array.isArray(questions)||questions.length<2000)throw new Error('Incomplete question data');
    state.questions=questions;render();
  } catch(error) {
    if(attempt<3){setTimeout(()=>loadQuestions(attempt+1),attempt*1200);return}
    app.innerHTML='<div class="empty"><p>題庫下載未完成，請確認網路後再試一次。</p><button class="primary" id="retryLoad">重新載入題庫</button></div>';
    $('#retryLoad').onclick=()=>{app.innerHTML='<div class="loading">正在重新下載題庫⋯</div>';loadQuestions()};
  }
}
async function loadEssayAudioManifest(){
  try{
    const response=await fetch('./essay-audio-manifest.json',{cache:'no-cache'});
    if(!response.ok)return;
    const data=await response.json();
    if(data&&typeof data==='object'&&data.items&&typeof data.items==='object'){
      state.essayAudioManifest=data;
      if(state.view==='question'&&state.essaySpeech.status==='idle'&&state.currentList[state.currentIndex]?.type==='essay'){
        renderQuestion();
      }
    }
  }catch(_){/* Offline or missing manifest gracefully falls back to built-in TTS */}
}
async function bootstrap(){
  try{const loaded=await window.learningDataStore.initialize();applyLearningState(loaded.state);}
  catch(_){/* Keep the empty safe state; question loading must remain available. */}
  loadEssayAudioManifest();
  loadQuestions();
}
bootstrap();
