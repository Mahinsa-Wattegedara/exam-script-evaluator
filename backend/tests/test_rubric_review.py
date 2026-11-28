import unittest
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from langgraph.checkpoint.memory import InMemorySaver

from app.services.rubric_review import review_progress, start_review


class RubricReviewTests(unittest.IsolatedAsyncioTestCase):
    async def test_removed_draft_question_no_longer_blocks_review(self):
        saver = InMemorySaver()
        archived = {"q2"}

        @contextmanager
        def transaction():
            yield

        @contextmanager
        def test_database():
            yield SimpleNamespace(transaction=transaction, execute=Mock()), saver

        async def read(assessment_id, question_id, owner, *, latest):
            if question_id in archived:
                raise HTTPException(404)
            return [SimpleNamespace(
                assessmentId=assessment_id, questionId=question_id, rubricId="approved-q1",
                version=1, approvedAt=datetime.now(UTC) + timedelta(seconds=1),
            )]

        repo = SimpleNamespace(read=read)
        with patch("app.services.rubric_review.review_database", test_database):
            review_id = await start_review("teacher", "assessment", ["q1", "q2"])
            with self.assertRaises(HTTPException) as denied:
                await review_progress(review_id, "teacher", repo, "q1")
            self.assertEqual(denied.exception.status_code, 409)

            status = await review_progress(review_id, "teacher", repo, "q2")
            self.assertEqual(status.pendingQuestionIds, [])
            self.assertEqual([ref.questionId for ref in status.approvedRubrics], ["q1"])
            self.assertEqual(await review_progress(review_id, "teacher", repo, "q2"), status)
            archived.add("q1")
            status = await review_progress(review_id, "teacher", repo, "q1")
            self.assertEqual(status.pendingQuestionIds, [])
            self.assertEqual(status.approvedRubrics, [])
            self.assertEqual(await review_progress(review_id, "teacher", repo), status)

    async def test_resume_after_every_question_has_a_new_approval(self):
        saver = InMemorySaver()

        @contextmanager
        def transaction():
            yield

        @contextmanager
        def test_database():
            yield SimpleNamespace(transaction=transaction, execute=Mock()), saver

        approvals = {}
        now = datetime.now(UTC)

        def approval(question_id, version, approved_at):
            return SimpleNamespace(
                assessmentId="assessment", questionId=question_id, rubricId=f"{question_id}-{version}",
                version=version, approvedAt=approved_at,
            )

        async def read(assessment_id, question_id, owner, *, latest):
            self.assertEqual((assessment_id, owner, latest), ("assessment", "teacher", True))
            if question_id not in approvals:
                raise HTTPException(404)
            return [approvals[question_id]]

        repo = SimpleNamespace(read=read)
        with patch("app.services.rubric_review.review_database", test_database):
            review_id = await start_review("teacher", "assessment", ["q1", "q2"])
            approvals["q1"] = approval("q1", 1, now + timedelta(minutes=1))
            approvals["q2"] = approval("q2", 1, now - timedelta(minutes=1))
            pending = await review_progress(review_id, "teacher", repo)
            self.assertEqual(pending.pendingQuestionIds, ["q2"])
            with self.assertRaises(HTTPException) as denied:
                await review_progress(review_id, "another-teacher", repo)
            self.assertEqual(denied.exception.status_code, 404)

            approvals["q2"] = approval("q2", 2, now + timedelta(minutes=1))
            complete = await review_progress(review_id, "teacher", repo)
            self.assertEqual(complete.pendingQuestionIds, [])
            self.assertEqual([ref.rubricId for ref in complete.approvedRubrics], ["q1-1", "q2-2"])

            approvals["q1"] = approval("q1", 2, now + timedelta(minutes=2))
            self.assertEqual(await review_progress(review_id, "teacher", repo), complete)
