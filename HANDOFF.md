# 專案架構與開發交接手冊

> 專案：`kisk44111/social-worker-quiz-pwa`  
> 正式網站：[https://kisk44111.github.io/social-worker-quiz-pwa/](https://kisk44111.github.io/social-worker-quiz-pwa/)  
> 掃描日期：2026-11-23（Asia/Taipei）  
> 本手冊依目前工作區與遠端 `origin/main` 實際內容整理；題庫、學習紀錄與官方答案不可在未驗證前任意改寫。

---

## 0. 交接快照與最重要原則

### Git 快照

- 遠端與本地正式分支：`main` 已與 `origin/main` 完全同步，涵蓋全題庫 160 / 160 題申論結構化擬答與解析（`c8fc487`）及 PWA `v31` 高擬真語音聽讀、NotebookLM／Gemini 自然口語講稿匯出與骨架盲測功能。
- GitHub Pages 使用 **legacy Pages**，來源是 `main` 分支根目錄 `/`，不是 Actions artifact，也不是 `gh-pages` 分支。
- 近期核心里程碑（皆已合併並部署至 `origin/main`）：
  - `fa42f18`：`data-store.js` 補齊進階欄位驗證與確定性無損備份合併，新增 4 組測試並升級 PWA 至 `v27`。
  - `e883088`：`tools/generate_content_mc_explanations.py` 安全重構（零 Keychain 預設讀取、雙重確認旗標、寫前驗證與原子寫入）。
  - `b325e24`：升級 PWA 至 **`v28`**，推出申論題雙區塊 UI（【AI 參考擬答（起・承・轉・合）】＋【答題解析與得分要點】）、`essayGuide` 結構驗證測試，以及零外部 API 依賴的離線批次工具 `tools/generate_essay_answers.py`。
  - `7c9c349`、`1072885`、`13fa297`、`5b851e6`、`40e6138`、`e1c98fa`、`c8fc487`：分科完成**專技社工師五科（120 題）＋公職社工師兩科（40 題）共 160 / 160 題（100.0%）**結構化申論擬答與解析匯入，且全程通過 `npm test` 驗證。
  - `680281b`（`v29`）：新增純原生申論考前衝刺雙工具——Web Speech API 申論聽讀播放器（單題分段高亮、語速、通勤連播）與骨架盲測（主動回憶）訓練模式，新增 `essay-study-tools.js` 與測試。
  - `09f3479`（`v30`）：全面升級申論語音自然度——最高優先權排序高擬真神經網路中文語音、新增「🎙 朗讀聲音」下拉選單（`localStorage` `swq_essay_speech_voice`）、中文口語前處理與三層氣口呼吸停頓排程及柔和語調微調。
  - **`v31`（已部署）**：新增零 API 依賴之**「🎧 匯出自然口語講稿（適配 NotebookLM / Gemini 聽讀）」**——於 `essay-study-tools.js` 實作 `formatEssayForNaturalAudio` 與整科講稿打包器，前端提供「📋 複製單題口語講稿」與「📦 匯出本考科講稿（.txt）」一鍵下載，並強化 Edge `★ HsiaoChen Online (Natural)` 引導提示，擴充測試至 10 項並同步升級 PWA 快取至 `v31`。
- 每次新開發前請先確認 `git fetch origin`、`git status --short --branch` 乾淨且對齊 `origin/main`。

### 不可破壞的資料原則

1. 不重編既有 `questions.json` 的 `id`，也不無驗證地改官方選擇題答案。
2. 不清除或重設使用者的 IndexedDB、localStorage、錯題、收藏、筆記、申論草稿、模擬考與統計。
3. 所有非官方內容（申論架構、參考答案、AI 生成詳解／知識整理）必須清楚標示非考選部官方內容與限制。
4. 題庫變更前先跑結構驗證；115 年第二次五科答案變更前還要跑官方重新核對。
5. 靜態檔案更新時必須同步處理 Service Worker 快取與 HTML 查詢版號，否則 PWA 使用者可能繼續拿到舊版。

---

# 1. 專案總覽與技術棧（Tech Stack）

## 1.1 定位

這是純前端、可離線使用的繁體中文（臺灣）社工師備考 PWA。它同時提供：

- 專技社工師五科：社會工作、人類行為與社會環境、社會工作直接服務、社會工作研究方法、社會政策與社會立法。
- 公職社工師兩科：社會福利政策與法規、社會工作實務。
- 歷屆選擇題／申論題、詳細解析、知識庫、錯題間隔複習、模擬考、統計、筆記、標籤、備份還原與 PWA 離線快取。

## 1.2 前端技術

| 層面 | 實際技術 | 說明 |
|---|---|---|
| UI | 原生 HTML + Vanilla JavaScript | 無 React、Vue、Svelte、Angular 或 TypeScript；`app.js` 用字串模板與 DOM event handler 畫面重繪。 |
| 樣式 | 原生 CSS | 沒有 Tailwind、Bootstrap、CSS Modules、Sass、PostCSS 或 CSS-in-JS。採多個全域 CSS 檔與 `@media`。 |
| 圖示 | 文字字元／Unicode | 例如 `▤`、`↻`、`★`、`⌘`、`✎`；沒有 icon library。 |
| 狀態 | 單一記憶體 `state` 物件 + IndexedDB | `app.js` 擁有 UI state；`data-store.js` 管理持久化與 legacy migration。 |
| 資料 | 靜態 `questions.json` + JS 知識內容 | 不使用後端、雲端資料庫、帳號登入或 API runtime。 |
| PWA | Web App Manifest + 原生 Service Worker | 手寫 `service-worker.js`，無 Workbox。 |
| 測試 | Node 內建 `node:test`、Python `unittest` | 沒有 Jest、Vitest、Playwright、Cypress。 |
| 部署 | GitHub Pages legacy branch deployment | Pages 從 `main` 根目錄直接提供靜態檔。 |

## 1.3 建置工具、套件與 CDN

- **沒有** Vite、Webpack、Rollup、Parcel、Babel、npm build pipeline 或 lockfile。
- `package.json` 為 private 專案，只有 npm scripts，**沒有 `dependencies` 或 `devDependencies`**。
- **沒有 CDN 連結**、Google Fonts、外掛 JS、analytics 或 tracker。
- 瀏覽器必備 API：`fetch`、Cache Storage、Service Worker、IndexedDB、File API、Blob、URL API、`beforeinstallprompt`（僅 Chromium 支援）。
- 開發／資料維護工具額外依賴：Node.js、Python 3；官方題目匯入／驗證腳本需要網路與 `pdftotext`（Poppler）。
- `tools/generate_content_mc_explanations.py` 是離線維護腳本，不是網站功能；它會以 macOS Keychain service `codex-openrouter-api-key` 讀取 OpenRouter token、呼叫 `https://openrouter.ai/api/v1/chat/completions`。不得把 token 放入 repo、HTML、題庫或 Git。

---

# 2. 完整目錄結構與核心檔案職責（Directory Tree & File Responsibilities）

## 2.1 完整目錄樹

以下為掃描時專案根目錄，已依要求排除 `.git/` 與 `node_modules/`；`__pycache__/` 是 Python 執行後產物，受 `.gitignore` 忽略。

```text
.
├── .gitignore
├── CHANGELOG.md
├── HANDOFF.md
├── README.md
├── app.js
├── data-store.js
├── desktop.css
├── essay-study-tools.js
├── exam-cram-guides.css
├── exam-cram-guides.js
├── historical-related-concepts.js
├── historical-theory-content.js
├── historical-theory-dossiers.css
├── historical-theory-dossiers.js
├── historical-theory-primers.js
├── icon-192.png
├── icon-512.png
├── index.html
├── knowledge-base.css
├── knowledge-base.js
├── knowledge-readability-fix.css
├── manifest.webmanifest
├── package.json
├── questions.json
├── readability.css
├── service-worker.js
├── study-engine.js
├── styles.css
├── sw-cache-policy.js
├── theme.css
├── theory-completion.js
├── theory-gap-additions.js
├── theory-third-round.js
├── tests
│   ├── __init__.py
│   ├── __pycache__/
│   │   ├── __init__.cpython-311.pyc
│   │   └── test_questions_validation.cpython-311.pyc
│   ├── data-store.test.cjs
│   ├── essay-study-tools.test.cjs
│   ├── exam-cram-guides.test.cjs
│   ├── historical-theory-dossiers.test.cjs
│   ├── knowledge-base.test.cjs
│   ├── study-engine.test.cjs
│   ├── sw-cache-policy.test.cjs
│   └── test_questions_validation.py
└── tools
    ├── __pycache__/
    │   ├── import_115_second_social_worker.cpython-311.pyc
    │   └── validate_questions.cpython-311.pyc
    ├── add_115_second_essay_guides.py
    ├── generate_content_mc_explanations.py
    ├── generate_essay_answers.py
    ├── import_115_second_social_worker.py
    ├── import_public_social_worker.py
    ├── rebuild_mc_explanations.py
    ├── validate_questions.py
    └── verify_115_second_social_worker.py
```

## 2.2 HTML、應用程式與資料層

| 檔案 | 職責與相依關係 |
|---|---|
| `index.html` | 唯一 HTML entry point。建立 top bar、`#app`、底部／桌面側欄 `#tabs`、離線與 iOS 安裝提示；以 `defer` 順序載入所有全域資料模組後才載入 `app.js`。內含 `?build=` cache-busting 版號。頂端註解 `deployment build 15 (not deployed from this branch)` 已過時，屬文件技術債。 |
| `app.js` | 約 53 KB 的單檔 SPA controller。定義 `state`、考試別／科目設定、畫面路由堆疊與所有 renderer。主要函式：`renderLibrary`、`renderSubject`、`renderList`、`renderQuestion`、`renderKnowledge`、`renderDataManagement`、`renderMockSetup`、`renderMock`、`renderMockResult`、`renderStats`、`loadQuestions`、`bootstrap`。依賴 `learningDataStore`、`studyEngine`、`examKnowledgeBase`、`examCramGuides` 與理論檔案 globals。所有使用者可見字串插值原則上經 `esc()` HTML escape。 |
| `questions.json` | 約 7.9 MB 靜態題庫，唯一正式題目資料來源（含全 160 題結構化 `essayGuide`）。`app.js` 以 `fetch('./questions.json', {cache:'no-cache'})` 載入；Service Worker 為它另建 data cache。 |
| `data-store.js` | UMD/IIFE 模組；瀏覽器掛到 `window.learningDataStore`，Node 測試可 `require`。定義 IndexedDB adapter、localStorage legacy migration、資料正規化、備份格式驗證與合併。 |
| `essay-study-tools.js` | UMD/IIFE 純函式模組；瀏覽器掛到 `window.essayStudyTools`，Node 測試可 `require`。負責高擬真神經網路中文語音排序與選單標籤、自然中文口語前處理與三層氣口停頓排程佇列、語調建議、跨題單通勤連播索引計算及盲測段落揭曉狀態操作。 |
| `study-engine.js` | UMD/IIFE 模組；掛到 `window.studyEngine`。提供間隔複習、正確率、近 7 日／週趨勢、模擬考計分、加權推薦與每日任務純函式。 |
| `sw-cache-policy.js` | Service Worker 與 Node 測試共用的 UMD cache namespace policy；確保只刪 `social-worker-quiz-pwa-` 前綴快取。 |
| `service-worker.js` | 手寫 PWA install/activate/fetch 處理；詳見第 4 節。 |

## 2.3 知識庫內容模組

這些檔案都不是 ES modules，而是載入後把資料放入 `window`。載入順序不可任意調換：

| 檔案 | 全域資料 | 功能 |
|---|---|---|
| `knowledge-base.js` | `window.examKnowledgeBase` | 版本 `2026.11.23`、來源索引與至少 40 張五科知識卡；卡片包含摘要、重點、應試提示、來源 ID。 |
| `exam-cram-guides.js` | `window.examCramGuides` | 五科「考前大補帖」；每科含讀題切入點、申論架構、至少五個單元，以及概念、工作方法、混淆、申論提示與關聯術語。 |
| `historical-theory-dossiers.js` | `window.historicalTheoryDossiers` | 32 份歷屆具名學者／理論檔案，包含 `history`、`framework`、`points`、`traps`、術語與可精準連題的英文字學者名稱。 |
| `historical-related-concepts.js` | `window.historicalTheoryConceptLinks` | 每份理論檔案的「相關概念延伸」檢索詞與說明；不把概念題誤稱為學者原題。 |
| `historical-theory-content.js` | `window.historicalTheoryContent` | 每理論的 `claim`、`mechanism`、`practice`，供理論內容區顯示。 |
| `historical-theory-primers.js` | `window.historicalTheoryPrimers` | 初學者導讀：歷史背景、白話解釋、例子。 |
| `theory-completion.js` | `window.theoryArchitectureCompletions`、`window.additionalTheoryDossiers` | 架構型理論的完整對照（例如階段／構成），另新增 10 份檔案。 |
| `theory-gap-additions.js` | `window.theoryGapDossiers` | 反查歷屆題後補上的 8 份理論／主義，含女性主義。 |
| `theory-third-round.js` | `window.thirdRoundTheoryDossiers` | 第三輪補充的 5 份主義、政策理論或研究概念。 |
| `historical-theory-dossiers.css` | 理論檔案視覺樣式 | dossier、導讀、內容、概念延伸與題目按鈕樣式。 |
| `knowledge-base.css` | 知識庫卡片樣式 | hero、搜尋／篩選、卡片與來源折疊區。 |
| `exam-cram-guides.css` | 大補帖樣式 | 補帖 hero、科目 tabs、折疊單元與桌面 grid。 |
| `knowledge-readability-fix.css` | 可讀性覆寫 | 深色模式對比、摺疊標題、按鈕、知識卡與 focus ring。這是近期修正點，後續若改動前述 CSS，需在深色模式一起檢驗。 |

`renderKnowledge()` 的實作會把「歷屆考點檔案」節點用 `app.prepend(...)` 移至 `#app` 最前方，因此切入知識庫第一屏應依序看到：dossier intro、考科篩選、題數說明、dossier 列表，然後才是離線知識庫與考前大補帖。不可移除這段排序邏輯。

## 2.4 CSS 分層

| 檔案 | 範圍 |
|---|---|
| `styles.css` | 基礎手機優先 layout、共用 components、題目／選項、tabs。 |
| `theme.css` | CSS variables、亮／暗色系與基本 dark-mode token。 |
| `desktop.css` | `min-width` 桌面資訊架構、側欄、題目雙欄、桌面可讀性與 hover。 |
| `readability.css` | 字級、行高、深色模式高對比、RWD 可讀性，以及備考工具 UI。 |
| `knowledge-base.css`、`exam-cram-guides.css`、`historical-theory-dossiers.css` | 知識庫專用區塊。 |
| `knowledge-readability-fix.css` | 最後載入的 hotfix layer；目前版號 `build=2`。 |

CSS 是 cascade-based，非 component scoped。新增規則前須以亮／暗色、手機／桌面測試，並避免用過度廣泛 `summary`、`button`、`p` selectors 汙染其他畫面。

## 2.5 測試與維護工具

| 檔案 | 說明 |
|---|---|
| `tests/data-store.test.cjs` | legacy migration、損毀資料復原、進階欄位驗證與確定性無損備份合併、v1 備份升級迴歸、IndexedDB unavailable fallback（搭配其餘 Node 測試共 39 項）。 |
| `tests/essay-study-tools.test.cjs` | 高擬真中文語音排序與使用者偏好解析、口語化文本前處理、三層氣口停頓佇列、NotebookLM／Gemini 自然口語講稿轉換與整科 `.txt` 打包、混合題單通勤連播索引與盲測單段揭曉 10 項測試。 |
| `tests/study-engine.test.cjs` | 1/3/7/14 天複習、統計、已更正答案計分、加權推薦、週趨勢。 |
| `tests/sw-cache-policy.test.cjs` | 快取隔離，避免刪到同 GitHub Pages 網域其他專案。 |
| `tests/knowledge-base.test.cjs` | 卡片結構、來源索引與五科覆蓋。 |
| `tests/exam-cram-guides.test.cjs` | 五科補帖完整性與每單元至少一題關聯歷屆題。 |
| `tests/historical-theory-dossiers.test.cjs` | 理論／導讀／架構／概念延伸與實題連結完整性。 |
| `tests/test_questions_validation.py` | 對 `tools.validate_questions`、`essayGuide` 結構驗證與 `tools.generate_essay_answers` 離線批次匯入流程的 7 項 Python unittest。 |
| `tools/validate_questions.py` | release 前題庫 schema、ID、科別、題型、選項、答案、題號連續性與 `essayGuide` 結構驗證器。 |
| `tools/import_115_second_social_worker.py` | 115 年第二次五科官方 PDF importer；fail-closed，預期每科 2 申論 + 40 選擇與 40 官方答案。 |
| `tools/verify_115_second_social_worker.py` | 重新下載官方答案／更正 PDF，比對題庫答案與 SHA-256。需要網路與 `pdftotext`。 |
| `tools/import_public_social_worker.py` | 匯入 2022–2026 公職社工師兩科申論題與非官方作答提示。 |
| `tools/add_115_second_essay_guides.py` | 早期為 115-2 十題申論補「非官方」起承轉合作答架構之腳本（現已由全庫 `essayGuide` 取代升級）。 |
| `tools/generate_essay_answers.py` | 零付費 API、零本機模型依賴之申論題離線批次工具：支援 `--status`（盤點各科進度）、`--export-batch`（匯出標準化題組任務包供 Gemini／Antigravity 撰寫）與 `--import-json`（含 `--dry-run`、逐題結構檢核、同步 `referenceAnswer`/`explanation`/`aiContent`、執行全庫 `validate_questions` 與同目錄暫存檔原子替換 `os.replace`）；進度檔 `.essay-answer-checkpoint.json` 已加入 `.gitignore`。 |
| `tools/generate_content_mc_explanations.py` | 以 OpenRouter API 批次產生選擇題內容導向解析；已強化金鑰與寫入防護，屬離線維運工具。 |
| `tools/rebuild_mc_explanations.py` | 規則式重建選擇題解析；目前文字含「考選部標準答案」導向，若重跑可能覆蓋現有較佳內容，需先人工審查 diff。 |

---

# 3. 題庫資料結構與狀態管理（Data Schema & State Management）

## 3.1 題庫位置、數量與分類

檔案：`questions.json`（JSON array，UTF-8，壓縮成單行，約 7.9 MB）。最新驗證結果（Commit `c8fc487`）：

| 分類 | 題數 |
|---|---:|
| 全部題目 | 2,560 |
| 選擇題 | 2,400 |
| 申論題 | 160 |
| 專技社工師 | 2,520（2,400 選擇 + 120 申論） |
| 公職社工師 | 40（皆為申論：社會工作實務 20 + 社會福利政策與法規 20） |
| 有官方來源 metadata 的 115-2 題 | 210 |
| 有 `acceptedAnswers` 官方更正容許答案 | 1 |
| 有 `referenceAnswer` 的申論題 | 160 |
| 有 `essayGuide` 結構化起承轉合擬答與三類解析要點的申論題 | **160 / 160（100.0%）** |
| 有 `aiContent` 非官方限制標示 | 160 |

年份範圍為 2021–2026。五科各 504 題；公職兩科各 20 題。舊題多數沒有明示 `examType`，應依程式既有邏輯視為 `socialWorker`，不可誤判為缺失資料。

## 3.2 題目 schema

`tools/validate_questions.py` 規定的共同必填欄位是：

```json
{
  "id": "2021-1-0401-M1",
  "year": 2021,
  "session": 1,
  "subject": "社會工作",
  "number": 1,
  "type": "multipleChoice",
  "prompt": "題幹文字",
  "options": ["選項 A", "選項 B", "選項 C", "選項 D"],
  "answer": "C",
  "questionPDF": "2021-1-0401-questions.pdf",
  "answerPDF": "2021-1-0401-answers.pdf",
  "explanation": "【題型辨識】…【核心判斷】…【正確答案與理由】…【選項逐項解析】…【複習結論】"
}
```

選擇性欄位與規則：

```json
{
  "examType": "socialWorker",
  "acceptedAnswers": ["A", "B"],
  "source": {
    "sourceUrl": "https://wwwq.moex.gov.tw/...&t=Q",
    "answerSourceUrl": "https://wwwq.moex.gov.tw/...&t=S",
    "correctionSourceUrl": null,
    "answerVersion": "official",
    "verifiedAt": "2026-10-31",
    "questionSha256": "…",
    "answerSha256": "…",
    "correctionSha256": null
  }
}
```

申論題格式（`v28` 結構化升級版；全題庫 160 題皆已完備 `essayGuide`，且前端保留舊版純文字 `referenceAnswer`／`explanation` 平滑降級相容）：

```json
{
  "id": "2021-1-0401-E1",
  "year": 2021,
  "session": 1,
  "subject": "社會工作",
  "number": 1,
  "type": "essay",
  "prompt": "試論述……",
  "options": [],
  "answer": null,
  "questionPDF": "2021-1-0401-questions.pdf",
  "answerPDF": null,
  "explanation": "三類答題解析要點彙整文字（相容舊版欄位）",
  "referenceAnswer": "起・承・轉・合完整擬答彙整文字（相容舊版欄位）",
  "essayGuide": {
    "modelAnswer": {
      "qi": { "title": "破題與核心概念界定", "content": "……" },
      "cheng": { "title": "理論依據與法規政策剖析", "content": "……" },
      "zhuan": { "title": "實務應用、困境與批判反思", "content": "……" },
      "he": { "title": "總結與具體建議展望", "content": "……" }
    },
    "analysis": {
      "focusAndTraps": ["命題焦點與常見作答陷阱……"],
      "theoriesAndLaws": ["核心理論、法規與實務依據……"],
      "scoringRubric": ["【起】約 15%：……", "【承】約 50%：……"]
    }
  },
  "aiContent": {
    "kind": "nonOfficialEssayAnswer",
    "model": "antigravity-batch-v1",
    "generatedAt": "2026-11-23",
    "limitations": "本擬答與解析係由 AI 輔助整理之非考選部官方參考內容，僅供備考練習架構參考，不得作為法定評分或法規條文唯一依據。"
  }
}
```

### Schema 約束

- `id`：全題庫唯一、非空白字串；驗證器不強制 ID 命名 pattern，但現有格式通常是 `年份-梯次-科目代碼-M/E題號`。**既有 ID 視為外部資料鍵，不可重排或重新命名。**
- `examType`：省略或 `socialWorker` 為專技社工師；`publicSocialWorker` 為公職社工師。
- `subject` 白名單：專技五科或公職兩科，且要與 `examType` 相符。
- `year`、`session`、`number` 必須是正整數；每份 `(examType, year, session, subject, type)` 試卷的題號需從 1 連續。
- `multipleChoice`：恰四個非空 `options`，`answer` 為 A–D。
- `essay`：`options` 必為 `[]`，`answer` 必為 `null`，`referenceAnswer` 必須是非空字串；若具 `essayGuide`，`modelAnswer` 須完整包含 `qi`、`cheng`、`zhuan`、`he` 四段非空 `{ title, content }`，且 `analysis` 須包含非空字串陣列 `focusAndTraps`、`theoriesAndLaws`、`scoringRubric`。
- 若有 `acceptedAnswers`，必須為非空 A–D 陣列；實際判分使用它優先於 `answer`。
- 若有 `source`，必須至少有 official URL、答案 URL、版本、核對日期與題卷／答案 SHA-256。

## 3.3 UI 記憶體 state

`app.js` 的 `state` 混合「應持久化的學習資料」與「僅當前畫面 session」：

- 持久化：`favorites`、`wrong`、`answered`、`correct`、`attempts`、`reviews`、`mockExams`、`essayPractices`、`resume`、`plan`、`notes`、`tags`、`customTags`、`errataNotes`、`examType`。
- 僅 session：`view`、`stack`、`questions`、`currentList`、`currentIndex`、`selected`、`submitted`、`activeMockId`、`mockIndex`、`essayStartedAt`、`essayInterval`、`filters`。

`learningSnapshot()` 是唯一主要 snapshot 入口；`applyLearningState()` 將資料恢復到 `state`。新增任何使用者資料欄位時，必須同時更新：

1. `data-store.js` 的 `defaultState()`；
2. `normaliseLearningState()`／`isValidLearningState()`；
3. `learningSnapshot()`／`applyLearningState()`；
4. `mergeLearningStates()` 的合併策略；
5. 相關 backup／migration tests。

## 3.4 IndexedDB、localStorage 與備份

### IndexedDB 正式資料層

| 項目 | 值 |
|---|---|
| DB name | `social-worker-quiz-pwa` |
| DB version | `1` |
| object stores | `state`、`meta` |
| state key | `learning-state` |
| migration snapshot meta key | `legacy-localstorage-snapshot-v1` |
| schema version | `2` |
| backup version | `2` |

`state` store 以 `{ key: 'learning-state', value: LearningState }` 儲存。`meta` store 保留 legacy 原始值；當 IndexedDB record 損毀時，也會以 `invalid-indexeddb-state-v1` 保存 forensic copy 後才從 legacy mirror 復原。

### 相容 localStorage keys

舊版鍵值為：`favorites`、`wrong`、`answered`、`correct`、`examType`。初始化時會讀取，成功使用 IndexedDB 後仍 mirror 回這些 key，以相容舊版；**不會刪除 legacy 原始資料**。若 IndexedDB 無法使用，網站 fallback 到 localStorage，但新進階資料不保證可完整保存。

### LearningState v2 摘要

```json
{
  "schemaVersion": 2,
  "favorites": ["question-id"],
  "wrong": ["question-id"],
  "answered": 42,
  "correct": 31,
  "examType": "socialWorker",
  "attempts": [{
    "id": "a-...",
    "questionId": "…",
    "subject": "社會工作",
    "examType": "socialWorker",
    "answer": "A",
    "correct": false,
    "at": "2026-11-23T…Z",
    "mode": "practice"
  }],
  "reviews": [{
    "questionId": "…",
    "subject": "社會工作",
    "examType": "socialWorker",
    "correctStreak": 0,
    "intervalDays": 1,
    "lastResult": "incorrect",
    "lastReviewedAt": "…",
    "dueAt": "YYYY-MM-DD"
  }],
  "mockExams": [],
  "essayPractices": [],
  "resume": null,
  "plan": {"weeklyGoal": 120, "startDate": null},
  "notes": {"question-id": "筆記"},
  "tags": {"question-id": ["標籤"]},
  "customTags": ["標籤"],
  "errataNotes": {"question-id": "使用者勘誤註記"},
  "updatedAt": "ISO-8601"
}
```

### 備份 format 與合併策略

匯出檔為：

```json
{
  "app": "social-worker-quiz-pwa",
  "backupVersion": 2,
  "exportedAt": "ISO-8601",
  "learningState": { "…": "上述 LearningState" }
}
```

匯入會驗證 `app`、backup version 和所有進階 state 結構（`isValidLearningState()`）。它採 **確定性無損 merge，不覆寫／刪除**（已於 Commit `fa42f18` 完成重構與 4 組單元測試保護）：收藏與錯題取聯集；累計 `answered`／`correct` 取較大值；`attempts`（上限 5,000）、`reviews`、`mockExams`（上限 100）、`essayPractices`（上限 500）、`notes`／`errataNotes`（非破壞式冪等合併）、`tags`／`customTags` 與 `plan`／`resume` 皆會完整無損保留，匯入舊版 v1 備份亦不會清空本機 v2 進階學習資料。

---

# 4. PWA 與快取機制（PWA & Service Worker Configuration）

## 4.1 Manifest

檔案：`manifest.webmanifest`

- `name`: 台灣社工師歷屆題庫
- `short_name`: 社工師題庫
- `start_url`: `./`
- `scope`: `./`
- `display`: `standalone`
- `background_color`: `#f6f5fb`
- `theme_color`: `#4f46a5`
- `lang`: `zh-Hant-TW`
- icons：`icon-192.png`、`icon-512.png`，均宣告 `purpose: any maskable`。

這些全部使用相對路徑，以相容 GitHub Pages 的 `/social-worker-quiz-pwa/` 子路徑。iOS Safari 另由 `index.html` 的 Apple meta tags 與 `apple-touch-icon` 支援；Safari 沒有 Chromium 的 `beforeinstallprompt`，故 `app.js` 以 user-agent 顯示「分享 → 加入主畫面」文字提示。

## 4.2 Service Worker 策略

目前 `service-worker.js`：

- 先 `importScripts('./sw-cache-policy.js')`。
- cache namespace prefix 是 **`social-worker-quiz-pwa-`**，由 `sw-cache-policy.js` 統一管理。
- 目前 active asset cache：`social-worker-quiz-pwa-assets-v31`。
- 目前 active question data cache：`social-worker-quiz-pwa-data-v31`。
- install：對 `ASSETS` 的 HTML、CSS、JS、manifest、icons 執行 `cache.addAll()`。
- activate：只刪除同 prefix 且不在 `[CACHE, DATA_CACHE]` 的舊 cache；同網域其他 GitHub Pages repo 的 caches 不會被刪除。
- navigation request：**Network-first**；成功時把 `./` 緩存，網路失敗時回傳 cache 的 `./`。
- `questions.json`：**Network-first + JSON Content-Type 驗證**；網路失敗才回 `DATA_CACHE`。這避免離線時完全不能載入題庫，也避免 HTML error response 被當 JSON cache。
- 其餘 static request：**Cache-first**；miss 才 fetch 並寫入 asset cache。
- update：收到 `{type:'SKIP_WAITING'}` 才 `skipWaiting()`；`app.js` 偵測 waiting worker 後顯示「更新」按鈕，使用者點擊後才 activate。`controllerchange` 時重載頁面。這避免更新在作答中被無預警強制套用。

## 4.3 每次前端發布必做的版號清單

這是非常重要的操作程序。因 static resource 是 cache-first，**只改檔案內容不改 URL 很容易讓 PWA 留在舊版。**

1. 在 `index.html` 修改有變更檔案的 `?build=N`：例如目前 `app.js?build=31`、`readability.css?build=31`、`essay-study-tools.js?build=31`、`data-store.js?build=27`、`knowledge-readability-fix.css?build=2`（純內容更新 `questions.json` 採 Network-first 且不經 `?build=`，毋須每次遞增前端版號）。
2. 在 `service-worker.js` 的 `ASSETS` 使用完全相同的新 URL。
3. 修改 `CACHE`、`DATA_CACHE` 版本（通常同時遞增，例如 `v31` → `v32`）。
4. 確認新 cache 的 `ASSETS` 包含所有新增檔案；否則離線初次安裝會失敗，因 `cache.addAll()` 任一項失敗就會造成 install 失敗。
5. 不要更改 `SWCachePolicy.CACHE_PREFIX`，除非有 migration 理由與 cache-isolation test。
6. 以新瀏覽器 profile／實機 PWA 驗證：「更新」提示、更新後 reload、離線重新開啟與舊 cache 清除。

網址 `?v=2` 是使用者慣用進入連結的 query parameter，不是 Service Worker cache 版號來源；不要依賴它進行離線 cache 失效。

---

# 5. GitHub Pages 部署與建置流程（Build & Deployment Pipeline）

## 5.1 實際部署設定

- Repository：`https://github.com/kisk44111/social-worker-quiz-pwa`
- Production branch：`main`
- GitHub Pages source：legacy Pages，`main` branch root `/`
- Production URL：`https://kisk44111.github.io/social-worker-quiz-pwa/`
- HTTPS enforced：是。
- `.github/workflows/` 在掃描時不存在；**沒有 GitHub Actions workflow、沒有 CI artifact build**。
- 因此推／merge 到 main 後 GitHub Pages 自動開始 static build。可用：

```bash
gh api repos/kisk44111/social-worker-quiz-pwa/pages/builds/latest \
  --jq '{status:.status,commit:.commit,error:.error.message}'
```

查詢建置狀態。

## 5.2 建議安全發布流程

```bash
# 1) 取得正式分支現況；不要使用本地舊 main 直接推送
git fetch origin --prune
git switch main
git pull --ff-only origin main

# 2) 開新功能分支
git switch -c feature/short-description

# 3) 修改後完整驗證
npm test
git diff --check
git status --short

# 4) 審閱題庫／SW UI 變更，再提交與推送
git add <explicit-files>
git commit -m "Describe change"
git push -u origin feature/short-description

# 5) 建 PR；確認可合併，再 merge 至 main
gh pr create --base main --head feature/short-description --title "…" --body "…"
gh pr view <number> --json mergeable,mergeStateStatus
gh pr merge <number> --merge

# 6) 等 Pages built，再驗證正式檔案與網址
gh api repos/kisk44111/social-worker-quiz-pwa/pages/builds/latest --jq '{status:.status,commit:.commit}'
curl -fsSI 'https://kisk44111.github.io/social-worker-quiz-pwa/?v=2'
```

## 5.3 子路徑注意事項

- 所有網站 asset、manifest、SW、questions fetch 都使用 `./` 或相對路徑；請維持這個規則。不能直接寫 `/questions.json` 或 `/service-worker.js`，否則在 GitHub Pages project path 會指到使用者網域根目錄而失敗。
- `<base>` 沒有設定；若日後導入 bundler，要設定 repo base 為 `/social-worker-quiz-pwa/`。
- 確認 `service-worker.js` 註冊為 `./service-worker.js`，scope 才會是專案子路徑。

---

# 6. 核心功能與使用者流程清單（Implemented Features）

| 功能 | 使用者流程 | 程式位置 |
|---|---|---|
| 考試別切換 | 首頁選「社工師考試」或「公職社工師考試」，題庫／統計／科目隨之切換。 | `app.js`：`examConfigs`、`renderLibrary()`。 |
| 多條件搜尋與篩選 | 用關鍵字、科目、年度、題型、未作答／錯題／收藏／到期複習組合搜尋。 | `renderLibrary()`。 |
| 歷屆題練習 | 從科目、搜尋結果或題單進入；保留「官方題號」及「題單位置」。 | `renderSubject()`、`renderList()`、`renderQuestion()`。 |
| 作答後詳解 | 選擇答案、按確認後顯示正誤、官方／更正答案與完整 `explanation`；可按下一題。 | `renderQuestion()`。 |
| 錯題與收藏 | 錯答加入 `wrong` Set；題目畫面可收藏；底部 tabs 可檢視。 | `renderQuestion()`、`render()`。 |
| 間隔複習 | 答錯初始 1 天；答對依 streak 1/3/7/14 天；錯答會重置。錯題答對後仍留 review record。 | `study-engine.js`：`scheduleReview()`、`dueReviews()`；`recordPracticeAttempt()`。 |
| 智慧推薦／每日任務 | 權重依到期複習、錯題、未作答與最弱兩科；首頁提供 review／weak／essay task。 | `weightedRecommendation()`、`dailyTasks()`。 |
| 接續練習 | 作答時保存題單 ID 與 index；首頁有繼續按鈕。 | `saveResume()`、`renderLibrary()`。 |
| 學習統計 | 累計、正確率、待複習、各科、近 7 天、週趨勢；新逐題紀錄才用於趨勢。 | `renderStats()`、`study-engine.js`。 |
| 分科模擬考 | 五科每科隨機 40 選擇題；計時、題號導覽、標記、交卷確認；交卷前不顯示答案。 | `renderMockSetup()`、`renderMock()`。 |
| 五科連續模擬 | 五科各抽 40 題，合計 200 題，結果有分科統計。 | `renderMockSetup()`、`renderMockResult()`。 |
| 歷屆完整試卷模式 | 題單剛好有 40 選擇題時可進入 historical paper mode。 | `renderList()` 的 `#paperMode`。 |
| 申論練習 | 題幹、計時、自動暫存、手動儲存、自評 5 項；`v28` 雙區塊結構化離線解答（起・承・轉・合擬答＋三類解析要點，全庫 160 題 100% 完備）；`v29`–`v31` 升級 Web Speech API 高擬真語音聽讀播放器（高擬真神經網路語音優先排序、手動中文語音切換器、自然口語前處理與三層氣口停頓、分段高亮、`1.0x/1.25x/1.5x` 語速、通勤連播）、**NotebookLM／Gemini 自然口語講稿單題複製與整科 `.txt` 匯出**及骨架盲測（主動回憶）訓練開關。 | `renderEssayHtml()`、`renderEssaySprintBarHtml()`、`essay-study-tools.js`、`readability.css`。 |
| 筆記、標籤與勘誤 | 每題能寫筆記、加入／移除自訂標籤；顯示官方來源與更正答案；`errataNotes` 有資料結構但目前 UI 尚未提供新增輸入。 | `questionTools()`、`bindQuestionTools()`。 |
| 備份與還原 | 匯出 JSON；選檔後驗證與安全合併，不刪現有摘要。 | `renderDataManagement()`、`data-store.js`。 |
| 知識庫 | 知識卡搜尋、五科大補帖、理論導讀／歷史／內容／架構、具名學者原題、概念延伸題。 | `renderKnowledge()` + 知識 JS/CSS 模組。 |
| 深色模式與 RWD | OS color scheme dark、手機 bottom nav、桌面側欄與雙欄題目。 | `theme.css`、`desktop.css`、`readability.css`、`knowledge-readability-fix.css`。 |
| PWA／離線 | manifest、install prompt、iOS 加入主畫面提示、asset cache、questions fallback、手動更新。 | `manifest.webmanifest`、`service-worker.js`、`app.js` bootstrap。 |

---

# 7. 已知問題、技術債與待辦事項（Known Issues & Technical Debt）

以下是掃描與程式閱讀所得結論，請接手者優先理解而非隱藏：

## P0：資料與發布安全

1. **~~local `main` 過期~~（已同步完成／HEAD `c8fc487`）**：本地 `main` 已與遠端 `origin/main` 完全同步；後續開發前仍應維持先 `git fetch origin`、`git status` 確認對齊再動工的紀律。
2. **PWA versioning 是手動且易漏**：HTML 的 build query、SW ASSETS、asset/data cache version 必須手工一致（目前最新版本為 `v31`）；近期已發生新樣式存在但舊 app JS 仍因 cache-first 顯示舊排序的問題。建議未來建立 release helper 或最少新增檢查測試，但不能未設計 migration 就盲目全面重構。
3. **題庫維護腳本可覆寫正式資料**：所有 `tools/import_*`、`add_115_*`、`generate_content_*`、`generate_essay_answers.py`、`rebuild_mc_explanations.py` 會寫入 `questions.json`（其中 `generate_content_mc_explanations.py` 與 `generate_essay_answers.py` 皆已內建寫入前 `validate_questions` 全庫驗證與同目錄暫存檔原子替換 `os.replace`）。仍須檢查 diff、跑全測試、保留官方來源與 hash。
4. **~~OpenRouter script 的 token 風險~~（已完成修復／Commit `e883088`）**：`tools/generate_content_mc_explanations.py` 已完成安全重構與過時 docstring 修正。現已支援 `--dry-run`（與 `pending == 0` 時零 Keychain 讀取／零 API 呼叫）、優先使用環境變數 `OPENROUTER_API_KEY`、僅明確傳入 `--use-keychain` 才讀取 macOS Keychain、遠端請求與 `--apply` 皆須 `--confirm-remote-api` 確認、寫回 `questions.json` 前必經 `validate_questions` 驗證與原子替換，並將無效回應日誌改存於受控 `0700/0600` 時間戳記目錄。執行時仍須確認額度與範圍，且絕不可記錄或提交金鑰。

## P1：功能一致性與資料完整性

1. **~~備份合併不完整~~（已完成修復／Commit `fa42f18`）**：`data-store.js` 的 `isValidLearningState()` 已補齊 `notes`、`tags`、`customTags`、`errataNotes`、`plan`、`resume` 與陣列元素結構驗證；`mergeLearningStates()` 已重構為確定性無損合併，完整涵蓋 `attempts`（ID／組合鍵去重，上限 5,000）、`reviews`（較新排程優先）、`mockExams`（ID 去重與已完成優先，上限 100）、`essayPractices`（非空且較新優先，上限 500）、`notes`／`errataNotes`（非破壞式雙邊分隔合併且具冪等性）、`tags`／`customTags`（聯集去重）與 `plan`／`resume`（非空／較新優先），並新增 4 組單元與 v1 舊備份迴歸測試且同步升級 PWA 快取至 `v27`。
2. **`errataNotes` 沒有新增 UI**：state 與顯示分支已存在，但使用者沒有介面可寫入此欄位。應補輸入介面或移除未使用欄位前先考量舊備份相容性。
3. **公職社工師首頁按鈕命名不精準**：公職題全是申論，但 `renderLibrary()` 的快速按鈕顯示「10 題隨機申論複習」；要確認流程名稱、統計與模擬考是否符合使用者期待。分科模擬只為專技五科設計。
4. **統計總數與逐題歷程的語意**：舊版僅有 `answered/correct` 累計數，趨勢與各科統計只由新 attempts 計算。這是正確的保守做法，但 UI 需繼續清楚說明，不能把舊總數推測成歷程。
5. **模擬 timer 重繪邏輯**：畫面用 `startedAt` + saved `elapsedSeconds` 推算；重新載入／切換時基本可用，但沒有專門 integration test，實機要驗證暫停／背景與回到頁面是否符合預期。
6. **知識檔案依字串關聯題目**：具名學者採拉丁字母精準字串；概念延伸採 terms 包含判斷。它可追溯且已有 tests，但不是 semantic search，可能漏掉中文譯名、拼字差異或 OCR 變體；新增理論需同時檢查題目實際命中數。

## P2：維護性、效能、設計與安全

1. **`app.js` 過大**：單檔約 53 KB、字串模板密集、幾乎所有 UI 邏輯混在一起。可漸進抽出 `renderers/` 或 pure data functions，但避免全面框架重寫，以免破壞離線與本機資料。
2. **題庫初始載入偏重**：約 7.9 MB JSON 要 parse、記憶體保存全陣列（含 2,400 題選擇詳解與 160 題完整結構化申論擬答）；低階 iPhone 可能出現載入等待。未來可評估依考科／年度分割題庫、預建 index 或 lazy load，但必須保留完整離線能力、資料 integrity validation 和 cache 策略。
3. **沒有正式 bundler／lint／format**：無 ESLint、Prettier、typecheck、lockfile 或 CI；目前以人工 review、`git diff --check`、npm tests 補足。若新增工具，要先確認不增加不必要 runtime complexity。
4. **沒有 E2E／真實 Safari 自動測試**：Node tests 未涵蓋 DOM、CSS、Service Worker 安裝、iOS 主畫面 PWA。發版前須人工驗證 iPhone Safari、iOS PWA、Mac Safari、Chrome。
5. **dark-mode CSS 競爭**：`theme.css`、`readability.css` 與 knowledge hotfix 多層 override，特別是 `<details><summary>` 容易因 inherited color／背景出現低對比。修改知識庫 UI 一律檢視亮暗模式展開與收合狀態。
6. **`index.html` 註解過期**：`<!-- deployment build 15 (not deployed from this branch) -->` 與目前版本不符，應在一次低風險文件 PR 修正或刪除。
7. **無 Content Security Policy**：雖然題目／筆記渲染多使用 `esc()`，但沒有 CSP header/meta。GitHub Pages header 限制下可考慮 `<meta http-equiv="Content-Security-Policy">` 前先仔細驗證 inline style、worker、blob download 需求。
8. **外部官方連結信任邊界**：題庫 source URL 目前由受控 JSON 注入並以 `esc()` + `rel="noopener"` 顯示。匯入工具若加入來源，需驗證 URL 協定為 HTTPS、目的地是官方網域，避免未來 data-driven link injection。
9. **`npm test` 的官方核對需網路**：`test:official` 會重新下載考選部 PDF；網路、考選部 endpoint 或 `pdftotext` 不可用時可能失敗，這不必然代表題庫錯誤，應在報告中分辨 infrastructure failure 與 content mismatch。

---

# 8. 給接手代理（Antigravity）的啟動指令與開發規範（Quick Start & Conventions）

## 8.1 首次啟動

```bash
# 進入專案（依實際掛載位置調整）
cd /Users/neko/.codex/workspaces/social-worker-quiz-pwa-knowledge

# 先同步遠端；不可信任目前本地 old main
git fetch origin --prune
git switch main
git pull --ff-only origin main

# 確認正式 commit 與工作樹
git status --short --branch
git log -1 --oneline

# 不需要 npm install（package.json 無 dependencies）。跑完整驗證：
npm test

# 啟動純靜態本機 server（擇一）
python3 -m http.server 4173
# 然後開啟 http://127.0.0.1:4173/
```

不要以 `file://` 直接開啟 `index.html`，因 `fetch`、Service Worker 與 PWA 必須透過 HTTP(S)。本機 `http://localhost`／`127.0.0.1` 可註冊 Service Worker；實機請使用 HTTPS GitHub Pages。

### 常用驗證指令

```bash
# 全部：Node、Python schema、題庫 validator、官方答案再核對
npm test

# 僅題庫 structure
python3 tools/validate_questions.py

# 查看申論題結構化擬答覆蓋進度（目前 160 / 160，100.0%）
python3 tools/generate_essay_answers.py --status

# 僅官方 115-2 來源與答案／更正核對（需要網路 + pdftotext）
python3 tools/verify_115_second_social_worker.py

# 只跑 Node tests
npm run test:storage

# 檢查 whitespace 與待提交內容
git diff --check
git status --short
git diff -- questions.json
```

## 8.2 程式風格與命名

- UI 語言固定繁體中文（臺灣）。社會工作、長照、研究用語採台灣常用語。
- 現行 JavaScript 為無分號／高壓縮風格；延續相近風格即可，但新程式可在不大量重排既有檔案的前提下採清楚多行格式。不要為 formatting 製造全檔 diff。
- 函式採 camelCase，如 `renderKnowledge`、`saveEssayPractice`；常數採 UPPER_SNAKE_CASE，如 `CACHE_PREFIX`、`DB_NAME`；CSS class 使用 kebab-case。
- 新增會顯示未信任／使用者輸入／題庫文字的 HTML 時，使用 `esc()`；不要用未 escape 字串拼到 `innerHTML`。
- 新增 user state 時先決定容量與 retention：目前 attempts 最多 5,000、mockExams 最多 100、essayPractices 最多 500。避免無上限 IndexedDB 膨脹。
- 不要在 browser runtime 導入 API key、付費 API、雲端資料庫、追蹤或 framework，除非使用者重新明確授權。

## 8.3 題庫修改規範

1. 永遠在 feature branch 修改；`questions.json` 需保持 UTF-8 JSON array。
2. 先備份／commit 現況，再執行任何會寫入題庫的 `tools/` script。
3. 不改既有 `id`、不刪題、不任意重排；題目新增應沿用既有 ID 邏輯並確保該卷 `number` 連續。
4. 官方題目與答案要有可追溯來源；官方更正使用 `acceptedAnswers`，不要直接消去原始 `answer` 的證據。
5. 申論的 AI／教材整理不得冒充官方標準答案；寫入 `aiContent.limitations` 或清楚的顯示文案。
6. 每次題庫變動後必跑：

   ```bash
   python3 tools/validate_questions.py
   npm test
   ```

7. 改 115 年第二次題目或答案後，還要跑 `python3 tools/verify_115_second_social_worker.py`，並記錄是否考選部檔案 hash 已變動。

## 8.4 UI／PWA 修改規範

1. 手機優先；至少檢查窄手機、iPad／平板、桌面寬度。
2. 每個文字／底色變更檢查亮色與 `prefers-color-scheme: dark`，特別是 button hover、disabled、details summary 展開／收合、焦點 outline。
3. 互動控制保留觸控目標與鍵盤 `:focus-visible`；勿只依賴 hover。
4. 新增 CSS／JS 或修改既有 static 資產時遵守第 4.3 節的 build query + SW cache version 清單。
5. PWA 更新不得自動 `skipWaiting`；現有「更新」按鈕語意是重要保護，避免使用者答題中斷。
6. 部署前以乾淨瀏覽器 profile 實測：首次載入、刷新、離線重新開啟、等待更新後手動更新，以及使用者學習資料仍存在。

## 8.5 發布前最小驗收清單

- [ ] `git status` 僅含預期檔案；未加入 Keychain／checkpoint／暫存資料。
- [ ] `npm test` 全數通過；若官方 re-download 失敗，明確記錄原因。
- [ ] `questions.json` 題數與科別分布符合預期，ID 沒改動／重複。
- [ ] 備份匯出、合併匯入與既有收藏／錯題保留可運作。
- [ ] 作答、錯題複習、詳解、申論暫存、模擬交卷與統計主流程可用。
- [ ] PWA update button、offline questions cache 與 cache namespace 已驗證。
- [ ] iPhone Safari、iOS 主畫面 PWA、Mac Safari、Chrome 完成實機 smoke test。
- [ ] GitHub Pages build 對應本次 main commit，正式 URL HTTP 200 且引用新 build URLs。

---

## 附錄：接手時應先閱讀的順序

1. 本檔 `HANDOFF.md`、`README.md`、`CHANGELOG.md`。
2. `index.html` 了解載入順序與 CSS／JS build query。
3. `app.js` 的前 42 行 state／routing，再讀各 renderer。
4. `data-store.js` 與 `study-engine.js`，確認資料安全邊界。
5. `service-worker.js`、`sw-cache-policy.js`，再修改任何靜態資產。
6. `tools/validate_questions.py`、tests，最後才碰 `questions.json`。

這個專案最重要的品質標準不是動畫或框架新穎性，而是：**官方答案可追溯、學習資料不遺失、PWA 更新不打斷作答、以及手機與桌面皆可清楚閱讀。**
