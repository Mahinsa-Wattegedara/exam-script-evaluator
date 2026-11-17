import asyncio
import base64
import io
import json
import re
from collections import defaultdict
from typing import Any

import httpx
from PIL import Image, ImageEnhance, ImageOps

from app.schemas.module1 import (
    ExtractedFlagSchema,
    ExtractedSpanSchema,
    McqPageImagePayload,
    RectSchema,
    StructuredQuestionResultSchema,
    StructuredRegionPayload,
)
from app.services.mcq_extractor import _resolve_gemini_api_key, _resolve_gemini_model

STRUCTURED_OCR_PROMPT = """You are an ultra-precise academic handwritten answer script transcriber for university examinations.
You are inspecting cropped image region(s) of a single student's handwritten response to ONE question.
(Multiple images, if present, are continuation parts of the SAME question in page order.)

CRITICAL RULES:
1. Transcribe the handwritten text line by line faithfully, preserving exact technical terminology, mathematical notation, equations, and numbers. Do NOT invent or complete sentences that are not written.
2. Output strictly valid JSON matching this schema:
{
  "blankDetected": false,
  "hasDiagramOrTable": false,
  "lines": [
    {
      "lineNumber": 1,
      "text": "exact transcribed line text",
      "confidence": 0.96,
      "unclearNote": ""
    }
  ]
}
3. If the cropped region is completely blank (no handwritten answer, only ruled lines or empty margin), set "blankDetected": true and "lines": [].
4. If the region contains a hand-drawn diagram, flowchart, circuit, graph, or complex table that cannot be faithfully represented as plain text lines, set "hasDiagramOrTable": true and still transcribe any legible labels or prose into "lines".
5. If any word or symbol is smudged, crossed out, or ambiguous, mark the unclear token with `[?]` inside "text", set lower "confidence" (e.g. 0.55 - 0.72), and describe the ambiguity briefly in "unclearNote".
6. Every confidence value MUST be a float between 0.0 and 1.0."""

FULL_PAGE_SEGMENT_OCR_PROMPT = """You are an ultra-precise academic handwritten answer script segmenter and OCR transcriber for university examinations.
You are inspecting full uploaded handwritten script page image(s) arranged sequentially (Page 1, Page 2, ...).
NOTE: Any dark horizontal bar near the top ("IDENTITY HEADER MASKED") covers redacted student metadata — completely IGNORE that masked header bar and DO NOT transcribe Name, Index No, or Signature lines if any appear near it.

TASK:
1. Identify every distinct handwritten question answer written across the uploaded page(s) in order (up to 10 questions).
   - If the student wrote explicit question labels like "Q1.", "Q2)", "1.", "2)", normalize the label cleanly as "Q1", "Q2", etc.
   - If answers are unnumbered, assign sequential labels ("Q1", "Q2", ...).
2. Output strictly valid JSON matching this schema:
{
  "questions": [
    {
      "questionNumber": "Q1",
      "pageNumber": 1,
      "bbox": { "x": 6.0, "y": 18.0, "width": 88.0, "height": 28.0 },
      "blankDetected": false,
      "hasDiagramOrTable": false,
      "lines": [
        {
          "lineNumber": 1,
          "text": "exact transcribed handwritten line",
          "confidence": 0.96,
          "unclearNote": ""
        }
      ]
    }
  ]
}
3. "bbox" MUST use percentage coordinates (0 to 100) on "pageNumber" tightly framing that question's handwritten answer (with y >= 15 below the header bar on Page 1), width > 0, height > 0, x + width <= 100, y + height <= 100.
4. If a single question continues onto the next page, merge all its lines in order under one entry and set "pageNumber" and "bbox" to its primary block on the starting page.
5. Transcribe handwritten text, mathematical notation, equations, bullet points, and terminology faithfully line by line. Never fabricate words not written by the student.
6. If any word or symbol is smudged, crossed out, or ambiguous, mark the unclear token with `[?]` inside "text", set lower "confidence" (0.50 - 0.75), and describe it briefly in "unclearNote".
7. If an answer region is blank or unanswered, set "blankDetected": true and "lines": [].
8. If an answer contains a hand-drawn diagram, flowchart, graph, or complex table, set "hasDiagramOrTable": true while still transcribing any legible labels or prose.
9. Every confidence value MUST be a float between 0.0 and 1.0."""


def _enhance_image_b64_for_ocr(mime_type: str, base64_data: str) -> tuple[str, str]:
    """Applies mild autocontrast & sharpening so faint pencil/pen handwriting is crisp."""
    try:
        raw_bytes = base64.b64decode(base64_data)
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        pil_img = ImageOps.autocontrast(pil_img, cutoff=1)
        pil_img = ImageEnhance.Sharpness(pil_img).enhance(1.3)
        out = io.BytesIO()
        pil_img.save(out, format="PNG", optimize=True)
        return "image/png", base64.b64encode(out.getvalue()).decode("ascii")
    except Exception:
        return mime_type or "image/jpeg", base64_data


