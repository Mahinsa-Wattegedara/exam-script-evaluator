import asyncio
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import NotRequired, TypedDict
from uuid import uuid4

from fastapi import HTTPException
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.approved_rubric import ApprovedRubricResponse
from app.services.approved_rubrics import ApprovedRubricRepository


class RubricReference(BaseModel):
    assessmentId: str
    questionId: str
    rubricId: str
    version: int


class RubricReviewStatus(BaseModel):
    pendingQuestionIds: list[str]
    approvedRubrics: list[RubricReference]


class RubricReviewCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    removeQuestionId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")


class ReviewState(TypedDict):
    owner: str
    assessment_id: str
    question_ids: list[str]
    started_at: str
    approved: NotRequired[list[dict]]


def wait_for_approvals(state: ReviewState) -> dict:
    approved = interrupt({"questionIds": state["question_ids"]})
    return {"approved": approved}


review = StateGraph(ReviewState)
review.add_node("wait_for_approvals", wait_for_approvals)
review.add_edge(START, "wait_for_approvals")
review.add_edge("wait_for_approvals", END)


def review_configured() -> bool:
    return bool(os.getenv("RUBRIC_REVIEW_DATABASE_URL", "").strip())


@contextmanager
def review_database():
    from langgraph.checkpoint.postgres import PostgresSaver
    from psycopg import Connection, Error
    from psycopg.rows import dict_row

    dsn = os.getenv("RUBRIC_REVIEW_DATABASE_URL", "").strip()
    if not dsn:
        raise HTTPException(503, "Rubric review storage is not configured.")
    try:
        connection = Connection.connect(
            dsn, autocommit=True, prepare_threshold=None, row_factory=dict_row,
            connect_timeout=5,
        )
        with connection:
            connection.execute("SET search_path TO rubric_review")
            yield connection, PostgresSaver(connection)
    except Error as exc:
        raise HTTPException(503, "Rubric review storage is unavailable. Check its database setup.") from exc


def thread_config(review_id: str) -> dict:
    return {"configurable": {"thread_id": review_id}}


def _start_review(owner: str, assessment_id: str, question_ids: list[str]) -> str:
    review_id = str(uuid4())
    with review_database() as (_, saver):
        workflow = review.compile(checkpointer=saver)
        workflow.invoke({
            "owner": owner, "assessment_id": assessment_id, "question_ids": question_ids,
            "started_at": datetime.now(UTC).isoformat(),
        }, thread_config(review_id))
    return review_id


async def start_review(owner: str, assessment_id: str, question_ids: list[str]) -> str:
    return await asyncio.to_thread(_start_review, owner, assessment_id, question_ids)


def _load_review(review_id: str, owner: str) -> ReviewState:
    with review_database() as (_, saver):
        workflow = review.compile(checkpointer=saver)
        state = workflow.get_state(thread_config(review_id)).values
    if state.get("owner") != owner:
        raise HTTPException(404, "Rubric review not found.")
    return state


def _complete_review(review_id: str, references: list[RubricReference]) -> RubricReviewStatus:
    config = thread_config(review_id)
    with review_database() as (connection, saver), connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (review_id,))
        workflow = review.compile(checkpointer=saver)
        state = workflow.get_state(config).values
        if "approved" in state:
            return RubricReviewStatus(pendingQuestionIds=[], approvedRubrics=state["approved"])
        references = [ref for ref in references if ref.questionId in state["question_ids"]]
        workflow.invoke(Command(resume=[ref.model_dump() for ref in references]), config)
    return RubricReviewStatus(pendingQuestionIds=[], approvedRubrics=references)


def _remove_review_question(review_id: str, question_id: str) -> ReviewState:
    config = thread_config(review_id)
    with review_database() as (connection, saver), connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (review_id,))
        workflow = review.compile(checkpointer=saver)
        state = workflow.get_state(config).values
        if question_id not in state["question_ids"]:
            return state
        remaining = [item for item in state["question_ids"] if item != question_id]
        if "approved" in state:
            approved = [ref for ref in state["approved"] if ref["questionId"] != question_id]
            workflow.update_state(config, {"question_ids": remaining, "approved": approved}, as_node="wait_for_approvals")
            return {**state, "question_ids": remaining, "approved": approved}
        workflow.update_state(config, {"question_ids": remaining}, as_node=START)
        return {**state, "question_ids": remaining}


async def review_progress(
    review_id: str, owner: str, repo: ApprovedRubricRepository, remove_question_id: str | None = None
) -> RubricReviewStatus:
    state = await asyncio.to_thread(_load_review, review_id, owner)
    if remove_question_id is not None and remove_question_id in state["question_ids"]:
        try:
            await repo.read(state["assessment_id"], remove_question_id, owner, latest=True)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        else:
            raise HTTPException(409, "This question has an approved rubric version.")
        state = await asyncio.to_thread(_remove_review_question, review_id, remove_question_id)
    if "approved" in state:
        return RubricReviewStatus(pendingQuestionIds=[], approvedRubrics=state["approved"])

    started_at = datetime.fromisoformat(state["started_at"])
    limit = asyncio.Semaphore(4)

    async def approved_since_start(question_id: str) -> ApprovedRubricResponse | None:
        async with limit:
            try:
                saved = (await repo.read(state["assessment_id"], question_id, owner, latest=True))[0]
            except HTTPException as exc:
                if exc.status_code == 404:
                    return None
                raise
            return saved if saved.approvedAt >= started_at else None

    saved_rubrics = await asyncio.gather(*(approved_since_start(qid) for qid in state["question_ids"]))
    pending = [qid for qid, saved in zip(state["question_ids"], saved_rubrics) if saved is None]
    references = [
        RubricReference(assessmentId=saved.assessmentId, questionId=saved.questionId, rubricId=saved.rubricId, version=saved.version)
        for saved in saved_rubrics if saved is not None
    ]
    if pending:
        return RubricReviewStatus(pendingQuestionIds=pending, approvedRubrics=references)
    return await asyncio.to_thread(_complete_review, review_id, references)


def setup() -> None:
    with review_database() as (connection, saver):
        connection.execute("CREATE SCHEMA IF NOT EXISTS rubric_review")
        saver.setup()


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    setup()
