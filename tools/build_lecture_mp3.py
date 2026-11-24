#!/usr/bin/env python3
"""
本機 100% 離線申論有聲課製作工具：直接讀取 questions.json 全部 160 題申論題，
預設透過 Apple Silicon MLX 零樣本聲音克隆模型（Qwen3-TTS-12Hz-1.7B-Base-bf16）
搭配本機快取之「台灣社工系教授清爽知性 12 秒參考聲紋」，離線批次產出
「道地台灣口音、清爽知性、平實自然不油膩」的國考申論解題 MP3 有聲書；
亦保留免費 Microsoft edge-tts 作為備選引擎（--engine edge）。

核心特色：
  1. 清爽知性台灣老師純口說改寫器：
     自動修復 PDF 斷行、移除所有條列編號（第一點／第二點）與生硬書面語（茲分述如下／
     係指／惟／綜上所述）及浮誇打油詩口訣，轉譯為台灣大學社工系教授錄製線上解題課
     的自然口說逐字稿（開場審題 → 起 → 承 → 轉 → 合 → 給分關鍵字平實總複習）。
  2. 100% 本機離線零樣本聲音克隆（預設 --engine mlx-clone）：
     使用 ~/.venvs/swq-mlx-tts 載入 mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16，
     讀取 ~/.cache/swq-tts-ref/tw_teacher_erinome_ref.wav 與精確對應逐字稿執行
     ICL（In-Context Learning）零樣本聲紋克隆，徹底消除大陸捲舌口音與表演式油膩感，
     完全不受雲端 API 每日額度限制。
  3. 專業音訊分段封裝與 32GB Apple Silicon 多進程平行加速：
     支援 --workers（預設 2，可設 1～4）透過 ProcessPoolExecutor（spawn 模式）啟動多
     進程 Worker，每個 Worker 僅於啟動時載入一次 Qwen3-TTS 常駐記憶體；搭配跨進程檔案
     鎖與非隱藏暫存檔原子替換（os.replace），並即時回報 [已完成/總題數]、累計耗時與
     預估剩餘時間（ETA）。每段約 70～165 字獨立合成、12ms 淡入淡出防爆音、一致響度
     正規化、段落間插入 0.48s～0.85s 真實靜音停頓，經 ffmpeg 輸出 24kHz 單聲道 96kbps
     MP3，預設寫入 ~/Documents/2027社工師國考申論名師有聲課/（0644 權限＋Spotlight 索引）。

常用指令：
  # 預覽全部 7 科 160 題資料夾、檔名與清爽口語講稿結構（免載入模型）
  python3 tools/build_lecture_mp3.py --dry-run

  # 以本機 M5 32GB 三進程平行離線生成全庫 160 題（自動略過已完成檔案，支援斷點續跑）
  ~/.venvs/swq-mlx-tts/bin/python tools/build_lecture_mp3.py --workers 3

  # 指定單題試聽輸出至自訂路徑
  ~/.venvs/swq-mlx-tts/bin/python tools/build_lecture_mp3.py \\
    --question-id 2021-1-0401-E2 \\
    --single-out ~/Desktop/試聽-第2題-本機M5台灣老師克隆版.mp3 --overwrite

  # 切換備用 edge-tts 雲端免費語音引擎
  ~/.venvs/swq-tts/bin/python tools/build_lecture_mp3.py --engine edge --limit 2
"""

from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
import fcntl
import hashlib
import json
import multiprocessing
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import wave
from pathlib import Path
from typing import Any, Iterator

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QUESTIONS_PATH = REPO_ROOT / "questions.json"
DEFAULT_OUTPUT_DIR = Path.home() / "Documents" / "2027社工師國考申論名師有聲課"

# 預設本機離線 MLX 零樣本克隆設定（存放於家目錄快取，嚴格排除於 Git 儲存庫之外）
DEFAULT_ENGINE = "mlx-clone"
DEFAULT_MLX_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
DEFAULT_WORKERS = 2
MIN_WORKERS = 1
MAX_WORKERS = 4
DEFAULT_LOCK_DIR = Path.home() / ".cache" / "swq-tts-locks"
DEFAULT_REF_DIR = Path.home() / ".cache" / "swq-tts-ref"
DEFAULT_REF_AUDIO = DEFAULT_REF_DIR / "tw_teacher_erinome_ref.wav"
DEFAULT_REF_TEXT_PATH = DEFAULT_REF_DIR / "tw_teacher_erinome_ref.txt"
DEFAULT_REF_TEXT = (
    "這題的核心在於連結，你必須把任務中心取向的操作特徵，"
    "一個一個扣回社會工作對案主、對機構、對補助單位，以及對專業倫理的交代。"
)
DEFAULT_MLX_TEMPERATURE = 0.65
DEFAULT_MLX_TOP_P = 0.90
DEFAULT_MLX_REPETITION_PENALTY = 1.50
DEFAULT_MLX_MAX_TOKENS = 2048

# 備用免費 edge-tts 設定
DEFAULT_VOICE = "zh-TW-HsiaoYuNeural"
FALLBACK_VOICE = "zh-TW-HsiaoChenNeural"
DEFAULT_RATE = "-8%"
DEFAULT_PITCH = "+0Hz"

VOICE_ALIASES = {
    "hsiaoyu": "zh-TW-HsiaoYuNeural",
    "曉雨": "zh-TW-HsiaoYuNeural",
    "hsiaochen": "zh-TW-HsiaoChenNeural",
    "曉臻": "zh-TW-HsiaoChenNeural",
    "女": "zh-TW-HsiaoYuNeural",
    "yunjhe": "zh-TW-YunJheNeural",
    "雲哲": "zh-TW-YunJheNeural",
    "男": "zh-TW-YunJheNeural",
}

CANONICAL_VOICE_NAMES = {
    "zh-TW-HsiaoYuNeural": "Microsoft Server Speech Text to Speech Voice (zh-TW, HsiaoYuNeural)",
    "zh-TW-HsiaoChenNeural": "Microsoft Server Speech Text to Speech Voice (zh-TW, HsiaoChenNeural)",
    "zh-TW-YunJheNeural": "Microsoft Server Speech Text to Speech Voice (zh-TW, YunJheNeural)",
}

EXAM_LABELS = {
    "socialWorker": "專技社工師",
    "publicSocialWorker": "公職社工師",
}

ORDERED_SUBJECT_FOLDERS: list[tuple[str, str, str]] = [
    ("socialWorker", "社會工作", "01-專技社工師-社會工作"),
    ("socialWorker", "人類行為與社會環境", "02-專技社工師-人類行為與社會環境"),
    ("socialWorker", "社會工作直接服務", "03-專技社工師-社會工作直接服務"),
    ("socialWorker", "社會工作研究方法", "04-專技社工師-社會工作研究方法"),
    ("socialWorker", "社會政策與社會立法", "05-專技社工師-社會政策與社會立法"),
    ("publicSocialWorker", "社會工作實務", "06-公職社工師-社會工作實務"),
    ("publicSocialWorker", "社會福利政策與法規", "07-公職社工師-社會福利政策與法規"),
]

# 真實靜音停頓秒數設定（營造清爽沉穩的教授線上解題課節奏）
PAUSE_MAJOR_SEC = 0.85     # 大段落（開場審題 → 起 → 承 → 轉 → 合 → 總複習）之間
PAUSE_CUE_SEC = 0.55       # 老師說完過渡引導句後進入正文的呼吸停頓
PAUSE_SUBPOINT_SEC = 0.48  # 同段各核心論點之間的思考停頓
PAUSE_KEYWORD_SEC = 0.35   # 關鍵字或小段間的輕停頓

CN_NUM_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

CN_DIGITS = "零一二三四五六七八九"

# 自然教授口語過渡詞（零「第一點、第二點」書面條列感）
HEADING_TRANSITIONS = [
    "首先來看",
    "再來是",
    "接著是",
    "另外看到",
    "此外還有",
    "再進一步看",
]
PLAIN_TRANSITIONS = [
    "首先，",
    "其次，",
    "再來，",
    "另外，",
    "此外，",
    "再進一步來說，",
]

