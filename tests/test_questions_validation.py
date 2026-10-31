import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("validate_questions", "tools/validate_questions.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def mc(identifier="2026-1-0301-M1", number=1):
    return {"id": identifier, "year": 2026, "session": 1, "subject": "社會工作", "number": number,
            "type": "multipleChoice", "prompt": "題目", "options": ["甲", "乙", "丙", "丁"], "answer": "A",
            "questionPDF": "source.pdf", "answerPDF": "answer.pdf", "explanation": "詳解"}


class QuestionValidationTests(unittest.TestCase):
    def test_valid_question_bank(self):
        self.assertEqual(validator.validate_questions([mc()]), [])

    def test_duplicate_id_is_rejected(self):
        errors = validator.validate_questions([mc(), mc()])
        self.assertTrue(any("id 重複" in error for error in errors))

    def test_invalid_choice_answer_and_number_are_rejected(self):
        question = mc(); question["answer"] = "E"; question["options"] = ["甲"]
        errors = validator.validate_questions([question])
        self.assertTrue(any("四個" in error for error in errors))
        self.assertTrue(any("A、B、C 或 D" in error for error in errors))

    def test_invalid_subject_is_rejected(self):
        question = mc(); question["subject"] = "不存在的科目"
        self.assertTrue(any("白名單" in error for error in validator.validate_questions([question])))

    def test_essay_requires_reference_answer(self):
        question = mc("2026-1-0301-E1"); question.update({"type": "essay", "options": [], "answer": None}); question.pop("referenceAnswer", None)
        self.assertTrue(any("referenceAnswer" in error for error in validator.validate_questions([question])))


if __name__ == "__main__":
    unittest.main()
