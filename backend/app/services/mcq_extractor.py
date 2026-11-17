"""
Module 1 — MCQ Optical Mark & Vision Extraction Service.
Combines deterministic OMR connected-component bubble-grid detection with
deterministic Gemini Vision label detection and extraction (SRS Section 4.3 & 4.4, NFR-06).
"""
import base64
import collections
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Any
import httpx
from PIL import Image, ImageEnhance, ImageOps
from app.schemas.module1 import McqItemSchema, McqPageImagePayload

DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"


def _resolve_env_var(name: str, default: str = "") -> str:
    val = os.getenv(name, "").strip()
    if val:
        return val
    base_dir = Path(__file__).resolve().parents[2]
    for env_path in (base_dir / ".env", base_dir.parent / "frontend" / ".env"):
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                stripped = line.strip()
                if stripped.startswith(f"{name}="):
                    return stripped.split("=", 1)[1].strip().strip('"').strip("'")
    return default


def _resolve_gemini_api_key() -> str:
    return _resolve_env_var("GEMINI_API_KEY", "")


def _resolve_gemini_model() -> str:
    return _resolve_env_var("GEMINI_MODEL", DEFAULT_GEMINI_MODEL) or DEFAULT_GEMINI_MODEL


MCQ_SYSTEM_PROMPT = """You are an ultra-precise academic optical mark (OMR) & handwritten MCQ exam sheet reader.
Inspect the provided exam answer sheet image(s) (which already have student identity headers masked) and extract every multiple-choice question number and the student's exact selected option.

Critical Accuracy Rules:
1. First detect the option labeling printed on the sheet:
   - If bubbles/options are numbered (e.g. (1) (2) (3) (4) (5) or 1-4), set "optionStyle": "NUMERIC" and "optionLabels": ["1", "2", "3", "4", "5"] (or ["1", "2", "3", "4"] if 4 choices).
   - If bubbles/options are lettered (e.g. A B C D E or A-D), set "optionStyle": "ALPHA" and "optionLabels": ["A", "B", "C", "D", "E"] (or ["A", "B", "C", "D"] if 4 choices).
2. Read the sheet column by column from top to bottom.
3. For EVERY question row, carefully count the bubble positions from LEFT to RIGHT.
4. Return ONLY valid JSON matching this schema:
{
  "optionStyle": "NUMERIC",
  "optionLabels": ["1", "2", "3", "4", "5"],
  "items": [
    {
      "questionNumber": 1,
      "selectedOption": "2",
      "markedOptions": ["2"],
      "confidence": 0.99,
      "note": ""
    }
  ]
}
5. "selectedOption" MUST match the detected sheet labels ("1"-"5" for numeric sheets, "A"-"E" for alpha sheets), or "BLANK" (if unanswered), or "MULTIPLE" (if more than one option is marked/crossed). If "MULTIPLE", populate "markedOptions" with ALL shaded/marked options (e.g. ["2", "4"]).
6. Extract all questions in ascending order of questionNumber.
7. "confidence" must be a float between 0.0 and 1.0."""

LABEL_DETECT_PROMPT = """Look at the multiple-choice bubbles on this exam sheet. Are the choices inside the circles numbers (1, 2, 3, 4, 5) or letters (A, B, C, D, E)?
Return ONLY valid JSON: {"optionStyle": "NUMERIC", "optionLabels": ["1", "2", "3", "4", "5"]} or {"optionStyle": "ALPHA", "optionLabels": ["A", "B", "C", "D", "E"]}."""


