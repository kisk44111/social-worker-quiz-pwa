#!/usr/bin/env python3
"""Rebuild multiple-choice explanations with option-specific comparisons."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "questions.json"
LETTERS = "ABCD"
REVERSE_WORDS = re.compile(r"錯誤|不正確|不適當|不包括|不包含|何者非|何者不是|除外|最不|不符合")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def short(text: str, limit: int = 110) -> str:
    value = clean(text)
    return value if len(value) <= limit else value[: limit - 1] + "…"


def reverse_correction(option: str) -> str:
    """Produce a concrete, conservative correction for a false statement."""
    rules = (
        (r"^僅", "不應僅"), (r"^只", "不應只"), (r"^所有", "並非所有"),
        (r"^任何", "並非任何"), (r"^一律", "不宜一律"), (r"^完全", "並非完全"),
        (r"^必須", "不一定必須"), (r"^不需", "仍需"), (r"^不須", "仍須"),
        (r"^不會", "仍可能"), (r"^不能", "不一定不能"), (r"^無法", "並非無法"),
    )
    for pattern, replacement in rules:
        if re.search(pattern, option):
            return re.sub(pattern, replacement, option, count=1)

    replacements = (
        ("初始即為", "初始並非"), ("一開始即為", "一開始並非"),
        ("只要", "不能只以"), ("皆為", "不必然皆為"), ("均為", "不必然均為"),
        ("都是", "不一定都是"), ("就是", "不宜直接等同於"), ("即為", "不宜直接等同於"),
        ("完全", "不一定完全"), ("必然", "不必然"), ("一定", "不一定"),
        ("僅有", "不僅有"), ("僅限", "不限於"), ("不需要", "仍需要"),
        ("不可以", "不一定不可以"), ("不得", "並非一概不得"),
    )
    for old, new in replacements:
        if old in option:
            return option.replace(old, new, 1)

    if "是" in option:
        return option.replace("是", "不宜逕行認定是", 1)
    return f"不能逕以「{option}」作為正確敘述；應刪除此主張，改採該概念在教材或法規中的正確定義。"


def option_analysis(question: dict, index: int, is_reverse: bool) -> str:
    letter = LETTERS[index]
    option = clean(question["options"][index])
    answer_letter = question["answer"]
    answer_index = LETTERS.index(answer_letter)
    answer_text = clean(question["options"][answer_index])
    clue = short(question["prompt"])

    if not is_reverse:
        if letter == answer_letter:
            return (
                f'{letter}「{option}」：應選。題幹要求判斷「{clue}」，考選部標準答案為 {answer_letter}。'
                f'也就是本題所描述的人物、制度、角色、方法或效果，應對應「{answer_text}」，因此本項無須修改。'
            )
        return (
            f'{letter}「{option}」：不選。這一項把題幹所問的答案判成「{option}」，但考選部標準答案指向「{answer_text}」。'
            f'兩者在本題不能互換；若要讓本項成為符合題意的敘述，應將「{option}」改為「{answer_text}」。'
        )

    if letter != answer_letter:
        return (
            f'{letter}「{option}」：不選。這是反向題，須找錯誤或不符合者；考選部並未將本項列為錯誤答案。'
            f'因此在本題設定下「{option}」屬可成立的敘述，不需要改寫，不能因題目出現否定詞而誤選。'
        )
    correction = reverse_correction(option)
    return (
        f'{letter}「{option}」：應選。題目要找錯誤或不符合者，而考選部標準答案正是 {answer_letter}。'
        f'原句的關鍵判斷與標準答案不符，常見問題是錯誤歸屬、範圍過大或把非必然關係說成必然。正確改寫方向為：「{correction}」；'
        f'複習時仍應依該年度教材或法規確認完整定義。'
    )


def rebuild(question: dict) -> str:
    prompt = clean(question["prompt"])
    is_reverse = bool(REVERSE_WORDS.search(prompt))
    answer_index = LETTERS.index(question["answer"])
    answer_text = clean(question["options"][answer_index])
    direction = "錯誤／例外選項" if is_reverse else "最符合題意的選項"
    analyses = "\n".join(option_analysis(question, i, is_reverse) for i in range(len(question["options"])))
    return f"""【題型辨識】
本題是{'反向題' if is_reverse else '正向題'}，作答目標是找出{direction}。先圈出題幹的否定詞與限定條件，再逐項核對，避免把「知道哪一項正確」與「題目實際要選哪一項」混為一談。

【核心判斷】
題幹問的是：「{short(prompt, 180)}」考選部標準答案為 {question['answer']}「{answer_text}」。判斷時應以完整題意及官方答案為準，不能只因某個選項看起來熟悉就作答。

【正確答案與理由】
答案為 {question['answer']}「{answer_text}」。{'因為本題要求選出錯誤敘述，所以此項是需要被挑出的錯誤／例外，而其他選項在本題脈絡中可成立。' if is_reverse else '此項是考選部標準答案所認定最符合題幹者；其他選項即使各自是相關概念，也不能取代本項回答這一題。'}

【選項逐項解析】
{analyses}

【複習結論】
本題應記住的對照是：題幹「{short(prompt, 90)}」→ 答案 {question['answer']}「{answer_text}」。重做時先判斷正向或反向，再逐項說出「為何選／不選」及「錯項應改成什麼」，不要只背答案字母。"""


def main() -> None:
    questions = json.loads(DATA.read_text(encoding="utf-8"))
    count = 0
    for question in questions:
        if question.get("type") != "multipleChoice":
            continue
        question["explanation"] = rebuild(question)
        count += 1
    DATA.write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Updated {count} multiple-choice explanations")


if __name__ == "__main__":
    main()
