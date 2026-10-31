#!/usr/bin/env python3
"""Import 115年第二次社工師正式試題 from the Ministry of Examination.

The importer is deliberately fail-closed: it refuses to write unless every
official paper yields exactly two essay questions, forty choice questions and
forty official answers. No explanations or essay answers are invented.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
BASE = "https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?c=103&code=115100&q=1"
PAPERS = (
    ("0301", "社會工作"), ("0302", "社會工作直接服務"), ("0303", "社會政策與社會立法"),
    ("0304", "人類行為與社會環境"), ("0305", "社會工作研究方法"),
)


def url(code: str, kind: str) -> str:
    return f"{BASE}&s={code}&t={kind}"


def compact(text: str) -> str:
    text = text.replace("\f", "\n")
    text = re.sub(r"(?m)^\s*代號：.*$", "", text)
    text = re.sub(r"(?m)^\s*頁次：.*$", "", text)
    text = re.sub(r"(?m)^.*115年第二次專門職業.*$", "", text)
    text = re.sub(r"(?m)^.*115年專\s*門\s*職\s*業.*$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def download_text(download_url: str, directory: Path, name: str) -> tuple[str, str]:
    pdf = directory / f"{name}.pdf"
    request = urllib.request.Request(download_url, headers={"User-Agent": "social-worker-quiz-pwa official importer"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get_content_type()
        body = response.read()
    if content_type != "application/pdf" or not body.startswith(b"%PDF"):
        raise ValueError(f"官方來源非 PDF：{download_url}")
    pdf.write_bytes(body)
    txt = pdf.with_suffix(".txt")
    subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True)
    return txt.read_text(encoding="utf-8", errors="strict"), hashlib.sha256(body).hexdigest()


def parse_essays(raw: str) -> list[str]:
    section = raw.split("乙、測驗題部分", 1)[0]
    section = section.split("甲、申論題部分", 1)[-1]
    parts = re.split(r"(?m)^\s*([一二])、", section)[1:]
    if len(parts) != 4:
        raise ValueError("無法取得兩題申論題")
    questions = []
    for index in range(0, len(parts), 2):
        value = compact(parts[index + 1])
        value = re.sub(r"（\s*20\s*分\s*）\s*$", "", value)
        if not value:
            raise ValueError("申論題內容為空")
        questions.append(value)
    return questions


def parse_choice_questions(raw: str) -> list[tuple[str, list[str]]]:
    marker = "乙、測驗題部分"
    if marker not in raw:
        raise ValueError("找不到測驗題區段")
    section = raw.split(marker, 1)[1]
    first = re.search(r"(?m)^\s*1\s+", section)
    if not first:
        raise ValueError("找不到第一題")
    section = section[first.start():]
    segments = re.split(r"(?m)^\s*(\d{1,2})\s+", section)[1:]
    result = []
    for index in range(0, len(segments), 2):
        number, body = int(segments[index]), compact(segments[index + 1])
        if number > 40:
            continue
        match = re.search(r"\s*(.*?)\s*\s*(.*?)\s*\s*(.*?)\s*\s*(.*)$", body)
        if not match:
            raise ValueError(f"第 {number} 題無法切出四個選項")
        prompt = body[:match.start()].strip()
        options = [part.strip() for part in match.groups()]
        if not prompt or any(not option for option in options):
            raise ValueError(f"第 {number} 題內容不完整")
        result.append((prompt, options))
    if len(result) != 40 or [number for number, _ in enumerate(result, 1)] != list(range(1, 41)):
        raise ValueError(f"選擇題數量不正確：{len(result)}")
    return result


def parse_answers(raw: str) -> list[str]:
    answers = re.findall(r"(?m)^答案\s+(.+)$", raw)
    letters = []
    for line in answers[:4]:
        letters.extend(re.findall(r"[ABCD]", line))
    if len(letters) != 40:
        raise ValueError(f"無法取得 40 題官方答案，目前 {len(letters)} 題")
    return letters


def correction_answers(raw: str) -> dict[int, list[str]]:
    # The Ministry’s correction notice for 0302 explicitly accepts B, D or BD
    # for Q40. Store the single-response choices that the UI can evaluate.
    if "第40題答Ｂ或Ｄ或BD者均給分" in raw:
        return {40: ["B", "D"]}
    return {}


def main() -> None:
    existing = json.loads(DATA.read_text(encoding="utf-8"))
    if any(q["id"].startswith("2026-2-") for q in existing):
        raise SystemExit("已偵測到 2026 第 2 次資料；為避免覆寫，請先人工檢查。")
    records = []
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        for code, subject in PAPERS:
            raw_q, question_hash = download_text(url(code, "Q"), directory, f"{code}-question")
            raw_a, answer_hash = download_text(url(code, "S"), directory, f"{code}-answer")
            essays, choices, answers = parse_essays(raw_q), parse_choice_questions(raw_q), parse_answers(raw_a)
            corrections: dict[int, list[str]] = {}
            correction_url = None
            correction_hash = None
            if code == "0302":
                correction_url = url(code, "M")
                raw_c, correction_hash = download_text(correction_url, directory, f"{code}-correction")
                corrections = correction_answers(raw_c)
                if not corrections:
                    raise ValueError("社會工作直接服務更正答案格式不符，停止匯入")
            source = {
                "sourceUrl": url(code, "Q"), "answerSourceUrl": url(code, "S"), "correctionSourceUrl": correction_url,
                "answerVersion": "corrected" if corrections else "official", "verifiedAt": date.today().isoformat(),
                "questionSha256": question_hash, "answerSha256": answer_hash, "correctionSha256": correction_hash,
            }
            for number, prompt in enumerate(essays, 1):
                records.append({
                    "id": f"2026-2-{code}-E{number}", "examType": "socialWorker", "year": 2026, "session": 2,
                    "subject": subject, "number": number, "type": "essay", "prompt": prompt, "options": [], "answer": None,
                    "questionPDF": source["sourceUrl"], "answerPDF": None,
                    "explanation": "【官方試題】考選部未提供申論題標準擬答；本題暫不提供 AI 擬答，請依官方題目與教材練習。",
                    "referenceAnswer": "【待補充】考選部未公布申論題參考答案。本系統不以未經人工校閱的內容冒充官方答案。",
                    "source": source,
                })
            for number, (prompt, options) in enumerate(choices, 1):
                record = {
                    "id": f"2026-2-{code}-M{number}", "examType": "socialWorker", "year": 2026, "session": 2,
                    "subject": subject, "number": number, "type": "multipleChoice", "prompt": prompt, "options": options,
                    "answer": answers[number - 1], "questionPDF": source["sourceUrl"], "answerPDF": source["answerSourceUrl"],
                    "explanation": "【官方標準答案】本題答案已依考選部公布之標準答案核對。詳解尚待人工編撰，請以官方試題、標準答案及考試年度教材為準。",
                    "source": source,
                }
                if number in corrections:
                    record["acceptedAnswers"] = corrections[number]
                records.append(record)
    if len(records) != 210:
        raise ValueError(f"匯入題數應為 210，實際為 {len(records)}")
    DATA.write_text(json.dumps(existing + records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"已匯入 {len(records)} 題 115 年第二次社工師正式試題。")


if __name__ == "__main__":
    main()
