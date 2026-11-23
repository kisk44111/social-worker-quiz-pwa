#!/usr/bin/env python3
"""Offline maintenance script to generate content-grounded MC explanations via OpenRouter.

Security and safety safeguards:
- Offline maintenance tool only; never used by the browser runtime.
- Credentials are never stored in the repo or written to disk.
- Prefers the ``OPENROUTER_API_KEY`` environment variable; macOS Keychain
  (service ``codex-openrouter-api-key``) is only read when ``--use-keychain``
  is explicitly passed.
- ``--dry-run`` (or zero pending items without ``--apply``) exits without
  reading Keychain or making any external API requests.
- Remote API requests and ``--apply`` writes require ``--confirm-remote-api``.
- ``--apply`` validates the full question bank with ``validate_questions`` and
  replaces ``questions.json`` atomically via a temporary file in the same
  directory.
"""

from __future__ import annotations

import argparse
import concurrent.futures
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

try:
    from tools.validate_questions import validate_questions
except ImportError:
    from validate_questions import validate_questions


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
CHECKPOINT = ROOT / ".mc-explanation-checkpoint.json"
DEFAULT_ERROR_LOG_DIR = Path(tempfile.gettempdir()) / "social-worker-quiz-pwa-logs"
KEYCHAIN_SERVICE = "codex-openrouter-api-key"
API_KEY_ENV = "OPENROUTER_API_KEY"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
MODEL_CONFIGS = (
    ("openai/gpt-4.1-mini", 4, 12000),
)
LETTERS = "ABCD"
REVERSE_WORDS = ("錯誤", "不正確", "不適當", "不包括", "不包含", "何者非", "何者不是", "除外", "最不", "不符合")

SYSTEM = """你是臺灣社工師國家考試的資深命題解析教師。請用繁體中文，依社會工作、心理與人類發展、直接服務、研究方法、統計、社會政策及法規的實質知識解析題目。

重要規則：
1. 推理必須來自題幹與專業知識；不得用「因官方答案是 X，所以……」當理由。
2. 每個選項都要解釋其概念本身、為何適用或不適用於本題；不能只寫「與題意不符」。
3. 錯誤選項必須指出錯誤點，並在 correction 寫出正確知識或可成立的改寫。若選項本身是正確敘述但因反向題而不選，correction 寫「本項敘述正確，無須修改」。
4. 正確選項的 analysis 要說明關鍵概念或因果關係，correction 寫「無須修改」。
5. 不得捏造法條號碼、年代、學者主張或數據；不確定時用穩健的概念說明。法規依題目年度有效規定理解。
6. 避免重複題幹、避免空話、避免提到你是 AI。
7. 只輸出合法 JSON，不要 Markdown。
"""


def read_keychain_token() -> str:
    account = subprocess.check_output(["id", "-un"], text=True).strip()
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"],
        text=True,
    ).strip()


def resolve_api_token(*, use_keychain: bool = False) -> str:
    env_token = os.environ.get(API_KEY_ENV, "").strip()
    if env_token:
        return env_token
    if use_keychain:
        keychain_token = read_keychain_token()
        if keychain_token:
            return keychain_token
        raise SystemExit(f"macOS Keychain 項目 {KEYCHAIN_SERVICE!r} 為空，無法取得 OpenRouter API 金鑰。")
    raise SystemExit(
        f"未設定環境變數 {API_KEY_ENV}。請設定 {API_KEY_ENV}，或明確加上 --use-keychain "
        f"以從 macOS Keychain（{KEYCHAIN_SERVICE}）讀取金鑰。"
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


def write_invalid_response_log(
    response: dict,
    invalid_ids: list[str],
    log_dir: Path = DEFAULT_ERROR_LOG_DIR,
) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(log_dir, 0o700)
    except OSError:
        pass
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "loggedAt": datetime.now(timezone.utc).isoformat(),
        "invalidQuestionIds": invalid_ids,
        "response": response,
    }
    fd, raw_path = tempfile.mkstemp(
        dir=log_dir,
        prefix=f"mc-invalid-response-{timestamp}-",
        suffix=".json",
    )
    log_path = Path(raw_path)
    try:
        os.chmod(log_path, 0o600)
    except OSError:
        pass
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    return log_path