# 安全的書面「之」口語化白名單（避免誤傷「之後、之間、換言之、百分之」等固定用法）
BOOKISH_ZHI_NOUNS = (
    "韌性|隱憂|限制|困境|風險|核心|本質|處境|落差|架構|結果|策略|夥伴|合作夥伴|"
    "基礎|目標|實務|脈絡|原則|要求|意義|張力|功能|責任|資源|權益|保障|依據|"
    "能力|結構|結構脆弱性|脆弱性|現象|關係|差異|過程|成效|評估|介入|處遇|服務|"
    "問題|需求|影響|運用|發展|建立|推動|落實|整合|支持|保護|協力|溝通|合作|"
    "反思|建議|展望|無力感|家庭會談|增強權能|依附|不公|污名|歧視|弱勢|壓迫|"
    "排斥|邊緣化|主體性|能動性|研究|危機|衝突|處理|機制|規範|措施|工具|方法|"
    "重點|焦點|因素|條件|環境|系統|歷程|階段|特性|特徵|面向|層次|角色|態度|"
    "倫理|價值|專業|政策|制度|法規|對象|群體|人口|家庭|社區|機構|個案|案主"
)


def resolve_voice_name(voice: str) -> str:
    raw = (voice or DEFAULT_VOICE).strip()
    return VOICE_ALIASES.get(raw.lower(), VOICE_ALIASES.get(raw, raw))


def assert_path_outside_repo(path: Path, label: str = "本機參考聲紋路徑") -> None:
    """安全護欄：確保大型音訊與參考聲紋絕對不寫入 Git 儲存庫目錄內。"""
    resolved = path.expanduser().resolve()
    repo_resolved = REPO_ROOT.resolve()
    try:
        resolved.relative_to(repo_resolved)
    except ValueError:
        return
    raise ValueError(f"{label}不可置於 Git 儲存庫內：{resolved}（請存放於 ~/.cache/swq-tts-ref/ 或桌面）")


def _int_to_zh(num: int) -> str:
    if num <= 0:
        return "零"
    if num < 10:
        return CN_DIGITS[num]
    if num < 20:
        return "十" if num == 10 else f"十{CN_DIGITS[num - 10]}"
    if num < 100:
        tens, ones = divmod(num, 10)
        return f"{CN_DIGITS[tens]}十" + ("" if ones == 0 else CN_DIGITS[ones])
    if num < 1000:
        hundreds, rem = divmod(num, 100)
        if rem == 0:
            return f"{CN_DIGITS[hundreds]}百"
        if rem < 10:
            return f"{CN_DIGITS[hundreds]}百零{CN_DIGITS[rem]}"
        if rem < 20:
            return f"{CN_DIGITS[hundreds]}百一十" + ("" if rem == 10 else CN_DIGITS[rem - 10])
        return f"{CN_DIGITS[hundreds]}百{_int_to_zh(rem)}"
    return str(num)


def format_roc_exam_label(year: Any, session: Any, exam_label: str) -> str:
    """將西元年與梯次轉為道地台灣口語（例如 2021, 1 -> 一百一十年第一次專技社工師）。"""
    try:
        y = int(year)
    except (TypeError, ValueError):
        return exam_label
    roc_year = y - 1911 if y >= 1912 else y
    year_zh = f"{_int_to_zh(roc_year)}年" if roc_year > 0 else ""
    sess_zh = ""
    if session is not None and str(session).strip():
        try:
            s_num = int(session)
            sess_zh = f"第{_int_to_zh(s_num)}次"
        except (TypeError, ValueError):
            sess_zh = f"第{session}次"
    return f"{year_zh}{sess_zh}{exam_label}"


def _strip_latin_diacritics(text: str) -> str:
    """將西文重音字母正規化為純 ASCII（如 Gutiérrez -> Gutierrez），避免語音模型唸錯音節。"""
    out: list[str] = []
    for ch in text:
        if ord(ch) > 127 and unicodedata.category(ch).startswith("L") and not ("\u4e00" <= ch <= "\u9fff"):
            decomposed = unicodedata.normalize("NFKD", ch)
            ascii_part = "".join(c for c in decomposed if ord(c) < 128)
            out.append(ascii_part if ascii_part else ch)
        else:
            out.append(ch)
    return "".join(out)


def repair_pdf_line_wraps(text: Any) -> str:
    """修復考選部 PDF 擷取時在中文詞語中間被強制斷行的換行符。"""
    s = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(
        r"([\u4e00-\u9fff，、])[ \t]*\n[ \t]*(?![（(]?[一二三四五六七八九十\d]+[)）.、]|[-*•#])([\u4e00-\u9fff])",
        r"\1\2",
        s,
    )
    return s


def _rewrite_numbered_lines_naturally(text: str) -> str:
    """將條列編號（1. / 2. / (一) / 一、）改寫為清爽平實的台灣教授課堂口說銜接，完全去除條列感。"""
    raw_lines = [line.strip() for line in text.split("\n") if line.strip()]
    item_pattern = re.compile(
        r"^(?:[（(]([一二三四五六七八九十1-9]|10)[)）]|([一二三四五六七八九十])、|([1-9]|10)[.、](?!\d))\s*(.+)$"
    )

    parsed: list[tuple[bool, str]] = []
    for line in raw_lines:
        m = item_pattern.match(line)
        if m:
            parsed.append((True, m.group(4).strip()))
        else:
            parsed.append((False, line))

    total_numbered = sum(1 for is_num, _ in parsed if is_num)
    num_idx = 0
    out_lines: list[str] = []

    for is_num, body in parsed:
        if not is_num:
            out_lines.append(body)
            continue

        is_last_item = total_numbered >= 3 and num_idx == total_numbered - 1
        # 偵測「短小標：內文」格式（例如「個人層次（自我效能與意識覺醒）：運用優勢觀點...」）
        heading_match = re.match(r"^([^。！？：:]{2,26})[：:]\s*(.+)$", body)
        if heading_match:
            heading = heading_match.group(1).strip()
            rest = heading_match.group(2).strip()
            if is_last_item:
                prefix = "最後一個面向是" if num_idx >= 2 else "最後是"
            else:
                prefix = HEADING_TRANSITIONS[min(num_idx, len(HEADING_TRANSITIONS) - 1)]
            out_lines.append(f"{prefix}{heading}，{rest}")
        else:
            if is_last_item:
                prefix = "最後，"
            else:
                prefix = PLAIN_TRANSITIONS[min(num_idx, len(PLAIN_TRANSITIONS) - 1)]
            out_lines.append(f"{prefix}{body}")
        num_idx += 1

    return "\n".join(out_lines)


