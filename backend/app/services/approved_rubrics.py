"""Approved rubric snapshots persisted via Supabase's service-only Data API."""
import httpx
from fastapi import HTTPException

from app.schemas.approved_rubric import ApprovedRubricResponse, ApproveRubricRequest, ArchiveMarkingSchemeResponse
from app.services.structured_extractor import _resolve_env_var


class ApprovedRubricRepository:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        url = _resolve_env_var("SUPABASE_URL") or _resolve_env_var("NEXT_PUBLIC_SUPABASE_URL")
        key = _resolve_env_var("SUPABASE_SECRET_KEY") or _resolve_env_var("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise HTTPException(503, "Configure SUPABASE_URL and a backend-only Supabase service key.")
        self.url = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    async def _request(self, method: str, path: str, **kwargs):
        try:
            response = await self.client.request(method, self.url + path, headers=self.headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(503, "Rubric database is unavailable. Retry without changing expectedVersion.") from exc
        if response.status_code >= 400:
            try:
                error = response.json()
            except ValueError:
                error = {}
            code = error.get("code")
            archiving = path == "/rpc/archive_module2_marking_scheme"
            if code in ("PGRST202", "PGRST204", "42703", "42P01"):
                migration = "003_module2_demo_scheme_reset.sql" if archiving else "002_module2_approved_rubrics.sql"
                raise HTTPException(503, f"Apply migration {migration} to Supabase first.")
            if response.status_code == 409 or code == "23505":
                if archiving and error.get("message") == "This marking scheme is linked to student work.":
                    raise HTTPException(409, error["message"])
                raise HTTPException(409, "The approved version changed. Fetch the latest version and review before retrying.")
            if response.status_code == 404:
                raise HTTPException(404, "Assessment or approved rubric not found.")
            if response.status_code == 403 and code == "PT403":
                raise HTTPException(403, "An active teacher account is required.")
            raise HTTPException(503, "Rubric database operation failed. Check the migration and service-key configuration.")
        return response.json()

    async def approve(self, assessment_id: str, question_id: str, username: str, payload: ApproveRubricRequest):
        data = await self._request("POST", "/rpc/approve_module2_rubric", json={
            "p_assessment_id": assessment_id, "p_question_id": question_id,
            "p_teacher_username": username, "p_title": payload.assessmentTitle,
            "p_course": payload.course, "p_expected_version": payload.expectedVersion,
            "p_question": payload.question.model_dump(mode="json"),
        })
        return ApprovedRubricResponse.model_validate(data)

    async def archive_marking_scheme(self, assessment_id: str, username: str, question_id: str | None):
        data = await self._request("POST", "/rpc/archive_module2_marking_scheme", json={
            "p_assessment_id": assessment_id, "p_teacher_username": username, "p_question_id": question_id,
        })
        return ArchiveMarkingSchemeResponse.model_validate(data)

    async def _question(self, assessment_id: str, question_id: str, username: str) -> str:
        users = await self._request("GET", "/app_users", params={
            "username": f"eq.{username}", "role": "eq.TEACHER", "is_active": "eq.true", "select": "user_id",
        })
        if not users:
            raise HTTPException(403, "An active teacher account is required.")
        assessments = await self._request("GET", "/assessments", params={
            "assessment_id": f"eq.{assessment_id}", "teacher_id": f"eq.{users[0]['user_id']}", "select": "assessment_id",
        })
        if not assessments:
            raise HTTPException(404, "Assessment or approved rubric not found.")
        questions = await self._request("GET", "/questions", params={
            "assessment_id": f"eq.{assessment_id}", "external_question_id": f"eq.{question_id}", "select": "question_id",
        })
        if not questions:
            raise HTTPException(404, "Assessment or approved rubric not found.")
        return questions[0]["question_id"]

    async def read(self, assessment_id: str, question_id: str, username: str, version: int | None = None, latest=False):
        stored_id = await self._question(assessment_id, question_id, username)
        params = {"question_id": f"eq.{stored_id}", "approval_status": "eq.APPROVED", "order": "version.desc",
                  "select": "rubric_id,version,approved_at,approved_by_username,approved_snapshot"}
        if version is not None:
            params["version"] = f"eq.{version}"
        if latest or version is not None:
            params["limit"] = "1"
        rows = await self._request("GET", "/rubrics", params=params)
        if not rows and (latest or version is not None):
            raise HTTPException(404, "Approved rubric version not found.")
        if any(not row.get("approved_snapshot") for row in rows):
            raise HTTPException(409, "A legacy rubric has no full snapshot. Migrate it before retrieval.")
        return [ApprovedRubricResponse(
            rubricId=row["rubric_id"], assessmentId=assessment_id, questionId=question_id,
            version=row["version"], approvedAt=row["approved_at"], approvedBy=row["approved_by_username"],
            question=row["approved_snapshot"],
        ) for row in rows]
