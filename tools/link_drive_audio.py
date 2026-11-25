#!/usr/bin/env python3
"""
Google 雲端硬碟申論名師有聲課 MP3 對照表生成器（essay-audio-manifest.json）。

功能模式：
  1. 初始化骨架（--init）：
     讀取 questions.json 全部 160 題申論題與本地音檔資料夾結構
     （預設 /Users/neko/Documents/2027社工師國考申論名師有聲課/），
     產生包含全部 160 題 question_id、考科與對應 MP3 檔名的 essay-audio-manifest.json
     （預設保留既有已填入之 fileId）。
  2. 模式 A（--from-json <drive_list.json>）：
     匯入 rclone lsjson -R 或 Google Drive API / Apps Script 匯出之檔案清單 JSON
     （含 name / Path 與 id / fileId），依 7 科資料夾與題號（01～24／01～20）自動精準比對，
     一鍵寫入 essay-audio-manifest.json。
  3. 模式 B（--from-csv <mapping.csv> 或 --interactive）：
     支援匯入 CSV（支援 question_id,fileId、filename,fileId 或直接貼上 Google Drive 分享連結），
     或透過互動式終端機逐筆貼上更新。

安全規範：
  本腳本不讀取亦不儲存任何 Google OAuth 憑證、金鑰或個人 Token；所有敏感檔名亦已排除於 .gitignore。

常用指令：
  # 1. 產生或更新 160 題對照表骨架（保留既有 fileId）
  python3 tools/link_drive_audio.py --init

  # 2. 使用 rclone 匯出 Google Drive 清單並一鍵比對寫入 manifest
  rclone lsjson -R gdrive:2027社工師國考申論名師有聲課 > /tmp/drive-files.json
  python3 tools/link_drive_audio.py --from-json /tmp/drive-files.json

  # 3. 使用 CSV 匯入（欄位：question_id 或 filename + fileId 或分享網址）
  python3 tools/link_drive_audio.py --from-csv /tmp/drive-links.csv

  # 4. 查看目前 160 題綁定覆蓋率與未綁定清單
  python3 tools/link_drive_audio.py --status
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import build_lecture_mp3 as lecture_builder  # noqa: E402

DEFAULT_QUESTIONS_PATH = REPO_ROOT / "questions.json"
DEFAULT_MANIFEST_PATH = REPO_ROOT / "essay-audio-manifest.json"
DEFAULT_AUDIO_DIR = lecture_builder.DEFAULT_OUTPUT_DIR

DRIVE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,128}$")
DRIVE_URL_PATTERNS = [
    re.compile(r"/file/d/([A-Za-z0-9_-]{10,128})"),
    re.compile(r"/d/([A-Za-z0-9_-]{10,128})"),
    re.compile(r"[?&]id=([A-Za-z0-9_-]{10,128})"),
]
SEQ_PREFIX_RE = re.compile(r"^(\d{1,2})[-_\s]")


def extract_drive_file_id(raw: Any) -> str:
    """從原始 Google Drive fileId 或分享網址萃取出乾淨的檔案 ID。"""
    text = str(raw or "").strip()
    if not text:
        return ""
    for pattern in DRIVE_URL_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1)
    if DRIVE_ID_RE.match(text):
        return text
    return ""


def _normalize_match_key(name: str) -> str:
    s = str(name or "").strip().lower()
    s = re.sub(r"\.mp3$", "", s)
    s = re.sub(r"[\s_\-]+", "", s)
    return s


def build_essay_catalog(
    questions: list[dict[str, Any]],
    audio_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """依 build_lecture_mp3 同一套 7 科與題號規則建立全部 160 題申論音檔目錄。"""
    base_dir = audio_dir or DEFAULT_AUDIO_DIR
    tasks = lecture_builder.collect_lecture_tasks(questions, out_dir=base_dir)
    catalog: list[dict[str, Any]] = []
    per_folder_seq: dict[str, int] = {}

    for task in tasks:
        folder = task["folderName"]
        seq = per_folder_seq.get(folder, 0) + 1
        per_folder_seq[folder] = seq
        filename = task["filename"]
        title = Path(filename).stem
        local_path = base_dir / folder / filename
        catalog.append(
            {
                "id": task["id"],
                "seq": seq,
                "examType": task["examType"],
                "examLabel": task["examLabel"],
                "subject": task["subject"],
                "folder": folder,
                "filename": filename,
                "title": title,
                "localExists": local_path.exists() and local_path.stat().st_size > 0,
            }
        )
    return catalog


def load_existing_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        return {"version": 1, "items": {}}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("items"), dict):
            return data
    except Exception:
        pass
    return {"version": 1, "items": {}}


def build_manifest_document(
    catalog: list[dict[str, Any]],
    file_id_map: dict[str, str],
    existing_manifest: dict[str, Any] | None = None,
    preserve_existing: bool = True,
) -> dict[str, Any]:
    """組裝標準化的 essay-audio-manifest.json 結構。"""
    existing_items = (existing_manifest or {}).get("items") or {}
    items: dict[str, dict[str, Any]] = {}
    linked_count = 0

    for entry in catalog:
        qid = entry["id"]
        incoming_id = extract_drive_file_id(file_id_map.get(qid, ""))
        prev_id = ""
        if preserve_existing and isinstance(existing_items.get(qid), dict):
            prev_id = extract_drive_file_id(existing_items[qid].get("fileId", ""))
        final_id = incoming_id or prev_id
        if final_id:
            linked_count += 1
        items[qid] = {
            "fileId": final_id,
            "title": entry["title"],
            "subject": entry["subject"],
            "folder": entry["folder"],
            "filename": entry["filename"],
            "examType": entry["examType"],
            "seq": entry["seq"],
        }

    return {
        "version": 1,
        "generatedAt": dt.date.today().isoformat(),
        "totalEssays": len(catalog),
        "linkedCount": linked_count,
        "items": items,
    }


def _extract_drive_records_from_json(raw_data: Any) -> list[dict[str, str]]:
    """支援 rclone lsjson、Drive API files.list、或自訂 items 陣列／物件格式。"""
    if isinstance(raw_data, dict):
        if isinstance(raw_data.get("files"), list):
            rows = raw_data["files"]
        elif isinstance(raw_data.get("items"), list):
            rows = raw_data["items"]
        elif isinstance(raw_data.get("items"), dict):
            rows = [
                {"questionId": qid, **(val if isinstance(val, dict) else {"fileId": val})}
                for qid, val in raw_data["items"].items()
            ]
        else:
            rows = [
                {"name": key, "id": val}
                for key, val in raw_data.items()
                if isinstance(val, str)
            ]
    elif isinstance(raw_data, list):
        rows = raw_data
    else:
        return []

    records: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("IsDir") is True or row.get("mimeType") == "application/vnd.google-apps.folder":
            continue
        fid = extract_drive_file_id(
            row.get("fileId")
            or row.get("ID")
            or row.get("id")
            or row.get("url")
            or row.get("webViewLink")
            or ""
        )
        if not fid:
            continue
        path_str = str(row.get("Path") or row.get("path") or "").strip()
        name_str = str(row.get("Name") or row.get("name") or row.get("filename") or "").strip()
        folder_str = str(row.get("folder") or row.get("Folder") or "").strip()
        qid_str = str(row.get("questionId") or row.get("question_id") or "").strip()
        if path_str and not name_str:
            name_str = Path(path_str).name
        if path_str and not folder_str and "/" in path_str:
            folder_str = Path(path_str).parent.name
        records.append(
            {
                "fileId": fid,
                "name": name_str,
                "path": path_str,
                "folder": folder_str,
                "questionId": qid_str,
            }
        )
    return records


def match_drive_records_to_catalog(
    records: list[dict[str, str]],
    catalog: list[dict[str, Any]],
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """
    將 Google Drive 檔案清單精準比對至 160 題申論題：
      1. 直接 questionId 比對
      2. folder + filename 完整路徑比對（rclone lsjson -R 最佳模式）
      3. 唯一 filename（或正規化檔名）比對
      4. folder／subject 關鍵字 + 題號前綴（01～24 / 01～20）比對
    """
    by_qid = {entry["id"]: entry for entry in catalog}
    by_folder_file = {(entry["folder"], entry["filename"]): entry for entry in catalog}
    by_folder_norm = {(entry["folder"], _normalize_match_key(entry["filename"])): entry for entry in catalog}
    by_folder_seq = {(entry["folder"], entry["seq"]): entry for entry in catalog}

    by_filename_list: dict[str, list[dict[str, Any]]] = {}
    by_norm_list: dict[str, list[dict[str, Any]]] = {}
    for entry in catalog:
        by_filename_list.setdefault(entry["filename"], []).append(entry)
        by_norm_list.setdefault(_normalize_match_key(entry["filename"]), []).append(entry)

    folder_names = sorted({entry["folder"] for entry in catalog})

    def detect_folder(folder_hint: str, path_hint: str) -> str:
        combined = f"{folder_hint}/{path_hint}"
        for fname in folder_names:
            if fname in combined:
                return fname
        for entry in catalog:
            if entry["subject"] in combined:
                return entry["folder"]
        return ""

    matched: dict[str, str] = {}
    unmatched: list[dict[str, str]] = []

    for rec in records:
        fid = rec["fileId"]
        qid = rec.get("questionId", "")
        if qid and qid in by_qid:
            matched[qid] = fid
            continue

        name = rec.get("name", "")
        path = rec.get("path", "")
        folder = detect_folder(rec.get("folder", ""), path)
        norm_name = _normalize_match_key(name)

        target: dict[str, Any] | None = None
        if folder and (folder, name) in by_folder_file:
            target = by_folder_file[(folder, name)]
        elif folder and (folder, norm_name) in by_folder_norm:
            target = by_folder_norm[(folder, norm_name)]
        elif name in by_filename_list and len(by_filename_list[name]) == 1:
            target = by_filename_list[name][0]
        elif norm_name in by_norm_list and len(by_norm_list[norm_name]) == 1:
            target = by_norm_list[norm_name][0]
        elif folder:
            m_seq = SEQ_PREFIX_RE.match(name)
            if m_seq:
                seq = int(m_seq.group(1))
                target = by_folder_seq.get((folder, seq))

        if target is not None:
            matched[target["id"]] = fid
        else:
            unmatched.append(rec)

    return matched, unmatched


def parse_csv_mappings(csv_path: Path, catalog: list[dict[str, Any]]) -> tuple[dict[str, str], list[dict[str, str]]]:
    """讀取 CSV（無表頭或有表頭皆可），支援 question_id / filename / path + fileId / Drive URL。"""
    records: list[dict[str, str]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = [row for row in csv.reader(f) if any(cell.strip() for cell in row)]
    if not rows:
        return {}, []

    first = [c.strip().lower() for c in rows[0]]
    has_header = any(h in first for h in ("question_id", "questionid", "id", "fileid", "file_id", "filename", "name", "url", "path"))

    if has_header:
        header = first
        data_rows = rows[1:]
        for row in data_rows:
            obj = {header[i]: row[i].strip() if i < len(row) else "" for i in range(len(header))}
            fid = extract_drive_file_id(obj.get("fileid") or obj.get("file_id") or obj.get("url") or obj.get("drive_url") or obj.get("id") or "")
            if not fid:
                continue
            qid = obj.get("question_id") or obj.get("questionid") or ""
            path = obj.get("path") or ""
            name = obj.get("filename") or obj.get("name") or (Path(path).name if path else "")
            folder = obj.get("folder") or (Path(path).parent.name if "/" in path else "")
            records.append({"fileId": fid, "questionId": qid, "name": name, "path": path, "folder": folder})
    else:
        for row in rows:
            if len(row) < 2:
                continue
            left, right = row[0].strip(), row[1].strip()
            fid = extract_drive_file_id(right)
            if not fid:
                continue
            if re.match(r"^(?:20\d\d|public-)", left):
                records.append({"fileId": fid, "questionId": left, "name": "", "path": "", "folder": ""})
            else:
                records.append(
                    {
                        "fileId": fid,
                        "questionId": "",
                        "name": Path(left).name,
                        "path": left,
                        "folder": Path(left).parent.name if "/" in left else "",
                    }
                )
    return match_drive_records_to_catalog(records, catalog)


def write_manifest_atomically(manifest: dict[str, Any], manifest_path: Path) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=".essay-audio-manifest-", suffix=".tmp", dir=str(manifest_path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(serialized)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, manifest_path)
    finally:
        tmp_path.unlink(missing_ok=True)


def format_status_report(catalog: list[dict[str, Any]], manifest: dict[str, Any]) -> str:
    items = manifest.get("items") or {}
    by_folder: dict[str, list[tuple[dict[str, Any], bool]]] = {}
    total_linked = 0
    local_present = 0
    for entry in catalog:
        fid = extract_drive_file_id((items.get(entry["id"]) or {}).get("fileId", ""))
        linked = bool(fid)
        if linked:
            total_linked += 1
        if entry["localExists"]:
            local_present += 1
        by_folder.setdefault(entry["folder"], []).append((entry, linked))

    pct = (total_linked / len(catalog) * 100.0) if catalog else 0.0
    lines = [
        f"申論有聲課 Google Drive 綁定進度：{total_linked} / {len(catalog)} 題（{pct:.1f}%）｜本機已生成 MP3：{local_present} 支",
        "-" * 74,
        f"{'考科資料夾':<36} {'總題數':>6} {'已綁定':>6} {'待綁定':>6}",
        "-" * 74,
    ]
    for folder, entries in by_folder.items():
        done = sum(1 for _, ok in entries if ok)
        lines.append(f"{folder:<36} {len(entries):>6} {done:>6} {len(entries) - done:>6}")
    lines.append("-" * 74)
    return "\n".join(lines)


def run_interactive_paste(catalog: list[dict[str, Any]]) -> tuple[dict[str, str], list[dict[str, str]]]:
    print("互動式匯入模式：請逐行貼上「題號或檔名, Google Drive 分享網址或 fileId」（輸入空行結束）：")
    print("  範例 1：2021-1-0401-E1, https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view")
    print("  範例 2：01-任務中心取向提供服務對社會工作責信有何意義.mp3, 1AbCdEfGhIjKlMnOpQr")
    lines: list[str] = []
    while True:
        try:
            line = input().strip()
        except EOFError:
            break
        if not line:
            break
        lines.append(line)
    if not lines:
        return {}, []
    with tempfile.NamedTemporaryFile("w", suffix=".csv", encoding="utf-8", delete=False) as tf:
        tf.write("\n".join(lines) + "\n")
        tmp_csv = Path(tf.name)
    try:
        return parse_csv_mappings(tmp_csv, catalog)
    finally:
        tmp_csv.unlink(missing_ok=True)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="將本機 160 支申論名師有聲課 MP3 與 Google 雲端硬碟檔案 ID 配對，生成 essay-audio-manifest.json。"
    )
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS_PATH, help="questions.json 路徑")
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR, help="本機 MP3 課程根目錄")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH, help="輸出 manifest 路徑")
    parser.add_argument("--init", action="store_true", help="模式 B：建立或補齊全部 160 題骨架（保留既有 fileId）")
    parser.add_argument("--from-json", type=Path, default=None, help="模式 A：匯入 rclone lsjson 或 Drive API JSON 清單")
    parser.add_argument("--from-csv", type=Path, default=None, help="模式 B：匯入 CSV（題號／檔名＋fileId／分享連結）")
    parser.add_argument("--interactive", action="store_true", help="模式 B：互動式貼上題號／檔名與 Drive 連結")
    parser.add_argument("--force-reset", action="store_true", help="忽略既有 fileId，完全以本次輸入重建")
    parser.add_argument("--status", action="store_true", help="僅顯示目前 7 科 160 題綁定覆蓋率，不寫入檔案")
    parser.add_argument("--dry-run", action="store_true", help="僅預覽比對結果，不寫入 manifest 檔案")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    questions_path = args.questions.expanduser().resolve()
    if not questions_path.exists():
        print(f"找不到題庫檔案：{questions_path}", file=sys.stderr)
        return 1

    audio_dir = args.audio_dir.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    questions = json.loads(questions_path.read_text(encoding="utf-8"))
    catalog = build_essay_catalog(questions, audio_dir=audio_dir)
    existing = load_existing_manifest(manifest_path)

    if args.status and not (args.init or args.from_json or args.from_csv or args.interactive):
        print(format_status_report(catalog, existing))
        return 0

    incoming_map: dict[str, str] = {}
    unmatched: list[dict[str, str]] = []

    if args.from_json is not None:
        json_path = args.from_json.expanduser().resolve()
        if not json_path.exists():
            print(f"找不到 Drive JSON 檔案：{json_path}", file=sys.stderr)
            return 1
        raw_data = json.loads(json_path.read_text(encoding="utf-8"))
        records = _extract_drive_records_from_json(raw_data)
        matched, unmatched = match_drive_records_to_catalog(records, catalog)
        incoming_map.update(matched)
        print(f"自 JSON 讀取 {len(records)} 筆雲端檔案，成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif args.from_csv is not None:
        csv_path = args.from_csv.expanduser().resolve()
        if not csv_path.exists():
            print(f"找不到 CSV 檔案：{csv_path}", file=sys.stderr)
            return 1
        matched, unmatched = parse_csv_mappings(csv_path, catalog)
        incoming_map.update(matched)
        print(f"自 CSV 成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif args.interactive:
        matched, unmatched = run_interactive_paste(catalog)
        incoming_map.update(matched)
        print(f"互動匯入成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif not args.init:
        print(format_status_report(catalog, existing))
        print("提示：請加上 --init、--from-json <檔案>、--from-csv <檔案> 或 --interactive 進行更新。")
        return 0

    if unmatched:
        print("以下雲端檔案未自動對應到題目（可改以 CSV 補齊）：")
        for rec in unmatched[:10]:
            print(f"  - {rec.get('path') or rec.get('name') or rec.get('questionId')} (id={rec['fileId']})")
        if len(unmatched) > 10:
            print(f"  ...（其餘 {len(unmatched) - 10} 筆省略）")

    manifest = build_manifest_document(
        catalog,
        incoming_map,
        existing_manifest=existing,
        preserve_existing=not args.force_reset,
    )
    print(format_status_report(catalog, manifest))

    if args.dry_run:
        print(f"[DRY-RUN] 未寫入檔案（目標：{manifest_path}）。")
        return 0

    write_manifest_atomically(manifest, manifest_path)
    print(f"✓ 已原子寫入對照表：{manifest_path}（已綁定 {manifest['linkedCount']} / {manifest['totalEssays']} 題）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
