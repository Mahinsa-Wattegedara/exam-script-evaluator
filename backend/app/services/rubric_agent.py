import os
import re
import unicodedata
from operator import add
from typing import Annotated, Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.schemas.module2 import DraftQuestion, RubricDraftRequest, RubricDraftResponse, RubricQualityWarning
from app.services.rubric_draft import RubricCandidate, generate_rubric_candidate, read_rubric_source
from app.services.rubric_validation import (
    OPTIONAL_QUESTIONS,
    InsufficientRubricSource,
    check_rubric_questions,
    check_rubric_source,
    decode_rubric_questions,
    heading_marks,
    source_question_headings,
    stated_paper_total,
)


MAX_ATTEMPTS = 2
CHUNK_THRESHOLD = 12_000
MAX_CHUNKS = 4


class DraftState(TypedDict):
    transcript: str
    expected_questions: list[str]
    attempts: int
    max_attempts: int
    fallback_model: str
    candidate: NotRequired[RubricCandidate]
    questions: NotRequired[list[DraftQuestion]]
    warnings: NotRequired[list[RubricQualityWarning]]
    validation_error: NotRequired[str | None]


class CompletedChunk(TypedDict):
    index: int
    questions: list[DraftQuestion]
    warnings: list[RubricQualityWarning]
    model: str


class RubricState(TypedDict):
    payload: RubricDraftRequest
    transcript: NotRequired[str]
    ocr_model: NotRequired[str | None]
    completed: Annotated[list[CompletedChunk], add]
    response: NotRequired[RubricDraftResponse]


def source_path(state: RubricState) -> Literal["read_text", "read_images"]:
    return "read_images" if state["payload"].pages else "read_text"


def read_text(state: RubricState) -> dict:
    transcript = state["payload"].text.strip()
    if not transcript:
        raise InsufficientRubricSource("Upload PDF pages or provide document text.")
    return {"transcript": transcript, "ocr_model": None}


async def read_images(state: RubricState) -> dict:
    transcript, ocr_model = await read_rubric_source(state["payload"])
    return {"transcript": transcript, "ocr_model": ocr_model}


def readable_ocr(text: str) -> bool:
    visible = [char for char in text if not char.isspace()]
    if sum(char.isalnum() for char in visible) < 2:
        return False
    damaged = sum(char == "\ufffd" or unicodedata.category(char) in {"Cc", "Co"} for char in visible)
    return damaged / len(visible) <= 0.15


def check_ocr_quality(state: RubricState) -> dict:
    ocr_text = re.sub(r"^\[Page [0-9]+\][ \t]*$", "", state["transcript"], flags=re.M)
    if readable_ocr(ocr_text):
        return {}
    supplied_text = state["payload"].text.strip()
    if readable_ocr(supplied_text):
        return {"transcript": supplied_text, "ocr_model": "pdf-text-fallback"}
    raise InsufficientRubricSource("OCR could not read enough of the source. Upload a clearer scan or paste the marking scheme text.")


async def draft_rubric(state: DraftState) -> dict:
    attempt = state["attempts"] + 1
    fallback = state["fallback_model"] if attempt > 1 and attempt == state["max_attempts"] else ""
    candidate = await generate_rubric_candidate(
        state["transcript"], state.get("validation_error"), state.get("candidate"),
        expected_questions=state["expected_questions"], fallback_model=fallback,
    )
    return {"candidate": candidate, "attempts": attempt}


def validation_failure(state: DraftState, exc: ValueError) -> dict:
    if state["attempts"] >= state["max_attempts"]:
        context = " after a correction attempt" if state["attempts"] > 1 else ""
        raise ValueError(f"The rubric model could not produce a complete marking guide{context}: {exc}") from exc
    return {"validation_error": str(exc)}


def parse_draft(state: DraftState) -> dict:
    try:
        questions = decode_rubric_questions(state["candidate"].content)
    except InsufficientRubricSource:
        raise
    except ValueError as exc:
        return validation_failure(state, exc)
    return {"questions": questions, "validation_error": None}


def check_draft(state: DraftState) -> dict:
    questions = state["questions"]
    expected_questions = state["expected_questions"]
    try:
        check_rubric_questions(questions)
        if expected_questions and [question.number for question in questions] != expected_questions:
            raise ValueError(f"This section must contain exactly {', '.join(expected_questions)} in source order.")
        warnings = check_rubric_source(questions, state["transcript"], check_paper_total=not expected_questions)
    except ValueError as exc:
        return validation_failure(state, exc)
    return {"warnings": warnings, "validation_error": None}