async def _call_gemini_vision_json(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    parts: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]]:
    """
    Calls pinned Gemini Vision deterministically with brief retry on HTTP 503
    and fallback only when Google returns HTTP 429 (quota exhausted) or 503 (overload).
    """
    candidate_models = [model] + [
        m for m in ("gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite") if m != model
    ]

    resp = None
    active_model = model
    for idx_m, cand in enumerate(candidate_models):
        active_model = cand
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{cand}:generateContent?key={api_key}"
        gen_config: dict[str, Any] = {"temperature": 0.0, "topK": 1, "seed": 42}
        if cand.startswith("gemini-"):
            gen_config["responseMimeType"] = "application/json"

        attempts = 2 if idx_m == 0 else 1
        for attempt in range(attempts):
            resp = await client.post(
                url,
                json={"contents": [{"parts": parts}], "generationConfig": gen_config},
            )
            if resp.status_code != 503:
                break
            if attempt < attempts - 1:
                await asyncio.sleep(1.5)

        if resp is not None and resp.status_code == 200:
            break
        if resp is None or resp.status_code not in (429, 503):
            break

    if resp is None or resp.status_code != 200:
        code = resp.status_code if resp is not None else "NO_RESPONSE"
        detail = resp.text[:240] if resp is not None else "No response"
        raise RuntimeError(f"Vision OCR HTTP {code}: {detail}")

    data = resp.json()
    raw_json_text = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not raw_json_text:
        raise RuntimeError("Empty response returned by Vision OCR model")

    cleaned = raw_json_text.strip().removeprefix("```json").removesuffix("```").strip()
    return active_model, json.loads(cleaned)


def _build_spans_and_flags(
    question_id: str,
    parsed: dict[str, Any],
) -> tuple[bool, list[ExtractedSpanSchema], list[ExtractedFlagSchema], str]:
    blank_detected = bool(parsed.get("blankDetected", False))
    has_diagram = bool(parsed.get("hasDiagramOrTable", False))
    raw_lines = parsed.get("lines", [])

    spans: list[ExtractedSpanSchema] = []
    flags: list[ExtractedFlagSchema] = []

    if isinstance(raw_lines, list):
        for line_obj in raw_lines:
            if not isinstance(line_obj, dict):
                continue
            text = str(line_obj.get("text", "")).strip()
            if not text:
                continue
            line_no = int(line_obj.get("lineNumber") or (len(spans) + 1))
            conf_raw = line_obj.get("confidence", 0.92)
            try:
                conf = max(0.0, min(1.0, round(float(conf_raw), 2)))
            except Exception:
                conf = 0.9
            span_id = f"{question_id}-L{line_no}-S1"
            spans.append(
                ExtractedSpanSchema(
                    id=span_id,
                    lineNumber=line_no,
                    text=text,
                    confidence=conf,
                )
            )
            unclear_note = str(line_obj.get("unclearNote") or "").strip()
            if "[?]" in text or conf < 0.78 or unclear_note:
                flags.append(
                    ExtractedFlagSchema(
                        type="UNCLEAR_CHAR" if "[?]" in text or unclear_note else "LOW_CONFIDENCE",
                        message=unclear_note or f"Line {line_no} extracted with reduced clarity — verify handwritten wording.",
                        spanId=span_id,
                    )
                )

    if not spans:
        blank_detected = True

    if blank_detected:
        flags.append(
            ExtractedFlagSchema(
                type="BLANK_ANSWER",
                message="No handwritten answer detected inside cropped region. Confirm Not Attempted or adjust crop.",
            )
        )

    if has_diagram:
        flags.append(
            ExtractedFlagSchema(
                type="UNSUPPORTED_CONTENT",
                message="Diagram, table, or non-linear sketch detected — verify or route for manual diagram review.",
            )
        )

    raw_text = "\n".join(sp.text for sp in spans)
    return blank_detected, spans, flags, raw_text


def _clamp_bbox(raw_bbox: Any, default_idx: int) -> RectSchema:
    if isinstance(raw_bbox, dict):
        try:
            x = max(0.0, min(95.0, float(raw_bbox.get("x", 6.0))))
            y = max(0.0, min(95.0, float(raw_bbox.get("y", 18.0))))
            w = max(4.0, min(100.0 - x, float(raw_bbox.get("width", 88.0))))
            h = max(4.0, min(100.0 - y, float(raw_bbox.get("height", 24.0))))
            return RectSchema(x=round(x, 2), y=round(y, 2), width=round(w, 2), height=round(h, 2))
        except Exception:
            pass
    y_fallback = min(76.0, 16.0 + (default_idx % 4) * 20.0)
    return RectSchema(x=6.0, y=y_fallback, width=88.0, height=18.0)


