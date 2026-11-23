#!/usr/bin/env python3
"""Zero-API batch export, progress status, and validated import tool for essay answers.

Designed for collaborative workflows using Google AI Pro (Gemini web) and Antigravity
without local model servers or paid cloud API keys. Browser runtime remains 100% offline.

Workflow:
    1) Check progress by subject:
       python3 tools/generate_essay_answers.py --status

    2) Export a standardized Markdown batch prompt pack for pending essays:
       python3 tools/generate_essay_answers.py --export-batch --limit 10
       python3 tools/generate_essay_answers.py --export-batch --subject 社會工作 --out /tmp/batch.md

    3) Validate and atomically import generated JSON into questions.json:
       python3 tools/generate_essay_answers.py --import-json responses.json --dry-run
       python3 tools/generate_essay_answers.py --import-json responses.json

Safety guarantees:
- Zero external network calls and zero API key dependencies.
- Validates every imported essay ID, 4-stage 「起・承・轉・合」 model answer, and
  3-part 「答題解析與得分要點」 before merging.
- Runs full question-bank ``validate_questions`` checks and replaces ``questions.json``
  atomically via a same-directory temporary file + ``os.replace()``.
- Records completed IDs to ``.essay-answer-checkpoint.json`` for resumable tracking.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any

try:
    from tools.validate_questions import validate_questions
except ImportError:
    from validate_questions import validate_questions


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
CHECKPOINT = ROOT / ".essay-answer-checkpoint.json"
DEFAULT_EXPORT_DIR = Path(tempfile.gettempdir()) / "social-worker-quiz-pwa-essay-batches"

STAGE_META = (
    ("qi", "起", "破題與核心概念界定"),
    ("cheng", "承", "理論依據與法規政策剖析"),
    ("zhuan", "轉", "實務應用、困境與批判反思"),
    ("he", "合", "總結與具體建議展望"),
)

NON_OFFICIAL_LIMITATION = (
    "本內容為 AI 輔助生成之非官方參考擬答與解析，非考選部標準答案或評分依據；"
    "法規條文與實務作法請以考試當年度有效規定與教材為準。"
)

SYSTEM_PROMPT = """你是臺灣「專門職業及技術人員高等考試社會工作師」與「公職社會工作師」的資深命題解析與閱卷輔導教師。
請以繁體中文（臺灣社工與法政常用語）撰寫高品質的申論題「起・承・轉・合」四段式參考擬答，以及「答題解析與得分要點」。

寫作與專業準則：
1. 擬答須完整回應題幹所有小問，嚴禁離題或空泛口號，語氣採正式國家考試申論書寫風格。
2. 四段架構要求：
   - 【起】破題與核心概念界定：精準點出題旨、界定核心概念／名詞或法理基礎，並總領全文脈絡。
   - 【承】理論依據與法規政策剖析：分點闡述相關社工理論、學者觀點、法規制度或處遇流程，展現專業深度。
   - 【轉】實務應用、困境與批判反思：結合臺灣在地社工實務情境（如強化社會安全網、保護性業務、長照、跨專業協作、資源落差、文化敏感度或倫理兩難）深度剖析與批判。
   - 【合】總結與具體建議展望：收斂各小問重點，提出具體可行的實務精進或政策制度建議。
