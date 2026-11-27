import json
import re
import unicodedata
from decimal import Decimal

from pydantic import ValidationError

from app.schemas.module2 import DraftQuestion, RubricQualityWarning


NUMBER = r"[0-9]+(?:\.[0-9]+)?"
QUESTION_HEADING = re.compile(r"^[ \t]*(?:question[ \t]+|q[ \t]*)([1-9][0-9]*)[ \t]*[.:|–—-][ \t]+(?!\([a-z]\))(.+)$", re.I | re.M)
PAPER_TOTAL = re.compile(
    rf"^[ \t]*(?:(?:(?:paper|exam(?:ination)?|assessment|overall|grand)[ \t]+)?total(?:[ \t]+marks)?|maximum[ \t]+marks)"
    rf"(?:[ \t]*[:=][ \t]*|[ \t]+)({NUMBER})(?:[ \t]*marks?)?[ \t]*$", re.I | re.M,
)
HEADING_MARKS = re.compile(rf"(?:\(({NUMBER})\s*(?:marks?|m)\)|\[({NUMBER})(?:\s*marks?)?\])\s*$", re.I)
MARK_VALUE = re.compile(rf"\s*[\[(]?\s*({NUMBER})\s*(?:marks?|m)?\s*[\])]?\s*", re.I)
OPTIONAL_QUESTIONS = re.compile(r"\b(?:answer|attempt|choose)\s+(?:any\b|either\b|only\b|(?:one|two|three|four|[0-9]+)\s+of\b)", re.I)


def normalize_draft_fields(item: dict) -> dict:
    number = item.get("number")
    if isinstance(number, str):
        match = re.fullmatch(r"\s*(?:question\s+|q\s*)?0*([1-9][0-9]*)\s*[.:]?\s*", number, re.I)
        if match:
            item["number"] = f"Q{match[1]}"

    def normalize_marks(value):
        if isinstance(value, str) and (match := MARK_VALUE.fullmatch(value)):
            return match[1]
        return value

    def normalize_group(group):
        if isinstance(group, dict) and "maxMarks" in group:
            group["maxMarks"] = normalize_marks(group["maxMarks"])

    normalize_group(item)
    for part in item.get("subquestions") or []:
        normalize_group(part)
    for criterion in item.get("criteria") or []:
        normalize_group(criterion)
        if not isinstance(criterion, dict):
            continue
        if isinstance(criterion.get("allowedPartialCredits"), list):
            criterion["allowedPartialCredits"] = [normalize_marks(value) for value in criterion["allowedPartialCredits"]]
        for score in criterion.get("scoringGuide") or []:
            if isinstance(score, dict) and "marks" in score:
                score["marks"] = normalize_marks(score["marks"])
    return item


class InsufficientRubricSource(ValueError):
    """The document lacks the marks or evidence needed for a complete draft."""


def decode_rubric_questions(content: str) -> list[DraftQuestion]:
    try:
        raw_questions = json.loads(content)["questions"]
        if not isinstance(raw_questions, list):
            raise ValueError("Expected a questions array.")
        questions = [DraftQuestion.model_validate(normalize_draft_fields(item) if isinstance(item, dict) else item) for item in raw_questions]
    except ValidationError as exc:
        issue = exc.errors(include_input=False, include_url=False)[0]
        field = '.'.join(str(part) for part in issue['loc'])
        raise ValueError(f"Invalid draft field {field}: {issue['msg']}.") from exc
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError("Return complete questions with subquestions (id, label, prompt, originalAnswer, maxMarks), criterion subquestionId/sourceExcerpt, alternatives and scoringGuide for every score.") from exc
    if not questions:
        raise InsufficientRubricSource("Check that the source gives clear marks and a model answer or scoring criteria for each item.")
    return questions


