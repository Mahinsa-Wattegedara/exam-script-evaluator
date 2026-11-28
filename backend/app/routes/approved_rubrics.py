from typing import Annotated
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.schemas.approved_rubric import (
    ApprovedRubricResponse, ApproveRubricRequest, ArchiveMarkingSchemeRequest, ArchiveMarkingSchemeResponse,
)
from app.schemas.auth import SessionUserSchema
from app.services.approved_rubrics import ApprovedRubricRepository
from app.services.crypto_service import verify_session_jwt

router = APIRouter(prefix="/api/v1/module2/assessments", tags=["Approved rubrics"])
bearer = HTTPBearer(auto_error=False)
ResourceId = Annotated[str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")]


def require_teacher(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if not os.getenv("AUTH_JWT_SECRET", "").strip():
        raise HTTPException(503, "Configure the backend session signing secret before using rubric storage.")
    user = verify_session_jwt(credentials.credentials if credentials else None)
    if not user:
        raise HTTPException(401, "A valid session bearer token is required.", headers={"WWW-Authenticate": "Bearer"})
    if user.role != "TEACHER":
        raise HTTPException(403, "Only teachers can access approved rubrics.")
    return user


async def repository():
    async with httpx.AsyncClient(timeout=20.0) as client:
        yield ApprovedRubricRepository(client)


Teacher = Annotated[SessionUserSchema, Depends(require_teacher)]
Repository = Annotated[ApprovedRubricRepository, Depends(repository)]


@router.post("/{assessment_id}/rubrics/archive", response_model=ArchiveMarkingSchemeResponse)
async def archive_marking_scheme(assessment_id: ResourceId, payload: ArchiveMarkingSchemeRequest, user: Teacher, repo: Repository):
    return await repo.archive_marking_scheme(assessment_id, user.username, payload.questionId)


@router.post("/{assessment_id}/questions/{question_id}/rubrics/approve", response_model=ApprovedRubricResponse, status_code=201)
async def approve(assessment_id: ResourceId, question_id: ResourceId, payload: ApproveRubricRequest, user: Teacher, repo: Repository):
    return await repo.approve(assessment_id, question_id, user.username, payload)


@router.get("/{assessment_id}/questions/{question_id}/rubrics", response_model=list[ApprovedRubricResponse])
async def list_versions(assessment_id: ResourceId, question_id: ResourceId, user: Teacher, repo: Repository):
    return await repo.read(assessment_id, question_id, user.username)


@router.get("/{assessment_id}/questions/{question_id}/rubrics/latest", response_model=ApprovedRubricResponse)
async def latest(assessment_id: ResourceId, question_id: ResourceId, user: Teacher, repo: Repository):
    return (await repo.read(assessment_id, question_id, user.username, latest=True))[0]


@router.get("/{assessment_id}/questions/{question_id}/rubrics/{version}", response_model=ApprovedRubricResponse)
async def exact_version(assessment_id: ResourceId, question_id: ResourceId, version: Annotated[int, Path(ge=1)], user: Teacher, repo: Repository):
    return (await repo.read(assessment_id, question_id, user.username, version=version))[0]
