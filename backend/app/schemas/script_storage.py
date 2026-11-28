"""Pydantic v2 schemas for Module 1 masked script storage and admin purge."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PURGE_CONFIRMATION = "DELETE ALL EXAM FILES"


class MaskedImageUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assessmentId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")
    pageNumber: int = Field(ge=1, le=10)
    maskStatus: Literal["MASKED", "NO_HEADER"]
    mimeType: Literal["image/jpeg", "image/png"]
    # 10 MB decoded ≈ 14 MB base64
    base64Data: str = Field(min_length=16, max_length=14_000_000)


class StoredImageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imageId: str
    scriptCode: str
    objectPath: str
    sizeBytes: int
    uploadedAt: Optional[str] = None


class SignedUrlResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    expiresIn: int


class StorageSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bucket: str
    fileCount: int
    scriptCount: int
    totalBytes: int
    lastPurgeAt: Optional[str] = None
    lastPurgeBy: Optional[str] = None


class PurgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: str
    reason: str = Field(default="", max_length=300)


class PurgeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    filesDeleted: int
    bytesDeleted: int
    purgedAt: str
