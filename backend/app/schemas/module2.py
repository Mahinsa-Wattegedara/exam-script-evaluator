from pydantic import BaseModel, ConfigDict, Field

from app.schemas.module1 import ScriptPageImagePayload


class RubricDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pages: list[ScriptPageImagePayload] = Field(default_factory=list, max_length=10)
    text: str = Field(default="", max_length=100_000)


class ScoreGuide(BaseModel):
    model_config = ConfigDict(extra="forbid")

    marks: float = Field(ge=0, allow_inf_nan=False)
    description: str = Field(min_length=1)


class DraftCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    subquestionId: str
    sourceExcerpt: str = Field(min_length=1)
    description: str
    maxMarks: float = Field(gt=0, allow_inf_nan=False)
    allowedPartialCredits: list[float] = Field(default_factory=list)
    acceptedAlternatives: list[str] = Field(default_factory=list)
    scoringGuide: list[ScoreGuide] = Field(min_length=2)


class DraftSubquestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    prompt: str
    originalAnswer: str = Field(min_length=1)
    maxMarks: float = Field(gt=0, allow_inf_nan=False)


class DraftQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    number: str
    prompt: str
    maxMarks: float = Field(gt=0, allow_inf_nan=False)
    modelAnswerText: str = ""
    subquestions: list[DraftSubquestion] = Field(min_length=1)
    criteria: list[DraftCriterion] = Field(min_length=1)


class RubricDraftResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questions: list[DraftQuestion]
    transcript: str
    ocrModel: str | None = None
    rubricModel: str
