"""Module 1 masked-page storage (TEACHER) and storage purge (ADMIN) endpoints."""
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.schemas.auth import SessionUserSchema
from app.schemas.script_storage import (
    PURGE_CONFIRMATION,
    MaskedImageUploadRequest,
    PurgeRequest,
    PurgeResponse,
    SignedUrlResponse,
    StorageSummaryResponse,
    StoredImageResponse,
)
from app.services.crypto_service import verify_session_jwt
from app.services.script_storage import ScriptStorageRepository

router = APIRouter(tags=["Script storage"])
bearer = HTTPBearer(auto_error=False)
SafeId = Annotated[str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")]


def _session(credentials: HTTPAuthorizationCredentials | None) -> SessionUserSchema:
    if not os.getenv("AUTH_JWT_SECRET", "").strip():
        raise HTTPException(503, "Configure the backend session signing secret before using script storage.")
    user = verify_session_jwt(credentials.credentials if credentials else None)
    if not user:
        raise HTTPException(401, "A valid session bearer token is required.", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_teacher(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> SessionUserSchema:
    user = _session(credentials)
    if user.role != "TEACHER":
        raise HTTPException(403, "Only teachers can store or view script pages.")
    return user


def require_admin(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> SessionUserSchema:
    user = _session(credentials)
    if user.role != "ADMIN":
        raise HTTPException(403, "Only administrators can manage exam storage.")
    return user


async def storage_repository():
    async with httpx.AsyncClient(timeout=60.0) as client:
        yield ScriptStorageRepository(client)


Teacher = Annotated[SessionUserSchema, Depends(require_teacher)]
Admin = Annotated[SessionUserSchema, Depends(require_admin)]
Repo = Annotated[ScriptStorageRepository, Depends(storage_repository)]


@router.put("/api/v1/module1/scripts/{script_code}/images/{image_id}/masked", response_model=StoredImageResponse)
async def upload_masked_page(script_code: SafeId, image_id: SafeId, payload: MaskedImageUploadRequest, user: Teacher, repo: Repo):
    return await repo.upload_masked(script_code, image_id, user.username, payload)


@router.delete("/api/v1/module1/scripts/{script_code}/images/{image_id}/masked")
async def delete_masked_page(script_code: SafeId, image_id: SafeId, user: Teacher, repo: Repo) -> dict[str, bool]:
    return {"ok": True, "deleted": await repo.delete_image(image_id)}


@router.get("/api/v1/module1/scripts/{script_code}/images/{image_id}/masked-url", response_model=SignedUrlResponse)
async def masked_page_url(script_code: SafeId, image_id: SafeId, user: Teacher, repo: Repo):
    return await repo.signed_url(image_id)


@router.get("/api/v1/admin/storage/summary", response_model=StorageSummaryResponse)
async def storage_summary(user: Admin, repo: Repo):
    return await repo.summary()


@router.post("/api/v1/admin/storage/purge", response_model=PurgeResponse)
async def purge_storage(payload: PurgeRequest, user: Admin, repo: Repo):
    if payload.confirm.strip() != PURGE_CONFIRMATION:
        raise HTTPException(422, f'Type "{PURGE_CONFIRMATION}" exactly to confirm.')
    return await repo.purge_all(user.username, payload.reason.strip())
