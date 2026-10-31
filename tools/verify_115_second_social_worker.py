#!/usr/bin/env python3
"""Re-download and compare the imported 115年第二次 official answers."""
import json
import tempfile
from pathlib import Path

from import_115_second_social_worker import PAPERS, correction_answers, download_text, parse_answers, url

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    questions = json.loads((ROOT / "questions.json").read_text(encoding="utf-8"))
    imported = [q for q in questions if q.get("year") == 2026 and q.get("session") == 2 and q.get("examType") == "socialWorker"]
    if len(imported) != 210:
        raise SystemExit(f"115 年第二次題數錯誤：{len(imported)}")
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        for code, subject in PAPERS:
            raw_answer, answer_hash = download_text(url(code, "S"), directory, f"{code}-answer")
            answers = parse_answers(raw_answer)
            selected = sorted([q for q in imported if q["subject"] == subject and q["type"] == "multipleChoice"], key=lambda q: q["number"])
            if [q["answer"] for q in selected] != answers:
                raise SystemExit(f"{subject} 官方答案不一致")
            if any(q["source"]["answerSha256"] != answer_hash for q in selected):
                raise SystemExit(f"{subject} 官方答案檔雜湊已變動，需人工重新核對")
            if code == "0302":
                raw_correction, _ = download_text(url(code, "M"), directory, f"{code}-correction")
                corrected = next(q for q in selected if q["number"] == 40)
                if corrected.get("acceptedAnswers") != correction_answers(raw_correction).get(40):
                    raise SystemExit("社會工作直接服務第 40 題更正答案不一致")
    print("115 年第二次五科官方答案及更正答案核對通過。")


if __name__ == "__main__":
    main()
