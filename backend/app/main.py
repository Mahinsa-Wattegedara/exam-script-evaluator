"""
Exam Script Evaluator — FastAPI 0.162 Backend Monolith (Module 1 Service).
Aligned with SRS Section 4.3 & 4.4 (ExternalInterfaces.docx):
- Python 3.12+
- FastAPI 0.162.0
- Pydantic v2 (extra="forbid")
- LangGraph 1.2.0
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.schemas.auth import (
    AuthResponseSchema,
    LoginRequestSchema,
    RegisterRequestSchema,
    SessionVerifyRequestSchema,
    SessionVerifyResponseSchema,
)
from app.schemas.module1 import (
    AnswerReadySchema,
    StructuredOcrRequest,
    StructuredOcrResponse,
)
from app.schemas.module2 import RubricDraftRequest, RubricDraftResponse
from app.services.rubric_draft import create_rubric_draft
from app.services.crypto_service import verify_session_jwt
from app.services.supabase_auth import authenticate_with_supabase, register_user_in_supabase
from app.routes.approved_rubrics import router as approved_rubrics_router
from app.routes.script_storage import router as script_storage_router

# Load environment variables from backend/.env or frontend/.env
backend_env = Path(__file__).resolve().parent.parent / ".env"
frontend_env = Path(__file__).resolve().parent.parent.parent / "frontend" / ".env"
if backend_env.exists():
    load_dotenv(backend_env, override=True)
elif frontend_env.exists():
    load_dotenv(frontend_env, override=True)

app = FastAPI(
    title="Exam Script Evaluator API",
    version="1.0.0",
    description="Module 1 (Script Intake and Answer Evidence) FastAPI 0.162 Service",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)
app.include_router(approved_rubrics_router)
app.include_router(script_storage_router)


@app.post("/api/v1/module2/rubric/draft-from-script", response_model=RubricDraftResponse)
async def draft_rubric_from_script(payload: RubricDraftRequest) -> RubricDraftResponse:
    from fastapi import HTTPException

    if not payload.pages and not payload.text.strip():
        raise HTTPException(status_code=422, detail="Upload PDF pages or provide document text.")
    try:
        return await create_rubric_draft(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Rubric draft generation failed: {type(exc).__name__}") from exc


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "exam-script-evaluator-backend",
        "fastapi_version": "0.162.0",
        "module": "Module 1 - Script Intake and Answer Evidence",
    }


@app.post("/api/v1/module1/contract/validate")
async def validate_answer_ready_contract(payload: AnswerReadySchema) -> dict[str, object]:
    from fastapi import HTTPException

    if payload.approval_status != "APPROVED":
        raise HTTPException(
            status_code=422,
            detail="Module 2 boundary rejected AnswerReady: approval_status must be 'APPROVED'.",
        )
    if payload.routing_status != "READY_FOR_AI":
        raise HTTPException(
            status_code=422,
            detail="Module 2 boundary rejected AnswerReady: routing_status must be 'READY_FOR_AI'.",
        )
    if (
        not payload.delimited_text
        or not payload.delimited_text.startswith("<student_answer_transcript>")
        or not payload.delimited_text.endswith("</student_answer_transcript>")
    ):
        raise HTTPException(
            status_code=422,
            detail="NFR-04 guardrail violation: delimited_text must be wrapped in <student_answer_transcript> XML delimiters.",
        )
    inner = payload.delimited_text.removeprefix("<student_answer_transcript>").removesuffix("</student_answer_transcript>")
    if "<student_answer_transcript>" in inner or "</student_answer_transcript>" in inner:
        raise HTTPException(
            status_code=422,
            detail="OWASP ASI01 guardrail violation: unescaped delimiter tag found inside student_answer_transcript.",
        )
    return {
        "ok": True,
        "contract": payload.contract,
        "schema_version": payload.schema_version,
        "pseudonymous_script_code": payload.pseudonymous_script_code,
        "question_id": payload.question_id,
        "transcript_version": payload.transcript_version,
        "span_count": len(payload.evidence),
        "validated": payload.model_dump(),
    }


@app.post("/api/v1/module1/ocr/structured", response_model=StructuredOcrResponse)
async def extract_structured_endpoint(payload: StructuredOcrRequest) -> StructuredOcrResponse:
    from app.services.structured_extractor import (
        _resolve_gemini_model,
        extract_structured_from_pages,
        extract_structured_from_regions,
    )

    try:
        if payload.pages:
            model_used, results = await extract_structured_from_pages(payload.pages)
        elif payload.regions:
            model_used, results = await extract_structured_from_regions(payload.regions)
        else:
            return StructuredOcrResponse(
                ok=False,
                model=_resolve_gemini_model(),
                results=[],
                error="Either pages or regions must be provided.",
            )
        return StructuredOcrResponse(
            ok=True,
            model=model_used,
            results=results,
        )
    except Exception as exc:
        return StructuredOcrResponse(
            ok=False,
            model=_resolve_gemini_model(),
            results=[],
            error=str(exc),
        )


@app.post("/api/v1/auth/login", response_model=AuthResponseSchema)
async def login_endpoint(payload: LoginRequestSchema) -> JSONResponse:
    ok, user, token, error = await authenticate_with_supabase(
        payload.username, payload.password, payload.role
    )
    if not ok or not user or not token:
        body = AuthResponseSchema(ok=False, error=error or "Invalid username or password.")
        return JSONResponse(status_code=401, content=body.model_dump())
    body = AuthResponseSchema(ok=True, user=user, token=token)
    return JSONResponse(status_code=200, content=body.model_dump())


@app.post("/api/v1/auth/register", response_model=AuthResponseSchema)
async def register_endpoint(payload: RegisterRequestSchema) -> JSONResponse:
    if payload.role == "ADMIN":
        body = AuthResponseSchema(
            ok=False,
            error="Administrator accounts cannot be self-registered. Contact a system administrator.",
        )
        return JSONResponse(status_code=403, content=body.model_dump())
    ok, user, token, error = await register_user_in_supabase(payload)
    if not ok or not user or not token:
        body = AuthResponseSchema(ok=False, error=error or "Could not create user.")
        return JSONResponse(status_code=400, content=body.model_dump())
    body = AuthResponseSchema(ok=True, user=user, token=token)
    return JSONResponse(status_code=200, content=body.model_dump())


@app.post("/api/v1/auth/session", response_model=SessionVerifyResponseSchema)
async def verify_session_endpoint(payload: SessionVerifyRequestSchema) -> SessionVerifyResponseSchema:
    user = verify_session_jwt(payload.token)
    if not user:
        return SessionVerifyResponseSchema(authenticated=False, user=None)
    return SessionVerifyResponseSchema(authenticated=True, user=user)

