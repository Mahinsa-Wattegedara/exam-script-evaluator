"""
Module 1 (Script Intake and Answer Evidence) Pydantic v2 Schemas.
Aligned with SRS Section 4.3 & 4.4 (ExternalInterfaces.docx).
"""
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class RectSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(..., ge=0, le=100)
    y: float = Field(..., ge=0, le=100)
    width: float = Field(..., gt=0, le=100)
    height: float = Field(..., gt=0, le=100)


class EvidenceSpanSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    span_id: str
    text: str
    page_number: int = Field(..., ge=1, le=10)
    region_id: str
    bbox: RectSchema


class AnswerReadySchema(BaseModel):
    """
    AnswerReady (Module 1 -> Module 2) immutable contract.
    Module 2 rejects any record that lacks explicit approval_status == 'APPROVED'.
    """
    model_config = ConfigDict(extra="forbid")

    contract: Literal["AnswerReady"] = "AnswerReady"
    schema_version: Literal["1.0"] = "1.0"
    assessment_id: str
    script_id: str
    pseudonymous_script_code: str
    question_id: str
    transcript_version: int = Field(..., ge=1)
    approved_text: str
    evidence: list[EvidenceSpanSchema]
    approval_status: Literal["PENDING", "APPROVED", "SUPERSEDED"]
    routing_status: Literal[
        "NOT_EXTRACTED",
        "NEEDS_REVIEW",
        "READY_FOR_AI",
        "MANUAL_MARKING",
        "NOT_ATTEMPTED",
    ]


class McqPageImagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pageNumber: int = Field(..., ge=1, le=10)
    mimeType: str = "image/jpeg"
    base64Data: str


class McqExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scriptId: Optional[str] = None
    images: list[McqPageImagePayload] = Field(..., min_length=1, max_length=10)


class McqItemSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pageNumber: Optional[int] = Field(None, ge=1, le=10)
    questionNumber: int = Field(..., ge=1)
    selectedOption: Literal[
        "A", "B", "C", "D", "E",
        "1", "2", "3", "4", "5",
        "BLANK", "MULTIPLE",
    ]
    markedOptions: Optional[list[str]] = None
    confidence: float | Literal["unknown"]
    note: Optional[str] = None
    edited: Optional[bool] = None


class McqExtractionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    model: Optional[str] = None
    optionStyle: Optional[Literal["ALPHA", "NUMERIC"]] = None
    optionLabels: Optional[list[str]] = None
    items: list[McqItemSchema] = Field(default_factory=list)
    error: Optional[str] = None


class StructuredRegionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str
    questionNumber: str = "Q1"
    questionPrompt: Optional[str] = None
    pageNumber: int = Field(default=1, ge=1)
    mimeType: str = "image/jpeg"
    base64Data: str = Field(..., min_length=16)


class StructuredOcrRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pages: Optional[list[McqPageImagePayload]] = Field(default=None, max_length=10)
    regions: Optional[list[StructuredRegionPayload]] = Field(default=None, max_length=25)


class ExtractedSpanSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    lineNumber: int = Field(..., ge=1)
    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class ExtractedFlagSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "LOW_CONFIDENCE",
        "UNCLEAR_CHAR",
        "OUT_OF_BOX",
        "DIAGRAM_DETECTED",
        "BLANK_ANSWER",
        "UNSUPPORTED_CONTENT",
    ]
    message: str
    spanId: Optional[str] = None


class StructuredQuestionResultSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str
    questionNumber: Optional[str] = None
    pageNumber: Optional[int] = Field(default=None, ge=1)
    bbox: Optional[RectSchema] = None
    rawText: str
    blankDetected: bool = False
    spans: list[ExtractedSpanSchema] = Field(default_factory=list)
    flags: list[ExtractedFlagSchema] = Field(default_factory=list)


class StructuredOcrResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    model: str
    results: list[StructuredQuestionResultSchema] = Field(default_factory=list)
    error: Optional[str] = None

