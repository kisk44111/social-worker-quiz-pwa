#!/usr/bin/env python3
"""
申論名師有聲課 MP3 雲端對照表生成器（essay-audio-manifest.json）。

支援雙軌高速託管與對照：
  1. GitHub Releases 永久直連 CDN（最推薦、免 API Key、iPhone Safari 載入最快）：
     - `--upload-github-release audio-v1`：將本機 160 支 MP3 重命名為純 ASCII 檔名
       （`01-01.mp3`～`07-20.mp3`，避免中文 URL 編碼問題）批次上傳至 GitHub Release，
       並自動寫入每題 `directUrl`。
     - `--from-github-release audio-v1`：讀取既有 GitHub Release 資產清單，自動比對並寫入 `directUrl`。
  2. Google 雲端硬碟（支援 Drive API v3 官方媒體串流端點＋備援網址）：
     - `--from-json <drive_list.json>`：匯入 `rclone lsjson -R` 或 Drive API JSON 清單。
     - `--from-csv <mapping.csv>`／`--interactive`／`--init`：匯入 CSV、互動貼上或初始化骨架。
     - `--drive-api-key <key>`：可選填受網域限制的 Google Drive API v3 唯讀金鑰（供官方 `alt=media` 端點使用）。

安全規範：
  本腳本不讀取亦不儲存任何 Google OAuth 憑證或個人私密 Token；所有敏感檔名亦已排除於 `.gitignore`。
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import datetime as dt
import json
import os
import re
import shutil
import subprocess
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
RELEASE_ASSET_RE = re.compile(r"^(\d{2})-(\d{2})\.mp3$", re.IGNORECASE)


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


def extract_folder_index(folder_name: str) -> str:
    m = re.match(r"^(\d{1,2})[-_]", str(folder_name or "").strip())
    if not m:
        return "00"
    return f"{int(m.group(1)):02d}"


def build_release_asset_name(folder_name: str, seq: int) -> str:
    """產生純 ASCII、無中文 URL 編碼問題的 GitHub Release 資產檔名（例如 01-01.mp3 ～ 07-20.mp3）。"""
    return f"{extract_folder_index(folder_name)}-{int(seq):02d}.mp3"


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
                "assetName": build_release_asset_name(folder, seq),
                "title": title,
                "localPath": local_path,
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
    file_id_map: dict[str, str] | None = None,
    direct_url_map: dict[str, str] | None = None,
    existing_manifest: dict[str, Any] | None = None,
    preserve_existing: bool = True,
    drive_api_key: str | None = None,
) -> dict[str, Any]:
    """組裝標準化的 essay-audio-manifest.json 結構（同時支援 directUrl 與 Google Drive fileId）。"""
    existing = existing_manifest or {}
    existing_items = existing.get("items") or {}
    incoming_ids = file_id_map or {}
    incoming_urls = direct_url_map or {}
    items: dict[str, dict[str, Any]] = {}
    linked_drive = 0
    linked_direct = 0

    for entry in catalog:
        qid = entry["id"]
        prev_item = existing_items.get(qid) if (preserve_existing and isinstance(existing_items.get(qid), dict)) else {}

        incoming_id = extract_drive_file_id(incoming_ids.get(qid, ""))
        prev_id = extract_drive_file_id(prev_item.get("fileId", ""))
        final_id = incoming_id or prev_id
        if final_id:
            linked_drive += 1

        incoming_url = str(incoming_urls.get(qid) or "").strip()
        prev_url = str(prev_item.get("directUrl") or "").strip()
        final_url = incoming_url or prev_url
        if final_url:
            linked_direct += 1

        item_obj: dict[str, Any] = {
            "directUrl": final_url,
            "fileId": final_id,
            "title": entry["title"],
            "subject": entry["subject"],
            "folder": entry["folder"],
            "filename": entry["filename"],
            "assetName": entry["assetName"],
            "examType": entry["examType"],
            "seq": entry["seq"],
        }
        items[qid] = item_obj

    doc: dict[str, Any] = {
        "version": 1,
        "generatedAt": dt.date.today().isoformat(),
        "totalEssays": len(catalog),
        "linkedCount": sum(1 for item in items.values() if item["directUrl"] or item["fileId"]),
        "directUrlCount": linked_direct,
        "driveFileIdCount": linked_drive,
    }

    resolved_api_key = (
        drive_api_key.strip()
        if drive_api_key is not None
        else (str(existing.get("driveApiKey") or "").strip() if preserve_existing else "")
    )
    if resolved_api_key:
        doc["driveApiKey"] = resolved_api_key

    doc["items"] = items
    return doc


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
    """將 Google Drive 檔案清單精準比對至 160 題申論題。"""
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


def match_release_assets_to_catalog(
    assets: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
) -> tuple[dict[str, str], list[str]]:
    """將 GitHub Release 資產清單（01-01.mp3～07-20.mp3 或原始檔名）精準配對為 directUrl。"""
    by_asset = {entry["assetName"].lower(): entry for entry in catalog}
    by_folder_idx_seq = {(extract_folder_index(entry["folder"]), entry["seq"]): entry for entry in catalog}
    by_filename = {entry["filename"]: entry for entry in catalog}

    matched: dict[str, str] = {}
    unmatched: list[str] = []

    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").strip()
        url = str(asset.get("url") or asset.get("browser_download_url") or "").strip()
        if not name or not url:
            continue

        target = by_asset.get(name.lower())
        if target is None:
            m = RELEASE_ASSET_RE.match(name)
            if m:
                target = by_folder_idx_seq.get((m.group(1), int(m.group(2))))
        if target is None:
            target = by_filename.get(name)

        if target is not None:
            matched[target["id"]] = url
        else:
            unmatched.append(name)

    return matched, unmatched


def fetch_github_release_assets(tag: str, repo: str | None = None) -> list[dict[str, Any]]:
    """透過本機 gh CLI 讀取指定 GitHub Release 之資產清單與永久下載網址。"""
    gh_bin = shutil.which("gh")
    if not gh_bin:
        raise RuntimeError("找不到 gh CLI，請先安裝 GitHub CLI（brew install gh）並執行 gh auth login。")
    cmd = [gh_bin, "release", "view", tag, "--json", "assets"]
    if repo:
        cmd.extend(["--repo", repo])
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"讀取 GitHub Release `{tag}` 失敗：{proc.stderr.strip() or proc.stdout.strip()}")
    data = json.loads(proc.stdout or "{}")
    return data.get("assets") or []


def upload_catalog_to_github_release(
    catalog: list[dict[str, Any]],
    tag: str,
    repo: str | None = None,
    concurrency: int = 4,
) -> list[dict[str, Any]]:
    """
    將本機 160 支 MP3 重命名為純 ASCII（01-01.mp3～07-20.mp3）並批次上傳至 GitHub Release：
    - 若 Release 不存在則自動建立。
    - 已存在且檔案大小一致的資產自動略過（支援斷點續傳）。
    - 上傳完成後回傳最新 Release 資產清單（含永久直連下載網址）。
    """
    gh_bin = shutil.which("gh")
    if not gh_bin:
        raise RuntimeError("找不到 gh CLI，請先安裝 GitHub CLI（brew install gh）並執行 gh auth login。")

    missing_local = [entry for entry in catalog if not entry["localExists"]]
    if missing_local:
        raise FileNotFoundError(
            f"本機缺少 {len(missing_local)} 支 MP3（例如 {missing_local[0]['localPath']}），請先確認本地音檔完整。"
        )

    repo_args = ["--repo", repo] if repo else []
    check_proc = subprocess.run(
        [gh_bin, "release", "view", tag, *repo_args, "--json", "assets"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    existing_assets: dict[str, int] = {}
    if check_proc.returncode == 0:
        data = json.loads(check_proc.stdout or "{}")
        for asset in data.get("assets") or []:
            existing_assets[str(asset.get("name") or "")] = int(asset.get("size") or 0)
        print(f"已偵測到既有 GitHub Release `{tag}`（目前已有 {len(existing_assets)} 個資產）。", flush=True)
    else:
        print(f"建立 GitHub Release `{tag}` ...", flush=True)
        create_proc = subprocess.run(
            [
                gh_bin,
                "release",
                "create",
                tag,
                *repo_args,
                "--title",
                f"2027 社工師國考申論名師有聲課 MP3（{tag}）",
                "--notes",
                "全 7 科 160 題台灣老師清爽知性申論解題有聲課 MP3（01-01.mp3 ～ 07-20.mp3），供 PWA 永久高速串流播放。",
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if create_proc.returncode != 0:
            raise RuntimeError(f"建立 Release `{tag}` 失敗：{create_proc.stderr.strip() or create_proc.stdout.strip()}")
        print(f"✓ 已建立 GitHub Release `{tag}`。", flush=True)

    pending: list[dict[str, Any]] = []
    skipped = 0
    for entry in catalog:
        asset_name = entry["assetName"]
        local_size = entry["localPath"].stat().st_size
        if existing_assets.get(asset_name) == local_size:
            skipped += 1
        else:
            pending.append(entry)

    print(
        f"準備上傳至 GitHub Release `{tag}`：待上傳 {len(pending)} 支、略過已存在 {skipped} 支（合計 {len(catalog)} 支）。",
        flush=True,
    )

    if pending:
        with tempfile.TemporaryDirectory(prefix="swq-gh-release-") as tmp_str:
            tmp_dir = Path(tmp_str)
            staged: list[tuple[dict[str, Any], Path]] = []
            for entry in pending:
                staged_path = tmp_dir / entry["assetName"]
                os.symlink(entry["localPath"], staged_path)
                staged.append((entry, staged_path))

            def _upload_one(item: tuple[dict[str, Any], Path]) -> str:
                entry, staged_path = item
                last_err = ""
                for attempt in range(1, 4):
                    proc = subprocess.run(
                        [gh_bin, "release", "upload", tag, str(staged_path), "--clobber", *repo_args],
                        cwd=str(REPO_ROOT),
                        capture_output=True,
                        text=True,
                    )
                    if proc.returncode == 0:
                        return entry["assetName"]
                    last_err = proc.stderr.strip() or proc.stdout.strip()
                raise RuntimeError(f"上傳 {entry['assetName']} 失敗：{last_err}")

            done = 0
            max_workers = max(1, min(6, int(concurrency)))
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = [pool.submit(_upload_one, item) for item in staged]
                for fut in as_completed(futures):
                    uploaded_name = fut.result()
                    done += 1
                    if done % 10 == 0 or done == len(staged):
                        print(f"  ↑ 已上傳 {done}/{len(staged)}（最新：{uploaded_name}）", flush=True)

    return fetch_github_release_assets(tag, repo=repo)


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
        for row in rows[1:]:
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
    by_folder: dict[str, list[tuple[bool, bool]]] = {}
    total_direct = 0
    total_drive = 0
    local_present = 0
    for entry in catalog:
        item = items.get(entry["id"]) or {}
        has_direct = bool(str(item.get("directUrl") or "").strip())
        has_drive = bool(extract_drive_file_id(item.get("fileId", "")))
        if has_direct:
            total_direct += 1
        if has_drive:
            total_drive += 1
        if entry["localExists"]:
            local_present += 1
        by_folder.setdefault(entry["folder"], []).append((has_direct, has_drive))

    total = len(catalog)
    lines = [
        f"申論有聲課雲端綁定進度｜永久直連 CDN（directUrl）：{total_direct}/{total}｜Google Drive（fileId）：{total_drive}/{total}｜本機 MP3：{local_present} 支",
        "-" * 82,
        f"{'考科資料夾':<36} {'總題數':>6} {'直連CDN':>8} {'DriveID':>8}",
        "-" * 82,
    ]
    for folder, flags in by_folder.items():
        d_ok = sum(1 for has_d, _ in flags if has_d)
        g_ok = sum(1 for _, has_g in flags if has_g)
        lines.append(f"{folder:<36} {len(flags):>6} {d_ok:>8} {g_ok:>8}")
    lines.append("-" * 82)
    return "\n".join(lines)


def run_interactive_paste(catalog: list[dict[str, Any]]) -> tuple[dict[str, str], list[dict[str, str]]]:
    print("互動式匯入模式：請逐行貼上「題號或檔名, Google Drive 分享網址或 fileId」（輸入空行結束）：")
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
        description="將本機 160 支申論名師有聲課 MP3 與 GitHub Releases CDN 或 Google Drive 配對，生成 essay-audio-manifest.json。"
    )
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS_PATH, help="questions.json 路徑")
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR, help="本機 MP3 課程根目錄")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH, help="輸出 manifest 路徑")
    parser.add_argument("--init", action="store_true", help="建立或補齊全部 160 題骨架（保留既有連結）")
    parser.add_argument("--from-github-release", type=str, default=None, help="讀取指定 GitHub Release（如 audio-v1）資產網址並寫入 directUrl")
    parser.add_argument("--upload-github-release", type=str, default=None, help="一鍵建立並上傳 160 支 MP3（01-01.mp3～07-20.mp3）至 GitHub Release 並寫入 directUrl")
    parser.add_argument("--github-repo", type=str, default=None, help="指定 GitHub Repo（如 owner/repo，預設自動偵測目前儲存庫）")
    parser.add_argument("--upload-concurrency", type=int, default=4, help="GitHub Release 上傳並行數（預設 4）")
    parser.add_argument("--from-json", type=Path, default=None, help="匯入 rclone lsjson 或 Drive API JSON 清單")
    parser.add_argument("--from-csv", type=Path, default=None, help="匯入 CSV（題號／檔名＋fileId／分享連結）")
    parser.add_argument("--drive-api-key", type=str, default=None, help="選填：設定受網域限制之 Google Drive API v3 唯讀金鑰")
    parser.add_argument("--interactive", action="store_true", help="互動式貼上題號／檔名與 Drive 連結")
    parser.add_argument("--force-reset", action="store_true", help="忽略既有連結，完全以本次輸入重建")
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

    has_write_action = any(
        [
            args.init,
            args.from_github_release,
            args.upload_github_release,
            args.from_json,
            args.from_csv,
            args.interactive,
            args.drive_api_key is not None,
        ]
    )
    if args.status and not has_write_action:
        print(format_status_report(catalog, existing))
        return 0

    incoming_ids: dict[str, str] = {}
    incoming_urls: dict[str, str] = {}
    unmatched_notes: list[str] = []

    if args.upload_github_release:
        if args.dry_run:
            print(f"[DRY-RUN] 預計將 {len(catalog)} 支 MP3 以 01-01.mp3～07-20.mp3 上傳至 Release `{args.upload_github_release}`。")
            return 0
        assets = upload_catalog_to_github_release(
            catalog,
            tag=args.upload_github_release,
            repo=args.github_repo,
            concurrency=args.upload_concurrency,
        )
        matched_urls, unmatched_assets = match_release_assets_to_catalog(assets, catalog)
        incoming_urls.update(matched_urls)
        unmatched_notes.extend(unmatched_assets)
        print(f"自 GitHub Release `{args.upload_github_release}` 成功綁定 {len(matched_urls)} 題永久直連 CDN 網址。")
    elif args.from_github_release:
        assets = fetch_github_release_assets(args.from_github_release, repo=args.github_repo)
        matched_urls, unmatched_assets = match_release_assets_to_catalog(assets, catalog)
        incoming_urls.update(matched_urls)
        unmatched_notes.extend(unmatched_assets)
        print(f"自 GitHub Release `{args.from_github_release}` 成功比對 {len(matched_urls)} 題永久直連 CDN 網址。")

    if args.from_json is not None:
        json_path = args.from_json.expanduser().resolve()
        if not json_path.exists():
            print(f"找不到 Drive JSON 檔案：{json_path}", file=sys.stderr)
            return 1
        raw_data = json.loads(json_path.read_text(encoding="utf-8"))
        records = _extract_drive_records_from_json(raw_data)
        matched, unmatched = match_drive_records_to_catalog(records, catalog)
        incoming_ids.update(matched)
        unmatched_notes.extend(r.get("path") or r.get("name") or r["fileId"] for r in unmatched)
        print(f"自 JSON 讀取 {len(records)} 筆雲端檔案，成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif args.from_csv is not None:
        csv_path = args.from_csv.expanduser().resolve()
        if not csv_path.exists():
            print(f"找不到 CSV 檔案：{csv_path}", file=sys.stderr)
            return 1
        matched, unmatched = parse_csv_mappings(csv_path, catalog)
        incoming_ids.update(matched)
        unmatched_notes.extend(r.get("path") or r.get("name") or r["fileId"] for r in unmatched)
        print(f"自 CSV 成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif args.interactive:
        matched, unmatched = run_interactive_paste(catalog)
        incoming_ids.update(matched)
        unmatched_notes.extend(r.get("path") or r.get("name") or r["fileId"] for r in unmatched)
        print(f"互動匯入成功比對 {len(matched)} 題（未比對 {len(unmatched)} 筆）。")
    elif not has_write_action:
        print(format_status_report(catalog, existing))
        print("提示：請加上 --upload-github-release audio-v1、--from-github-release audio-v1、--from-json 或 --from-csv。")
        return 0

    if unmatched_notes:
        print(f"未自動比對的項目（共 {len(unmatched_notes)} 筆，前 10 筆）：")
        for note in unmatched_notes[:10]:
            print(f"  - {note}")

    manifest = build_manifest_document(
        catalog,
        file_id_map=incoming_ids,
        direct_url_map=incoming_urls,
        existing_manifest=existing,
        preserve_existing=not args.force_reset,
        drive_api_key=args.drive_api_key,
    )
    print(format_status_report(catalog, manifest))

    if args.dry_run:
        print(f"[DRY-RUN] 未寫入檔案（目標：{manifest_path}）。")
        return 0

    write_manifest_atomically(manifest, manifest_path)
    print(
        f"✓ 已原子寫入對照表：{manifest_path}"
        f"（directUrl：{manifest['directUrlCount']}/{manifest['totalEssays']}｜Drive fileId：{manifest['driveFileIdCount']}/{manifest['totalEssays']}）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