def check_rubric_questions(questions: list[DraftQuestion]) -> None:
    if len({q.number for q in questions}) != len(questions):
        raise ValueError("The draft contains duplicate question numbers.")
    for question in questions:
        if not question.prompt.strip() or not re.fullmatch(r"Q[1-9][0-9]*", question.number):
            raise ValueError("A question number or prompt is missing.")
        if len({c.id for c in question.criteria}) != len(question.criteria):
            raise ValueError(f"Duplicate criterion IDs in {question.number}.")
        parts = {part.id: part for part in question.subquestions}
        if len(parts) != len(question.subquestions):
            raise ValueError(f"Duplicate subquestion IDs in {question.number}.")
        part_total = sum(part.maxMarks for part in question.subquestions)
        if abs(part_total - question.maxMarks) > 0.001:
            raise ValueError(f"{question.number} sub-parts sum to {part_total:g} but {question.number} is worth {question.maxMarks:g}.")
        for part in question.subquestions:
            points = [c for c in question.criteria if c.subquestionId == part.id]
            if not part.label.strip() or not part.prompt.strip() or not part.originalAnswer.strip() or not points or abs(sum(c.maxMarks for c in points) - part.maxMarks) > 0.001:
                raise ValueError(f"Provide original answer and correct mark breakdown for {part.label}.")
        for c in question.criteria:
            if c.subquestionId not in parts:
                raise ValueError(f"Unknown subquestion reference in {question.number}/{c.id}.")
            if " ".join(c.sourceExcerpt.split()) not in " ".join(parts[c.subquestionId].originalAnswer.split()):
                raise ValueError(f"sourceExcerpt must be copied verbatim from its originalAnswer in {question.number}/{c.id}.")
            if not c.description.strip() or c.description.strip() == question.prompt.strip():
                raise ValueError(f"State the expected answer, not the question prompt, in {question.number}/{c.id}.")
            if not c.acceptedAlternatives or any(not alt.strip() for alt in c.acceptedAlternatives):
                raise ValueError(f"Provide specific valid alternative answers in {question.number}/{c.id}.")
            scores = c.allowedPartialCredits
            if not scores or len(set(scores)) != len(scores) or 0 not in scores or c.maxMarks not in scores:
                raise ValueError(f"Allowed scores must be unique and include 0 and the maximum in {question.number}/{c.id}.")
            if any(not 0 <= mark <= c.maxMarks for mark in scores):
                raise ValueError(f"Partial credit exceeds a criterion maximum in {question.number}/{c.id}.")
            guide_scores = [entry.marks for entry in c.scoringGuide]
            if len(set(guide_scores)) != len(guide_scores) or set(guide_scores) != set(scores) or any(not entry.description.strip() for entry in c.scoringGuide):
                raise ValueError(f"Explain exactly every allowed score in scoringGuide for {question.number}/{c.id}.")
        if abs(sum(c.maxMarks for c in question.criteria) - question.maxMarks) > 0.001:
            raise ValueError(f"Criterion marks do not total {question.maxMarks} in {question.number}.")


def parse_rubric_questions(content: str) -> list[DraftQuestion]:
    questions = decode_rubric_questions(content)
    check_rubric_questions(questions)
    return questions


def source_question_headings(transcript: str) -> list[re.Match[str]]:
    headings = list(QUESTION_HEADING.finditer(transcript))
    if len(headings) != len({heading[1] for heading in headings}):
        return []
    return headings


def stated_paper_total(transcript: str) -> Decimal | None:
    if OPTIONAL_QUESTIONS.search(transcript):
        return None
    totals = {Decimal(match[1]) for match in PAPER_TOTAL.finditer(transcript)}
    return totals.pop() if len(totals) == 1 else None


def heading_marks(heading: re.Match[str]) -> Decimal | None:
    match = HEADING_MARKS.search(heading[2])
    return Decimal(match[1] or match[2]) if match else None


def normalized_source_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def check_rubric_source(
    questions: list[DraftQuestion], transcript: str, *, check_paper_total: bool = True
) -> list[RubricQualityWarning]:
    headings = source_question_headings(transcript)
    expected_labels = [f"Q{heading[1]}" for heading in headings]
    numbers = [question.number for question in questions]
    if len(headings) > 1 and [number for number in numbers if number in expected_labels] != expected_labels:
        raise ValueError(f"Source includes {', '.join(expected_labels)} in that order. Draft has {', '.join(numbers)}.")
    ordered_numbers = sorted(int(number[1:]) for number in numbers)
    if any(right - left > 1 for left, right in zip(ordered_numbers, ordered_numbers[1:])) and numbers != expected_labels:
        raise ValueError(f"Draft numbering has a gap in {', '.join(numbers)}. Check the missing questions against the source.")

    expected_total = stated_paper_total(transcript) if check_paper_total else None
    if expected_total is not None:
        actual_total = sum(Decimal(str(question.maxMarks)) for question in questions)
        if actual_total != expected_total:
            raise ValueError(
                f"Draft questions total {actual_total.normalize():f} marks but the paper states {expected_total.normalize():f} marks."
            )

    normalized_transcript = normalized_source_text(transcript)
    transcript_words = set(re.findall(r"\w+", normalized_transcript))
    source_marks = {f"Q{heading[1]}": heading_marks(heading) for heading in headings}
    source_sections = {
        f"Q{heading[1]}": normalized_source_text(transcript[heading.start():end])
        for heading, end in zip(headings, [heading.start() for heading in headings[1:]] + [len(transcript)])
    }
    warnings = []
    for question in questions:
        expected_marks = source_marks.get(question.number)
        if expected_marks is not None and Decimal(str(question.maxMarks)) != expected_marks:
            raise ValueError(f"{question.number} is worth {question.maxMarks:g} in the draft but the source states {expected_marks:g}.")
        section = source_sections.get(question.number)
        excerpts_outside_section = False
        for criterion in question.criteria:
            excerpt = normalized_source_text(criterion.sourceExcerpt)
            if excerpt not in normalized_transcript:
                raise ValueError(f"{question.number}/{criterion.id} cites an excerpt that could not be found in the source.")
            if section is not None and excerpt not in section:
                excerpts_outside_section = True
        prompt_words = set(re.findall(r"\w+", normalized_source_text(question.prompt)))
        if prompt_words and len(prompt_words & transcript_words) / len(prompt_words) < 0.6:
            warnings.append(RubricQualityWarning(questionNumber=question.number, message="Check the question wording against the source."))
        if excerpts_outside_section:
            warnings.append(RubricQualityWarning(questionNumber=question.number, message="Some scoring evidence appears outside this question's section. Check that it belongs here."))
    return warnings