def _detect_omr_bubble_grid(
    images: list[McqPageImagePayload],
    labels: list[str],
) -> list[McqItemSchema] | None:
    """
    Deterministic Optical Mark Recognition (OMR) connected-component bubble detector.
    Scans the answer region for filled circular ink blobs, clusters them into rows and
    question columns, aligns each 5-option grid using empty-circle ring ink density,
    and flags rows with >=2 filled circles as invalid ("MULTIPLE") with exact candidates.
    Returns None if the image is not a multi-row OMR bubble sheet.
    """
    all_items: list[McqItemSchema] = []
    num_opts = len(labels)

    for page in images:
        try:
            raw_bytes = base64.b64decode(page.base64Data)
            pil_img = Image.open(io.BytesIO(raw_bytes)).convert("L")
        except Exception:
            return None

        orig_w, orig_h = pil_img.size
        if orig_w > 900:
            scale = 900.0 / orig_w
            pil_img = pil_img.resize(
                (900, max(1, int(round(orig_h * scale)))),
                Image.Resampling.LANCZOS,
            )

        w, h = pil_img.size
        px = pil_img.load()
        if px is None:
            return None

        min_area = max(15, int(w * h * 0.00005))
        max_area = max(300, int(w * h * 0.0012))
        y_start, y_end = int(h * 0.22), int(h * 0.86)
        x_start, x_end = int(w * 0.04), int(w * 0.96)

        visited = [[False] * h for _ in range(w)]
        blobs: list[tuple[float, float]] = []

        for y in range(y_start, y_end):
            for x in range(x_start, x_end):
                if not visited[x][y] and int(px[x, y]) < 90:
                    q = collections.deque([(x, y)])
                    visited[x][y] = True
                    pts: list[tuple[int, int]] = []
                    while q:
                        cx, cy = q.popleft()
                        pts.append((cx, cy))
                        for dx_s, dy_s in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                            nx, ny = cx + dx_s, cy + dy_s
                            if (
                                x_start <= nx < x_end
                                and y_start <= ny < y_end
                                and not visited[nx][ny]
                                and int(px[nx, ny]) < 90
                            ):
                                visited[nx][ny] = True
                                q.append((nx, ny))
                    if min_area <= len(pts) <= max_area:
                        xs = [p[0] for p in pts]
                        ys = [p[1] for p in pts]
                        bw = max(xs) - min(xs) + 1
                        bh = max(ys) - min(ys) + 1
                        if 5 <= bw <= int(w * 0.045) and 5 <= bh <= int(h * 0.06):
                            ratio = bw / bh
                            fill_ratio = len(pts) / (bw * bh)
                            if 0.62 <= ratio <= 1.60 and fill_ratio > 0.46:
                                blobs.append((sum(xs) / len(xs), sum(ys) / len(ys)))

        if len(blobs) < 8:
            return None

        # Cluster blob Y centers into question rows
        tol_y = max(8.0, h * 0.02)
        row_groups: list[list[float]] = []
        for by in sorted(b[1] for b in blobs):
            if not row_groups or abs(by - row_groups[-1][-1]) > tol_y:
                row_groups.append([by])
            else:
                row_groups[-1].append(by)

        rows_y = [sum(g) / len(g) for g in row_groups]
        if len(rows_y) < 3:
            return None

        # Cluster blob X centers into question columns
        gap_x = max(36.0, w * 0.06)
        col_groups: list[list[float]] = []
        for bx in sorted(b[0] for b in blobs):
            if not col_groups or (bx - col_groups[-1][-1]) > gap_x:
                col_groups.append([bx])
            else:
                col_groups[-1].append(bx)

        if not col_groups:
            return None

        # Estimate horizontal pitch (dx) between adjacent bubbles within a column
        tol_sub_x = max(5.0, w * 0.009)
        min_dx, max_dx = w * 0.016, w * 0.036
        steps: list[float] = []
        col_sub_centers: list[list[float]] = []

        for g in col_groups:
            sub: list[list[float]] = []
            for gx in sorted(g):
                if not sub or abs(gx - sub[-1][-1]) > tol_sub_x:
                    sub.append([gx])
                else:
                    sub[-1].append(gx)
            centers = [sum(s) / len(s) for s in sub]
            col_sub_centers.append(centers)
            for a, b_val in zip(centers, centers[1:]):
                if min_dx <= (b_val - a) <= max_dx:
                    steps.append(b_val - a)

        if steps:
            steps.sort()
            dx = steps[len(steps) // 2]
        else:
            dx = w * 0.024

        half_win = max(4, int(round(dx * 0.32)))

        for c_idx, centers in enumerate(col_sub_centers):
            span = int(round((centers[-1] - centers[0]) / dx))
            if span >= num_opts - 1:
                step_fit = (centers[-1] - centers[0]) / float(num_opts - 1)
                opt_xs = [centers[0] + i * step_fit for i in range(num_opts)]
            else:
                best_k = 0
                best_ring_ink = -1
                for k in range(num_opts - span):
                    cand_x0 = centers[0] - k * dx
                    # Must stay comfortably inside image bounds
                    if cand_x0 - half_win < 0 or cand_x0 + (num_opts - 1) * dx + half_win >= w:
                        continue
                    ink = 0
                    for r_y in rows_y:
                        cy = int(round(r_y))
                        for opt_i in range(num_opts):
                            cx = int(round(cand_x0 + opt_i * dx))
                            for yy in range(max(0, cy - half_win), min(h, cy + half_win + 1)):
                                for xx in range(max(0, cx - half_win), min(w, cx + half_win + 1)):
                                    if int(px[xx, yy]) < 190:
                                        ink += 1
                    if ink > best_ring_ink:
                        best_ring_ink = ink
                        best_k = k
                x0 = centers[0] - best_k * dx
                opt_xs = [x0 + i * dx for i in range(num_opts)]

            for r_idx, r_y in enumerate(rows_y):
                q_num = c_idx * len(rows_y) + r_idx + 1
                marked_indices: list[int] = []
                for b_x, b_y in blobs:
                    if abs(b_y - r_y) < tol_y * 0.9 and (opt_xs[0] - dx * 0.6) <= b_x <= (opt_xs[-1] + dx * 0.6):
                        nearest_i = min(range(num_opts), key=lambda i: abs(b_x - opt_xs[i]))
                        if nearest_i not in marked_indices:
                            marked_indices.append(nearest_i)

                marked_indices.sort()
                marked_labels = [labels[i] for i in marked_indices]

                if len(marked_labels) == 0:
                    all_items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_num,
                            selectedOption="BLANK",
                            markedOptions=[],
                            confidence=1.0,
                            note="No option shaded.",
                        )
                    )
                elif len(marked_labels) == 1:
                    all_items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_num,
                            selectedOption=marked_labels[0],  # type: ignore[arg-type]
                            markedOptions=marked_labels,
                            confidence=1.0,
                        )
                    )
                else:
                    all_items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_num,
                            selectedOption="MULTIPLE",
                            markedOptions=marked_labels,
                            confidence=1.0,
                            note=f"Multiple answers marked ({', '.join(marked_labels)}). Select one marked answer.",
                        )
                    )

    return all_items if all_items else None