def route_after_parse(state: DraftState) -> Literal["draft_rubric", "check_draft"]:
    return "draft_rubric" if state["validation_error"] is not None else "check_draft"


def route_after_checks(state: DraftState) -> Literal["retry", "finish"]:
    return "retry" if state["validation_error"] is not None else "finish"


drafting = StateGraph(DraftState)
drafting.add_node("draft_rubric", draft_rubric)
drafting.add_node("parse_draft", parse_draft)
drafting.add_node("check_draft", check_draft)
drafting.add_edge(START, "draft_rubric")
drafting.add_edge("draft_rubric", "parse_draft")
drafting.add_conditional_edges("parse_draft", route_after_parse)
drafting.add_conditional_edges("check_draft", route_after_checks, {"retry": "draft_rubric", "finish": END})
draft_workflow = drafting.compile()


def plan_chunks(transcript: str) -> list[tuple[str, list[str]]]:
    headings = source_question_headings(transcript)
    if len(transcript) < CHUNK_THRESHOLD or len(headings) < 2 or OPTIONAL_QUESTIONS.search(transcript):
        return [(transcript, [])]
    paper_total = stated_paper_total(transcript)
    marks = [heading_marks(heading) for heading in headings]
    if paper_total is not None and (None in marks or sum(mark for mark in marks if mark is not None) != paper_total):
        return [(transcript, [])]

    chunks = []
    group_size = (len(headings) + MAX_CHUNKS - 1) // MAX_CHUNKS
    preamble = transcript[:headings[0].start()]
    for index in range(0, len(headings), group_size):
        group_end = index + group_size
        end = headings[group_end].start() if group_end < len(headings) else len(transcript)
        text = preamble + transcript[headings[index].start():end]
        numbers = [f"Q{heading[1]}" for heading in headings[index:group_end]]
        chunks.append((text, numbers))
    return chunks


def send_chunks(state: RubricState) -> list[Send]:
    raw_attempts = os.getenv("RUBRIC_MAX_ATTEMPTS", str(MAX_ATTEMPTS))
    max_attempts = int(raw_attempts) if raw_attempts in {"1", "2", "3"} else MAX_ATTEMPTS
    fallback_model = os.getenv("RUBRIC_FALLBACK_MODEL", "").strip()
    return [
        Send("draft_chunk", {
            "index": index, "transcript": text, "expected_questions": numbers, "attempts": 0,
            "max_attempts": max_attempts, "fallback_model": fallback_model,
        })
        for index, (text, numbers) in enumerate(plan_chunks(state["transcript"]))
    ]


class ChunkState(DraftState):
    index: int


async def draft_chunk(state: ChunkState) -> dict:
    result = await draft_workflow.ainvoke(state)
    return {"completed": [{
        "index": state["index"], "questions": result["questions"], "warnings": result["warnings"],
        "model": result["candidate"].model,
    }]}


def merge_chunks(state: RubricState) -> dict:
    chunks = sorted(state["completed"], key=lambda chunk: chunk["index"])
    questions = [question for chunk in chunks for question in chunk["questions"]]
    warnings = [warning for chunk in chunks for warning in chunk["warnings"]]
    if len(chunks) > 1:
        check_rubric_questions(questions)
        check_rubric_source(questions, state["transcript"])
    models = dict.fromkeys(chunk["model"] for chunk in chunks)
    return {"response": RubricDraftResponse(
        questions=questions, transcript=state["transcript"], ocrModel=state["ocr_model"],
        rubricModel=", ".join(models), warnings=warnings,
    )}


graph = StateGraph(RubricState)
graph.add_node("read_text", read_text)
graph.add_node("read_images", read_images)
graph.add_node("check_ocr_quality", check_ocr_quality)
graph.add_node("draft_chunk", draft_chunk)
graph.add_node("merge_chunks", merge_chunks)
graph.add_conditional_edges(START, source_path)
graph.add_edge("read_images", "check_ocr_quality")
graph.add_conditional_edges("read_text", send_chunks, ["draft_chunk"])
graph.add_conditional_edges("check_ocr_quality", send_chunks, ["draft_chunk"])
graph.add_edge("draft_chunk", "merge_chunks")
graph.add_edge("merge_chunks", END)
rubric_agent = graph.compile()


async def create_rubric_draft(payload: RubricDraftRequest) -> RubricDraftResponse:
    result = await rubric_agent.ainvoke({"payload": payload, "completed": []})
    return result["response"]
