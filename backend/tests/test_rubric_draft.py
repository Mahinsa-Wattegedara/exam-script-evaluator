import copy
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.schemas.module2 import RubricDraftRequest
from app.services.rubric_draft import create_rubric_draft, parse_rubric_questions


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
    def test_preserves_alternatives_and_score_evidence(self):
        questions = parse_rubric_questions(json.dumps(draft()))
        self.assertEqual(questions[0].criteria[0].scoringGuide[1].marks, 1)
        self.assertIn("hides internal state", questions[0].criteria[0].acceptedAlternatives[0])

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
    async def test_repairs_incomplete_model_output_once(self):
        invalid = draft()
        invalid["questions"][0]["criteria"][0]["acceptedAlternatives"] = []
        def response(data):
            return httpx.Response(200, json={"model": "test-model", "choices": [{"message": {"content": json.dumps(data)}}]})
        client = AsyncMock()
        client.post.side_effect = [response(invalid), response(draft())]
        with patch("app.services.rubric_draft._resolve_env_var", side_effect=lambda name, default="": "test-key" if name == "OPENROUTER_API_KEY" else "test-model"), patch("app.services.rubric_draft.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            result = await create_rubric_draft(RubricDraftRequest(text="Teacher answer"))
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
