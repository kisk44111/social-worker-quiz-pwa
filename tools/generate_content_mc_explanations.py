#!/usr/bin/env python3
"""Generate content-grounded MC explanations with GitHub Models.

The GitHub credential is read at runtime through ``gh auth token`` and is never
written to disk. Completed batches are checkpointed so the job can resume.
"""

import argparse
import concurrent.futures
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
CHECKPOINT = ROOT / ".mc-explanation-checkpoint.json"
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


def token() -> str:
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", subprocess.check_output(["id", "-un"], text=True).strip(),
         "-s", "codex-openrouter-api-key", "-w"],
        text=True,
    ).strip()


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


def load_checkpoint() -> dict:
    if CHECKPOINT.exists():
        return json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(results: dict) -> None:
    CHECKPOINT.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    questions = json.loads(DATA.read_text(encoding="utf-8"))
    multiple = [q for q in questions if q.get("type") == "multipleChoice"]
    if args.limit:
        multiple = multiple[: args.limit]
    results = load_checkpoint()
    pending = [q for q in multiple if q["id"] not in results]
    auth_token = token()
    print(f"Target {len(multiple)}; cached {len(multiple)-len(pending)}; pending {len(pending)}", flush=True)

    batches = []
    offset = 0
    while offset < len(pending):
        for model, configured_size, max_tokens in MODEL_CONFIGS:
            if offset >= len(pending):
                break
            size = min(args.batch_size, configured_size) if args.batch_size else configured_size
            batch = pending[offset : offset + size]
            batches.append((batch, model, max_tokens))
            offset += len(batch)

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
                    Path("/tmp/mc-invalid-response.json").write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
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
        missing = [q["id"] for q in multiple if q["id"] not in results]
        if missing:
            raise SystemExit(f"Cannot apply; {len(missing)} target questions missing")
        by_id = {q["id"]: q for q in questions}
        for qid, item in results.items():
            if qid in by_id and by_id[qid].get("type") == "multipleChoice":
                by_id[qid]["explanation"] = format_explanation(item, by_id[qid])
        DATA.write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Applied {len(results)} content-grounded explanations", flush=True)


if __name__ == "__main__":
    main()
