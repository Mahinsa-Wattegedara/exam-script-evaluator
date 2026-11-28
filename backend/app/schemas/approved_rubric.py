from datetime import datetime
from decimal import Decimal
import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.module2 import DraftQuestion
from app.services.rubric_validation import parse_rubric_questions


class ApproveRubricRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    assessmentTitle: str = Field(min_length=1, max_length=300)
    course: str = Field(min_length=1, max_length=300)
    expectedVersion: int = Field(ge=0, strict=True)
    question: DraftQuestion

    @model_validator(mode="after")
    def validate_complete_rubric(self):
        if not re.fullmatch(r"Q[1-9][0-9]*", self.question.number):
            raise ValueError("Main question numbers must use Q1, Q2, etc.")
        parse_rubric_questions('{"questions":[' + self.question.model_dump_json() + ']}')
        amounts = [self.question.maxMarks]
        amounts += [part.maxMarks for part in self.question.subquestions]
        for criterion in self.question.criteria:
            amounts += [criterion.maxMarks, *criterion.allowedPartialCredits]
        if any(value > 999.99 or Decimal(str(value)).normalize().as_tuple().exponent < -2 for value in amounts):
            raise ValueError("Marks must be at most 999.99 with at most two decimal places.")
        return self


class ApprovedRubricResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rubricId: str
    assessmentId: str
    questionId: str
    version: int = Field(ge=1)
    approvedAt: datetime
    approvedBy: str
    question: DraftQuestion


class ArchiveMarkingSchemeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")


class ArchiveMarkingSchemeResponse(BaseModel):
    archivedQuestions: int = Field(ge=0)