async def _extract_single_question_ocr(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    question_id: str,
    q_regions: list[StructuredRegionPayload],
) -> tuple[str, StructuredQuestionResultSchema]:
    q_regions_sorted = sorted(q_regions, key=lambda r: r.pageNumber)
    q_num = q_regions_sorted[0].questionNumber
    q_prompt = q_regions_sorted[0].questionPrompt or ""

    context_hint = f"Question {q_num}"
    if q_prompt:
        context_hint += f": {q_prompt}"

    image_parts: list[dict[str, Any]] = []
    for reg in q_regions_sorted:
        mime, b64 = _enhance_image_b64_for_ocr(reg.mimeType, reg.base64Data)
        image_parts.append({"inlineData": {"mimeType": mime, "data": b64}})

    parts: list[dict[str, Any]] = [
        {"text": f"{STRUCTURED_OCR_PROMPT}\n\nQuestion context (for terminology disambiguation only, do NOT copy into answer unless written): {context_hint}"},
        *image_parts,
    ]

    active_model, parsed = await _call_gemini_vision_json(client, api_key, model, parts)
    blank_detected, spans, flags, raw_text = _build_spans_and_flags(question_id, parsed)

    return active_model, StructuredQuestionResultSchema(
        questionId=question_id,
        questionNumber=q_num,
        pageNumber=q_regions_sorted[0].pageNumber,
        rawText=raw_text,
        blankDetected=blank_detected,
        spans=spans,
        flags=flags,
    )


async def extract_structured_from_regions(
    regions: list[StructuredRegionPayload],
) -> tuple[str, list[StructuredQuestionResultSchema]]:
    """
    Runs pinned Gemini Vision OCR over cropped handwritten question regions,
    grouped by questionId in page order.
    """
    api_key = _resolve_gemini_api_key()
    model = _resolve_gemini_model()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in backend environment.")

    grouped: dict[str, list[StructuredRegionPayload]] = defaultdict(list)
    order: list[str] = []
    for reg in regions:
        if reg.questionId not in grouped:
            order.append(reg.questionId)
        grouped[reg.questionId].append(reg)

    used_model = model
    results: list[StructuredQuestionResultSchema] = []
    async with httpx.AsyncClient(timeout=40.0) as client:
        for q_id in order:
            used_model, res = await _extract_single_question_ocr(client, api_key, model, q_id, grouped[q_id])
            results.append(res)

    return used_model, results


async def extract_structured_from_pages(
    pages: list[McqPageImagePayload],
) -> tuple[str, list[StructuredQuestionResultSchema]]:
    """
    Auto-segments full handwritten script pages into detected questions with bounding boxes
    and transcribes every line in a single batched Vision request.
    """
    api_key = _resolve_gemini_api_key()
    model = _resolve_gemini_model()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in backend environment.")

    parts: list[dict[str, Any]] = [{"text": FULL_PAGE_SEGMENT_OCR_PROMPT}]
    for idx, page in enumerate(pages):
        mime, b64 = _enhance_image_b64_for_ocr(page.mimeType, page.base64Data)
        parts.append({"text": f"Page {idx + 1}:"})
        parts.append({"inlineData": {"mimeType": mime, "data": b64}})

    async with httpx.AsyncClient(timeout=55.0) as client:
        active_model, parsed = await _call_gemini_vision_json(client, api_key, model, parts)

    raw_questions = parsed.get("questions", [])
    if not isinstance(raw_questions, list) or len(raw_questions) == 0:
        raise RuntimeError("No handwritten questions were detected in the uploaded page image(s).")

    results: list[StructuredQuestionResultSchema] = []
    seen_ids: set[str] = set()
    num_pages = len(pages)

    for idx, q_obj in enumerate(raw_questions[:10]):
        if not isinstance(q_obj, dict):
            continue
        raw_num = str(q_obj.get("questionNumber") or f"Q{idx + 1}").strip()
        m = re.search(r"(\d+[a-z]?)", raw_num, flags=re.IGNORECASE)
        norm_num = f"Q{m.group(1)}" if m else f"Q{idx + 1}"
        cand_id = f"q{m.group(1).lower()}" if m else f"q{idx + 1}"
        if cand_id in seen_ids:
            cand_id = f"q{idx + 1}"
        seen_ids.add(cand_id)

        try:
            page_no = max(1, min(num_pages, int(q_obj.get("pageNumber") or 1)))
        except Exception:
            page_no = 1

        bbox = _clamp_bbox(q_obj.get("bbox"), idx)
        blank_detected, spans, flags, raw_text = _build_spans_and_flags(cand_id, q_obj)
        results.append(
            StructuredQuestionResultSchema(
                questionId=cand_id,
                questionNumber=norm_num,
                pageNumber=page_no,
                bbox=bbox,
                rawText=raw_text,
                blankDetected=blank_detected,
                spans=spans,
                flags=flags,
            )
        )

    return active_model, results