def request_model(batch: list[dict], auth_token: str, model: str, max_tokens: int) -> dict:
    payload_questions = [
        {
            "id": q["id"], "year": q["year"], "subject": q["subject"],
            "prompt": q["prompt"], "options": dict(zip(LETTERS, q["options"])),
            "answer": q["answer"],
            "polarity": "反向題：答案是錯誤／例外項" if any(w in q["prompt"] for w in REVERSE_WORDS) else "正向題：答案是正確／最適項",
        }
        for q in batch
    ]
    user = """請解析以下題目。為避免空泛，篇幅集中在四個選項的實質知識。輸出格式：
{"questions":[{"id":"題號","core":"用專業知識說明本題的判斷原理，2至3句","options":[{"letter":"A","verdict":"應選或不選","analysis":"說明本選項概念，以及為何適用或不適用本題，1至2句","correction":"錯項的正確改寫或正確知識；正確敘述寫無須修改"}]}]}

每題 options 必須依 A、B、C、D 完整輸出。題目如下：
""" + json.dumps(payload_questions, ensure_ascii=False)
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        "temperature": 0.15,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }, ensure_ascii=False).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://kisk44111.github.io/social-worker-quiz-pwa/",
            "X-OpenRouter-Title": "Taiwan Social Worker Quiz Explanation Builder",
        },
    )
    with urllib.request.urlopen(req, timeout=240) as response:
        result = json.load(response)
    return json.loads(result["choices"][0]["message"]["content"])


def valid(item: dict, expected: dict) -> bool:
    if item.get("id") != expected["id"]:
        return False
    options = item.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return False
    if [o.get("letter") for o in options] != list(LETTERS):
        return False
    required = ("type_note", "core", "correct_reason", "review")
    if any(len(str(item.get(k, "")).strip()) < 10 for k in required):
        return False
    for option in options:
        if len(str(option.get("analysis", "")).strip()) < 18:
            return False
        if len(str(option.get("correction", "")).strip()) < 4:
            return False
    return True


def normalize(item: dict, question: dict) -> dict:
    """Fill optional wording fields without replacing the model's reasoning."""
    options = item.get("options", [])
    answer_option = next((o for o in options if o.get("letter") == question["answer"]), {})
    core = str(item.get("core", "")).strip()
    item.setdefault("type_note", f"考查「{core}」中的關鍵概念與選項差異。")
    item.setdefault("correct_reason", str(answer_option.get("analysis", core)).strip())
    item.setdefault("review", core)
    for option in options:
        if not str(option.get("correction", "")).strip():
            if option.get("letter") == question["answer"]:
                option["correction"] = item.get("correct_reason", "無須修改")
            else:
                option["correction"] = (
                    f'本項應依上述差異修正；正確判斷可對照：{item.get("correct_reason", "請回到題幹核心概念判斷。")}'
                )
    return item


def format_explanation(item: dict, question: dict) -> str:
    answer_text = question["options"][LETTERS.index(question["answer"])]
    lines = []
    for option, original in zip(item["options"], question["options"]):
        verdict = "應選" if option["letter"] == question["answer"] else "不選"
        lines.append(
            f'{option["letter"]}「{original}」：{verdict}。{option["analysis"].strip()}\n'
            f'修正／補充：{option["correction"].strip()}'
        )
    polarity = "反向題，必須選出錯誤、例外或最不適當的選項。" if any(w in question["prompt"] for w in REVERSE_WORDS) else "正向題，必須選出正確或最適當的選項。"
    type_note = item['type_note'].replace("正向題", "").replace("反向題", "").lstrip("，、： ")
    return f"""【題型辨識】
{polarity}{type_note}

【核心判斷】
{item['core'].strip()}

【正確答案與理由】
答案為 {question['answer']}「{answer_text}」。{item['correct_reason'].strip()}

【選項逐項解析】
{chr(10).join(lines)}

【複習結論】
{item['review'].strip()}"""


