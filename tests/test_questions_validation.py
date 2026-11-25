import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("validate_questions", "tools/validate_questions.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

gen_spec = importlib.util.spec_from_file_location("generate_essay_answers", "tools/generate_essay_answers.py")
essay_gen = importlib.util.module_from_spec(gen_spec)
gen_spec.loader.exec_module(essay_gen)


def mc(identifier="2026-1-0301-M1", number=1):
    return {"id": identifier, "year": 2026, "session": 1, "subject": "社會工作", "number": number,
            "type": "multipleChoice", "prompt": "題目", "options": ["甲", "乙", "丙", "丁"], "answer": "A",
            "questionPDF": "source.pdf", "answerPDF": "answer.pdf", "explanation": "詳解"}


def sample_essay(identifier="2026-1-0301-E1", number=1):
    return {"id": identifier, "year": 2026, "session": 1, "subject": "社會工作", "number": number,
            "type": "essay", "prompt": "試論述社工專業倫理兩難之處理原則。", "options": [], "answer": None,
            "questionPDF": "source.pdf", "answerPDF": None, "explanation": "擬答方向", "referenceAnswer": "參考答案"}


def valid_essay_guide():
    return {
        "modelAnswer": {
            "qi": {"title": "破題與核心概念界定", "content": "社會工作倫理兩難源於多重價值與責任之衝突，作答首須界定專業倫理核心。"},
            "cheng": {"title": "理論依據與法規政策剖析", "content": "可援引 Reamer 倫理決策步驟與 Lowenberg 及 Dolgoff 倫理原則篩檢架構分析。"},
            "zhuan": {"title": "實務應用、困境與批判反思", "content": "於臺灣保護性業務實務中，須兼顧案主自決、保密界線、法定通報義務與督導支持。"},
            "he": {"title": "總結與具體建議展望", "content": "綜上，應以倫理守則、法令規範與跨專業督導機制建構可檢視之專業責信。"},
        },
        "analysis": {
            "focusAndTraps": ["聚焦價值衝突排序與決策流程", "避免僅憑個人道德直覺作答而未援引專業守則"],
            "theoriesAndLaws": ["Reamer 倫理決策步驟", "Lowenberg & Dolgoff 倫理原則篩檢", "社會工作師倫理守則"],
            "scoringRubric": ["【起】約 15%：明確界定倫理兩難與核心價值", "【承】約 35%：清楚鋪陳理論與法源", "【轉】約 35%：連結臺灣實務與限制", "【合】約 15%：提出具體配套"],
        },
    }


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

    def test_structured_essay_guide_validation(self):
        question = sample_essay()
        question["essayGuide"] = valid_essay_guide()
        self.assertEqual(validator.validate_questions([question]), [])

        bad_stage = sample_essay()
        bad_stage["essayGuide"] = valid_essay_guide()
        bad_stage["essayGuide"]["modelAnswer"]["zhuan"]["content"] = "   "
        self.assertTrue(any("essayGuide.modelAnswer.zhuan" in error for error in validator.validate_questions([bad_stage])))

        bad_analysis = sample_essay()
        bad_analysis["essayGuide"] = valid_essay_guide()
        bad_analysis["essayGuide"]["analysis"]["theoriesAndLaws"] = []
        self.assertTrue(any("essayGuide.analysis.theoriesAndLaws" in error for error in validator.validate_questions([bad_analysis])))

        wrong_type = mc()
        wrong_type["essayGuide"] = valid_essay_guide()
        self.assertTrue(any("只有申論題可包含 essayGuide" in error for error in validator.validate_questions([wrong_type])))

    def test_essay_generator_status_export_and_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            data_path = tmp_dir / "questions.json"
            checkpoint_path = tmp_dir / ".checkpoint.json"
            export_path = tmp_dir / "batch.md"
            import_path = tmp_dir / "gemini-response.md"
            data_path.write_text(json.dumps([sample_essay()], ensure_ascii=False), encoding="utf-8")

            # Check --status report before import
            report_before = essay_gen.format_status_report(json.loads(data_path.read_text(encoding="utf-8")))
            self.assertIn("已完成 0 / 1 題", report_before)
            self.assertIn("社會工作", report_before)
            self.assertEqual(essay_gen.main(["--data", str(data_path), "--status"]), 0)

            # Export batch Markdown task pack
            rc = essay_gen.main(["--data", str(data_path), "--export-batch", "--limit", "1", "--out", str(export_path)])
            self.assertEqual(rc, 0)
            exported = export_path.read_text(encoding="utf-8")
            self.assertIn("2026-1-0301-E1", exported)
            self.assertIn("focusAndTraps", exported)

            # Import Markdown-fenced JSON pasted from Gemini Pro
            fenced = "以下為生成結果：\n```json\n" + json.dumps([{"id": "2026-1-0301-E1", **valid_essay_guide()}], ensure_ascii=False) + "\n```\n"
            import_path.write_text(fenced, encoding="utf-8")

            # Dry-run import validates without mutating questions.json
            before = data_path.read_text(encoding="utf-8")
            rc = essay_gen.main(["--data", str(data_path), "--checkpoint", str(checkpoint_path), "--import-json", str(import_path), "--dry-run"])
            self.assertEqual(rc, 0)
            self.assertEqual(data_path.read_text(encoding="utf-8"), before)

            # Real import validates and atomically writes questions.json + checkpoint
            rc = essay_gen.main(["--data", str(data_path), "--checkpoint", str(checkpoint_path), "--import-json", str(import_path)])
            self.assertEqual(rc, 0)
            saved = json.loads(data_path.read_text(encoding="utf-8"))
            self.assertIn("essayGuide", saved[0])
            self.assertEqual(saved[0]["essayGuide"]["modelAnswer"]["qi"]["title"], "破題與核心概念界定")
            self.assertEqual(saved[0]["aiContent"]["kind"], "nonOfficialEssayAnswer")
            self.assertEqual(validator.validate_questions(saved), [])

            # Check --status report after import
            report_after = essay_gen.format_status_report(saved)
            self.assertIn("已完成 1 / 1 題", report_after)

    def test_sync_notebooklm_packs_export_and_profile_guard(self):
        from tools import sync_notebooklm

        essay = sample_essay()
        essay["essayGuide"] = valid_essay_guide()
        packs = sync_notebooklm.build_subject_packs([essay], exam_type_filter="all")
        self.assertEqual(len(packs), 1)
        self.assertEqual(packs[0]["subject"], "社會工作")
        self.assertIn("這題在考的核心概念是", packs[0]["content"])
        self.assertIn("資深社工督導", packs[0]["promptGuide"])

        with self.assertRaises(ValueError):
            sync_notebooklm.assert_profile_outside_repo(sync_notebooklm.REPO_ROOT / ".swq-notebooklm-profile")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            data_path = tmp_dir / "questions.json"
            export_dir = tmp_dir / "out"
            data_path.write_text(json.dumps([essay], ensure_ascii=False), encoding="utf-8")
            self.assertEqual(sync_notebooklm.main(["--questions", str(data_path), "--dry-run"]), 0)
            self.assertEqual(
                sync_notebooklm.main(["--questions", str(data_path), "--export-only", str(export_dir)]),
                0,
            )
            exported_files = list(export_dir.glob("*.txt"))
            self.assertEqual(len(exported_files), 2)

    def test_build_lecture_mp3_script_filename_and_dry_run(self):
        from tools import build_lecture_mp3

        essay = sample_essay("2021-1-0401-E1")
        essay["year"] = 2021
        essay["session"] = 1
        essay["prompt"] = "試論述運用任務中心取向（Task-Centered Approach）提供服務，對社會\n工作責信（accountability）有何意義？（25 分）"
        essay["essayGuide"] = valid_essay_guide()
        essay["essayGuide"]["modelAnswer"]["qi"]["content"] = (
            "增強權能（Empowerment，亦稱增權或充權）由 Lorraine Gutiérrez 提出，強調弱勢群體之無力感源於結構排斥。"
        )
        essay["essayGuide"]["modelAnswer"]["cheng"]["content"] = (
            "茲分述如下：\n1. 個人層次（自我效能）：係指提升案主能力，並結合家暴保護（《家庭暴力防治法》）。\n"
            "2. 制度層次：惟實務上仍須防範挑案現象。綜上，責信應回歸案主福祉。"
        )

        # PDF mid-word line-wrap repair & clean Taiwan professor spoken translation
        cleaned_prompt = build_lecture_mp3.clean_lecture_text(essay["prompt"])
        self.assertIn("社會工作責信", cleaned_prompt)
        self.assertNotIn("Task-Centered", cleaned_prompt)
        self.assertNotIn("25 分", cleaned_prompt)

        spoken_qi = build_lecture_mp3.convert_to_lecturer_spoken_chinese(
            essay["essayGuide"]["modelAnswer"]["qi"]["content"]
        )
        self.assertNotIn("Empowerment", spoken_qi)
        self.assertIn("增權或充權", spoken_qi)
        self.assertIn("Gutierrez", spoken_qi)
        self.assertIn("的無力感", spoken_qi)

        spoken_cheng = build_lecture_mp3.convert_to_lecturer_spoken_chinese(
            essay["essayGuide"]["modelAnswer"]["cheng"]["content"]
        )
        self.assertIn("首先來看個人層次", spoken_cheng)
        self.assertIn("再來是制度層次", spoken_cheng)
        self.assertIn("指的就是", spoken_cheng)
        self.assertIn("像是家庭暴力防治法", spoken_cheng)
        self.assertIn("不過，", spoken_cheng)
        self.assertIn("總結來說", spoken_cheng)
        self.assertNotIn("第一個重點", spoken_cheng)
        self.assertNotIn("茲分述如下", spoken_cheng)

        # Clean Taiwan professor segmented structure (no cheesy rhyming slogan)
        segments = build_lecture_mp3.build_lecture_segments(essay)
        self.assertGreaterEqual(len(segments), 8)
        self.assertTrue(any(seg["pauseAfterSec"] >= 0.85 for seg in segments))
        script = build_lecture_mp3.build_lecture_script(essay)
        self.assertIn("一百一十年第一次專技社工師", script)
        self.assertIn("閱卷老師真正想看到的重點是什麼", script)
        self.assertIn("第一段起的部分", script)
        self.assertIn("接著進到第二段承", script)
        self.assertIn("第三段轉", script)
        self.assertIn("最後第四段合", script)
        self.assertIn("閱卷給分關鍵字", script)
        self.assertNotIn("考場記憶口訣", script)
        self.assertNotRegex(script, r"[《》【】「」『』()（）*#]")

        # Filename cleanup & collision handling
        used: set[str] = set()
        name1 = build_lecture_mp3.build_lecture_filename(1, essay, used_names=used)
        self.assertTrue(name1.startswith("01-任務中心取向"))
        self.assertTrue(name1.endswith(".mp3"))
        self.assertNotRegex(name1, r'[\\/:*?"<>|\s]')
        name2 = build_lecture_mp3.build_lecture_filename(1, essay, used_names=used)
        self.assertNotEqual(name1, name2)

        # Local offline MLX clone defaults (8-bit, single-worker low-thermal, cooldown, in-memory prompt cache)
        self.assertEqual(build_lecture_mp3.DEFAULT_ENGINE, "mlx-clone")
        self.assertEqual(build_lecture_mp3.DEFAULT_MLX_MODEL, "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")
        self.assertEqual(
            build_lecture_mp3.DEFAULT_OUTPUT_DIR,
            Path.home() / "Documents" / "2027社工師國考申論名師有聲課",
        )
        self.assertEqual(build_lecture_mp3.DEFAULT_WORKERS, 1)
        self.assertEqual(build_lecture_mp3.DEFAULT_COOLDOWN_SEC, 2.0)
        self.assertEqual(build_lecture_mp3.format_duration_eta(45), "45 秒")
        self.assertEqual(build_lecture_mp3.format_duration_eta(125), "2 分 05 秒")
        self.assertEqual(build_lecture_mp3.format_duration_eta(5040), "1 小時 24 分")
        with self.assertRaises(ValueError):
            build_lecture_mp3.assert_path_outside_repo(build_lecture_mp3.REPO_ROOT / "tw_teacher_erinome_ref.wav")
        self.assertEqual(build_lecture_mp3.DEFAULT_VOICE, "zh-TW-HsiaoYuNeural")
        self.assertEqual(build_lecture_mp3.resolve_voice_name("hsiaoyu"), "zh-TW-HsiaoYuNeural")
        self.assertEqual(build_lecture_mp3.resolve_voice_name("hsiaochen"), "zh-TW-HsiaoChenNeural")
        self.assertEqual(build_lecture_mp3.resolve_voice_name("yunjhe"), "zh-TW-YunJheNeural")

        # In-memory speaker & ICL prompt cache avoids recomputing speaker embedding per segment
        class _FakeAudio:
            size = 4
            def sum(self):
                return 1.5

        class _FakeModel:
            speaker_encoder = object()
            def __init__(self):
                self.spk_calls = 0
                self._icl_cache = {}
            def extract_speaker_embedding(self, audio):
                self.spk_calls += 1
                return ("spk-vec", audio.size)
            def _prepare_icl_generation_inputs(self, text, ref_audio, ref_text, language="auto"):
                self._icl_cache[(ref_text, ref_audio.size)] = ("codes", "ids")
                return ("e", "t", "p", "c")

        fake_model = _FakeModel()
        fake_audio = _FakeAudio()
        cache_info = build_lecture_mp3.install_in_memory_prompt_cache(fake_model, fake_audio, "參考逐字稿")
        self.assertTrue(cache_info["speakerCached"])
        self.assertTrue(cache_info["iclPromptCached"])
        self.assertEqual(fake_model.spk_calls, 1)
        # Subsequent segment calls hit RAM cache without invoking speaker encoder again
        self.assertEqual(fake_model.extract_speaker_embedding(fake_audio), ("spk-vec", 4))
        self.assertEqual(fake_model.extract_speaker_embedding(fake_audio), ("spk-vec", 4))
        self.assertEqual(fake_model.spk_calls, 1)

        # Dry-run CLI with --output-dir, --workers/--cooldown validation, --question-id and atomic write
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            data_path = tmp_dir / "questions.json"
            data_path.write_text(json.dumps([essay], ensure_ascii=False), encoding="utf-8")
            self.assertEqual(
                build_lecture_mp3.main(["--questions", str(data_path), "--workers", "0", "--dry-run"]),
                1,
            )
            self.assertEqual(
                build_lecture_mp3.main(["--questions", str(data_path), "--workers", "5", "--dry-run"]),
                1,
            )
            self.assertEqual(
                build_lecture_mp3.main(["--questions", str(data_path), "--cooldown", "-1", "--dry-run"]),
                1,
            )
            rc = build_lecture_mp3.main(
                [
                    "--questions",
                    str(data_path),
                    "--output-dir",
                    str(tmp_dir / "docs_out"),
                    "--workers",
                    "1",
                    "--cooldown",
                    "2.5",
                    "--question-id",
                    "2021-1-0401-E1",
                    "--single-out",
                    str(tmp_dir / "audition.mp3"),
                    "--dry-run",
                ]
            )
            self.assertEqual(rc, 0)
            self.assertFalse((tmp_dir / "audition.mp3").exists())

            src = tmp_dir / "src.mp3"
            dest = tmp_dir / "out" / "final.mp3"
            src.write_bytes(b"ID3-test-payload")
            build_lecture_mp3._write_icloud_safe_file(src, dest)
            self.assertEqual(dest.read_bytes(), b"ID3-test-payload")
            self.assertEqual(list(dest.parent.glob("*.tmp-*")), [])

    def test_link_drive_audio_and_manifest_structure(self):
        from tools import link_drive_audio

        # Validate Drive fileId & URL extraction
        self.assertEqual(
            link_drive_audio.extract_drive_file_id("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr_99/view?usp=sharing"),
            "1AbCdEfGhIjKlMnOpQr_99",
        )
        self.assertEqual(
            link_drive_audio.extract_drive_file_id("https://drive.google.com/uc?export=download&id=1ZyXwVuTsRqPoNmLkJi_88"),
            "1ZyXwVuTsRqPoNmLkJi_88",
        )
        self.assertEqual(link_drive_audio.extract_drive_file_id(""), "")

        # Validate repository root essay-audio-manifest.json has all 160 essays with required keys
        manifest_path = Path("essay-audio-manifest.json")
        self.assertTrue(manifest_path.exists(), "essay-audio-manifest.json should exist in repo root")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest.get("version"), 1)
        self.assertEqual(manifest.get("totalEssays"), 160)
        self.assertIsInstance(manifest.get("items"), dict)
        self.assertEqual(len(manifest["items"]), 160)
        sample_item = manifest["items"]["2021-1-0401-E1"]
        for req_key in ("fileId", "title", "subject", "filename", "folder"):
            self.assertIn(req_key, sample_item)

        # End-to-end test: Mode A (--from-json rclone style) + Mode B (--init & --from-csv)
        e1 = sample_essay("2021-1-0401-E1", number=1)
        e1["year"], e1["session"] = 2021, 1
        e1["prompt"] = "試論述任務中心取向對社會工作責信之意義。"
        e2 = sample_essay("2021-1-0401-E2", number=2)
        e2["year"], e2["session"] = 2021, 1
        e2["prompt"] = "試問在台灣社會工作者如何增權新住民女性？"

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            q_path = tmp_dir / "questions.json"
            m_path = tmp_dir / "essay-audio-manifest.json"
            q_path.write_text(json.dumps([e1, e2], ensure_ascii=False), encoding="utf-8")

            # Mode B: --init skeleton
            rc = link_drive_audio.main(["--questions", str(q_path), "--manifest", str(m_path), "--init"])
            self.assertEqual(rc, 0)
            init_doc = json.loads(m_path.read_text(encoding="utf-8"))
            self.assertEqual(init_doc["totalEssays"], 2)
            self.assertEqual(init_doc["linkedCount"], 0)

            # Mode A: --from-json (rclone lsjson -R format)
            rclone_json = tmp_dir / "rclone.json"
            rclone_json.write_text(
                json.dumps(
                    [
                        {
                            "Path": f"01-專技社工師-社會工作/{init_doc['items']['2021-1-0401-E1']['filename']}",
                            "Name": init_doc["items"]["2021-1-0401-E1"]["filename"],
                            "ID": "1DriveFileIdForEssayOne01",
                            "IsDir": False,
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            rc = link_drive_audio.main(
                ["--questions", str(q_path), "--manifest", str(m_path), "--from-json", str(rclone_json)]
            )
            self.assertEqual(rc, 0)
            after_json = json.loads(m_path.read_text(encoding="utf-8"))
            self.assertEqual(after_json["linkedCount"], 1)
            self.assertEqual(after_json["items"]["2021-1-0401-E1"]["fileId"], "1DriveFileIdForEssayOne01")

            # Mode B: --from-csv preserves previous fileId and adds E2 via Drive share URL
            csv_path = tmp_dir / "links.csv"
            csv_path.write_text(
                "question_id,url\n2021-1-0401-E2,https://drive.google.com/file/d/1DriveFileIdForEssayTwo02/view\n",
                encoding="utf-8",
            )
            rc = link_drive_audio.main(
                ["--questions", str(q_path), "--manifest", str(m_path), "--from-csv", str(csv_path)]
            )
            self.assertEqual(rc, 0)
            after_csv = json.loads(m_path.read_text(encoding="utf-8"))
            self.assertEqual(after_csv["linkedCount"], 2)
            self.assertEqual(after_csv["items"]["2021-1-0401-E1"]["fileId"], "1DriveFileIdForEssayOne01")
            self.assertEqual(after_csv["items"]["2021-1-0401-E2"]["fileId"], "1DriveFileIdForEssayTwo02")


if __name__ == "__main__":
    unittest.main()
