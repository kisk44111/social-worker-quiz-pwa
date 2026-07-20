const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {
  questions: [], view: 'library', stack: [], currentList: [], currentIndex: 0,
  favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
  wrong: new Set(JSON.parse(localStorage.getItem('wrong') || '[]')),
  answered: Number(localStorage.getItem('answered') || 0),
  correct: Number(localStorage.getItem('correct') || 0), selected: null, submitted: false,
  examType: localStorage.getItem('examType') || 'socialWorker'
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

function save(){
  localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
  localStorage.setItem('wrong', JSON.stringify([...state.wrong]));
  localStorage.setItem('answered', state.answered); localStorage.setItem('correct', state.correct);
}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function push(view, data={}){state.stack.push({view:state.view});Object.assign(state,data);state.view=view;render()}
function root(view){state.view=view;state.stack=[];state.selected=null;state.submitted=false;render()}
function render(){
  app.dataset.view=state.view;
  back.classList.toggle('hidden', !state.stack.length); tabs.classList.toggle('hidden', state.view==='question');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.view));
  ({library:renderLibrary,wrong:()=>renderList('錯題複習',examQuestions().filter(q=>state.wrong.has(q.id))),favorites:()=>renderList('收藏題目',examQuestions().filter(q=>state.favorites.has(q.id))),stats:renderStats,subject:renderSubject,list:()=>renderList(state.listTitle,state.currentList),question:renderQuestion}[state.view]||renderLibrary)();
  scrollTo(0,0);
}
function renderLibrary(){
  const config=activeConfig(),questions=examQuestions(),subjects=config.subjects,isPublic=state.examType==='publicSocialWorker';
  title.textContent=config.label;
  const accuracy=state.answered?Math.round(state.correct/state.answered*100):0;
  app.innerHTML=`<section class="exam-switcher" aria-label="選擇考試類別"><div><span class="eyebrow">考試類別</span><strong>選擇你的備考目標</strong></div>${Object.entries(examConfigs).map(([key,c])=>`<button class="exam-choice ${key===state.examType?'active':''} ${c.accent}" data-exam="${key}"><span class="exam-choice-icon">${key==='socialWorker'?'社':'公'}</span><span><b>${c.label}</b><small>${key==='socialWorker'?'專技高考・五大科目':'高考三級・兩大專業科目'}</small></span><i>${key===state.examType?'✓':'→'}</i></button>`).join('')}</section>
  <section class="hero ${config.accent}"><div><span class="eyebrow">${config.period} ${config.label}</span><h2>${isPublic?'準備公職社工師，從歷屆申論開始':'今天想從哪裡開始？'}</h2><p>${isPublic?'收錄考選部近五年正式試題，附 AI 擬答方向與參考答案。':'整合 2021–2026 歷屆試題、完整詳解與申論擬答。'}</p></div><div class="hero-stats"><div><strong>${questions.length.toLocaleString()}</strong><span>收錄題數</span></div><div><strong>${subjects.length}</strong><span>專業科目</span></div><div><strong>${config.period}</strong><span>收錄年度</span></div></div></section>
  <div class="desktop-toolbar"><div><h2>題庫總覽</h2><p>依科目練習，或直接開始今日測驗</p></div><label class="search-wrap"><span>⌕</span><input class="search" id="search" type="search" placeholder="搜尋題目關鍵字"></label></div>
  <section class="quick-grid"><button class="row quick-card primary-quick" id="random"><span class="quick-icon">↝</span><div><span class="eyebrow">快速開始</span><h3>${isPublic?'10 題隨機申論複習':'40 題隨機練習'}</h3><p>${isPublic?'從兩科近五年試題隨機抽題':'從所有歷屆選擇題智慧抽題'}</p></div><b>開始 →</b></button>
  <button class="row quick-card" id="essays"><span class="quick-icon">✎</span><div><span class="eyebrow">申論專區</span><h3>申論題總覽</h3><p>查看 AI 擬答架構與參考答案</p></div><b>瀏覽 →</b></button></section>
  <div class="section-heading"><div><span class="section-title">${isPublic?'兩大專業科目':'五大科目'}</span><p>選擇科目查看歷屆試題與隨機練習</p></div><span class="desktop-only">${config.period.replace('–',' — ')}</span></div><section class="subject-grid ${isPublic?'public-subject-grid':''}">${subjects.map((s,i)=>`<button class="row subject ${isPublic?'public-subject':''}" data-subject="${esc(s)}"><span class="subject-index">0${i+1}</span><div class="subject-copy"><span class="subject-kind">${subjectInfo[s][0]}</span><h3>${esc(s)}</h3><p>${subjectInfo[s][1]}</p></div><div class="subject-tail"><strong>${questions.filter(q=>q.subject===s).length}</strong><span>題</span><i>→</i></div></button>`).join('')}</section>`;
  document.querySelectorAll('.exam-choice').forEach(b=>b.onclick=()=>{state.examType=b.dataset.exam;localStorage.setItem('examType',state.examType);state.stack=[];render()});
  $('#random').onclick=()=>openList(isPublic?'10 題隨機申論複習':'40 題隨機練習',shuffle(questions.filter(q=>isPublic?q.type==='essay':q.type==='multipleChoice')).slice(0,isPublic?10:40));
  $('#essays').onclick=()=>openList('申論題總覽',questions.filter(q=>q.type==='essay'));
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
  document.querySelectorAll('.question-link').forEach(b=>b.onclick=()=>{state.currentList=items;state.currentIndex=+b.dataset.i;state.selected=null;state.submitted=false;push('question')});
}
function renderQuestion(){
  const q=state.currentList[state.currentIndex], letters=['A','B','C','D']; title.textContent=q.type==='essay'?'申論題':`第 ${state.currentIndex+1}／${state.currentList.length} 題`;
  const opts=q.options.map((o,i)=>{const l=letters[i];let cls=state.selected===l?'selected ':'';if(state.submitted&&l===q.answer)cls+='correct';else if(state.submitted&&l===state.selected)cls+='incorrect';return `<button class="row option ${cls}" data-letter="${l}" ${state.submitted?'disabled':''}><span class="letter">${l}</span><span>${esc(o)}</span></button>`}).join('');
  const result=state.submitted?`<div class="result ${state.selected===q.answer?'good':'bad'}">${state.selected===q.answer?'✓ 答對了':'✕ 正確答案：'+esc(q.answer)}</div>${q.explanation?`<div class="answer-box"><h3>💡 完整詳解</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.explanation)}</div><p class="muted">本詳解由 AI 依題幹與專業概念生成，並以考選部答案核對；非考選部官方解析。法規題請以該考試年度有效法規為準。</p></div>`:''}`:'';
  const progress=Math.round((state.currentIndex+1)/state.currentList.length*100);
  const questionExam=examConfigs[examOf(q)];
  const context=`<div class="question-context"><span class="track-chip ${questionExam.accent}">${questionExam.label}</span><span>${q.year} 第 ${q.session} 次</span><span>${esc(q.subject)}</span><button class="star" id="star" aria-label="收藏">${state.favorites.has(q.id)?'★':'☆'}</button></div>`;
  const progressCard=`<aside class="progress-card"><div class="progress-heading"><span>練習進度</span><strong>${state.currentIndex+1} / ${state.currentList.length}</strong></div><div class="progress-track"><i style="width:${progress}%"></i></div><p>${state.submitted?'已完成本題解析，可前往下一題。':'選擇答案後送出，即可查看完整詳解。'}</p></aside>`;
  app.innerHTML=q.type==='essay'?`${context}<div class="essay-layout"><article class="question-panel"><span class="eyebrow">申論題</span><p class="question-text">${esc(q.prompt)}</p></article><div class="essay-answers"><div class="answer-box"><h3><span>01</span> AI 擬答方向</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.explanation||'擬答整理中')}</div><p class="muted">本內容由 AI 依題幹生成，非考選部官方答案。</p></div><div class="answer-box reference-answer"><h3><span>02</span> AI 參考答案</h3><div style="white-space:pre-wrap;line-height:1.75">${esc(q.referenceAnswer||'參考答案整理中')}</div><p class="muted">法規、數據與專有名詞請以考試時點的官方資料及教科書核對。</p></div></div></div>`:`${context}<div class="question-layout"><section class="question-panel"><div class="question-kicker"><span>單選題</span><strong>${state.currentIndex+1} / ${state.currentList.length}</strong></div><p class="question-text">${esc(q.prompt)}</p><div class="options">${opts}</div><button id="submit" class="primary" ${!state.selected&&!state.submitted?'disabled':''}>${state.submitted?(state.currentIndex+1<state.currentList.length?'下一題 →':'完成練習'):'確認答案'}</button></section><aside class="answer-column">${result||progressCard}</aside></div>`;
  $('#star').onclick=()=>{state.favorites.has(q.id)?state.favorites.delete(q.id):state.favorites.add(q.id);save();renderQuestion()};
  document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{if(!state.submitted){state.selected=b.dataset.letter;renderQuestion()}});
  if($('#submit'))$('#submit').onclick=()=>{if(state.submitted){if(++state.currentIndex<state.currentList.length){state.selected=null;state.submitted=false;render()}else back.click()}else{state.submitted=true;state.answered++;if(state.selected===q.answer){state.correct++;state.wrong.delete(q.id)}else state.wrong.add(q.id);save();renderQuestion()}};
}
function renderStats(){
  title.textContent='學習統計';const accuracy=state.answered?Math.round(state.correct/state.answered*100):0,config=activeConfig(),questions=examQuestions(),isPublic=state.examType==='publicSocialWorker';
  app.innerHTML=`<div class="exam-context-badge">目前顯示：${config.label}</div><div class="stat-grid"><div class="card stat"><strong>${state.answered}</strong>累計作答</div><div class="card stat"><strong>${state.correct}</strong>答對題數</div><div class="card stat"><strong>${accuracy}%</strong>正確率</div><div class="card stat"><strong>${state.wrong.size}</strong>待複習錯題</div></div><div class="section-title">資料說明</div><div class="card">${isPublic?`收錄 ${config.period} 年公職社工師兩科考選部正式試題，共 ${questions.length} 題申論題，並提供 AI 擬答方向與參考答案。`:`收錄 2021–2026 年社工師五科考選部試題，共 ${questions.length.toLocaleString()} 題。選擇題答案採官方標準答案；申論題提供 AI 擬答方向與參考答案。`}<p class="muted">作答、錯題及收藏資料只保存在這台裝置上。</p></div>`;
}
back.onclick=()=>{const last=state.stack.pop();state.view=last?.view||'library';state.selected=null;state.submitted=false;render()};
tabs.onclick=e=>{const b=e.target.closest('[data-tab]');if(b)root(b.dataset.tab)};
window.addEventListener('online',()=>$('#offline').classList.add('hidden'));window.addEventListener('offline',()=>$('#offline').classList.remove('hidden'));
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').classList.remove('hidden')});
$('#install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#install').classList.add('hidden')}};
if('serviceWorker'in navigator){
  let reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;location.reload()}});
  navigator.serviceWorker.register('./service-worker.js');
}
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
loadQuestions();
