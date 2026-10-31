const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {
  questions: [], view: 'library', stack: [], currentList: [], currentIndex: 0,
  favorites: new Set(), wrong: new Set(), answered: 0, correct: 0, attempts: [], reviews: [], mockExams: [], essayPractices: [], resume: null, plan: {weeklyGoal:120,startDate:null},
  selected: null, submitted: false, examType: 'socialWorker', activeMockId: null, mockIndex: 0, essayStartedAt: null, essayInterval: null
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

function learningSnapshot(){return {favorites:[...state.favorites],wrong:[...state.wrong],answered:state.answered,correct:state.correct,examType:state.examType,attempts:state.attempts,reviews:state.reviews,mockExams:state.mockExams,essayPractices:state.essayPractices,resume:state.resume,plan:state.plan}}
function applyLearningState(saved){state.favorites=new Set(saved.favorites);state.wrong=new Set(saved.wrong);state.answered=saved.answered;state.correct=saved.correct;state.examType=saved.examType;state.attempts=saved.attempts||[];state.reviews=saved.reviews||[];state.mockExams=saved.mockExams||[];state.essayPractices=saved.essayPractices||[];state.resume=saved.resume||null;state.plan=saved.plan||{weeklyGoal:120,startDate:null}}
function save(){window.learningDataStore.save(learningSnapshot()).catch(()=>{});}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function push(view, data={}){state.stack.push({view:state.view});Object.assign(state,data);state.view=view;render()}
function root(view){state.view=view;state.stack=[];state.selected=null;state.submitted=false;render()}
function render(){
  app.dataset.view=state.view;
  back.classList.toggle('hidden', !state.stack.length); tabs.classList.toggle('hidden', state.view==='question');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.view));
  ({library:renderLibrary,wrong:()=>renderList('錯題複習',examQuestions().filter(q=>state.wrong.has(q.id))),favorites:()=>renderList('收藏題目',examQuestions().filter(q=>state.favorites.has(q.id))),stats:renderStats,subject:renderSubject,list:()=>renderList(state.listTitle,state.currentList),question:renderQuestion,data:renderDataManagement,mockSetup:renderMockSetup,mock:renderMock,mockResult:renderMockResult}[state.view]||renderLibrary)();
  scrollTo(0,0);
}
function renderLibrary(){
  const config=activeConfig(),questions=examQuestions(),subjects=config.subjects,isPublic=state.examType==='publicSocialWorker';
  const today=new Date(),days=Math.max(0,Math.ceil((Date.UTC(2027,1,20)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000)),due=studyEngine.dueReviews(state.reviews,today,state.examType),weak=studyEngine.subjectStats(state.attempts,state.examType)[0],resume=state.resume&&state.resume.examType===state.examType?state.resume:null;
  title.textContent=config.label;
  const accuracy=state.answered?Math.round(state.correct/state.answered*100):0;
  app.innerHTML=`<section class="exam-switcher" aria-label="選擇考試類別"><div><span class="eyebrow">考試類別</span><strong>選擇你的備考目標</strong></div>${Object.entries(examConfigs).map(([key,c])=>`<button class="exam-choice ${key===state.examType?'active':''} ${c.accent}" data-exam="${key}"><span class="exam-choice-icon">${key==='socialWorker'?'社':'公'}</span><span><b>${c.label}</b><small>${key==='socialWorker'?'專技高考・五大科目':'高考三級・兩大專業科目'}</small></span><i>${key===state.examType?'✓':'→'}</i></button>`).join('')}</section>
  ${state.examType==='socialWorker'?`<section class="study-dashboard"><div><span>116年第一次考試倒數</span><strong>${days} 天</strong><small>2027 年 2 月 20 日</small></div><button id="reviewDue"><span>今日待複習</span><strong>${due.length} 題</strong><small>${weak?`優先：${esc(weak.subject)}`:'先完成第一題練習'}</small></button><div><span>本週目標</span><strong>${state.plan.weeklyGoal} 題</strong><button id="editPlan">調整 14 週計畫</button></div></section>${resume?`<button class="row resume-card" id="resume"><span class="quick-icon">↺</span><div><span class="eyebrow">接續練習</span><h3>${esc(resume.listTitle||'上次題單')}</h3><p>從第 ${resume.currentIndex+1} 題繼續</p></div><b>繼續 →</b></button>`:''}`:''}
  <section class="hero ${config.accent}"><div><span class="eyebrow">${config.period} ${config.label}</span><h2>${isPublic?'準備公職社工師，從歷屆申論開始':'今天想從哪裡開始？'}</h2><p>${isPublic?'收錄考選部近五年正式試題，附 AI 擬答方向與參考答案。':'整合 2021–2026 歷屆試題、完整詳解與申論擬答。'}</p></div><div class="hero-stats"><div><strong>${questions.length.toLocaleString()}</strong><span>收錄題數</span></div><div><strong>${subjects.length}</strong><span>專業科目</span></div><div><strong>${config.period}</strong><span>收錄年度</span></div></div></section>
  <div class="desktop-toolbar"><div><h2>題庫總覽</h2><p>依科目練習，或直接開始今日測驗</p></div><label class="search-wrap"><span>⌕</span><input class="search" id="search" type="search" placeholder="搜尋題目關鍵字"></label></div>
  <section class="quick-grid"><button class="row quick-card primary-quick" id="random"><span class="quick-icon">↝</span><div><span class="eyebrow">快速開始</span><h3>${isPublic?'10 題隨機申論複習':'40 題隨機練習'}</h3><p>${isPublic?'從兩科近五年試題隨機抽題':'從所有歷屆選擇題智慧抽題'}</p></div><b>開始 →</b></button>
  <button class="row quick-card" id="essays"><span class="quick-icon">✎</span><div><span class="eyebrow">申論專區</span><h3>申論題總覽</h3><p>查看 AI 擬答架構與參考答案</p></div><b>瀏覽 →</b></button>
  <button class="row quick-card" id="mockStart"><span class="quick-icon">◷</span><div><span class="eyebrow">國考模擬</span><h3>40 題分科模擬</h3><p>計時、標記待檢查，交卷後查看詳解</p></div><b>開始 →</b></button>
  <button class="row quick-card" id="dataManagement"><span class="quick-icon">⇅</span><div><span class="eyebrow">資料保護</span><h3>備份與還原</h3><p>匯出或合併匯入本機學習紀錄</p></div><b>管理 →</b></button></section>
  <div class="section-heading"><div><span class="section-title">${isPublic?'兩大專業科目':'五大科目'}</span><p>選擇科目查看歷屆試題與隨機練習</p></div><span class="desktop-only">${config.period.replace('–',' — ')}</span></div><section class="subject-grid ${isPublic?'public-subject-grid':''}">${subjects.map((s,i)=>`<button class="row subject ${isPublic?'public-subject':''}" data-subject="${esc(s)}"><span class="subject-index">0${i+1}</span><div class="subject-copy"><span class="subject-kind">${subjectInfo[s][0]}</span><h3>${esc(s)}</h3><p>${subjectInfo[s][1]}</p></div><div class="subject-tail"><strong>${questions.filter(q=>q.subject===s).length}</strong><span>題</span><i>→</i></div></button>`).join('')}</section>`;
  document.querySelectorAll('.exam-choice').forEach(b=>b.onclick=()=>{state.examType=b.dataset.exam;save();state.stack=[];render()});
  $('#random').onclick=()=>openList(isPublic?'10 題隨機申論複習':'40 題隨機練習',shuffle(questions.filter(q=>isPublic?q.type==='essay':q.type==='multipleChoice')).slice(0,isPublic?10:40));
  $('#essays').onclick=()=>openList('申論題總覽',questions.filter(q=>q.type==='essay'));
  $('#mockStart').onclick=()=>push('mockSetup');
  $('#dataManagement').onclick=()=>push('data');
  if($('#resume'))$('#resume').onclick=()=>{const list=resume.questionIds.map(id=>state.questions.find(q=>q.id===id)).filter(Boolean);if(list.length){state.currentList=list;state.currentIndex=Math.min(resume.currentIndex,list.length-1);push('question')}};
  if($('#reviewDue'))$('#reviewDue').onclick=()=>{const reviewQuestions=due.map(item=>state.questions.find(q=>q.id===item.questionId)).filter(Boolean);if(reviewQuestions.length)openList('今日錯題複習',reviewQuestions);else if(weak){openList(`${weak.subject} 今日推薦`,shuffle(questions.filter(q=>q.subject===weak.subject&&q.type==='multipleChoice')).slice(0,10));}else openList('今日推薦練習',shuffle(questions.filter(q=>q.type==='multipleChoice')).slice(0,10));};
  if($('#editPlan'))$('#editPlan').onclick=()=>{const value=prompt('每週預計完成幾題？',state.plan.weeklyGoal);if(value&&Number(value)>0){state.plan.weeklyGoal=Math.floor(Number(value));save();render()}};
  document.querySelectorAll('.subject').forEach(b=>b.onclick=()=>push('subject',{activeSubject:b.dataset.subject}));
  $('#search').oninput=e=>{const q=e.target.value.trim();if(q.length>1) openList('搜尋結果',questions.filter(x=>x.prompt.includes(q)),false)};
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
  app.innerHTML=items.length?`<div class="list-summary"><div><span class="track-chip ${config.accent}">${config.label}</span><span class="eyebrow">練習題單</span><h2>${esc(name)}</h2></div><strong>${items.length}<small> 題</small></strong></div><section class="question-grid">${items.map((q,i)=>`<button class="row question-link ${q.type==='essay'?'essay':''}" data-i="${i}"><div class="question-number">${q.type==='essay'?'✎':String(i+1).padStart(2,'0')}</div><div class="question-preview"><span class="badge">${q.type==='essay'?'申論・含 AI 擬答與參考答案':'第 '+q.number+' 題'}</span><p>${esc(q.prompt)}</p><div class="meta">${q.year}・第 ${q.session} 次・${esc(q.subject)}</div></div><span class="row-arrow">→</span></button>`).join('')}</section>`:'<div class="empty">目前沒有題目</div>';
  document.querySelectorAll('.question-link').forEach(b=>b.onclick=()=>{state.currentList=items;state.currentIndex=+b.dataset.i;state.selected=null;state.submitted=false;saveResume();push('question')});
}
function renderEssayHtml(q,context){
  const existing=state.essayPractices.find(item=>item.questionId===q.id)||{id:`essay-${q.id}`,questionId:q.id,draft:'',elapsedSeconds:0,selfCheck:{}};
  state.essayStartedAt=Date.now();
  return `${context}<div class="essay-layout"><article class="question-panel"><span class="eyebrow">申論題</span><p class="question-text">${esc(q.prompt)}</p><div class="essay-timer">作答計時：<strong id="essayTimer">${Math.floor(existing.elapsedSeconds/60)}:${String(existing.elapsedSeconds%60).padStart(2,'0')}</strong></div><label class="essay-label" for="essayDraft">我的擬答（自動暫存）</label><textarea id="essayDraft" class="essay-draft" placeholder="在此輸入擬答；內容只儲存在這台裝置。">${esc(existing.draft)}</textarea><div class="self-check"><strong>自評檢核</strong>${['回應題幹每個小問','說明概念或法規依據','提出可執行的實務作法','補充倫理、限制或配套','結論回扣題旨'].map((label,index)=>`<label><input type="checkbox" data-check="${index}" ${existing.selfCheck?.[index]?'checked':''}>${label}</label>`).join('')}</div><button class="primary" id="saveEssay">儲存本次練習</button></article><div class="essay-answers"><div class="answer-box"><h3><span>01</span> 擬答方向</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.explanation||'待補充')}</div></div><div class="answer-box reference-answer"><h3><span>02</span> 參考答案</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.referenceAnswer||'待補充')}</div></div></div></div>`;
}
function saveEssayPractice(q,completed=false){
  const draft=$('#essayDraft')?.value||'', current=state.essayPractices.find(item=>item.questionId===q.id), selfCheck={};document.querySelectorAll('[data-check]').forEach(item=>selfCheck[item.dataset.check]=item.checked);
  const record={id:current?.id||`essay-${q.id}`,questionId:q.id,subject:q.subject,examType:examOf(q),draft,elapsedSeconds:(current?.elapsedSeconds||0)+Math.max(0,Math.floor((Date.now()-state.essayStartedAt)/1000)),selfCheck,updatedAt:new Date().toISOString(),completed};
  const index=state.essayPractices.findIndex(item=>item.questionId===q.id);if(index>=0)state.essayPractices[index]=record;else state.essayPractices.push(record);save();return record;
}
function saveResume(){state.resume={examType:state.examType,listTitle:state.listTitle||'練習題單',questionIds:state.currentList.map(q=>q.id),currentIndex:state.currentIndex,updatedAt:new Date().toISOString()};save()}
function recordPracticeAttempt(q,answer,correct){
  state.attempts.push({id:`a-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,questionId:q.id,subject:q.subject,examType:examOf(q),answer,correct,at:new Date().toISOString(),mode:'practice'});
  if(state.attempts.length>5000)state.attempts=state.attempts.slice(-5000);
  const index=state.reviews.findIndex(item=>item.questionId===q.id);
  if(!correct||index>=0){const scheduled=studyEngine.scheduleReview(index>=0?state.reviews[index]:null,q,correct);if(index>=0)state.reviews[index]=scheduled;else state.reviews.push(scheduled)}
}
function renderQuestion(){
  if(state.essayInterval){clearInterval(state.essayInterval);state.essayInterval=null}
  const q=state.currentList[state.currentIndex], letters=['A','B','C','D']; title.textContent=q.type==='essay'?'申論題':`第 ${state.currentIndex+1}／${state.currentList.length} 題`;
  const accepted=q.acceptedAnswers||[q.answer],passed=accepted.includes(state.selected);const opts=q.options.map((o,i)=>{const l=letters[i];let cls=state.selected===l?'selected ':'';if(state.submitted&&accepted.includes(l))cls+='correct';else if(state.submitted&&l===state.selected)cls+='incorrect';return `<button class="row option ${cls}" data-letter="${l}" ${state.submitted?'disabled':''}><span class="letter">${l}</span><span>${esc(o)}</span></button>`}).join('');
  const result=state.submitted?`<div class="result ${passed?'good':'bad'}">${passed?'✓ 答對了':'✕ 正確答案：'+esc(accepted.join(' 或 '))}</div>${q.explanation?`<div class="answer-box"><h3>💡 完整詳解</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.explanation)}</div><p class="muted">詳解為學習輔助；選擇題答案以考選部公告及更正答案為準。法規題請以該考試年度有效法規為準。</p></div>`:''}`:'';
  const progress=Math.round((state.currentIndex+1)/state.currentList.length*100);
  const questionExam=examConfigs[examOf(q)];
  const context=`<div class="question-context"><span class="track-chip ${questionExam.accent}">${questionExam.label}</span><span>${q.year} 第 ${q.session} 次</span><span>${esc(q.subject)}</span><button class="star" id="star" aria-label="收藏">${state.favorites.has(q.id)?'★':'☆'}</button></div>`;
  const progressCard=`<aside class="progress-card"><div class="progress-heading"><span>練習進度</span><strong>${state.currentIndex+1} / ${state.currentList.length}</strong></div><div class="progress-track"><i style="width:${progress}%"></i></div><p>${state.submitted?'已完成本題解析，可前往下一題。':'選擇答案後送出，即可查看完整詳解。'}</p></aside>`;
  app.innerHTML=q.type==='essay'?renderEssayHtml(q,context):`${context}<div class="question-layout"><section class="question-panel"><div class="question-kicker"><span>單選題</span><strong>${state.currentIndex+1} / ${state.currentList.length}</strong></div><p class="question-text">${esc(q.prompt)}</p><div class="options">${opts}</div><button id="submit" class="primary" ${!state.selected&&!state.submitted?'disabled':''}>${state.submitted?(state.currentIndex+1<state.currentList.length?'下一題 →':'完成練習'):'確認答案'}</button></section><aside class="answer-column">${result||progressCard}</aside></div>`;
  $('#star').onclick=()=>{state.favorites.has(q.id)?state.favorites.delete(q.id):state.favorites.add(q.id);save();renderQuestion()};
  if(q.type==='essay'){
    let draftTimer;$('#essayDraft').oninput=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveEssayPractice(q),500)};
    $('#saveEssay').onclick=()=>{saveEssayPractice(q,true);$('#saveEssay').textContent='已儲存';};
    state.essayInterval=setInterval(()=>{if($('#essayTimer')){const current=state.essayPractices.find(item=>item.questionId===q.id);const seconds=(current?.elapsedSeconds||0)+Math.max(0,Math.floor((Date.now()-state.essayStartedAt)/1000));$('#essayTimer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}},1000);
  }
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
  app.innerHTML=`<section class="subject-hero"><span class="eyebrow">國考模擬</span><h2>40 題分科模擬</h2><p>交卷前不顯示答案。完成後僅呈現選擇題成績，不能當作整科國考成績。</p></section><section class="exam-grid">${subjects.map(subject=>`<button class="row exam mock-choice" data-subject="${esc(subject)}"><h3>${esc(subject)}</h3><p>40 題・60 分測驗題練習</p></button>`).join('')}</section><div class="section-title">歷次模擬紀錄</div><section>${state.mockExams.filter(mock=>mock.completedAt).slice(-10).reverse().map(mock=>`<div class="card"><strong>${esc(mock.subject)}</strong><p class="muted">${new Date(mock.completedAt).toLocaleString('zh-TW')}・選擇題 ${mock.choiceScore}/${mock.choiceTotal}（${mock.choiceAccuracy}%）</p></div>`).join('')||'<div class="empty">尚無已完成模擬考</div>'}</section>`;
  document.querySelectorAll('.mock-choice').forEach(button=>button.onclick=()=>{
    const pool=examQuestions().filter(q=>q.subject===button.dataset.subject&&q.type==='multipleChoice');
    const mock={id:`mock-${Date.now()}`,subject:button.dataset.subject,examType:'socialWorker',questionIds:shuffle(pool).slice(0,40).map(q=>q.id),answers:{},flagged:[],startedAt:new Date().toISOString(),elapsedSeconds:0};
    state.mockExams.push(mock);state.activeMockId=mock.id;state.mockIndex=0;save();push('mock');
  });
}
function activeMock(){return state.mockExams.find(mock=>mock.id===state.activeMockId)}
function renderMock(){
  const mock=activeMock();if(!mock){root('mockSetup');return}const questions=mock.questionIds.map(id=>state.questions.find(q=>q.id===id)).filter(Boolean),q=questions[state.mockIndex];if(!q){root('mockSetup');return}
  title.textContent=`模擬考 ${state.mockIndex+1}/40`;const letters=['A','B','C','D'],elapsed=(mock.elapsedSeconds||0)+Math.floor((Date.now()-new Date(mock.startedAt))/1000);
  app.innerHTML=`<div class="question-context"><span>模擬考・${esc(mock.subject)}</span><span id="mockTimer">${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}</span></div><section class="question-panel"><div class="question-kicker"><span>單選題</span><strong>交卷前不顯示答案</strong></div><p class="question-text">${esc(q.prompt)}</p><div class="options">${q.options.map((option,index)=>`<button class="row option ${mock.answers[q.id]===letters[index]?'selected':''}" data-option="${letters[index]}"><span class="letter">${letters[index]}</span><span>${esc(option)}</span></button>`).join('')}</div><div class="mock-actions"><button id="flagMock" class="row">${mock.flagged.includes(q.id)?'★ 已標記待檢查':'☆ 標記待檢查'}</button><button id="submitMock" class="primary">交卷並查看結果</button></div></section><section class="mock-nav">${questions.map((question,index)=>`<button class="${index===state.mockIndex?'active':''} ${mock.answers[question.id]?'answered':''} ${mock.flagged.includes(question.id)?'flagged':''}" data-index="${index}">${index+1}</button>`).join('')}</section>`;
  document.querySelectorAll('[data-option]').forEach(button=>button.onclick=()=>{mock.answers[q.id]=button.dataset.option;save();renderMock()});
  document.querySelectorAll('[data-index]').forEach(button=>button.onclick=()=>{state.mockIndex=+button.dataset.index;save();renderMock()});
  $('#flagMock').onclick=()=>{mock.flagged.includes(q.id)?mock.flagged=mock.flagged.filter(id=>id!==q.id):mock.flagged.push(q.id);save();renderMock()};
  $('#submitMock').onclick=()=>{if(confirm(`確定交卷？尚有 ${questions.length-Object.keys(mock.answers).length} 題未作答。`)){mock.elapsedSeconds=(mock.elapsedSeconds||0)+Math.floor((Date.now()-new Date(mock.startedAt))/1000);const result=studyEngine.gradeMock(mock,questions);Object.assign(mock,result);for(const item of result.results){const question=state.questions.find(x=>x.id===item.questionId);if(question){state.attempts.push({id:`m-${Date.now()}-${item.questionId}`,questionId:question.id,subject:question.subject,examType:'socialWorker',answer:item.selected,correct:item.correct,at:new Date().toISOString(),mode:'mock'});if(!item.correct){state.wrong.add(question.id);const old=state.reviews.find(review=>review.questionId===question.id),scheduled=studyEngine.scheduleReview(old,question,false);if(old)Object.assign(old,scheduled);else state.reviews.push(scheduled)}}}save();push('mockResult')}};
}
function renderMockResult(){
  const mock=activeMock();if(!mock?.completedAt){root('mockSetup');return}title.textContent='模擬考結果';const wrong=(mock.results||[]).filter(item=>!item.correct).map(item=>state.questions.find(q=>q.id===item.questionId)).filter(Boolean);
  app.innerHTML=`<section class="subject-hero"><span class="eyebrow">模擬結果</span><h2>${esc(mock.subject)}</h2><p>選擇題 ${mock.choiceScore}/${mock.choiceTotal} 題・${mock.choiceAccuracy}%</p><div>本結果僅為測驗題成績（60 分部分），不等同完整整科國考成績。</div></section><button class="primary" id="reviewMockWrong">檢視錯題與詳解</button><div class="section-title">作答摘要</div><div class="card">作答時間：約 ${Math.ceil((mock.elapsedSeconds||0)/60)} 分鐘・標記待檢查 ${mock.flagged.length} 題</div>`;
  $('#reviewMockWrong').onclick=()=>openList('模擬考錯題',wrong);
}
function renderStats(){
  title.textContent='學習統計';const accuracy=state.answered?Math.round(state.correct/state.answered*100):0,config=activeConfig(),questions=examQuestions(),isPublic=state.examType==='publicSocialWorker',stats=studyEngine.subjectStats(state.attempts,state.examType),last7=studyEngine.lastSevenDays(state.attempts),bySubject=new Map(stats.map(item=>[item.subject,item]));
  app.innerHTML=`<div class="exam-context-badge">目前顯示：${config.label}</div><div class="stat-grid"><div class="card stat"><strong>${state.answered}</strong>累計作答</div><div class="card stat"><strong>${state.correct}</strong>答對題數</div><div class="card stat"><strong>${accuracy}%</strong>正確率</div><div class="card stat"><strong>${studyEngine.dueReviews(state.reviews,new Date(),state.examType).length}</strong>待複習錯題</div></div><div class="section-title">${isPublic?'科目表現':'五科學習表現'}</div><section>${config.subjects.map(subject=>{const item=bySubject.get(subject)||{answered:0,correct:0,accuracy:0};return `<div class="card"><strong>${esc(subject)}</strong><p class="muted">${item.answered} 題・答對 ${item.correct} 題・正確率 ${item.accuracy}%</p></div>`}).join('')}</section><div class="section-title">近 7 天學習</div><div class="card">${last7.map(item=>`${item.date.slice(5)}：${item.answered} 題${item.accuracy===null?'':'・'+item.accuracy+'%'}`).join('　')}</div><div class="section-title">資料說明</div><div class="card">${isPublic?`收錄 ${config.period} 年公職社工師兩科考選部正式試題，共 ${questions.length} 題申論題。`:`收錄 2021–2026 年社工師五科考選部試題，共 ${questions.length.toLocaleString()} 題。`}<p class="muted">舊版只有累計資料，僅列為總摘要；各科與近 7 天統計只從本次更新後的新作答紀錄開始計算。</p></div>`;
}
back.onclick=()=>{const last=state.stack.pop();state.view=last?.view||'library';state.selected=null;state.submitted=false;render()};
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
async function bootstrap(){
  try{const loaded=await window.learningDataStore.initialize();applyLearningState(loaded.state);}
  catch(_){/* Keep the empty safe state; question loading must remain available. */}
  loadQuestions();
}
bootstrap();
