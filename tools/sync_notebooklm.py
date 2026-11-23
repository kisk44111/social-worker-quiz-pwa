#!/usr/bin/env python3
"""
本機離線維運工具：將 questions.json 全庫 160 題申論題自動轉換為
適合 Google NotebookLM 雙人深度對談 Podcast（Audio Overview）之自然口語講稿，
並支援：
  1. --dry-run      ：預覽 7 科題數、字數與來源結構（不啟動瀏覽器、不寫檔）
  2. --export-only  ：一鍵匯出 7 科自然口語 .txt 講稿與對談提示詞至本機目錄
  3. Playwright 模式：使用家目錄獨立 Chrome Profile（~/.cache/swq-notebooklm-profile，
                      嚴格排除於 Git 儲存庫外），自動同步講稿至 NotebookLM 筆記本
                      「2027 社工師國考申論衝刺有聲書」，並可選用 --generate-audio
                      觸發語音摘要生成。

注意：
  - 本工具為本機個人備考自動化腳本，不影響網站前端純靜態與零 API 依賴架構。
  - 首次使用 Playwright 同步時會開啟可視化瀏覽器供您親自登入 Google 帳號，
    後續將自動沿用家目錄中的獨立登入工作階段；嚴禁將 Profile 目錄放進專案內。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QUESTIONS_PATH = REPO_ROOT / "questions.json"
DEFAULT_PROFILE_DIR = Path.home() / ".cache" / "swq-notebooklm-profile"
DEFAULT_EXPORT_DIR = Path.home() / ".cache" / "swq-notebooklm-exports"
DEFAULT_NOTEBOOK_TITLE = "2027 社工師國考申論衝刺有聲書"
NOTEBOOKLM_URL = "https://notebooklm.google.com/"

EXAM_LABELS = {
    "socialWorker": "專技社工師",
    "publicSocialWorker": "公職社工師",
}

ORDERED_SUBJECT_GROUPS: list[tuple[str, str]] = [
    ("socialWorker", "社會工作"),
    ("socialWorker", "人類行為與社會環境"),
    ("socialWorker", "社會工作直接服務"),
    ("socialWorker", "社會工作研究方法"),
    ("socialWorker", "社會政策與社會立法"),
    ("publicSocialWorker", "社會工作實務"),
    ("publicSocialWorker", "社會福利政策與法規"),
]

ESSAY_STAGES: list[tuple[str, str, str]] = [
    ("qi", "起", "破題與核心概念界定"),
    ("cheng", "承", "理論依據與法規政策剖析"),
    ("zhuan", "轉", "實務應用、困境與批判反思"),
    ("he", "合", "總結與具體建議展望"),
]

CN_NUMS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]


def _number_to_spoken_ordinal(num_text: str) -> str:
    try:
        n = int(num_text)
        if 1 <= n <= 10:
            return f"第{CN_NUMS[n]}點，"
    except ValueError:
        pass
    return f"第{num_text}點，"


def clean_speech_text(text: Any) -> str:
    """與前端 essay-study-tools.js 對齊之中文自然口語文本前處理。"""
    s = str(text or "")
    s = re.sub(r"\*\*(.*?)\*\*", r"\1", s)
    s = re.sub(r"__(.*?)__", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"^#{1,6}\s*", "", s, flags=re.MULTILINE)
    s = re.sub(r"^\s*[-*•]\s+", "", s, flags=re.MULTILINE)

    # 移除題末配分標示（如 （25 分））
    s = re.sub(r"[（(]\s*\d+\s*分\s*[)）]", "", s)
    # 移除純英文／數字括號補充，避免語音引擎逐字母拼讀
    s = re.sub(r"[（(]\s*[A-Za-z0-9\s\-_/,.;:&+'\"]+\s*[)）]", "", s)

    # 條列序號轉自然口語
    s = re.sub(
        r"(^|[\n。！？；：])\s*[（(]([一二三四五六七八九十])[)）]\s*",
        r"\1第\2點，",
        s,
    )
    s = re.sub(
        r"(^|[\n。！？；：])\s*([一二三四五六七八九十])、\s*",
        r"\1第\2點，",
        s,
    )
    s = re.sub(
        r"(^|[\n。！？；：])\s*[（(]([1-9]|10)[)）]\s*",
        lambda m: f"{m.group(1)}{_number_to_spoken_ordinal(m.group(2))}",
        s,
    )
    s = re.sub(
        r"(^|[\n。！？；：])\s*([1-9]|10)[.、](?!\d)\s*",
        lambda m: f"{m.group(1)}{_number_to_spoken_ordinal(m.group(2))}",
        s,
    )

    # 中文括號補充轉逗號停頓
    s = re.sub(r"[（(]([^（）()]+)[)）]", r"，\1，", s)
    # 去除書名號與引號等干擾符號
    s = re.sub(r"[《》〈〉「」『』【】\[\]]", "", s)

    s = re.sub(r"\bvs\.?\b", "對照", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*[→➔➜]\s*", "，進而", s)
    s = re.sub(r"([\u4e00-\u9fff])\s*[／/]\s*([\u4e00-\u9fff])", r"\1、\2", s)
    s = re.sub(r"[｜|]", "，", s)
    s = re.sub(r"[ \t]+", " ", s)

    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\n{2,}", "\n", s)
    s = re.sub(r"[，,]{2,}", "，", s)
    s = re.sub(r"([。！？；：])[，,、]+", r"\1", s)
    s = re.sub(r"[，,、]+([。！？；：])", r"\1", s)
    s = re.sub(r"^[\s，,、]+", "", s, flags=re.MULTILINE)
    s = re.sub(r"[\s，,、]+$", "", s, flags=re.MULTILINE)
    return s.strip()


def to_conversational_paragraph(text: Any) -> str:
    cleaned = clean_speech_text(text)
    if not cleaned:
        return ""
    lines = [line.strip() for line in cleaned.split("\n") if line.strip()]
    spoken_lines: list[str] = []
    for idx, line in enumerate(lines):
        s = line
        s = re.sub(r"^第一點[，,、：:]?\s*", "首先，" if idx == 0 else "第一點，", s)
        s = re.sub(r"^第二點[，,、：:]?\s*", "接著第二點，", s)
        s = re.sub(r"^第三點[，,、：:]?\s*", "第三點，", s)
        s = re.sub(r"^第四點[，,、：:]?\s*", "再來第四點，", s)
        s = re.sub(r"^第五點[，,、：:]?\s*", "第五點，", s)
        s = re.sub(r"^第六點[，,、：:]?\s*", "第六點，", s)
        s = re.sub(r"[：:;；]", "，", s)
        s = re.sub(r"[()（）\[\]【】《》「」『』*#•▪]", "", s)
        s = re.sub(r"[，,]{2,}", "，", s)
        s = re.sub(r"([。！？])[，,]+", r"\1", s)
        s = re.sub(r"[，,]+([。！？])", r"\1", s)
        s = s.strip()
        if s and not re.search(r"[。！？]$", s):
            s += "。"
        if s:
            spoken_lines.append(s)
    return " ".join(spoken_lines)


def format_essay_for_natural_audio(question: dict[str, Any]) -> str:
    """將單題申論題轉為自然口語導讀講稿。"""
    blocks: list[str] = []
    meta_bits: list[str] = []
    if question.get("year"):
        meta_bits.append(f"{question['year']}年")
    if question.get("session"):
        meta_bits.append(f"第{question['session']}次")
    if question.get("subject"):
        meta_bits.append(clean_speech_text(question["subject"]))
    intro = f"{''.join(meta_bits)}申論題考前導讀。" if meta_bits else "申論題考前導讀。"

    prompt = to_conversational_paragraph(question.get("prompt", ""))
    blocks.append(f"{intro}{'先來看一下這題的題目，' + prompt if prompt else ''}")

    essay_guide = question.get("essayGuide") or {}
    model = essay_guide.get("modelAnswer")
    if isinstance(model, dict) and model:
        qi = model.get("qi") or {}
        cheng = model.get("cheng") or {}
        zhuan = model.get("zhuan") or {}
        he = model.get("he") or {}

        qi_body = to_conversational_paragraph(qi.get("content", ""))
        if qi_body:
            title = clean_speech_text(qi.get("title") or ESSAY_STAGES[0][2])
            blocks.append(f"這題在考的核心概念是{title}。{qi_body}")

        cheng_body = to_conversational_paragraph(cheng.get("content", ""))
        if cheng_body:
            title = clean_speech_text(cheng.get("title") or ESSAY_STAGES[1][2])
            blocks.append(f"在理論與法規面向上，針對{title}，我們可以從以下幾個重點切入。{cheng_body}")

        zhuan_body = to_conversational_paragraph(zhuan.get("content", ""))
        if zhuan_body:
            title = clean_speech_text(zhuan.get("title") or ESSAY_STAGES[2][2])
            blocks.append(f"回到台灣第一線社工實務現場來看，關於{title}，{zhuan_body}")

        he_body = to_conversational_paragraph(he.get("content", ""))
        if he_body:
            title = clean_speech_text(he.get("title") or ESSAY_STAGES[3][2])
            blocks.append(f"最後在結論收尾時，針對{title}，建議提出以下總結。{he_body}")
    else:
        legacy = to_conversational_paragraph(question.get("referenceAnswer") or question.get("explanation") or "")
        if legacy:
            blocks.append(f"這題的重點作答方向可以這樣切入。{legacy}")

    analysis = essay_guide.get("analysis") or {}
    raw_theories = analysis.get("theoriesAndLaws") or []
    theories: list[str] = []
    for item in raw_theories:
        cleaned = re.sub(r"[：:；;()（）\[\]【】《》「」『』]", "，", clean_speech_text(item))
        cleaned = re.sub(r"[，,]{2,}", "，", cleaned).strip("， ")
        if cleaned:
            theories.append(cleaned)
    if theories:
        blocks.append(f"考前快速複習這題一定要帶到的核心理論與法規關鍵字，包括：{'、'.join(theories)}。")

    return "\n\n".join(b for b in blocks if b)


def build_podcast_prompt(subject_name: str, exam_label: str) -> str:
    subject = clean_speech_text(subject_name)
    exam = clean_speech_text(exam_label)
    return (
        f"請以繁體中文（臺灣用語）製作「{exam}・{subject}」考前申論衝刺深度對談 Podcast。"
        "設定兩位主持人皆為台灣資深社工督導兼國考閱卷輔導老師，語氣溫暖自然、節奏俐落不照稿唸，"
        "逐題拆解：\n"
        "1. 審題破題與「起・承・轉・合」四段答題骨架；\n"
        "2. 台灣在地保護性、脆弱家庭、長照或社區第一線實務案例與常見困境反思；\n"
        "3. 國考必背核心理論、學者觀點、法規名稱與閱卷給分關鍵字，避免空泛口號並於每題結尾用一句話幫考生記憶。"
    )


def build_subject_packs(
    questions: list[dict[str, Any]],
    exam_type_filter: str = "all",
    subject_filter: str | None = None,
) -> list[dict[str, Any]]:
    """將全庫申論題依專技 5 科 + 公職 2 科分組並轉換為自然口語講稿包。"""
    packs: list[dict[str, Any]] = []
    essays = [q for q in questions if q.get("type") == "essay"]

    for exam_type, subject in ORDERED_SUBJECT_GROUPS:
        if exam_type_filter != "all" and exam_type != exam_type_filter:
            continue
        exam_label = EXAM_LABELS[exam_type]
        if subject_filter:
            needle = subject_filter.strip()
            if needle and (needle not in subject and needle not in f"{exam_label}{subject}"):
                continue

        matched = [
            q
            for q in essays
            if (q.get("examType") or "socialWorker") == exam_type and q.get("subject") == subject
        ]
        matched.sort(key=lambda q: (int(q.get("year") or 0), int(q.get("session") or 0), int(q.get("number") or 0)))
        if not matched:
            continue

        prompt_guide = build_podcast_prompt(subject, exam_label)
        source_title = f"{exam_label}｜{subject}（{len(matched)}題申論口語講稿）"
        safe_filename = f"{exam_label}-{subject}-{len(matched)}題-口語講稿.txt"

        header = "\n".join(
            [
                f"【來源名稱】{source_title}",
                "【給 NotebookLM 雙人深度對談（Audio Overview）導讀指令】",
                prompt_guide,
                "【非官方內容聲明】本講稿為 AI 輔助整理之非考選部官方參考內容，僅供備考聽讀與結構記憶，法規與實務請以考試當年度有效規定為準。",
            ]
        )
        body = "\n\n────────────────────\n\n".join(
            f"第 {idx} 題講稿\n{format_essay_for_natural_audio(q)}"
            for idx, q in enumerate(matched, start=1)
        )
        content = f"{header}\n\n====================\n\n{body}\n"

        packs.append(
            {
                "examType": exam_type,
                "examLabel": exam_label,
                "subject": subject,
                "count": len(matched),
                "sourceTitle": source_title,
                "filename": safe_filename,
                "promptGuide": prompt_guide,
                "charCount": len(content),
                "estMinutes": max(1, round(len(content) / 240)),
                "content": content,
            }
        )
    return packs


def assert_profile_outside_repo(profile_dir: Path) -> Path:
    resolved = profile_dir.expanduser().resolve()
    repo_resolved = REPO_ROOT.resolve()
    try:
        resolved.relative_to(repo_resolved)
    except ValueError:
        return resolved
    raise ValueError(
        f"安全防護攔截：瀏覽器 Profile 目錄（{resolved}）不可位於 Git 專案目錄（{repo_resolved}）內，"
        f"請改用家目錄路徑（例如 {DEFAULT_PROFILE_DIR}）。"
    )


def print_dry_run_summary(packs: list[dict[str, Any]], notebook_title: str, profile_dir: Path) -> None:
    total_q = sum(p["count"] for p in packs)
    total_chars = sum(p["charCount"] for p in packs)
    print(f"NotebookLM 目標筆記本：{notebook_title}")
    print(f"獨立瀏覽器 Profile 路徑：{profile_dir}（位於 Git 專案外）")
    print(f"預計同步考科包：{len(packs)} 份｜合計 {total_q} 題申論｜總計 {total_chars:,} 字")
    print("-" * 82)
    print(f"{'考試類別':<10} {'考科':<16} {'題數':>4} {'總字數':>10} {'估計聽讀':>8}  來源標題")
    print("-" * 82)
    for p in packs:
        print(
            f"{p['examLabel']:<10} {p['subject']:<16} {p['count']:>4} "
            f"{p['charCount']:>10,} {str(p['estMinutes']) + ' 分':>8}  {p['sourceTitle']}"
        )
    print("-" * 82)
    print("[DRY-RUN] 僅預覽結構與字數，未啟動瀏覽器，未寫入任何檔案。")


def export_packs_to_dir(packs: list[dict[str, Any]], export_dir: Path) -> list[Path]:
    target_dir = export_dir.expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    prompts_lines = [
        "NotebookLM 雙人深度對談 Podcast（Audio Overview）各科自訂提示詞總表",
        "=" * 68,
        "",
    ]
    for p in packs:
        out_path = target_dir / p["filename"]
        out_path.write_text(p["content"], encoding="utf-8")
        written.append(out_path)
        prompts_lines.append(f"【{p['examLabel']}・{p['subject']}（{p['count']} 題）】")
        prompts_lines.append(p["promptGuide"])
        prompts_lines.append("")

    prompts_path = target_dir / "00-NotebookLM-Podcast提示詞總表.txt"
    prompts_path.write_text("\n".join(prompts_lines), encoding="utf-8")
    written.append(prompts_path)
    return written


def _click_first_visible(page: Any, selectors: list[str], timeout_ms: int = 3500) -> bool:
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=timeout_ms):
                loc.click()
                return True
        except Exception:
            continue
    return False


def _sync_with_playwright(
    packs: list[dict[str, Any]],
    notebook_title: str,
    profile_dir: Path,
    upload_method: str,
    generate_audio: bool,
    login_timeout: int,
) -> int:
    safe_profile = assert_profile_outside_repo(profile_dir)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("尚未安裝 Playwright，無法自動操作網頁版 NotebookLM。", file=sys.stderr)
        print("請先執行以下指令完成安裝：", file=sys.stderr)
        print("  pip3 install playwright", file=sys.stderr)
        print("  python3 -m playwright install chromium", file=sys.stderr)
        print("", file=sys.stderr)
        print("若暫時不想安裝瀏覽器自動化套件，可先使用離線匯出模式：", file=sys.stderr)
        print(f"  python3 tools/sync_notebooklm.py --export-only {DEFAULT_EXPORT_DIR}", file=sys.stderr)
        return 2

    safe_profile.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(safe_profile, 0o700)
    except OSError:
        pass

    print(f"啟動獨立 Chromium（Profile：{safe_profile}）前往 {NOTEBOOKLM_URL} ...")
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(safe_profile),
            headless=False,
            viewport={"width": 1360, "height": 900},
            locale="zh-TW",
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(NOTEBOOKLM_URL, wait_until="domcontentloaded")

        # 若尚未登入 Google 帳號，等待使用者於可視化視窗親自登入
        deadline = time.time() + max(30, login_timeout)
        logged_in = False
        prompted_login = False
        while time.time() < deadline:
            current_url = page.url or ""
            if "notebooklm.google.com" in current_url and "accounts.google.com" not in current_url:
                # 檢查主畫面建立筆記本或既有筆記本是否載入
                if _has_any_visible(
                    page,
                    [
                        "button:has-text('Create new')",
                        "button:has-text('建立新的')",
                        "button:has-text('新增')",
                        f"text={notebook_title}",
                        "text=My notebooks",
                        "text=我的筆記本",
                    ],
                ):
                    logged_in = True
                    break
            if not prompted_login:
                print("偵測到尚未登入 Google 帳號，請在剛開啟的視窗內完成登入（登入後腳本會自動接手）...")
                prompted_login = True
            time.sleep(2)

        if not logged_in:
            print("等待登入逾時，請重新執行並於視窗內完成 Google 登入。", file=sys.stderr)
            context.close()
            return 1

        print(f"已進入 NotebookLM，正在尋找或建立筆記本「{notebook_title}」...")
        existing = page.locator(f"text={notebook_title}").first
        try:
            if existing.is_visible(timeout=3000):
                existing.click()
                page.wait_for_timeout(1800)
            else:
                raise RuntimeError("not visible")
        except Exception:
            created = _click_first_visible(
                page,
                [
                    "button:has-text('Create new')",
                    "button:has-text('建立新的')",
                    "button:has-text('New notebook')",
                    "button:has-text('新增筆記本')",
                ],
                timeout_ms=4000,
            )
            if not created:
                print("找不到「建立新筆記本」按鈕，請確認 NotebookLM 介面後重試。", file=sys.stderr)
                context.close()
                return 1
            page.wait_for_timeout(2500)
            # 嘗試設定筆記本標題
            for title_sel in [
                "input[aria-label*='title' i]",
                "input[aria-label*='標題']",
                "input.title-input",
            ]:
                try:
                    inp = page.locator(title_sel).first
                    if inp.is_visible(timeout=1500):
                        inp.fill(notebook_title)
                        inp.press("Enter")
                        break
                except Exception:
                    continue

        with tempfile.TemporaryDirectory(prefix="swq-nlm-upload-") as tmp_dir:
            tmp_root = Path(tmp_dir)
            for idx, pack in enumerate(packs, start=1):
                print(f"[{idx}/{len(packs)}] 匯入來源：{pack['sourceTitle']}（{pack['charCount']:,} 字）...")
                # 若尚未打開新增來源對話框，先點選新增來源
                _click_first_visible(
                    page,
                    [
                        "button:has-text('Add sources')",
                        "button:has-text('Add source')",
                        "button:has-text('新增來源')",
                        "button[aria-label*='Add source' i]",
                    ],
                    timeout_ms=2000,
                )
                page.wait_for_timeout(800)

                uploaded = False
                if upload_method == "file":
                    txt_path = tmp_root / pack["filename"]
                    txt_path.write_text(pack["content"], encoding="utf-8")
                    try:
                        file_input = page.locator("input[type='file']").first
                        if file_input.count() > 0:
                            file_input.set_input_files(str(txt_path))
                            uploaded = True
                            page.wait_for_timeout(2500)
                    except Exception:
                        uploaded = False

                if not uploaded:
                    # Fallback：使用「貼上的文字 / Copied text」方式匯入
                    clicked_paste = _click_first_visible(
                        page,
                        [
                            "button:has-text('Copied text')",
                            "button:has-text('貼上的文字')",
                            "text=Copied text",
                            "text=貼上的文字",
                        ],
                        timeout_ms=3000,
                    )
                    if clicked_paste:
                        page.wait_for_timeout(700)
                        try:
                            ta = page.locator("textarea").first
                            ta.fill(pack["content"])
                            _click_first_visible(
                                page,
                                [
                                    "button:has-text('Insert')",
                                    "button:has-text('插入')",
                                    "button:has-text('新增')",
                                ],
                                timeout_ms=3000,
                            )
                            uploaded = True
                            page.wait_for_timeout(2200)
                        except Exception:
                            uploaded = False

                if uploaded:
                    print(f"  ✓ 已送出匯入：{pack['filename']}")
                else:
                    print(
                        f"  ⚠ 無法自動定位上傳欄位，請於瀏覽器中手動上傳或改用 --export-only：{pack['filename']}",
                        file=sys.stderr,
                    )

            if generate_audio:
                print("嘗試觸發語音摘要（Audio Overview）生成...")
                combined_prompt = build_podcast_prompt(
                    "、".join(p["subject"] for p in packs),
                    packs[0]["examLabel"] if len({p["examLabel"] for p in packs}) == 1 else "專技與公職社工師",
                )
                customized = _click_first_visible(
                    page,
                    [
                        "button:has-text('Customize')",
                        "button:has-text('自訂')",
                    ],
                    timeout_ms=3000,
                )
                if customized:
                    page.wait_for_timeout(800)
                    try:
                        ta = page.locator("textarea").last
                        if ta.is_visible(timeout=2000):
                            ta.fill(combined_prompt)
                    except Exception:
                        pass
                triggered = _click_first_visible(
                    page,
                    [
                        "button:has-text('Generate')",
                        "button:has-text('產生')",
                        "button:has-text('生成')",
                        "button:has-text('Audio Overview')",
                        "button:has-text('語音摘要')",
                    ],
                    timeout_ms=4000,
                )
                if triggered:
                    print("✓ 已送出 Audio Overview 生成指令，請於 NotebookLM 頁面檢視生成進度。")
                else:
                    print("⚠ 尚未找到自動生成按鈕，您可直接在右側 Studio 面板點擊「語音摘要 → 自訂」貼上提示詞生成。")

        print("同步作業完成！保留視窗 10 秒供檢視後結束（登入狀態已保存於家目錄獨立 Profile）。")
        page.wait_for_timeout(10000)
        context.close()
    return 0


def _has_any_visible(page: Any, selectors: list[str]) -> bool:
    for sel in selectors:
        try:
            if page.locator(sel).first.is_visible(timeout=500):
                return True
        except Exception:
            continue
    return False


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="將 questions.json 160 題申論題轉為自然口語講稿並同步至 Google NotebookLM。"
    )
    parser.add_argument(
        "--questions",
        type=Path,
        default=DEFAULT_QUESTIONS_PATH,
        help=f"題庫路徑（預設：{DEFAULT_QUESTIONS_PATH}）",
    )
    parser.add_argument(
        "--exam-type",
        choices=["all", "socialWorker", "publicSocialWorker"],
        default="all",
        help="篩選考試類別（預設：all 涵蓋專技 5 科與公職 2 科）",
    )
    parser.add_argument(
        "--subject",
        type=str,
        default=None,
        help="指定單一考科關鍵字（例如：社會工作、研究方法、社會工作實務）",
    )
    parser.add_argument(
        "--notebook-title",
        type=str,
        default=DEFAULT_NOTEBOOK_TITLE,
        help=f"NotebookLM 目標筆記本名稱（預設：{DEFAULT_NOTEBOOK_TITLE}）",
    )
    parser.add_argument(
        "--profile-dir",
        type=Path,
        default=DEFAULT_PROFILE_DIR,
        help=f"獨立 Chrome User Data 目錄，嚴禁設於 Git 專案內（預設：{DEFAULT_PROFILE_DIR}）",
    )
    parser.add_argument(
        "--upload-method",
        choices=["file", "paste"],
        default="file",
        help="NotebookLM 來源匯入方式：file（上傳 .txt）或 paste（貼上文字），預設 file",
    )
    parser.add_argument(
        "--generate-audio",
        action="store_true",
        help="匯入來源後嘗試自動觸發 NotebookLM 語音摘要（Audio Overview）生成",
    )
    parser.add_argument(
        "--export-only",
        nargs="?",
        const=str(DEFAULT_EXPORT_DIR),
        default=None,
        help=f"離線匯出各科 .txt 講稿與提示詞總表而不啟動瀏覽器（預設輸出至：{DEFAULT_EXPORT_DIR}）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="僅預覽各科題數、字數與來源結構，不啟動瀏覽器且不寫入任何檔案",
    )
    parser.add_argument(
        "--login-timeout",
        type=int,
        default=300,
        help="首次執行等待使用者於瀏覽器完成 Google 登入之秒數上限（預設 300 秒）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    questions_path = args.questions.expanduser().resolve()
    if not questions_path.exists():
        print(f"找不到題庫檔案：{questions_path}", file=sys.stderr)
        return 1

    questions = json.loads(questions_path.read_text(encoding="utf-8"))
    packs = build_subject_packs(questions, exam_type_filter=args.exam_type, subject_filter=args.subject)
    if not packs:
        print("依目前篩選條件查無符合之申論題，請確認 --exam-type 或 --subject 參數。", file=sys.stderr)
        return 1

    if args.dry_run:
        safe_profile = assert_profile_outside_repo(args.profile_dir)
        print_dry_run_summary(packs, args.notebook_title, safe_profile)
        return 0

    if args.export_only is not None:
        written = export_packs_to_dir(packs, Path(args.export_only))
        print(f"離線匯出完成！共輸出 {len(written)} 個檔案至：{Path(args.export_only).expanduser().resolve()}")
        for path in written:
            print(f"  - {path.name}")
        return 0

    return _sync_with_playwright(
        packs=packs,
        notebook_title=args.notebook_title,
        profile_dir=args.profile_dir,
        upload_method=args.upload_method,
        generate_audio=args.generate_audio,
        login_timeout=args.login_timeout,
    )


if __name__ == "__main__":
    raise SystemExit(main())