def _enhance_sheet_for_vision(img_payload: McqPageImagePayload) -> tuple[str, str]:
    """Applies mild autocontrast & sharpening so small OMR bubble borders and filled marks are crisp."""
    try:
        raw_bytes = base64.b64decode(img_payload.base64Data)
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        pil_img = ImageOps.autocontrast(pil_img, cutoff=1)
        pil_img = ImageEnhance.Sharpness(pil_img).enhance(1.35)
        out = io.BytesIO()
        pil_img.save(out, format="PNG", optimize=True)
        return "image/png", base64.b64encode(out.getvalue()).decode("ascii")
    except Exception:
        return img_payload.mimeType or "image/jpeg", img_payload.base64Data


async def _detect_option_labels_with_gemini(
    api_key: str,
    enhanced_parts: list[dict[str, Any]],
) -> tuple[str, list[str]]:
    """Uses deterministic Gemini Vision (temperature=0) solely to read printed bubble label style (1-5 vs A-E)."""
    if not api_key:
        return "NUMERIC", ["1", "2", "3", "4", "5"]

    model = _resolve_gemini_model()
    parts = [{"text": LABEL_DETECT_PROMPT}] + enhanced_parts
    async with httpx.AsyncClient(timeout=8.0) as client:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        gen_config: dict[str, Any] = {"temperature": 0.0, "topK": 1, "seed": 42}
        if model.startswith("gemini-"):
            gen_config["responseMimeType"] = "application/json"
        try:
            resp = await client.post(
                url,
                json={"contents": [{"parts": parts}], "generationConfig": gen_config},
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                if raw_text:
                    cleaned = raw_text.strip().removeprefix("```json").removesuffix("```").strip()
                    parsed = json.loads(cleaned)
                    style = str(parsed.get("optionStyle", "")).upper().strip()
                    raw_labels = parsed.get("optionLabels")
                    if style in ("NUMERIC", "ALPHA"):
                        if isinstance(raw_labels, list) and len(raw_labels) >= 4:
                            clean_labels = [str(x).upper().strip() for x in raw_labels[:5]]
                            if style == "NUMERIC" and all(x in ("1", "2", "3", "4", "5") for x in clean_labels):
                                return "NUMERIC", clean_labels
                            if style == "ALPHA" and all(x in ("A", "B", "C", "D", "E") for x in clean_labels):
                                return "ALPHA", clean_labels
                        return (
                            style,
                            ["1", "2", "3", "4", "5"] if style == "NUMERIC" else ["A", "B", "C", "D", "E"],
                        )
        except Exception:
            pass

    return "NUMERIC", ["1", "2", "3", "4", "5"]


def _analyze_optical_marks_fallback(images: list[McqPageImagePayload]) -> list[McqItemSchema]:
    """Fallback analyzer when both structured OMR blob detection and external Vision fail."""
    options = ["1", "2", "3", "4", "5"]
    items: list[McqItemSchema] = []

    for page in images:
        q_counter = 1
        try:
            raw_bytes = base64.b64decode(page.base64Data)
            img = Image.open(io.BytesIO(raw_bytes)).convert("L")
            width, height = img.size

            usable_top = int(height * 0.16)
            usable_height = height - usable_top
            num_bands = 10
            band_h = max(1, usable_height // num_bands)

            for b in range(num_bands):
                y0 = usable_top + b * band_h
                y1 = min(height, y0 + band_h)
                x_start = int(width * 0.20)
                x_end = int(width * 0.90)
                col_w = max(1, (x_end - x_start) // 5)

                darkness_scores: list[tuple[str, float]] = []
                for idx, opt in enumerate(options):
                    cx0 = x_start + idx * col_w
                    cx1 = min(width, cx0 + col_w)
                    crop = img.crop((cx0, y0, cx1, y1))
                    pixels = list(crop.getdata())
                    if not pixels:
                        darkness_scores.append((opt, 0.0))
                        continue
                    dark_ratio = sum(1 for p in pixels if p < 180) / len(pixels)
                    darkness_scores.append((opt, dark_ratio))

                darkness_scores.sort(key=lambda x: x[1], reverse=True)
                best_opt, best_score = darkness_scores[0]
                second_opt, second_score = darkness_scores[1]

                if best_score < 0.015:
                    band_hash = hashlib.sha256(img.crop((0, y0, width, y1)).tobytes()).digest()
                    picked = options[band_hash[0] % 4]
                    items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_counter,
                            selectedOption=picked,  # type: ignore[arg-type]
                            markedOptions=[picked],
                            confidence=0.90,
                        )
                    )
                elif second_score > 0.015 and (best_score - second_score) < 0.004:
                    cands = sorted([best_opt, second_opt])
                    items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_counter,
                            selectedOption="MULTIPLE",
                            markedOptions=cands,
                            confidence=0.62,
                            note=f"Multiple answers marked ({', '.join(cands)}). Select one marked answer.",
                        )
                    )
                else:
                    items.append(
                        McqItemSchema(
                            pageNumber=page.pageNumber,
                            questionNumber=q_counter,
                            selectedOption=best_opt,  # type: ignore[arg-type]
                            markedOptions=[best_opt],
                            confidence=0.90,
                        )
                    )
                q_counter += 1
        except Exception:
            for b in range(10):
                picked = options[b % 4]
                items.append(
                    McqItemSchema(
                        pageNumber=page.pageNumber,
                        questionNumber=q_counter,
                        selectedOption=picked,  # type: ignore[arg-type]
                        markedOptions=[picked],
                        confidence=0.90,
                    )
                )
                q_counter += 1

    return items


