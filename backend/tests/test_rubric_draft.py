import copy
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.main import app
from app.schemas.module2 import RubricDraftRequest
from app.services.rubric_agent import create_rubric_draft
from app.services.rubric_draft import RubricCandidate
from app.services.rubric_validation import check_rubric_source, parse_rubric_questions


def draft():
    return {"questions": [{
        "number": "Q1", "prompt": "Define encapsulation", "maxMarks": 2,
        "modelAnswerText": "Bundles data and methods; restricts access to state.",
        "subquestions": [{"id": "q1a", "label": "Q1(a)", "prompt": "Define encapsulation", "originalAnswer": "Bundles data and methods; restricts access to state.", "maxMarks": 2}],
        "criteria": [{
            "subquestionId": "q1a", "sourceExcerpt": "Bundles data and methods",
            "id": "C1", "description": "Bundles state and methods in a class and controls access.",
            "maxMarks": 2, "allowedPartialCredits": [0, 1, 2],
            "acceptedAlternatives": ["Combines object state with behaviour and hides internal state."],
            "scoringGuide": [
                {"marks": 0, "description": "Neither bundling nor access control is correct."},
                {"marks": 1, "description": "Correctly explains either bundling or access control."},
                {"marks": 2, "description": "Correctly explains both bundling and access control."},
            ],
        }],
    }]}


class RubricValidationTests(unittest.TestCase):
    def test_total_and_excerpt_are_checked_against_the_source(self):
        questions = parse_rubric_questions(json.dumps(draft()))
        with self.assertRaisesRegex(ValueError, "total 2 marks but the paper states 4"):
            check_rubric_source(questions, "Total 4 marks\nBundles data and methods.")
        with self.assertRaisesRegex(ValueError, "Q1/C1 cites an excerpt"):
            check_rubric_source(questions, "Total 2 marks\nDefine encapsulation.")

    def test_normalizes_marks_notation_and_question_ids(self):
        data = draft()
        data["questions"][0].update(number="Question 01", maxMarks="[2]")
        data["questions"][0]["criteria"][0]["allowedPartialCredits"] = ["0m", "[1]", "2 marks"]
        question, = parse_rubric_questions(json.dumps(data))
        self.assertEqual(question.number, "Q1")
        self.assertEqual(question.maxMarks, 2)
        self.assertEqual(question.criteria[0].allowedPartialCredits, [0, 1, 2])

    def test_preserves_alternatives_and_score_evidence(self):
        questions = parse_rubric_questions(json.dumps(draft()))
        self.assertEqual(questions[0].criteria[0].scoringGuide[1].marks, 1)
        self.assertIn("hides internal state", questions[0].criteria[0].acceptedAlternatives[0])

    def test_accepts_scoring_table_without_separate_model_answer(self):
        data = draft()
        question = data["questions"][0]
        title = "Section B: Poster layout"
        row = "Layout | Readable headings and consistent alignment | 2 marks"
        question.update(prompt=title, modelAnswerText="")
        question["subquestions"][0].update(label=title, prompt=title, originalAnswer=row)
        question["criteria"][0].update(
            sourceExcerpt="Readable headings and consistent alignment",
            description="Headings are legible and elements are consistently aligned.",
            acceptedAlternatives=["A clear heading hierarchy with a consistent alignment grid."],
            scoringGuide=[
                {"marks": 0, "description": "Neither layout requirement is met."},
                {"marks": 1, "description": "Only one layout requirement is met."},
                {"marks": 2, "description": "Both layout requirements are met."},
            ],
        )
        questions = parse_rubric_questions(json.dumps(data))
        self.assertEqual(questions[0].subquestions[0].originalAnswer, row)
        self.assertEqual(questions[0].modelAnswerText, "")

    def test_rejects_incomplete_or_inconsistent_marking_guides(self):
        changes = [
            {"acceptedAlternatives": []},
            {"acceptedAlternatives": [" "]},
            {"scoringGuide": []},
            {"scoringGuide": draft()["questions"][0]["criteria"][0]["scoringGuide"][:2]},
            {"allowedPartialCredits": [0, 2, 3]},
            {"allowedPartialCredits": [0, 1, 1, 2]},
            {"maxMarks": 3},
            {"description": "Define encapsulation"},
            {"subquestionId": "missing"},
            {"sourceExcerpt": "Invented answer content"},
        ]
        for change in changes:
            with self.subTest(change=change):
                data = copy.deepcopy(draft())
                data["questions"][0]["criteria"][0].update(change)
                with self.assertRaises(ValueError):
                    parse_rubric_questions(json.dumps(data))

    def test_rejects_ambiguous_duplicate_score_rules(self):
        data = draft()
        data["questions"][0]["criteria"][0]["scoringGuide"][1]["marks"] = 0
        with self.assertRaises(ValueError):
            parse_rubric_questions(json.dumps(data))

    def test_subquestion_totals_cannot_hide_behind_correct_main_total(self):
        data = draft()
        data["questions"][0]["maxMarks"] = 4
        part = data["questions"][0]["subquestions"][0]
        part["maxMarks"] = 1
        data["questions"][0]["subquestions"].append({**part, "id": "q1b", "label": "Q1(b)", "maxMarks": 3})
        point = data["questions"][0]["criteria"][0]
        data["questions"][0]["criteria"].append({**point, "id": "C2", "subquestionId": "q1b"})
        with self.assertRaisesRegex(ValueError, "correct mark breakdown"):
            parse_rubric_questions(json.dumps(data))