3. 嚴禁捏造不存在的法條條號、學者年份或統計數據；若不確定確切條號，請以準確法規名稱與核心原則論述。
4. 答題解析需務實對應國考閱卷給分點，包含審題陷阱、必寫核心理論／法規清單，以及建議篇幅與配分策略。
5. 只輸出嚴格合法的 JSON 陣列（可用 ```json ... ``` 包裹），保留每題完全一致的 `id`。"""


def build_batch_markdown(questions: list[dict[str, Any]]) -> str:
    question_blocks = []
    for index, q in enumerate(questions, start=1):
        exam_label = "公職社會工作師" if q.get("examType") == "publicSocialWorker" else "專技高考社會工作師"
        question_blocks.append(
            f"### 第 {index} 題\n"
            f"- id: `{q['id']}`\n"
            f"- 類別：{exam_label}｜{q['year']} 年第 {q['session']} 次｜{q['subject']} 第 {q['number']} 題\n"
            f"- 題幹：\n{q['prompt'].strip()}"
        )
    schema_example = json.dumps(
        [
            {
                "id": questions[0]["id"] if questions else "2021-1-0401-E1",
                "modelAnswer": {
                    "qi": {
                        "title": "破題與核心概念界定",
                        "content": "120～220 字，點出題旨並界定核心名詞或法理基礎。",
                    },
                    "cheng": {
                        "title": "理論依據與法規政策剖析",
                        "content": "250～400 字，條列分點論述核心理論、學者或臺灣相關法規政策內涵。",
                    },
                    "zhuan": {
                        "title": "實務應用、困境與批判反思",
                        "content": "250～400 字，扣緊臺灣在地社工實務情境、倫理兩難、資源限制與批判反思。",
                    },
                    "he": {
                        "title": "總結與具體建議展望",
                        "content": "120～200 字，回扣題幹所有小問並提出具體可行的實務或政策精進建議。",
                    },
                },
                "analysis": {
                    "focusAndTraps": [
                        "審題關鍵：說明本題核心考點與答題切入角度",
                        "常見離題陷阱：指出考生最容易忽略或寫偏的盲點",
                    ],
                    "theoriesAndLaws": [
                        "必寫專有名詞、理論、學者或法規名稱（至少 3 項）",
                    ],
                    "scoringRubric": [
                        "【起】約 15%～20%：建議篇幅與給分重點",
                        "【承】約 35%～40%：建議篇幅與給分重點",
                        "【轉】約 30%：建議篇幅與給分重點",
                        "【合】約 10%～15%：建議篇幅與給分重點",
                    ],
                },
            }
        ],
        ensure_ascii=False,
        indent=2,
    )
    return (
        "# 社工師申論題批次生成任務包（適用 Gemini Pro 網頁版／Antigravity）\n\n"
        f"本批次共 **{len(questions)} 題**申論題。請嚴格依照下方角色設定與 JSON 格式，"
        "**一次輸出包含全部題目的合法 JSON 陣列**，並保持每題 `id` 完全不變：\n\n"
        "---\n\n"
        "## 角色與閱卷寫作準則（System Prompt）\n\n"
        f"{SYSTEM_PROMPT}\n\n"
        "## 強制輸出 JSON 陣列格式（User Schema）\n\n"
        f"```json\n{schema_example}\n```\n\n"
        "## 待生成申論題清單\n\n"
        + "\n\n".join(question_blocks)
        + "\n\n---\n\n"
        "### 完成後匯入指令\n"
        "將生成結果存檔（純 `.json` 或直接複製含 ```` ```json ```` 區塊的回覆文字皆可），執行：\n"
        "```bash\n"
        "python3 tools/generate_essay_answers.py --import-json <回覆檔路徑> --dry-run\n"
        "python3 tools/generate_essay_answers.py --import-json <回覆檔路徑>\n"
        "```\n"
    )


def atomic_write_text(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            tmp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, target)
    except Exception:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        raise


def load_checkpoint(checkpoint_path: Path = CHECKPOINT) -> dict[str, dict[str, Any]]:
    if checkpoint_path.exists():
        data = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    return {}


def save_checkpoint(results: dict[str, dict[str, Any]], checkpoint_path: Path = CHECKPOINT) -> None:
    atomic_write_text(checkpoint_path, json.dumps(results, ensure_ascii=False, indent=2))


def extract_json_payload(raw_text: str) -> Any:
    text = raw_text.strip()
    if not text:
        raise ValueError("空白內容，無法解析 JSON。")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    for block in fenced:
        try:
            return json.loads(block.strip())
        except json.JSONDecodeError:
            continue
    first_arr, last_arr = text.find("["), text.rfind("]")
    first_obj, last_obj = text.find("{"), text.rfind("}")
    candidates = []
    if first_arr != -1 and last_arr > first_arr:
        candidates.append((first_arr, text[first_arr : last_arr + 1]))
    if first_obj != -1 and last_obj > first_obj:
        candidates.append((first_obj, text[first_obj : last_obj + 1]))
    for _, slice_text in sorted(candidates, key=lambda pair: pair[0]):
        try:
            return json.loads(slice_text)
        except json.JSONDecodeError:
            continue
    raise ValueError("無法從檔案中解析合法 JSON，請確認貼上的回覆格式完整。")


def _clean_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        items = [line.strip("•- \t") for line in value.splitlines() if line.strip("•- \t")]
        return [item for item in items if item]
    if isinstance(value, list):
        return [str(item).strip() for item in value if isinstance(item, (str, int, float)) and str(item).strip()]
    return []


def normalize_essay_guide(raw_item: dict[str, Any], expected_id: str | None = None) -> tuple[str, dict[str, Any]]:
    if not isinstance(raw_item, dict):
        raise ValueError("每筆申論資料必須是 JSON 物件。")
    qid = str(raw_item.get("id") or expected_id or "").strip()
    if not qid:
        raise ValueError("缺少題目 id。")
    if expected_id and qid != expected_id:
        raise ValueError(f"題目 id 不符：預期 {expected_id}，實際 {qid}。")

    guide_root = raw_item.get("essayGuide") if isinstance(raw_item.get("essayGuide"), dict) else raw_item
    raw_model = guide_root.get("modelAnswer") or guide_root.get("擬答") or {}
    if not isinstance(raw_model, dict):
        raise ValueError(f"{qid} 缺少 modelAnswer 物件。")

    model_answer: dict[str, dict[str, str]] = {}
    for key, zh_key, default_title in STAGE_META:
        stage_raw = raw_model.get(key) or raw_model.get(zh_key) or raw_model.get(f"【{zh_key}】")
        if isinstance(stage_raw, str):
            title, content = default_title, stage_raw.strip()
        elif isinstance(stage_raw, dict):
            title = str(stage_raw.get("title") or default_title).strip() or default_title
            content = str(stage_raw.get("content") or stage_raw.get("text") or "").strip()
        else:
            raise ValueError(f"{qid} 的 modelAnswer 缺少「{zh_key}」（{key}）段落。")
        if len(content) < 20:
            raise ValueError(f"{qid} 的「{zh_key}」段落內容過短（少於 20 字）。")
        model_answer[key] = {"title": title, "content": content}

    raw_analysis = guide_root.get("analysis") or guide_root.get("答題解析") or {}
    if not isinstance(raw_analysis, dict):
        raise ValueError(f"{qid} 缺少 analysis 物件。")

    focus_and_traps = _clean_string_list(
        raw_analysis.get("focusAndTraps") or raw_analysis.get("審題與破題關鍵")
    )
    theories_and_laws = _clean_string_list(
        raw_analysis.get("theoriesAndLaws") or raw_analysis.get("核心理論與法規清單")
    )
    scoring_rubric = _clean_string_list(
        raw_analysis.get("scoringRubric") or raw_analysis.get("架構與配分要點")
    )

    if not focus_and_traps:
        raise ValueError(f"{qid} 的 analysis.focusAndTraps 不可為空。")
    if not theories_and_laws:
        raise ValueError(f"{qid} 的 analysis.theoriesAndLaws 不可為空。")
    if not scoring_rubric:
        raise ValueError(f"{qid} 的 analysis.scoringRubric 不可為空。")

    return qid, {
        "modelAnswer": model_answer,
        "analysis": {
            "focusAndTraps": focus_and_traps,
            "theoriesAndLaws": theories_and_laws,
            "scoringRubric": scoring_rubric,
        },
    }


def format_reference_answer(essay_guide: dict[str, Any]) -> str:
    model = essay_guide["modelAnswer"]
    blocks = []
    for key, badge, default_title in STAGE_META:
        part = model[key]
        blocks.append(f"【{badge}｜{part.get('title') or default_title}】\n{part['content'].strip()}")
    return "\n\n".join(blocks)


def format_explanation_summary(essay_guide: dict[str, Any]) -> str:
    analysis = essay_guide["analysis"]
    focus_lines = "\n".join(f"• {item}" for item in analysis["focusAndTraps"])
    theory_lines = "、".join(analysis["theoriesAndLaws"])
    rubric_lines = "\n".join(f"• {item}" for item in analysis["scoringRubric"])
    return (
        f"【審題與破題關鍵】\n{focus_lines}\n\n"
        f"【核心理論與法規清單】\n{theory_lines}\n\n"
        f"【架構與配分要點】\n{rubric_lines}"
    )


def apply_essay_guides(
    questions: list[dict[str, Any]],
    guides_by_id: dict[str, dict[str, Any]],
    *,
    source_model: str,
    data_path: Path = DATA,
) -> int:
    by_id = {q["id"]: q for q in questions}
    updated = 0
    today = date.today().isoformat()
    for qid, record in guides_by_id.items():
        question = by_id.get(qid)
        if not question:
            raise SystemExit(f"找不到題目 ID：{qid}，請確認匯入檔中的 id 是否正確。")
        if question.get("type") != "essay":
            raise SystemExit(f"題目 {qid} 不是申論題（type={question.get('type')!r}），禁止寫入申論擬答。")
        essay_guide = record["essayGuide"] if "essayGuide" in record else record
        _, clean_guide = normalize_essay_guide(essay_guide, expected_id=qid)
        question["essayGuide"] = clean_guide
        question["referenceAnswer"] = format_reference_answer(clean_guide)
        question["explanation"] = format_explanation_summary(clean_guide)
        question["aiContent"] = {
            "kind": "nonOfficialEssayAnswer",
            "generatedAt": str(record.get("generatedAt") or today),
            "model": str(record.get("model") or source_model),
            "limitations": NON_OFFICIAL_LIMITATION,
        }
        updated += 1

    errors = validate_questions(questions)
    if errors:
        preview = "\n".join(f"- {error}" for error in errors[:10])
        raise SystemExit(
            f"題庫結構驗證失敗（共 {len(errors)} 項），已中止寫入 {data_path}：\n{preview}"
        )
    atomic_write_text(data_path, json.dumps(questions, ensure_ascii=False, separators=(",", ":")))
    return updated


def format_status_report(questions: list[dict[str, Any]]) -> str:
    essays = [q for q in questions if q.get("type") == "essay"]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for q in essays:
        exam_label = "公職社工師" if q.get("examType") == "publicSocialWorker" else "專技社工師"
        grouped[(exam_label, q["subject"])].append(q)

    total = len(essays)
    completed_total = sum(1 for q in essays if isinstance(q.get("essayGuide"), dict))
    pending_total = total - completed_total
    pct = (completed_total / total * 100) if total else 0.0

    lines = [
        f"申論題升級進度總覽：已完成 {completed_total} / {total} 題（{pct:.1f}%），尚餘 {pending_total} 題待生成",
        "-" * 72,
        f"{'考試類別':<10} {'考科':<14} {'總題數':>6} {'已完成':>6} {'待生成':>6}",
        "-" * 72,
    ]
    for (exam_label, subject), items in sorted(grouped.items()):
        done = sum(1 for q in items if isinstance(q.get("essayGuide"), dict))
        left = len(items) - done
        lines.append(f"{exam_label:<10} {subject:<14} {len(items):>6} {done:>6} {left:>6}")
    lines.append("-" * 72)
    return "\n".join(lines)


def select_target_essays(
    questions: list[dict[str, Any]],
    *,
    subject: str | None = None,
    exam_type: str | None = None,
    question_ids: list[str] | None = None,
    limit: int | None = None,
    force: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    essays = [q for q in questions if q.get("type") == "essay"]
    if exam_type:
        essays = [q for q in essays if (q.get("examType") or "socialWorker") == exam_type]
    if subject:
        essays = [q for q in essays if q.get("subject") == subject]
    if question_ids:
        wanted = set(question_ids)
        essays = [q for q in essays if q["id"] in wanted]

    pending_pool = list(essays) if force else [q for q in essays if not isinstance(q.get("essayGuide"), dict)]
    if limit is not None:
        if limit < 0:
            raise SystemExit("--limit 必須為非負整數。")
        selected = pending_pool[:limit]
    else:
        selected = pending_pool
    return essays, selected


def parse_import_file(input_path: Path) -> list[dict[str, Any]]:
    if not input_path.exists():
        raise SystemExit(f"找不到匯入檔案：{input_path}")
    raw = input_path.read_text(encoding="utf-8")
    payload = extract_json_payload(raw)
    if isinstance(payload, dict):
        for key in ("essays", "questions", "items", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return [payload]
    if isinstance(payload, list):
        return payload
    raise SystemExit("匯入檔案必須是 JSON 物件或陣列。")


def resolve_default_export_path(subject: str | None = None) -> Path:
    DEFAULT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(DEFAULT_EXPORT_DIR, 0o700)
    except OSError:
        pass
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"-{subject}" if subject else ""
    return DEFAULT_EXPORT_DIR / f"essay-batch{suffix}-{stamp}.md"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "零 API 依賴的社工師申論題批次匯出／驗證匯入工具（適用 Gemini Pro 網頁版與 Antigravity）。"
        )
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--status", action="store_true", help="依考科統計 160 題申論題已完成與待生成進度。")
    mode.add_argument("--export-batch", action="store_true", help="匯出待生成申論題的標準化 Markdown Prompt 任務包。")
    mode.add_argument("--import-json", type=Path, metavar="INPUT_PATH", help="嚴格驗證並原子匯入生成好的 JSON 結果檔至 questions.json。")

    parser.add_argument("--limit", type=int, help="搭配 --export-batch：匯出前 N 題尚未生成的申論題。")
    parser.add_argument("--subject", help="搭配 --export-batch：只篩選指定考科（例如：社會工作、社會政策與社會立法）。")
    parser.add_argument("--exam-type", choices=("socialWorker", "publicSocialWorker"), help="搭配 --export-batch：只篩選專技或公職社工師申論題。")
    parser.add_argument("--question-id", action="append", help="搭配 --export-batch：指定特定題目 ID（可重複傳入）。")
    parser.add_argument("--out", type=Path, help=f"搭配 --export-batch：指定輸出 Markdown 路徑（預設存於 {DEFAULT_EXPORT_DIR}）。")
    parser.add_argument("--force", action="store_true", help="搭配 --export-batch：包含已有 essayGuide 的題目強制重出。")
    parser.add_argument("--model-label", default="gemini-pro-batch", help="搭配 --import-json：記錄於 aiContent.model 的來源標記（預設：gemini-pro-batch）。")
    parser.add_argument("--dry-run", action="store_true", help="預覽匯出內容或驗證匯入 JSON，不寫入任何檔案。")
    parser.add_argument("--checkpoint", type=Path, default=CHECKPOINT, help=f"Checkpoint 紀錄路徑（預設：{CHECKPOINT.name}）。")
    parser.add_argument("--data", type=Path, default=DATA, help="題庫 JSON 路徑（預設：questions.json）。")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    questions = json.loads(args.data.read_text(encoding="utf-8"))

    if args.status:
        print(format_status_report(questions))
        return 0

    if args.export_batch:
        pool, selected = select_target_essays(
            questions,
            subject=args.subject,
            exam_type=args.exam_type,
            question_ids=args.question_id,
            limit=args.limit,
            force=args.force,
        )
        done_count = sum(1 for q in pool if isinstance(q.get("essayGuide"), dict))
        print(f"篩選範圍共 {len(pool)} 題申論題｜已完成：{done_count} 題｜本次預計匯出：{len(selected)} 題", flush=True)
        if not selected:
            print("沒有符合條件的待生成申論題（如需重新匯出請加上 --force）。")
            return 0
        content = build_batch_markdown(selected)
        out_path = args.out or resolve_default_export_path(args.subject)
        if args.dry_run:
            print(f"[DRY-RUN] 預計匯出至：{out_path}")
            print(f"[DRY-RUN] 包含題號：{', '.join(q['id'] for q in selected)}")
            print("\n--- 任務包預覽（前 1,000 字）---")
            print(content[:1000])
            return 0
        atomic_write_text(out_path, content)
        print(f"已匯出 {len(selected)} 題標準化生成任務包至：{out_path}")
        print(f"包含題號：{', '.join(q['id'] for q in selected)}")
        return 0

    if args.import_json is not None:
        raw_items = parse_import_file(args.import_json)
        by_id = {q["id"]: q for q in questions}
        imported: dict[str, dict[str, Any]] = {}
        today = date.today().isoformat()
        for item in raw_items:
            qid, clean_guide = normalize_essay_guide(item)
            if qid not in by_id or by_id[qid].get("type") != "essay":
                raise SystemExit(f"匯入失敗：題目 ID {qid!r} 不存在或不是申論題。")
            imported[qid] = {
                "essayGuide": clean_guide,
                "model": str(item.get("model") or args.model_label),
                "generatedAt": today,
            }
        if args.dry_run:
            print(f"[DRY-RUN] 已通過結構與題號校驗，共 {len(imported)} 題（{', '.join(imported.keys())}），未修改任何檔案。")
            return 0
        checkpoint = load_checkpoint(args.checkpoint)
        checkpoint.update(imported)
        save_checkpoint(checkpoint, args.checkpoint)
        updated = apply_essay_guides(questions, imported, source_model=args.model_label, data_path=args.data)
        print(f"全庫驗證並原子寫入完成：已更新 {updated} 題申論題架構（{', '.join(imported.keys())}）。")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