def convert_to_lecturer_spoken_chinese(text: Any) -> str:
    """
    將申論擬答書面／法條體轉譯為「清爽知性、平實自然」的台灣社工系教授口說逐字稿：
    - 去除所有條列編號（第一點／第二點）與生硬公文連接詞（茲分述如下／係指／惟／綜上）
    - 完整保留國考必背專有名詞、代表學者與台灣法規名稱
    """
    s = repair_pdf_line_wraps(text)
    s = _strip_latin_diacritics(s)
    s = re.sub(r"\*\*(.*?)\*\*", r"\1", s)
    s = re.sub(r"__(.*?)__", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"^#{1,6}\s*", "", s, flags=re.MULTILINE)
    s = re.sub(r"^\s*[-*•▪]\s+", "", s, flags=re.MULTILINE)

    # 移除題末配分括號如 （25 分）
    s = re.sub(r"[（(]\s*\d+\s*分\s*[)）]", "", s)
    # 移除純英文／數字括號補充，避免中文語音在括號處生硬切換口音
    s = re.sub(r"[（(]\s*[A-Za-z0-9\s\-_/,.;:&+'\"]+\s*[)）]", "", s)
    # 混合括號內若前段為純英文（如「（Empowerment，亦稱增權或充權）」），移除英文部分保留中文說明
    s = re.sub(r"([（(])\s*[A-Za-z][A-Za-z0-9\s\-_/,.;:&+'\"]*[，,、]\s*", r"\1", s)
    # 清除考選部 PDF 常見特殊編號符號
    s = re.sub(r"[⑴⑵⑶⑷⑸⑹]", "\n", s)

    # 先將條列行轉成自然的教授口說過渡，再處理括號與書面語
    s = _rewrite_numbered_lines_naturally(s)

    # 括號內若為單一法規書名號（如「（《家庭暴力防治法》）」），轉為自然口語舉例
    s = re.sub(r"[（(]《([^》]+)》[)）]", r"，像是\1，", s)
    # 中文括號轉為平順口語補充
    s = re.sub(r"[（(](?:亦稱|又稱|簡稱|即)([^（）()]+)[)）]", r"，也稱為\1，", s)
    s = re.sub(r"[（(]([^（）()]+)[)）]", r"，也就是\1，", s)
    # 清除書名號、引號、括號、星號與井字號
    s = re.sub(r"[《》〈〉「」『』【】\[\]()（）*#]", "", s)

    # 書面公文連接詞 → 清爽平實的台灣教授口語
    spoken_replacements = [
        (r"茲分述如下[：:，。]?", "我們可以從幾個面向來看。"),
        (r"茲說明如下[：:，。]?", "我們接著來看具體的重點。"),
        (r"茲析論如下[：:，。]?", "我們一步一步來分析。"),
        (r"茲依[^，。：\n]{0,20}?(?:剖析|說明|論述|分述|比較)如下[：:，。]?", "我們照著架構逐一來說明。"),
        (r"可展開以下[^，。：\n]{0,16}?[：:]", "可以從以下幾個層次來推動具體做法。"),
        (r"進行批判反思如下[：:]?", "提出幾個重要的實務反思。"),
        (r"並進行批判反思[：:]", "，我們一起來看看實務上常見的挑戰。"),
        (r"須審慎因應以下[^，。：\n]{0,12}?[：:]", "需要特別留意幾個實務上的張力。"),
        (r"實務操作與倫理反思如下[：:]?", "在台灣的實務現場上，可以這樣一步步操作。"),
        (r"茲從", "我們先從"),
        (r"茲就", "我們針對"),
        (r"茲以", "我們以"),
        (r"係指", "指的就是"),
        (r"係屬", "屬於"),
        (r"係為", "就是"),
        (r"意指", "意思就是"),
        (r"(^|[，。！？\n])\s*惟(?![一])", r"\1不過，"),
        (r"(^|[，。！？\n])\s*爰", r"\1因此，"),
        (r"綜上所述[，、]?", "總結來說，"),
        (r"(^|[，。！？\n])\s*綜上[，、]?", r"\1總結來說，"),
        (r"切忌", "要避免"),
        (r"亟待", "迫切需要"),
        (r"亟需", "迫切需要"),
        (r"尤須|尤應", "特別需要"),
        (r"仍須", "還是必須"),
        (r"(?<![必無不仍])須", "必須"),
        (r"方能", "才能"),
        (r"始得", "才能"),
        (r"倘若|若係", "如果是"),
        (r"抑或", "或是"),
        (r"據此", "根據這一點"),
        (r"亦即", "也就是說"),
        (r"也就是說，也就是", "也就是"),
        (r"也就是也就是", "也就是"),
        # 溫和替換過於文言的「之」與「於」，保留所有固定成語與專有名詞
        (rf"之({BOOKISH_ZHI_NOUNS})", r"的\1"),
        (r"之(新住民|弱勢|兒少|長者|老人|婦女|女性|青少年|家庭|社區)", r"的\1"),
        (r"(^|[，。；\n])於(台灣|臺灣|實務|個人|人際|社區|家庭|機構|校園|保護性)", r"\1在\2"),
        (r"同步於(個人|微視)", r"同步在\1"),
        (r"臺灣", "台灣"),
    ]
    for pattern, repl in spoken_replacements:
        s = re.sub(pattern, repl, s)

    s = re.sub(r"\bvs\.?\b", "對照", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*[→➔➜]\s*", "，接著帶到", s)
    s = re.sub(r"([\u4e00-\u9fff])\s*[／/]\s*([\u4e00-\u9fff])", r"\1與\2", s)
    s = re.sub(r"[｜|]", "，", s)
    s = re.sub(r"[：:]", "，", s)
    s = re.sub(r"[；;]", "，", s)
    s = re.sub(r"[ \t]+", " ", s)

    cleaned_lines: list[str] = []
    for raw_line in s.split("\n"):
        line = re.sub(r"[，,]{2,}", "，", raw_line)
        line = re.sub(r"([。！？])[，,、]+", r"\1", line)
        line = re.sub(r"[，,、]+([。！？])", r"\1", line)
        line = line.strip(" \t，,、")
        if line:
            if not re.search(r"[。！？]$", line):
                line += "。"
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines)


def clean_lecture_text(text: Any) -> str:
    """單行版相容介面：將文本清洗並轉譯為清爽自然口語授課文字。"""
    return " ".join(convert_to_lecturer_spoken_chinese(text).split("\n")).strip()


def _polish_focus_item(raw_item: str, idx: int) -> str:
    """將審題要點與常見陷阱改寫為平實自然的教授課堂提醒。"""
    s = clean_lecture_text(raw_item)
    if not s:
        return ""
    s = re.sub(r"^常見離題與扣分陷阱，", "另外要特別提醒一個常見的失分陷阱，", s)
    s = re.sub(r"^常見離題陷阱，", "另外要特別提醒一個常見的失分陷阱，", s)
    s = re.sub(r"^審題重點在於", "這題的審題關鍵在於", s)
    s = re.sub(r"^本題包含", "動筆前要注意，這題包含", s)
    if idx == 0 and not re.match(r"^(這題|動筆前|審題|另外)", s):
        s = f"這題的審題重點是，{s}"
    return s


def _split_into_digestible_beats(multiline_text: str, max_chars: int = 165) -> list[str]:
    """將段落依換行與句號拆為自然換氣節奏（每段約 70～165 字），避免句中硬切並維持 MLX ICL 穩定度。"""
    beats: list[str] = []
    for line in [l.strip() for l in multiline_text.split("\n") if l.strip()]:
        if len(line) <= max_chars:
            beats.append(line)
            continue
        sentences = re.findall(r"[^。！？]+[。！？]?", line)
        current = ""
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            # 單句若仍過長（> max_chars），於逗號處自然切開
            if len(sent) > max_chars:
                if current:
                    beats.append(current)
                    current = ""
                clauses = re.findall(r"[^，]+[，]?", sent)
                sub = ""
                for cl in clauses:
                    if not sub:
                        sub = cl
                    elif len(sub) + len(cl) <= max_chars:
                        sub += cl
                    else:
                        beats.append(sub)
                        sub = cl
                if sub:
                    beats.append(sub)
                continue

            if not current:
                current = sent
            elif len(current) + len(sent) <= max_chars:
                current += sent
            else:
                beats.append(current)
                current = sent
        if current:
            beats.append(current)
    return beats


def _extract_core_keyword(raw_term: str) -> str:
    s = _strip_latin_diacritics(str(raw_term or "").strip())
    s = re.sub(r"[（(]\s*[A-Za-z0-9\s\-_/,.;:&+'\"]+\s*[)）]", "", s)
    s = re.sub(r"[（(]([^（）()]+)[)）]", r"與\1", s)
    s = re.sub(r"[《》〈〉「」『』【】*#]", "", s)
    s = re.sub(r"([\u4e00-\u9fff])\s*[／/]\s*([\u4e00-\u9fff])", r"\1、\2", s)
    s = re.sub(r"\s+", " ", s).strip(" ，、：:；;")
    return s


def build_keyword_recap(question: dict[str, Any]) -> str:
    """清爽平實的閱卷給分關鍵字總複習（徹底去除浮誇押韻打油詩口訣）。"""
    analysis = (question.get("essayGuide") or {}).get("analysis") or {}
    theories = analysis.get("theoriesAndLaws") or []
    keywords: list[str] = []
    for item in theories:
        kw = _extract_core_keyword(item)
        if kw and kw not in keywords:
            keywords.append(kw)
        if len(keywords) >= 6:
            break

    if keywords:
        joined = "、".join(keywords)
        return (
            f"最後幫同學整理一下，這題作答時務必自然帶到的幾個閱卷給分關鍵字：{joined}。"
            "把這些核心概念放進起承轉合的架構裡，這題就能寫得相當扎實完整。"
        )
    return "最後提醒同學，只要把核心概念、理論法規、台灣實務反思與具體建議自然放進起承轉合的架構裡，這題就能寫得相當扎實完整。"