class RubricRepairTests(unittest.IsolatedAsyncioTestCase):
    async def test_long_numbered_paper_fans_out_and_merges_in_source_order(self):
        source = "Total 4 marks\nQ1. Define encapsulation. (2 marks)\nBundles data and methods.\nQ2. Define encapsulation. (2 marks)\nBundles data and methods."

        async def generate(transcript, *_args, **_kwargs):
            data = draft()
            if "Q2." in transcript:
                self.assertNotIn("Q1.", transcript)
                data["questions"][0]["number"] = "Q2"
            return RubricCandidate(json.dumps(data), "test", "openrouter", "test")

        with (
            patch("app.services.rubric_agent.CHUNK_THRESHOLD", 1),
            patch("app.services.rubric_agent.generate_rubric_candidate", side_effect=generate) as generator,
        ):
            result = await create_rubric_draft(RubricDraftRequest(text=source))
        self.assertEqual(generator.await_count, 2)
        self.assertEqual([question.number for question in result.questions], ["Q1", "Q2"])

    async def test_ocr_garbage_stops_before_drafting(self):
        payload = RubricDraftRequest(pages=[{"pageNumber": 1, "base64Data": "c2Nhbm5lZCBwYWdlIQ=="}])
        with (
            patch("app.services.rubric_agent.read_rubric_source", return_value=("[Page 1]\n\ufffd\ufffd\ufffdab", "gemini-ocr")),
            patch("app.services.rubric_agent.generate_rubric_candidate") as generator,
        ):
            with self.assertRaisesRegex(ValueError, "OCR could not read enough"):
                await create_rubric_draft(payload)
        generator.assert_not_called()

    async def test_paper_total_feedback_reaches_the_final_fallback_model(self):
        invalid = draft()
        valid = draft()
        question = valid["questions"][0]
        question["maxMarks"] = 3
        question["subquestions"][0]["maxMarks"] = 3
        criterion = question["criteria"][0]
        criterion["maxMarks"] = 3
        criterion["allowedPartialCredits"][-1] = 3
        criterion["scoringGuide"][-1]["marks"] = 3
        with (
            patch.dict("os.environ", {"RUBRIC_MAX_ATTEMPTS": "3", "RUBRIC_FALLBACK_MODEL": "stronger"}),
            patch("app.services.rubric_agent.generate_rubric_candidate") as generator,
        ):
            generator.side_effect = [
                RubricCandidate(json.dumps(data), "test", "openrouter", "test")
                for data in [invalid, invalid, valid]
            ]
            result = await create_rubric_draft(RubricDraftRequest(text="Total: 3 marks\nBundles data and methods."))
        self.assertEqual(result.questions[0].maxMarks, 3)
        self.assertIn("paper states 3", generator.await_args.args[1])
        self.assertEqual(generator.await_args.kwargs["fallback_model"], "stronger")

    async def test_scanned_upload_retries_draft_without_repeating_ocr(self):
        invalid = draft()
        invalid["questions"][0]["criteria"][0]["acceptedAlternatives"] = []
        path = "/api/v1/module2/rubric/draft-from-script"
        upload = {"pages": [{"pageNumber": 1, "base64Data": "c2Nhbm5lZCBwYWdlIQ=="}]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            with (
                patch("app.services.rubric_draft._resolve_env_var", return_value="gemini"),
                patch("app.services.rubric_draft._resolve_gemini_api_key", return_value="test-key"),
                patch("app.services.rubric_draft._resolve_gemini_model", return_value="gemini-test"),
                patch("app.services.rubric_draft._call_gemini_vision_json", new_callable=AsyncMock) as gemini,
            ):
                gemini.side_effect = [
                    ("gemini-ocr", {"text": "Q1. Define encapsulation. (2 marks)\nBundles data and methods."}),
                    ("gemini-draft", invalid),
                    ("gemini-draft", draft()),
                ]
                response = await client.post(path, json=upload)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["ocrModel"], "gemini-ocr")
        self.assertEqual(response.json()["rubricModel"], "gemini-draft")
        self.assertEqual(gemini.await_count, 3)
        initial_parts = gemini.await_args_list[1].args[3]
        correction_parts = gemini.await_args_list[2].args[3]
        self.assertIn("[Page 1]\nQ1. Define encapsulation.", initial_parts[0]["text"])
        self.assertIn("Provide specific valid alternative answers", correction_parts[0]["text"])

    async def test_insufficient_source_does_not_retry_generation(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, json={"choices": [{"message": {"content": '{"questions": []}'}}]})
        with patch("app.services.rubric_draft._resolve_env_var", return_value="test-value"), patch("app.services.rubric_draft.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            with self.assertRaisesRegex(ValueError, "source gives clear marks"):
                await create_rubric_draft(RubricDraftRequest(text="Section B: Poster layout"))
        client.post.assert_awaited_once()

    async def test_repairs_incomplete_model_output_once(self):
        invalid = draft()
        invalid["questions"][0]["criteria"][0]["acceptedAlternatives"] = []
        def response(data):
            return httpx.Response(200, json={"model": "test-model", "choices": [{"message": {"content": json.dumps(data)}}]})
        client = AsyncMock()
        client.post.side_effect = [response(invalid), response(draft())]
        with patch("app.services.rubric_draft._resolve_env_var", side_effect=lambda name, default="": "test-key" if name == "OPENROUTER_API_KEY" else "test-model"), patch("app.services.rubric_draft.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            result = await create_rubric_draft(RubricDraftRequest(text="Q1. Define encapsulation. (2 marks)\nBundles data and methods."))
        self.assertEqual(client.post.await_count, 2)
        self.assertTrue(result.questions[0].criteria[0].acceptedAlternatives)

    async def test_repeated_invalid_output_fails_after_one_repair(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})
        with patch("app.services.rubric_draft._resolve_env_var", return_value="test-value"), patch("app.services.rubric_draft.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            with self.assertRaisesRegex(ValueError, "after a correction attempt"):
                await create_rubric_draft(RubricDraftRequest(text="Teacher answer"))
        self.assertEqual(client.post.await_count, 2)


if __name__ == "__main__":
    unittest.main()
