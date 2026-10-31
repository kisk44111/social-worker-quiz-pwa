#!/usr/bin/env python3
"""Add clearly-labelled non-official writing frameworks to 115-2 essays."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
FOCUS = {
    "社會工作": ["危機介入、需求評估、創傷知情與通報責任", "外展工作、優勢觀點、青少年參與及社區組織"],
    "社會工作直接服務": ["個案／團體／社區直接服務的評估、目標與處遇程序", "專業關係、倫理界線、跨網絡合作與服務成效"],
    "社會政策與社會立法": ["政策或行政法的概念、法源依據、權利影響與救濟", "福利制度目的、執行機制、資源公平與改革配套"],
    "人類行為與社會環境": ["生命歷程、發展理論、風險與保護因子的整合分析", "人在情境中的系統觀點、文化差異與支持系統"],
    "社會工作研究方法": ["研究問題、設計、抽樣、資料蒐集與倫理", "量化／質性分析、信效度或可信性與研究限制"],
}


def framework(prompt, focus):
    return f"""【非官方作答架構｜僅供練習】
本題依考選部正式試題整理；考選部未公布申論標準答案，以下不是官方擬答或評分標準。

【起｜界定問題】
先摘述題幹的服務對象、情境與作答動詞，界定「{focus}」的核心概念；避免只重述題目。

【承｜分點論證】
可依「概念／理論或法規依據 → 題幹事實判斷 → 具體作法 → 預期效果」逐點回應。對照本題小問，至少說明評估面向、處遇或制度安排、資源連結及紀錄／評估方式。

【轉｜倫理與限制】
補充自決、知情同意、保密與例外、文化敏感、資源差異及跨專業協作；若為法規或政策題，並檢核權限、程序、比例與救濟。

【合｜結論】
逐項回扣題幹，提出兼顧服務對象權益、可執行性與專業責信的結論。

※請以考試當年度有效法規、教材及教師指導校正內容。"""


def main():
    questions = json.loads(DATA.read_text(encoding="utf-8"))
    changed = 0
    for question in questions:
        if question.get("year") != 2026 or question.get("session") != 2 or question.get("type") != "essay":
            continue
        focus = FOCUS[question["subject"]][question["number"] - 1]
        question["explanation"] = framework(question["prompt"], focus)
        question["referenceAnswer"] = "【非官方提示】本題提供的是作答架構，不是考選部參考答案。請先依上方「起、承、轉、合」完成自己的擬答，再對照教材與授課教師建議修訂。"
        question["aiContent"] = {"kind": "nonOfficialWritingFramework", "generatedAt": "2026-10-31", "limitations": "非考選部官方答案；不得作為法規或評分依據。"}
        changed += 1
    if changed != 10:
        raise SystemExit(f"預期更新 10 題，實際 {changed} 題")
    DATA.write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"已加入 {changed} 題非官方申論作答架構。")


if __name__ == "__main__":
    main()