def build_lecture_segments(question: dict[str, Any]) -> list[dict[str, Any]]:
    """
    將單題申論題重組為「清爽知性台灣老師純口說分段清單」，
    每段皆帶有自然靜音停頓秒數（pauseAfterSec）。
    """
    exam_type = question.get("examType") or "socialWorker"
    exam_label = EXAM_LABELS.get(exam_type, "社工師")
    year = question.get("year")
    session = question.get("session")
    subject = clean_lecture_text(question.get("subject", "")).rstrip("。")

    segments: list[dict[str, Any]] = []

    def add_seg(key: str, text: str, pause_sec: float) -> None:
        cleaned = str(text or "").strip()
        if cleaned:
            segments.append({"key": key, "text": cleaned, "pauseAfterSec": pause_sec})

    # 1. 開場與題目說明
    when_label = format_roc_exam_label(year, session, exam_label)
    subj_label = f"，{subject}的申論題" if subject else "的申論題"
    opening = f"各位同學好，今天我們來看{when_label}{subj_label}。"
    prompt_clean = clean_lecture_text(question.get("prompt", ""))
    if prompt_clean:
        prompt_text = f"題目問的是：{prompt_clean}"
        if len(opening) + len(prompt_text) <= 150:
            add_seg("opening", opening + prompt_text, PAUSE_MAJOR_SEC)
        else:
            add_seg("opening", opening, PAUSE_CUE_SEC)
            prompt_beats = _split_into_digestible_beats(prompt_text)
            for idx, beat in enumerate(prompt_beats):
                is_last = idx == len(prompt_beats) - 1
                add_seg("prompt", beat, PAUSE_MAJOR_SEC if is_last else PAUSE_SUBPOINT_SEC)
    else:
        add_seg("opening", opening, PAUSE_CUE_SEC)

    # 2. 審題破題關鍵
    essay_guide = question.get("essayGuide") or {}
    analysis = essay_guide.get("analysis") or {}
    focus_items = [
        _polish_focus_item(item, idx)
        for idx, item in enumerate(analysis.get("focusAndTraps") or [])
        if _polish_focus_item(item, idx)
    ]
    if focus_items:
        add_seg(
            "focus_cue",
            "在動筆之前，我們先冷靜審題，想想閱卷老師真正想看到的重點是什麼。",
            PAUSE_SUBPOINT_SEC,
        )
        for idx, item in enumerate(focus_items):
            beats = _split_into_digestible_beats(item)
            for b_idx, beat in enumerate(beats):
                is_very_last = idx == len(focus_items) - 1 and b_idx == len(beats) - 1
                add_seg("focus", beat, PAUSE_MAJOR_SEC if is_very_last else PAUSE_SUBPOINT_SEC)

    # 3. 【起・承・轉・合】四段架構精講
    model = essay_guide.get("modelAnswer")
    if isinstance(model, dict) and model:
        stage_cues = [
            (
                "qi",
                "那麼第一段起的部分，破題不用寫得太冗長，先把核心概念跟題旨精準交代清楚。",
                PAUSE_MAJOR_SEC,
            ),
            (
                "cheng",
                "接著進到第二段承，這裡是整題最重要的得分段落，我們把核心理論、法規依據跟具體架構紮實地鋪陳出來。",
                PAUSE_MAJOR_SEC,
            ),
            (
                "zhuan",
                "前面把理論跟架構講完之後，第三段轉，就是用來拉開高分差距的關鍵段落，我們把視角拉回台灣第一線的社工現場與制度反思。",
                PAUSE_MAJOR_SEC,
            ),
            (
                "he",
                "最後第四段合，我們收束全文，提出具體的實務與政策建議。",
                PAUSE_MAJOR_SEC,
            ),
        ]
        for key, cue_text, end_pause in stage_cues:
            part = model.get(key) or {}
            spoken_body = convert_to_lecturer_spoken_chinese(part.get("content", ""))
            if not spoken_body:
                continue
            beats = _split_into_digestible_beats(spoken_body)
            add_seg(f"{key}_cue", cue_text, PAUSE_CUE_SEC)
            for idx, beat in enumerate(beats):
                is_last = idx == len(beats) - 1
                add_seg(key, beat, end_pause if is_last else PAUSE_SUBPOINT_SEC)
    else:
        legacy = convert_to_lecturer_spoken_chinese(question.get("referenceAnswer") or question.get("explanation") or "")
        if legacy:
            add_seg("legacy_cue", "這題的答題架構，我們可以照著以下脈絡一步步展開。", PAUSE_CUE_SEC)
            beats = _split_into_digestible_beats(legacy)
            for idx, beat in enumerate(beats):
                add_seg("legacy", beat, PAUSE_MAJOR_SEC if idx == len(beats) - 1 else PAUSE_SUBPOINT_SEC)

    # 4. 閱卷給分關鍵字平實總複習
    recap_beats = _split_into_digestible_beats(build_keyword_recap(question), max_chars=140)
    for idx, beat in enumerate(recap_beats):
        add_seg("recap", beat, 0.45 if idx == len(recap_beats) - 1 else PAUSE_KEYWORD_SEC)

    return segments


def build_lecture_script(question: dict[str, Any]) -> str:
    """組合完整清爽口說講稿（以空行標示主要段落停頓，方便檢閱或另存文字檔）。"""
    segments = build_lecture_segments(question)
    lines: list[str] = []
    for seg in segments:
        lines.append(seg["text"])
        if seg["pauseAfterSec"] >= PAUSE_MAJOR_SEC:
            lines.append("")
    return "\n".join(lines).strip()


def extract_short_topic(question: dict[str, Any], max_len: int = 24) -> str:
    """從題幹萃取出乾淨、適合當作檔名的短標題。"""
    raw = repair_pdf_line_wraps(question.get("prompt", ""))
    raw = re.sub(r"[（(]\s*\d+\s*分\s*[)）]", "", raw)
    raw = re.sub(r"[（(]\s*[A-Za-z0-9\s\-_/,.;:&+'\"]+\s*[)）]", "", raw)
    raw = re.sub(r"[《》〈〉「」『』【】\[\]()（）*#？?!！。；;：:,，、\s]+", "", raw)
    raw = re.sub(
        r"^(?:試請析論並比較|試請析論|試論述運用|試論述|試申論|試說明|試以|試舉|試評析|試針對|試根據上述案例|"
        r"請分別說明|請分別從|請就以下案例|請析論|請說明|請論述|請試擬|請問依據|請問|請|何謂|有關)",
        "",
        raw,
    )
    raw = re.sub(r'[\\/:*?"<>|]+', "", raw).strip("._-")
    if not raw:
        raw = str(question.get("id") or "申論題")
    if len(raw) > max_len:
        raw = raw[:max_len]
    return raw


def build_lecture_filename(seq_num: int, question: dict[str, Any], used_names: set[str] | None = None) -> str:
    topic = extract_short_topic(question)
    base = f"{seq_num:02d}-{topic}"
    candidate = f"{base}.mp3"
    if used_names is not None:
        if candidate in used_names:
            year = question.get("year") or ""
            session = question.get("session") or ""
            candidate = f"{base}-{year}-{session}.mp3"
        used_names.add(candidate)
    return candidate


def collect_lecture_tasks(
    questions: list[dict[str, Any]],
    out_dir: Path,
    exam_type_filter: str = "all",
    subject_filter: str | None = None,
    question_id: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """依 7 大考科順序整理所有待生成的 MP3 課程任務。"""
    essays = [q for q in questions if q.get("type") == "essay"]
    tasks: list[dict[str, Any]] = []
    target_qid = (question_id or "").strip()

    for exam_type, subject, folder_name in ORDERED_SUBJECT_FOLDERS:
        if exam_type_filter != "all" and exam_type != exam_type_filter:
            continue
        exam_label = EXAM_LABELS[exam_type]
        if subject_filter:
            needle = subject_filter.strip()
            if needle and (needle not in subject and needle not in f"{exam_label}{subject}" and needle not in folder_name):
                continue

        matched = [
            q
            for q in essays
            if (q.get("examType") or "socialWorker") == exam_type and q.get("subject") == subject
        ]
        matched.sort(key=lambda q: (int(q.get("year") or 0), int(q.get("session") or 0), int(q.get("number") or 0)))

        used_names: set[str] = set()
        for seq_num, q in enumerate(matched, start=1):
            filename = build_lecture_filename(seq_num, q, used_names=used_names)
            if target_qid and q.get("id") != target_qid:
                continue
            segments = build_lecture_segments(q)
            script = build_lecture_script(q)
            tasks.append(
                {
                    "id": q.get("id", ""),
                    "examType": exam_type,
                    "examLabel": exam_label,
                    "subject": subject,
                    "folderName": folder_name,
                    "filename": filename,
                    "outputPath": out_dir / folder_name / filename,
                    "segments": segments,
                    "script": script,
                    "charCount": len(script),
                }
            )
            if target_qid:
                return tasks
            if limit is not None and len(tasks) >= limit:
                return tasks
    return tasks


def format_duration_eta(seconds: float) -> str:
    """將秒數格式化為易讀中文耗時／ETA 字串（例如 1 小時 24 分、12 分 08 秒）。"""
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours} 小時 {minutes:02d} 分"
    if minutes > 0:
        return f"{minutes} 分 {secs:02d} 秒"
    return f"{secs} 秒"


