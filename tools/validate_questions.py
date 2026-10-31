#!/usr/bin/env python3
"""Validate the immutable question-bank structure before a release.

Usage: python3 tools/validate_questions.py [questions.json]
Exit status is non-zero when any structural or identity problem is found.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

SOCIAL_SUBJECTS = {
    "社會工作", "人類行為與社會環境", "社會工作直接服務", "社會工作研究方法", "社會政策與社會立法",
}
PUBLIC_SUBJECTS = {"社會福利政策與法規", "社會工作實務"}
COMMON_FIELDS = {"id", "year", "session", "subject", "number", "type", "prompt", "options", "answer", "questionPDF", "answerPDF", "explanation"}


def issue(errors: list[str], index: int, message: str) -> None:
    errors.append(f"第 {index + 1} 筆：{message}")


def validate_questions(questions: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(questions, list):
        return ["根節點必須是題目陣列。"]

    seen_ids: dict[str, int] = {}
    paper_numbers: dict[tuple[str, int, int, str, str], list[int]] = defaultdict(list)
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            issue(errors, index, "題目必須是物件。"); continue
        missing = COMMON_FIELDS - question.keys()
        if missing:
            issue(errors, index, f"缺少必要欄位：{', '.join(sorted(missing))}。"); continue

        question_id = question["id"]
        if not isinstance(question_id, str) or not question_id.strip():
            issue(errors, index, "id 必須是非空字串。")
        elif question_id in seen_ids:
            issue(errors, index, f"id 重複：{question_id}（首次出現在第 {seen_ids[question_id] + 1} 筆）。")
        else:
            seen_ids[question_id] = index

        exam_type = question.get("examType", "socialWorker")
        if exam_type not in {"socialWorker", "publicSocialWorker"}:
            issue(errors, index, "examType 必須為 socialWorker 或 publicSocialWorker。")
        subjects = PUBLIC_SUBJECTS if exam_type == "publicSocialWorker" else SOCIAL_SUBJECTS
        if question["subject"] not in subjects:
            issue(errors, index, f"科目不屬於 {exam_type} 的白名單：{question['subject']!r}。")

        for field, minimum in (("year", 1900), ("session", 1), ("number", 1)):
            value = question[field]
            if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
                issue(errors, index, f"{field} 必須是不小於 {minimum} 的整數。")
        if not isinstance(question["prompt"], str) or not question["prompt"].strip():
            issue(errors, index, "prompt 必須是非空字串。")
        if not isinstance(question["explanation"], str) or not question["explanation"].strip():
            issue(errors, index, "explanation 必須是非空字串。")
        if not isinstance(question["questionPDF"], (str, type(None))) or not isinstance(question["answerPDF"], (str, type(None))):
            issue(errors, index, "questionPDF 與 answerPDF 必須是字串或 null。")
        if "acceptedAnswers" in question:
            accepted = question["acceptedAnswers"]
            if not isinstance(accepted, list) or not accepted or not all(item in {"A", "B", "C", "D"} for item in accepted):
                issue(errors, index, "acceptedAnswers 必須是非空 A–D 陣列。")
        if "source" in question:
            source = question["source"]
            needed_source = {"sourceUrl", "answerSourceUrl", "answerVersion", "verifiedAt", "questionSha256", "answerSha256"}
            if not isinstance(source, dict) or needed_source - source.keys() or not all(isinstance(source.get(key), str) and source[key] for key in needed_source):
                issue(errors, index, "source 缺少官方來源、版本或核對資訊。")

        question_type = question["type"]
        if question_type not in {"multipleChoice", "essay"}:
            issue(errors, index, "type 必須為 multipleChoice 或 essay。")
        elif question_type == "multipleChoice":
            options = question["options"]
            if not isinstance(options, list) or len(options) != 4 or not all(isinstance(option, str) and option.strip() for option in options):
                issue(errors, index, "選擇題必須有四個非空白文字選項。")
            if question["answer"] not in {"A", "B", "C", "D"}:
                issue(errors, index, "選擇題 answer 必須是 A、B、C 或 D。")
        elif question_type == "essay":
            if question["options"] != []:
                issue(errors, index, "申論題 options 必須是空陣列。")
            if question["answer"] is not None:
                issue(errors, index, "申論題 answer 必須是 null。")
            if not isinstance(question.get("referenceAnswer"), str) or not question["referenceAnswer"].strip():
                issue(errors, index, "申論題必須有非空白 referenceAnswer。")

        if all(isinstance(question.get(field), int) and not isinstance(question.get(field), bool) for field in ("year", "session", "number")):
            paper_numbers[(exam_type, question["year"], question["session"], question["subject"], question_type)].append(question["number"])

    for key, numbers in paper_numbers.items():
        duplicates = [number for number, count in Counter(numbers).items() if count > 1]
        if duplicates:
            errors.append(f"試卷 {key} 的題號重複：{sorted(duplicates)}。")
        expected = list(range(1, len(numbers) + 1))
        if sorted(numbers) != expected:
            errors.append(f"試卷 {key} 題號不連續；實際為 {sorted(numbers)}，預期為 {expected}。")
    return errors


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "questions.json"
    try:
        questions = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"無法讀取題庫：{exc}", file=sys.stderr)
        return 2
    errors = validate_questions(questions)
    if errors:
        print(f"題庫驗證失敗，共 {len(errors)} 項：", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    counts = Counter(question.get("type") for question in questions)
    print(f"題庫驗證通過：{len(questions)} 題（選擇題 {counts['multipleChoice']}、申論題 {counts['essay']}）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
