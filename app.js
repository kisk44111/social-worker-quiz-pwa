const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {
  questions: [], view: 'library', stack: [], currentList: [], currentIndex: 0,
  favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
  wrong: new Set(JSON.parse(localStorage.getItem('wrong') || '[]')),
  answered: Number(localStorage.getItem('answered') || 0),
  correct: Number(localStorage.getItem('correct') || 0), selected: null, submitted: false
};
const subjects = ['社會工作','人類行為與社會環境','社會工作直接服務','社會工作研究方法','社會政策與社會立法'];
const title = $('#title'), app = $('#app'), back = $('#back'), tabs = $('#tabs');

function save(){
  localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
  localStorage.setItem('wrong', JSON.stringify([...state.wrong]));
  localStorage.setItem('answered', state.answered); localStorage.setItem('correct', state.correct);
}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function push(view, data={}){state.stack.push({view:state.view});Object.assign(state,data);state.view=view;render()}
function root(view){state.view=view;state.stack=[];state.selected=null;state.submitted=false;render()}
function render(){
  back.classList.toggle('hidden', !state.stack.length); tabs.classList.toggle('hidden', state.view==='question');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.view));
  ({library:renderLibrary,wrong:()=>renderList('錯題複習',state.questions.filter(q=>state.wrong.has(q.id))),favorites:()=>renderList('收藏題目',state.questions.filter(q=>state.favorites.has(q.id))),stats:renderStats,subject:renderSubject,list:()=>renderList(state.listTitle,state.currentList),question:renderQuestion}[state.view]||renderLibrary)();
  scrollTo(0,0);
}
function renderLibrary(){
  title.textContent='社工師題庫';
  app.innerHTML=`<div class="hero"><h2>台灣社工師歷屆題庫</h2><p>2021–2026・五大科目・共 ${state.questions.length.toLocaleString()} 題</p></div>
  <input class="search" id="search" type="search" placeholder="搜尋題目">
  <button class="row" id="random"><h3>🔀 40 題隨機練習</h3><p>從所有歷屆選擇題隨機抽題</p></button>
  <button class="row" id="essays"><h3>✎ 申論題總覽</h3><p>歷屆申論題完整收錄</p></button>
  <div class="section-title">五大科目</div>${subjects.map(s=>`<button class="row subject" data-subject="${esc(s)}"><span class="subject-count">${state.questions.filter(q=>q.subject===s).length} 題</span><h3>${esc(s)}</h3><p>2021–2026 歷屆試題</p></button>`).join('')}`;
  $('#random').onclick=()=>openList('40 題隨機練習',shuffle(state.questions.filter(q=>q.type==='multipleChoice')).slice(0,40));
  $('#essays').onclick=()=>openList('申論題總覽',state.questions.filter(q=>q.type==='essay'));
  document.querySelectorAll('.subject').forEach(b=>b.onclick=()=>push('subject',{activeSubject:b.dataset.subject}));
  $('#search').oninput=e=>{const q=e.target.value.trim();if(q.length>1) openList('搜尋結果',state.questions.filter(x=>x.prompt.includes(q)),false)};
}
function renderSubject(){
  const s=state.activeSubject, qs=state.questions.filter(q=>q.subject===s); title.textContent=s;
  const groups={}; qs.forEach(q=>{const k=`${q.year}-${q.session}`;(groups[k]??=[]).push(q)});
  app.innerHTML=`<button class="row" id="subjectRandom"><h3>🔀 40 題科目隨機練習</h3><p>從本科技歷屆選擇題隨機抽題</p></button><div class="section-title">歷年題庫</div>`+
    Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,v])=>`<button class="row exam" data-key="${k}"><h3>${v[0].year} 年・第 ${v[0].session} 次</h3><p>${v.length} 題</p></button>`).join('');
  $('#subjectRandom').onclick=()=>openList(`${s}隨機練習`,shuffle(qs.filter(q=>q.type==='multipleChoice')).slice(0,40));
  document.querySelectorAll('.exam').forEach(b=>b.onclick=()=>openList(`${groups[b.dataset.key][0].year} 第 ${groups[b.dataset.key][0].session} 次`,groups[b.dataset.key]));
}
function openList(name,items,navigate=true){state.currentList=items;state.listTitle=name;if(navigate)push('list');else{state.stack.push({view:'library'});state.view='list';render()}}
function renderList(name,items){
  title.textContent=name;
  app.innerHTML=items.length?items.map((q,i)=>`<button class="row question-link ${q.type==='essay'?'essay':''}" data-i="${i}"><span class="badge">${q.type==='essay'?'申論':'第 '+q.number+' 題'}</span><p>${esc(q.prompt)}</p><div class="meta">${q.year}・第 ${q.session} 次・${esc(q.subject)}</div></button>`).join(''):'<div class="empty">目前沒有題目</div>';
  document.querySelectorAll('.question-link').forEach(b=>b.onclick=()=>{state.currentList=items;state.currentIndex=+b.dataset.i;state.selected=null;state.submitted=false;push('question')});
}
function renderQuestion(){
  const q=state.currentList[state.currentIndex], letters=['A','B','C','D']; title.textContent=q.type==='essay'?'申論題':`第 ${state.currentIndex+1}／${state.currentList.length} 題`;
  const opts=q.options.map((o,i)=>{const l=letters[i];let cls=state.selected===l?'selected ':'';if(state.submitted&&l===q.answer)cls+='correct';else if(state.submitted&&l===state.selected)cls+='incorrect';return `<button class="row option ${cls}" data-letter="${l}" ${state.submitted?'disabled':''}><span class="letter">${l}</span><span>${esc(o)}</span></button>`}).join('');
  const result=state.submitted?`<div class="result ${state.selected===q.answer?'good':'bad'}">${state.selected===q.answer?'✓ 答對了':'✕ 正確答案：'+esc(q.answer)}</div>${q.explanation?`<div class="answer-box"><h3>💡 詳解</h3><div>${esc(q.explanation)}</div><p class="muted">本詳解依考選部標準答案整理，非考選部官方逐題解析。</p></div>`:''}`:'';
  app.innerHTML=`<div class="meta">${q.year} 第 ${q.session} 次・${esc(q.subject)}<button class="star" id="star" aria-label="收藏">${state.favorites.has(q.id)?'★':'☆'}</button></div><p class="question-text">${esc(q.prompt)}</p>${q.type==='essay'?'<div class="answer-box"><h3>申論題</h3>官方未公布申論題標準答案，請搭配考選部原始試卷研讀。</div>':opts+result+`<button id="submit" class="primary" ${!state.selected&&!state.submitted?'disabled':''}>${state.submitted?(state.currentIndex+1<state.currentList.length?'下一題':'完成練習'):'確認答案'}</button>`}`;
  $('#star').onclick=()=>{state.favorites.has(q.id)?state.favorites.delete(q.id):state.favorites.add(q.id);save();renderQuestion()};
  document.querySelectorAll('.option').forEach(b=>b.onclick=()=>{if(!state.submitted){state.selected=b.dataset.letter;renderQuestion()}});
  if($('#submit'))$('#submit').onclick=()=>{if(state.submitted){if(++state.currentIndex<state.currentList.length){state.selected=null;state.submitted=false;render()}else back.click()}else{state.submitted=true;state.answered++;if(state.selected===q.answer){state.correct++;state.wrong.delete(q.id)}else state.wrong.add(q.id);save();renderQuestion()}};
}
function renderStats(){
  title.textContent='學習統計';const accuracy=state.answered?Math.round(state.correct/state.answered*100):0;
  app.innerHTML=`<div class="stat-grid"><div class="card stat"><strong>${state.answered}</strong>累計作答</div><div class="card stat"><strong>${state.correct}</strong>答對題數</div><div class="card stat"><strong>${accuracy}%</strong>正確率</div><div class="card stat"><strong>${state.wrong.size}</strong>待複習錯題</div></div><div class="section-title">資料說明</div><div class="card">收錄 2021–2026 年五科考選部試題，共 ${state.questions.length.toLocaleString()} 題。選擇題答案採官方標準答案；申論題僅收錄題目。<p class="muted">作答、錯題及收藏資料只保存在這台裝置上。</p></div>`;
}
back.onclick=()=>{const last=state.stack.pop();state.view=last?.view||'library';state.selected=null;state.submitted=false;render()};
tabs.onclick=e=>{const b=e.target.closest('[data-tab]');if(b)root(b.dataset.tab)};
window.addEventListener('online',()=>$('#offline').classList.add('hidden'));window.addEventListener('offline',()=>$('#offline').classList.remove('hidden'));
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').classList.remove('hidden')});
$('#install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#install').classList.add('hidden')}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js');
fetch('./questions.json').then(r=>r.json()).then(q=>{state.questions=q;render()}).catch(()=>app.innerHTML='<div class="empty">題庫載入失敗，請重新整理頁面。</div>');