@contextmanager
def _locked_output_target(dest_path: Path, lock_dir: Path = DEFAULT_LOCK_DIR) -> Iterator[None]:
    """跨進程目標檔案專屬鎖（fcntl.flock），確保多 Worker 或重疊執行絕不寫入衝突。"""
    lock_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(str(dest_path.expanduser().resolve()).encode("utf-8")).hexdigest()[:16]
    lock_path = lock_dir / f"{digest}.lock"
    with lock_path.open("a+") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _write_icloud_safe_file(src_path: Path, dest_path: Path) -> None:
    """
    透過非隱藏暫存檔＋os.replace 進行原子寫入並維持 0644 權限，
    相容 macOS iCloud Drive（Documents / Desktop）且中斷絕不殘留半成品，並觸發 Spotlight 索引。
    """
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(src_path, 0o644)
    staging_path = dest_path.with_name(f"{dest_path.stem}.tmp-{os.getpid()}{dest_path.suffix}")
    try:
        shutil.copyfile(src_path, staging_path)
        os.chmod(staging_path, 0o644)
        os.replace(staging_path, dest_path)
        os.chmod(dest_path, 0o644)
    finally:
        staging_path.unlink(missing_ok=True)
    mdimport_bin = shutil.which("mdimport")
    if mdimport_bin:
        try:
            subprocess.run([mdimport_bin, str(dest_path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass


def _trim_and_polish_segment(audio: Any, sample_rate: int) -> Any:
    """裁切頭尾多餘靜音、柔和正規化響度並加上 12ms 淡入淡出，確保分段銜接無爆音。"""
    import numpy as np

    wav = np.asarray(audio, dtype=np.float32).reshape(-1)
    if wav.size == 0:
        return wav

    # 移除 DC offset
    wav = wav - float(np.mean(wav))

    # 裁切過長頭尾靜音，保留 35ms 自然呼吸邊界
    active = np.flatnonzero(np.abs(wav) > 0.004)
    if active.size > 0:
        pad = int(sample_rate * 0.035)
        start = max(0, int(active[0]) - pad)
        end = min(wav.size, int(active[-1]) + pad)
        wav = wav[start:end]

    # 柔和 RMS 正規化至一致講課音量（約 -19 dBFS，峰值上限 0.89 避免削波）
    rms = float(np.sqrt(np.mean(wav * wav))) if wav.size else 0.0
    if rms > 1e-4:
        target_rms = 0.115
        gain = min(target_rms / rms, 0.89 / max(float(np.max(np.abs(wav))), 1e-5))
        wav = np.clip(wav * gain, -0.95, 0.95)

    # 12ms 頭尾淡入淡出，避免段間雜訊與爆音
    fade = min(int(sample_rate * 0.012), wav.size // 4)
    if fade > 1:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        wav[:fade] *= ramp
        wav[-fade:] *= ramp[::-1]

    return wav


def _encode_pcm_float_to_mp3(
    full_audio: Any,
    sample_rate: int,
    output_path: Path,
    ffmpeg_bin: str | None,
) -> None:
    import numpy as np

    pcm16 = np.clip(np.asarray(full_audio, dtype=np.float32), -1.0, 1.0)
    pcm16_int = (pcm16 * 32767.0).astype("<i2")

    with tempfile.TemporaryDirectory(prefix="swq-mlx-lecture-") as tmp_str:
        tmp_dir = Path(tmp_str)
        wav_path = tmp_dir / "lecture.wav"
        with wave.open(str(wav_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm16_int.tobytes())

        if ffmpeg_bin and output_path.suffix.lower() == ".mp3":
            mp3_path = tmp_dir / "lecture.mp3"
            subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(wav_path),
                    "-c:a",
                    "libmp3lame",
                    "-ar",
                    str(sample_rate),
                    "-ac",
                    "1",
                    "-b:a",
                    "96k",
                    str(mp3_path),
                ],
                check=True,
            )
            _write_icloud_safe_file(mp3_path, output_path)
        else:
            _write_icloud_safe_file(wav_path, output_path)


def _synthesize_task_mlx_clone(
    model: Any,
    ref_audio_mx: Any,
    ref_text: str,
    segments: list[dict[str, Any]],
    output_path: Path,
    ffmpeg_bin: str | None,
    temperature: float = DEFAULT_MLX_TEMPERATURE,
    top_p: float = DEFAULT_MLX_TOP_P,
    repetition_penalty: float = DEFAULT_MLX_REPETITION_PENALTY,
    max_tokens: int = DEFAULT_MLX_MAX_TOKENS,
    verbose_segments: bool = True,
) -> tuple[float, float]:
    """使用 MLX Qwen3-TTS Base ICL 模式分段離線合成並原子封裝為 MP3。"""
    import mlx.core as mx
    import numpy as np

    t0 = time.time()
    sr = int(getattr(model, "sample_rate", 24000))
    pieces: list[Any] = []
    total_segs = len(segments)

    for idx, seg in enumerate(segments, start=1):
        text = seg["text"]
        seg_t0 = time.time()
        # 合理長度防呆上限（避免極少數自回歸拖尾）
        max_reasonable_sec = max(18.0, len(text) * 0.42 + 6.0)
        best_audio = None

        for attempt in range(3):
            temp = max(0.45, temperature - 0.08 * attempt)
            chunks = []
            for res in model.generate(
                text=text,
                ref_audio=ref_audio_mx,
                ref_text=ref_text,
                lang_code="chinese",
                temperature=temp,
                top_p=top_p,
                repetition_penalty=repetition_penalty,
                max_tokens=max_tokens,
            ):
                chunks.append(np.asarray(res.audio, dtype=np.float32))
            if not chunks:
                continue
            cand = _trim_and_polish_segment(np.concatenate(chunks), sr)
            dur = cand.size / sr
            if best_audio is None or dur < (best_audio.size / sr):
                best_audio = cand
            if 0.4 <= dur <= max_reasonable_sec:
                break
            if verbose_segments:
                print(
                    f"    ↻ 第 {idx}/{total_segs} 段片長 {dur:.1f}s 異常，微調 temperature={temp:.2f} 重試...",
                    flush=True,
                )

        if best_audio is None or best_audio.size == 0:
            raise RuntimeError(f"第 {idx} 段 MLX 零樣本克隆未產出有效音訊：{text[:30]}")

        seg_dur = best_audio.size / sr
        if verbose_segments:
            print(
                f"    [{idx:02d}/{total_segs:02d}] {seg['key']}（{len(text)} 字 → {seg_dur:.1f}s，耗時 {time.time() - seg_t0:.1f}s）",
                flush=True,
            )
        pieces.append(best_audio)

        pause_sec = float(seg.get("pauseAfterSec") or 0)
        if pause_sec > 0 and idx < total_segs:
            pieces.append(np.zeros(int(round(sr * pause_sec)), dtype=np.float32))

    full_audio = np.concatenate(pieces)
    total_dur = full_audio.size / sr
    _encode_pcm_float_to_mp3(full_audio, sr, output_path, ffmpeg_bin=ffmpeg_bin)
    mx.clear_cache()
    return total_dur, time.time() - t0


# ProcessPoolExecutor 專屬 Worker 狀態（每個子進程僅於啟動時載入一次 Qwen3-TTS 模型常駐記憶體）
_MLX_WORKER_STATE: dict[str, Any] = {}


def _mlx_worker_init(
    model_id: str,
    ref_audio_str: str,
    ref_text: str,
    temperature: float,
    top_p: float,
    repetition_penalty: float,
) -> None:
    from mlx_audio.tts.utils import load_model
    from mlx_audio.utils import load_audio

    pid = os.getpid()
    t0 = time.time()
    model = load_model(model_id)
    sr = int(getattr(model, "sample_rate", 24000))
    ref_audio_mx = load_audio(ref_audio_str, sample_rate=sr)
    _MLX_WORKER_STATE.clear()
    _MLX_WORKER_STATE.update(
        {
            "pid": pid,
            "model": model,
            "ref_audio_mx": ref_audio_mx,
            "ref_text": ref_text,
            "ffmpeg_bin": shutil.which("ffmpeg"),
            "temperature": temperature,
            "top_p": top_p,
            "repetition_penalty": repetition_penalty,
        }
    )
    print(f"[Worker PID {pid}] ✓ 模型常駐載入完成（耗時 {time.time() - t0:.1f}s｜{sr}Hz）", flush=True)


def _mlx_worker_run_task(payload: dict[str, Any]) -> dict[str, Any]:
    state = _MLX_WORKER_STATE
    pid = state.get("pid", os.getpid())
    out_path = Path(payload["outputPath"])
    overwrite = bool(payload["overwrite"])
    save_scripts = bool(payload["saveScripts"])
    rel_label = f"{payload['folderName']}/{payload['filename']}"

    try:
        if save_scripts:
            script_path = out_path.with_suffix(".txt")
            script_path.parent.mkdir(parents=True, exist_ok=True)
            script_path.write_text(payload["script"], encoding="utf-8")
            os.chmod(script_path, 0o644)

        with _locked_output_target(out_path):
            if not overwrite and out_path.exists() and out_path.stat().st_size > 0:
                return {
                    "id": payload["id"],
                    "relLabel": rel_label,
                    "outputPath": str(out_path),
                    "status": "skipped",
                    "workerPid": pid,
                }

            print(
                f"[Worker PID {pid}] ▶ 開始生成：{payload['id']} → {rel_label}"
                f"（{payload['charCount']:,} 字｜{len(payload['segments'])} 段）",
                flush=True,
            )
            audio_dur, elapsed = _synthesize_task_mlx_clone(
                model=state["model"],
                ref_audio_mx=state["ref_audio_mx"],
                ref_text=state["ref_text"],
                segments=payload["segments"],
                output_path=out_path,
                ffmpeg_bin=state["ffmpeg_bin"],
                temperature=state["temperature"],
                top_p=state["top_p"],
                repetition_penalty=state["repetition_penalty"],
                verbose_segments=False,
            )
            size_mb = out_path.stat().st_size / (1024 * 1024)
            return {
                "id": payload["id"],
                "relLabel": rel_label,
                "outputPath": str(out_path),
                "status": "generated",
                "audioDur": audio_dur,
                "elapsed": elapsed,
                "sizeMb": size_mb,
                "workerPid": pid,
            }
    except Exception as exc:
        return {
            "id": payload["id"],
            "relLabel": rel_label,
            "outputPath": str(out_path),
            "status": "failed",
            "error": f"{type(exc).__name__}: {exc}",
            "workerPid": pid,
        }


def _ensure_hf_model_cached(model_id: str) -> None:
    """多進程啟動前以純 CPU 預先確認 HuggingFace 模型快取完整，避免多 Worker 同時下載衝突。"""
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(model_id, local_files_only=False)
    except Exception:
        # 若環境離線或為本機路徑，交由各 Worker 直接載入本地快取
        pass


def _run_batch_mlx_clone(
    tasks: list[dict[str, Any]],
    model_id: str,
    ref_audio_path: Path,
    ref_text: str,
    overwrite: bool,
    save_scripts: bool,
    temperature: float,
    top_p: float,
    repetition_penalty: float,
    workers: int = DEFAULT_WORKERS,
) -> tuple[int, int, int]:
    assert_path_outside_repo(ref_audio_path, "參考聲紋 WAV")
    if not ref_audio_path.exists() or ref_audio_path.stat().st_size == 0:
        raise FileNotFoundError(
            f"找不到台灣老師參考聲紋檔：{ref_audio_path}\n"
            "請先從乾淨的台灣老師試聽檔擷取 10～14 秒 24kHz 單聲道 WAV 至該路徑。"
        )
    if not ref_text.strip():
        raise ValueError("參考聲紋逐字稿（ref_text）不可為空，ICL 零樣本克隆需要與參考音檔完全一致的文字。")

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        print(f"已偵測到 ffmpeg（{ffmpeg_bin}），將封裝為 24kHz 單聲道 96kbps MP3。", flush=True)
    else:
        print("⚠ 未偵測到 ffmpeg，將直接輸出 WAV 檔案。", flush=True)

    total = len(tasks)
    pending: list[dict[str, Any]] = []
    skipped = 0

    for task in tasks:
        out_path: Path = task["outputPath"]
        if save_scripts:
            script_path = out_path.with_suffix(".txt")
            script_path.parent.mkdir(parents=True, exist_ok=True)
            script_path.write_text(task["script"], encoding="utf-8")
            os.chmod(script_path, 0o644)
        if not overwrite and out_path.exists() and out_path.stat().st_size > 0:
            skipped += 1
            print(f"[{skipped}/{total}] 略過已存在：{task['folderName']}/{task['filename']}", flush=True)
        else:
            pending.append(task)

    if not pending:
        print(f"全部 {total} 支課程檔皆已存在，無需重新生成（如需覆蓋請加 --overwrite）。", flush=True)
        return 0, skipped, 0

    effective_workers = max(MIN_WORKERS, min(MAX_WORKERS, int(workers), len(pending)))
    batch_t0 = time.time()
    generated = 0
    failed = 0
    pending_total = len(pending)

    if effective_workers == 1:
        from mlx_audio.tts.utils import load_model
        from mlx_audio.utils import load_audio

        t_load = time.time()
        print(f"載入本機 MLX 零樣本聲音克隆模型：{model_id}（單進程模式）...", flush=True)
        model = load_model(model_id)
        sr = int(getattr(model, "sample_rate", 24000))
        ref_audio_mx = load_audio(str(ref_audio_path), sample_rate=sr)
        print(f"✓ 模型載入完成（耗時 {time.time() - t_load:.1f}s｜取樣率 {sr}Hz｜參考聲紋：{ref_audio_path.name}）", flush=True)

        work_t0 = time.time()
        for idx, task in enumerate(pending, start=1):
            out_path = task["outputPath"]
            rel_label = f"{task['folderName']}/{task['filename']}"
            with _locked_output_target(out_path):
                if not overwrite and out_path.exists() and out_path.stat().st_size > 0:
                    skipped += 1
                    print(f"[{skipped + generated}/{total}] 略過已存在：{rel_label}", flush=True)
                    continue
                print(
                    f"[{skipped + generated + 1}/{total}] 本機離線克隆生成中：{task['id']} → {rel_label}"
                    f"（{task['charCount']:,} 字｜{len(task['segments'])} 段）",
                    flush=True,
                )
                try:
                    audio_dur, elapsed = _synthesize_task_mlx_clone(
                        model=model,
                        ref_audio_mx=ref_audio_mx,
                        ref_text=ref_text,
                        segments=task["segments"],
                        output_path=out_path,
                        ffmpeg_bin=ffmpeg_bin,
                        temperature=temperature,
                        top_p=top_p,
                        repetition_penalty=repetition_penalty,
                        verbose_segments=True,
                    )
                    size_mb = out_path.stat().st_size / (1024 * 1024)
                    generated += 1
                    done_overall = skipped + generated
                    wall_elapsed = time.time() - work_t0
                    remaining = max(0, pending_total - idx)
                    eta_str = format_duration_eta((wall_elapsed / generated) * remaining) if remaining else "0 秒"
                    print(
                        f"  ✓ [{done_overall}/{total}] 完成（片長 {audio_dur / 60:.1f} 分｜單題 {elapsed:.1f}s｜"
                        f"{size_mb:.2f} MB）｜累計耗時 {format_duration_eta(time.time() - batch_t0)}｜"
                        f"預估剩餘 ETA {eta_str} → {rel_label}",
                        flush=True,
                    )
                except Exception as exc:
                    failed += 1
                    print(f"  ✗ 失敗：{task['id']}（{rel_label}）→ {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)

        return generated, skipped, failed

    # 多進程平行模式（spawn + 每 Worker 僅載入一次模型常駐記憶體）
    print(
        f"準備啟動 {effective_workers} 個獨立 MLX Worker 進程平行生成（已略過 {skipped} 支，本次待生成 {pending_total} 支 / 總計 {total} 支）...",
        flush=True,
    )
    _ensure_hf_model_cached(model_id)
    mp_ctx = multiprocessing.get_context("spawn")
    payloads = [
        {
            "id": t["id"],
            "folderName": t["folderName"],
            "filename": t["filename"],
            "outputPath": str(t["outputPath"]),
            "segments": t["segments"],
            "script": t["script"],
            "charCount": t["charCount"],
            "overwrite": overwrite,
            "saveScripts": False,  # 主進程已預先輸出 .txt（若啟用 --save-scripts）
        }
        for t in pending
    ]

    work_t0 = time.time()
    finished_pending = 0
    with ProcessPoolExecutor(
        max_workers=effective_workers,
        mp_context=mp_ctx,
        initializer=_mlx_worker_init,
        initargs=(model_id, str(ref_audio_path), ref_text, temperature, top_p, repetition_penalty),
    ) as executor:
        futures = [executor.submit(_mlx_worker_run_task, p) for p in payloads]
        for fut in as_completed(futures):
            res = fut.result()
            finished_pending += 1
            status = res.get("status")
            if status == "generated":
                generated += 1
                done_overall = skipped + generated
                wall_elapsed = time.time() - work_t0
                remaining = max(0, pending_total - finished_pending)
                eta_str = format_duration_eta((wall_elapsed / generated) * remaining) if remaining else "0 秒"
                print(
                    f"[{done_overall}/{total}] ✓ 完成（PID {res['workerPid']}｜片長 {res['audioDur'] / 60:.1f} 分｜"
                    f"單題 {res['elapsed']:.1f}s｜{res['sizeMb']:.2f} MB）｜"
                    f"已耗時 {format_duration_eta(time.time() - batch_t0)}｜ETA {eta_str} → {res['relLabel']}",
                    flush=True,
                )
            elif status == "skipped":
                skipped += 1
                print(
                    f"[{skipped + generated}/{total}] 略過已存在（PID {res['workerPid']}）：{res['relLabel']}",
                    flush=True,
                )
            else:
                failed += 1
                print(
                    f"[{skipped + generated}/{total}] ✗ 失敗（PID {res['workerPid']}｜{res['id']}）："
                    f"{res['relLabel']} → {res.get('error')}",
                    file=sys.stderr,
                    flush=True,
                )

    return generated, skipped, failed


async def _synthesize_text_to_file(
    edge_tts_module: Any,
    text: str,
    dest_path: Path,
    voice: str,
    rate: str,
    pitch: str,
    retries: int = 2,
) -> None:
    voice_candidates = [voice]
    canonical = CANONICAL_VOICE_NAMES.get(voice)
    if canonical and canonical != voice:
        voice_candidates.append(canonical)

    last_error: Exception | None = None
    for attempt in range(1, max(1, retries) + 1):
        chosen_voice = voice_candidates[(attempt - 1) % len(voice_candidates)]
        try:
            communicate = edge_tts_module.Communicate(text=text, voice=chosen_voice, rate=rate, pitch=pitch)
            await communicate.save(str(dest_path))
            if not dest_path.exists() or dest_path.stat().st_size == 0:
                raise RuntimeError("edge-tts 未產出有效音訊內容")
            return
        except Exception as exc:
            last_error = exc
            dest_path.unlink(missing_ok=True)
            if attempt < retries:
                await asyncio.sleep(0.9 * attempt)
    assert last_error is not None
    raise last_error


def _ensure_silence_mp3(ffmpeg_bin: str, duration_sec: float, cache_dir: Path) -> Path:
    ms = max(50, int(round(duration_sec * 1000)))
    sil_path = cache_dir / f"silence_{ms}ms.mp3"
    if sil_path.exists() and sil_path.stat().st_size > 0:
        return sil_path
    cmd = [
        ffmpeg_bin,
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=mono",
        "-t",
        f"{ms / 1000:.3f}",
        "-c:a",
        "libmp3lame",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-b:a",
        "48k",
        str(sil_path),
    ]
    subprocess.run(cmd, check=True)
    return sil_path


async def _synthesize_segmented_mp3(
    edge_tts_module: Any,
    segments: list[dict[str, Any]],
    output_path: Path,
    voice: str,
    rate: str,
    pitch: str,
    ffmpeg_bin: str | None,
) -> None:
    """備用 edge-tts 分段合成並插入真實靜音停頓。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="swq-lecture-") as tmp_str:
        tmp_dir = Path(tmp_str)
        concat_entries: list[Path] = []

        for idx, seg in enumerate(segments):
            seg_path = tmp_dir / f"seg_{idx:03d}.mp3"
            await _synthesize_text_to_file(
                edge_tts_module,
                seg["text"],
                seg_path,
                voice=voice,
                rate=rate,
                pitch=pitch,
            )
            concat_entries.append(seg_path)
            pause_sec = float(seg.get("pauseAfterSec") or 0)
            if ffmpeg_bin and pause_sec > 0 and idx < len(segments) - 1:
                sil_path = _ensure_silence_mp3(ffmpeg_bin, pause_sec, tmp_dir)
                concat_entries.append(sil_path)

        final_tmp = tmp_dir / "final.mp3"
        if ffmpeg_bin:
            list_file = tmp_dir / "concat.txt"
            list_lines = [f"file '{p.as_posix()}'" for p in concat_entries]
            list_file.write_text("\n".join(list_lines) + "\n", encoding="utf-8")
            cmd = [
                ffmpeg_bin,
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c:a",
                "libmp3lame",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-b:a",
                "64k",
                str(final_tmp),
            ]
            subprocess.run(cmd, check=True)
        else:
            with final_tmp.open("wb") as out_f:
                for p in concat_entries:
                    out_f.write(p.read_bytes())

        if not final_tmp.exists() or final_tmp.stat().st_size == 0:
            raise RuntimeError("合併後的 MP3 檔案無效")

        _write_icloud_safe_file(final_tmp, output_path)


async def _run_batch_edge_synthesis(
    edge_tts_module: Any,
    tasks: list[dict[str, Any]],
    voice: str,
    rate: str,
    pitch: str,
    overwrite: bool,
    save_scripts: bool,
    allow_fallback: bool = True,
) -> tuple[int, int, str]:
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        print(f"已偵測到 ffmpeg（{ffmpeg_bin}），將啟用真實段落靜音間隔與 64kbps 統一封裝。")
    else:
        print("⚠ 未偵測到 ffmpeg，將改以無外部轉檔模式串接分段音訊。")

    generated = 0
    skipped = 0
    active_voice = voice
    total = len(tasks)
    for idx, task in enumerate(tasks, start=1):
        out_path: Path = task["outputPath"]
        if save_scripts:
            script_path = out_path.with_suffix(".txt")
            script_path.parent.mkdir(parents=True, exist_ok=True)
            script_path.write_text(task["script"], encoding="utf-8")
            os.chmod(script_path, 0o644)

        if not overwrite and out_path.exists() and out_path.stat().st_size > 0:
            skipped += 1
            print(f"[{idx}/{total}] 略過已存在：{out_path}")
            continue

        print(
            f"[{idx}/{total}] edge-tts 生成中：{task['folderName']}/{task['filename']}"
            f"（{task['charCount']:,} 字｜{len(task['segments'])} 段｜{active_voice}）..."
        )
        try:
            await _synthesize_segmented_mp3(
                edge_tts_module,
                task["segments"],
                out_path,
                voice=active_voice,
                rate=rate,
                pitch=pitch,
                ffmpeg_bin=ffmpeg_bin,
            )
        except Exception as exc:
            if allow_fallback and active_voice != FALLBACK_VOICE:
                print(
                    f"  ⚠ 微軟伺服器目前對 {active_voice} 回應異常（{type(exc).__name__}），"
                    f"自動備援切換為 {FALLBACK_VOICE}（曉臻老師）重試..."
                )
                active_voice = FALLBACK_VOICE
                await _synthesize_segmented_mp3(
                    edge_tts_module,
                    task["segments"],
                    out_path,
                    voice=active_voice,
                    rate=rate,
                    pitch=pitch,
                    ffmpeg_bin=ffmpeg_bin,
                )
            else:
                raise
        size_kb = out_path.stat().st_size / 1024
        generated += 1
        print(f"  ✓ 完成（{size_kb:.1f} KB）→ {out_path}")
    return generated, skipped, active_voice


def resolve_ref_text(ref_text_arg: str | None, ref_text_file: Path) -> str:
    if ref_text_arg and ref_text_arg.strip():
        return ref_text_arg.strip()
    resolved = ref_text_file.expanduser().resolve()
    if resolved.exists():
        content = resolved.read_text(encoding="utf-8").strip()
        if content:
            return content
    return DEFAULT_REF_TEXT


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="本機 100% 離線（MLX Qwen3-TTS 台灣老師零樣本聲紋克隆）批次生成 160 題社工師國考申論有聲課 MP3。"
    )
    parser.add_argument(
        "--engine",
        choices=["mlx-clone", "edge"],
        default=DEFAULT_ENGINE,
        help=f"語音合成引擎：mlx-clone（預設，本機 Apple Silicon 零樣本台灣老師克隆）或 edge（微軟免費雲端）",
    )
    parser.add_argument(
        "--questions",
        type=Path,
        default=DEFAULT_QUESTIONS_PATH,
        help=f"題庫檔案路徑（預設：{DEFAULT_QUESTIONS_PATH}）",
    )
    parser.add_argument(
        "--output-dir",
        "--out-dir",
        dest="out_dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"MP3 輸出根目錄（預設：{DEFAULT_OUTPUT_DIR}）",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"MLX 多進程平行 Worker 數（預設：{DEFAULT_WORKERS}，範圍 {MIN_WORKERS}～{MAX_WORKERS}；32GB 統一記憶體建議 2～3）",
    )
    parser.add_argument(
        "--single-out",
        type=Path,
        default=None,
        help="單題模式覆寫輸出完整路徑（例如 ~/Desktop/試聽-第2題-本機M5台灣老師克隆版.mp3）",
    )
    parser.add_argument(
        "--mlx-model",
        type=str,
        default=DEFAULT_MLX_MODEL,
        help=f"本機 MLX 零樣本聲音克隆模型 ID（預設：{DEFAULT_MLX_MODEL}）",
    )
    parser.add_argument(
        "--ref-audio",
        type=Path,
        default=DEFAULT_REF_AUDIO,
        help=f"台灣老師參考聲紋 24kHz WAV 路徑（預設：{DEFAULT_REF_AUDIO}，嚴禁置於 Git 儲存庫內）",
    )
    parser.add_argument(
        "--ref-text",
        type=str,
        default=None,
        help="與參考聲紋完全一致的繁體中文逐字稿（未填時自動讀取 --ref-text-file）",
    )
    parser.add_argument(
        "--ref-text-file",
        type=Path,
        default=DEFAULT_REF_TEXT_PATH,
        help=f"參考聲紋逐字稿文字檔路徑（預設：{DEFAULT_REF_TEXT_PATH}）",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=DEFAULT_MLX_TEMPERATURE,
        help=f"MLX 取樣溫度（預設：{DEFAULT_MLX_TEMPERATURE}，較低更沉穩清爽）",
    )
    parser.add_argument(
        "--top-p",
        type=float,
        default=DEFAULT_MLX_TOP_P,
        help=f"MLX top-p 取樣參數（預設：{DEFAULT_MLX_TOP_P}）",
    )
    parser.add_argument(
        "--repetition-penalty",
        type=float,
        default=DEFAULT_MLX_REPETITION_PENALTY,
        help=f"MLX ICL 重複懲罰係數（預設：{DEFAULT_MLX_REPETITION_PENALTY}）",
    )
    parser.add_argument(
        "--voice",
        type=str,
        default=DEFAULT_VOICE,
        help="edge 備用模式語音：zh-TW-HsiaoYuNeural（預設）、zh-TW-HsiaoChenNeural 或 zh-TW-YunJheNeural",
    )
    parser.add_argument(
        "--rate",
        type=str,
        default=DEFAULT_RATE,
        help="edge 備用模式語速調整（預設：-8%%）",
    )
    parser.add_argument(
        "--pitch",
        type=str,
        default=DEFAULT_PITCH,
        help="edge 備用模式音調微調（預設：+0Hz）",
    )
    parser.add_argument(
        "--exam-type",
        choices=["all", "socialWorker", "publicSocialWorker"],
        default="all",
        help="篩選考試類別（預設：all）",
    )
    parser.add_argument(
        "--subject",
        type=str,
        default=None,
        help="指定單一考科關鍵字（例如：社會工作、研究方法、社會工作實務）",
    )
    parser.add_argument(
        "--question-id",
        type=str,
        default=None,
        help="僅生成指定題目 ID（例如：2021-1-0401-E2）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="限制產出題數（例如 --limit 2）",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="覆蓋已存在的同名 MP3 檔案（預設略過已生成檔案以便斷點續跑）",
    )
    parser.add_argument(
        "--save-scripts",
        action="store_true",
        help="同時於同資料夾輸出對應的 .txt 台灣老師口說講稿文字檔",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="僅預覽資料夾、檔名、分段數、字數與首題清爽口語講稿，不載入模型且不寫入任何檔案",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.limit is not None and args.limit <= 0:
        print("--limit 必須為正整數。", file=sys.stderr)
        return 1

    if args.workers < MIN_WORKERS or args.workers > MAX_WORKERS:
        print(f"--workers 必須介於 {MIN_WORKERS} 到 {MAX_WORKERS} 之間（目前為 {args.workers}）。", file=sys.stderr)
        return 1

    questions_path = args.questions.expanduser().resolve()
    if not questions_path.exists():
        print(f"找不到題庫檔案：{questions_path}", file=sys.stderr)
        return 1

    out_dir = args.out_dir.expanduser().resolve()
    questions = json.loads(questions_path.read_text(encoding="utf-8"))
    tasks = collect_lecture_tasks(
        questions,
        out_dir=out_dir,
        exam_type_filter=args.exam_type,
        subject_filter=args.subject,
        question_id=args.question_id,
        limit=args.limit,
    )
    if not tasks:
        print("依目前篩選條件查無符合之申論題。", file=sys.stderr)
        return 1

    if args.single_out is not None:
        if len(tasks) != 1:
            print("--single-out 僅可搭配單題篩選（例如 --question-id 或 --limit 1）。", file=sys.stderr)
            return 1
        tasks[0]["outputPath"] = args.single_out.expanduser().resolve()

    if args.dry_run:
        total_chars = sum(t["charCount"] for t in tasks)
        engine_desc = (
            f"mlx-clone（{args.mlx_model}｜workers={args.workers}｜參考聲紋：{args.ref_audio}）"
            if args.engine == "mlx-clone"
            else f"edge（{resolve_voice_name(args.voice)}｜語速：{args.rate}）"
        )
        print(f"台灣老師申論有聲課預覽｜引擎：{engine_desc}")
        print(f"輸出目錄：{out_dir}｜預計產出：{len(tasks)} 支 MP3｜總字數：{total_chars:,} 字")
        print("-" * 78)
        for t in tasks[:15]:
            print(f"  {t['folderName']}/{t['filename']}（{t['id']}｜{t['charCount']:,} 字｜{len(t['segments'])} 段）")
        if len(tasks) > 15:
            print(f"  ...（其餘 {len(tasks) - 15} 支省略）")
        print("-" * 78)
        print("[首題清爽台灣老師口說講稿節錄]")
        print(tasks[0]["script"][:480] + "⋯")
        print("[DRY-RUN] 未載入語音模型，未寫入任何檔案。")
        return 0

    if args.engine == "mlx-clone":
        import importlib.util

        if importlib.util.find_spec("mlx_audio") is None:
            print("尚未安裝 mlx-audio，請改用已建置之 Apple Silicon 虛擬環境執行：", file=sys.stderr)
            print("  ~/.venvs/swq-mlx-tts/bin/python tools/build_lecture_mp3.py --workers 2", file=sys.stderr)
            print("（或安裝：python3 -m venv ~/.venvs/swq-mlx-tts && ~/.venvs/swq-mlx-tts/bin/pip install mlx-audio soundfile）", file=sys.stderr)
            return 2

        ref_audio_path = args.ref_audio.expanduser().resolve()
        ref_text = resolve_ref_text(args.ref_text, args.ref_text_file)
        print(
            f"開始本機 100% 離線零樣本聲音克隆｜模型：{args.mlx_model}｜"
            f"Workers：{args.workers}｜輸出目錄：{out_dir}｜共 {len(tasks)} 題",
            flush=True,
        )
        generated, skipped, failed = _run_batch_mlx_clone(
            tasks=tasks,
            model_id=args.mlx_model,
            ref_audio_path=ref_audio_path,
            ref_text=ref_text,
            overwrite=args.overwrite,
            save_scripts=args.save_scripts,
            temperature=args.temperature,
            top_p=args.top_p,
            repetition_penalty=args.repetition_penalty,
            workers=args.workers,
        )
        print(
            f"全部完成！本次本機離線產出 {generated} 支 MP3、略過已存在 {skipped} 支、失敗 {failed} 支。"
            f"輸出位置：{out_dir}",
            flush=True,
        )
        return 1 if failed > 0 else 0

    voice = resolve_voice_name(args.voice)
    try:
        import edge_tts  # type: ignore[import-not-found]
    except ImportError:
        print("尚未安裝 edge-tts，請改用虛擬環境執行：", file=sys.stderr)
        print("  ~/.venvs/swq-tts/bin/python tools/build_lecture_mp3.py --engine edge --limit 2", file=sys.stderr)
        return 2

    print(f"開始使用 edge-tts 備用引擎生成有聲課｜語音：{voice}｜語速：{args.rate}｜共 {len(tasks)} 題")
    print(f"輸出目錄：{out_dir}")
    generated, skipped, actual_voice = asyncio.run(
        _run_batch_edge_synthesis(
            edge_tts,
            tasks,
            voice=voice,
            rate=args.rate,
            pitch=args.pitch,
            overwrite=args.overwrite,
            save_scripts=args.save_scripts,
        )
    )
    print(f"全部完成！本次新產出 {generated} 支 MP3（實際語音：{actual_voice}）、略過已存在 {skipped} 支。輸出位置：{out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