def load_checkpoint(checkpoint_path: Path = CHECKPOINT) -> dict:
    if checkpoint_path.exists():
        return json.loads(checkpoint_path.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(results: dict, checkpoint_path: Path = CHECKPOINT) -> None:
    atomic_write_text(checkpoint_path, json.dumps(results, ensure_ascii=False))


def build_batches(pending: list[dict], batch_size: int) -> list[tuple[list[dict], str, int]]:
    batches: list[tuple[list[dict], str, int]] = []
    offset = 0
    while offset < len(pending):
        for model, configured_size, max_tokens in MODEL_CONFIGS:
            if offset >= len(pending):
                break
            size = min(batch_size, configured_size) if batch_size else configured_size
            batch = pending[offset : offset + size]
            batches.append((batch, model, max_tokens))
            offset += len(batch)
    return batches


def apply_explanations(
    questions: list[dict],
    multiple: list[dict],
    results: dict,
    data_path: Path = DATA,
) -> int:
    missing = [q["id"] for q in multiple if q["id"] not in results]
    if missing:
        raise SystemExit(f"Cannot apply; {len(missing)} target questions missing")
    by_id = {q["id"]: q for q in questions}
    updated_count = 0
    for qid, item in results.items():
        if qid in by_id and by_id[qid].get("type") == "multipleChoice":
            by_id[qid]["explanation"] = format_explanation(item, by_id[qid])
            updated_count += 1
    errors = validate_questions(questions)
    if errors:
        preview = "\n".join(f"- {error}" for error in errors[:10])
        raise SystemExit(
            f"題庫結構驗證失敗（共 {len(errors)} 項），已中止寫入 {data_path}：\n{preview}"
        )
    atomic_write_text(data_path, json.dumps(questions, ensure_ascii=False, separators=(",", ":")))
    return updated_count


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Offline maintenance script to generate content-grounded MC explanations "
            "using the OpenRouter API. Safe by default: use --dry-run to preview, or "
            "pass --confirm-remote-api to authorize external API calls / --apply writes."
        )
    )
    parser.add_argument("--batch-size", type=int, default=20, help="Max questions per batch (clamped by model config).")
    parser.add_argument("--workers", type=int, default=3, help="Concurrent worker threads for OpenRouter requests.")
    parser.add_argument("--limit", type=int, help="Limit processing to the first N multiple-choice questions.")
    parser.add_argument("--dry-run", action="store_true", help="Preview target/cached/pending counts without reading Keychain, calling APIs, or writing files.")
    parser.add_argument("--apply", action="store_true", help="Validate and atomically write generated explanations back into questions.json.")
    parser.add_argument(
        "--confirm-remote-api",
        action="store_true",
        help="Explicitly authorize paid OpenRouter API requests and/or --apply writes to questions.json.",
    )
    parser.add_argument(
        "--use-keychain",
        action="store_true",
        help=f"Fallback to macOS Keychain service {KEYCHAIN_SERVICE!r} if {API_KEY_ENV} is not set.",
    )
    parser.add_argument(
        "--error-log-dir",
        type=Path,
        default=DEFAULT_ERROR_LOG_DIR,
        help=f"Directory for timestamped invalid-response logs (default: {DEFAULT_ERROR_LOG_DIR}).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    questions = json.loads(DATA.read_text(encoding="utf-8"))
    multiple = [q for q in questions if q.get("type") == "multipleChoice"]
    if args.limit is not None:
        if args.limit < 0:
            raise SystemExit("--limit must be a non-negative integer")
        multiple = multiple[: args.limit]

    results = load_checkpoint()
    pending = [q for q in multiple if q["id"] not in results]
    batches = build_batches(pending, args.batch_size)
    print(f"Target {len(multiple)}; cached {len(multiple) - len(pending)}; pending {len(pending)}", flush=True)

    if args.dry_run:
        models = ", ".join(model for model, _, _ in MODEL_CONFIGS)
        auth_source = (
            f"env:{API_KEY_ENV}"
            if os.environ.get(API_KEY_ENV, "").strip()
            else (f"keychain:{KEYCHAIN_SERVICE}" if args.use_keychain else f"unconfigured (set {API_KEY_ENV} or pass --use-keychain)")
        )
        print(
            f"[DRY-RUN] Planned {len(batches)} batch(es) via {ENDPOINT} (models: {models}); "
            f"apply={args.apply}; auth_source={auth_source}. "
            "No Keychain access, no remote API requests, and no files were modified.",
            flush=True,
        )
        return 0

    if not pending and not args.apply:
        print("No pending questions and --apply not set; exiting without credential access or API requests.", flush=True)
        return 0

    if not args.confirm_remote_api:
        action_desc = []
        if pending:
            action_desc.append(f"向 OpenRouter 發送 {len(batches)} 批付費 API 請求（{len(pending)} 題）")
        if args.apply:
            action_desc.append(f"寫回 {DATA.name}")
        raise SystemExit(
            f"已中止：本次執行將{'並'.join(action_desc)}。"
            "請確認額度與範圍後加上 --confirm-remote-api，或先使用 --dry-run 預覽。"
        )

    if pending:
        auth_token = resolve_api_token(use_keychain=args.use_keychain)

        def generate_batch(batch: list[dict], model: str, max_tokens: int) -> dict:
            for attempt in range(1, 7):
                try:
                    response = request_model(batch, auth_token, model, max_tokens)
                    response_items = response.get("questions", [])
                    if not isinstance(response_items, list) or any(not isinstance(item, dict) for item in response_items):
                        raise ValueError("questions must be an array of objects")
                    returned = {item.get("id"): item for item in response_items}
                    for q in batch:
                        if q["id"] in returned:
                            returned[q["id"]] = normalize(returned[q["id"]], q)
                    invalid = [q["id"] for q in batch if q["id"] not in returned or not valid(returned[q["id"]], q)]
                    if invalid:
                        log_path = write_invalid_response_log(response, invalid, log_dir=args.error_log_dir)
                        print(f"Saved invalid API response log to {log_path}", file=sys.stderr, flush=True)
                        raise ValueError(f"invalid results: {invalid}")
                    return {q["id"]: returned[q["id"]] for q in batch}
                except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                    if attempt == 6:
                        if len(batch) > 1:
                            print(f"Split stubborn {len(batch)}-question batch into single questions", flush=True)
                            split_results = {}
                            for question in batch:
                                split_results.update(generate_batch([question], model, max_tokens))
                            return split_results
                        raise
                    wait = min(75, attempt * 15)
                    detail = getattr(exc, "code", f"{type(exc).__name__}: {exc}")
                    print(f"Retry {model} batch after {detail}; waiting {wait}s", flush=True)
                    time.sleep(wait)
            raise RuntimeError("Unreachable retry loop end")

        completed_now = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(generate_batch, batch, model, max_tokens) for batch, model, max_tokens in batches]
            for future in concurrent.futures.as_completed(futures):
                batch_results = future.result()
                results.update(batch_results)
                save_checkpoint(results)
                completed_now += len(batch_results)
                print(f"Completed {completed_now}/{len(pending)} (total cached {len(results)})", flush=True)

    if args.apply:
        updated = apply_explanations(questions, multiple, results, data_path=DATA)
        print(f"Validated and atomically applied {updated} content-grounded explanations", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