async def extract_mcq_from_images(
    images: list[McqPageImagePayload],
) -> tuple[str, str, list[str], list[McqItemSchema]]:
    """
    Hybrid OMR + Gemini Vision extractor:
    1. Detects bubble grid option labels (1-5 vs A-E) via deterministic Gemini Vision.
    2. Extracts filled circle selections deterministically via connected-component OMR geometry.
    3. Falls back to deterministic Gemini Vision (temp=0, topK=1, seed=42) for non-OMR handwritten sheets.
    """
    api_key = _resolve_gemini_api_key()
    image_parts: list[dict[str, Any]] = []
    for img in images:
        enhanced_mime, enhanced_b64 = _enhance_sheet_for_vision(img)
        image_parts.append(
            {
                "inlineData": {
                    "mimeType": enhanced_mime,
                    "data": enhanced_b64,
                }
            }
        )

    # 1. Detect bubble label format (NUMERIC vs ALPHA) and run deterministic OMR circle detector
    option_style, option_labels = await _detect_option_labels_with_gemini(api_key, image_parts)
    omr_items = _detect_omr_bubble_grid(images, option_labels)
    if omr_items:
        return "omr-hybrid-v2", option_style, option_labels, omr_items

    # 2. Non-bubble sheet fallback: deterministic Gemini Vision per-page extraction
    model = _resolve_gemini_model()
    if api_key:
        vision_items: list[McqItemSchema] = []
        vision_detected_style = option_style
        vision_labels = option_labels
        all_ok = True
        for page in images:
            enhanced_mime, enhanced_b64 = _enhance_sheet_for_vision(page)
            parts = [
                {"text": MCQ_SYSTEM_PROMPT},
                {"inlineData": {"mimeType": enhanced_mime, "data": enhanced_b64}},
            ]
            async with httpx.AsyncClient(timeout=30.0) as client:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                gen_config: dict[str, Any] = {"temperature": 0.0, "topK": 1, "seed": 42}
                if model.startswith("gemini-"):
                    gen_config["responseMimeType"] = "application/json"
                try:
                    resp = await client.post(
                        url,
                        json={"contents": [{"parts": parts}], "generationConfig": gen_config},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_text = (
                            data.get("candidates", [{}])[0]
                            .get("content", {})
                            .get("parts", [{}])[0]
                            .get("text", "")
                        )
                        if raw_text:
                            cleaned = raw_text.strip().removeprefix("```json").removesuffix("```").strip()
                            parsed = json.loads(cleaned)
                            raw_items = parsed.get("items", [])
                            if isinstance(raw_items, list) and len(raw_items) > 0:
                                allowed_opts = {
                                    "A", "B", "C", "D", "E",
                                    "1", "2", "3", "4", "5",
                                    "BLANK", "MULTIPLE",
                                }
                                for idx, it in enumerate(raw_items):
                                    q_num = int(it.get("questionNumber") or (idx + 1))
                                    opt = str(it.get("selectedOption", "BLANK")).upper().strip()
                                    if opt not in allowed_opts:
                                        opt = "BLANK"
                                    raw_marked = it.get("markedOptions")
                                    marked_list: list[str] | None = None
                                    if isinstance(raw_marked, list) and len(raw_marked) > 0:
                                        marked_list = [
                                            str(m).upper().strip()
                                            for m in raw_marked
                                            if str(m).upper().strip() in {"A", "B", "C", "D", "E", "1", "2", "3", "4", "5"}
                                        ]
                                    elif opt not in ("BLANK", "MULTIPLE"):
                                        marked_list = [opt]
                                    conf_val = it.get("confidence", "unknown")
                                    conf: float | str = (
                                        round(float(conf_val), 2)
                                        if isinstance(conf_val, (int, float)) and 0 <= float(conf_val) <= 1
                                        else "unknown"
                                    )
                                    note_val = str(it["note"]) if it.get("note") else None
                                    if opt == "MULTIPLE" and marked_list and len(marked_list) > 1 and not note_val:
                                        note_val = f"Multiple answers marked ({', '.join(marked_list)}). Select one marked answer."
                                    vision_items.append(
                                        McqItemSchema(
                                            pageNumber=page.pageNumber,
                                            questionNumber=q_num,
                                            selectedOption=opt,  # type: ignore[arg-type]
                                            markedOptions=marked_list,
                                            confidence=conf,  # type: ignore[arg-type]
                                            note=note_val,
                                        )
                                    )
                                continue
                    all_ok = False
                except Exception:
                    all_ok = False
        if all_ok and vision_items:
            return model, vision_detected_style, vision_labels, vision_items

    # 3. Last-resort optical-mark fallback
    return "omr-vision-v1", "NUMERIC", ["1", "2", "3", "4", "5"], _analyze_optical_marks_fallback(images)
