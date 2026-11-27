import copy
import os
import unittest
from unittest.mock import patch

import httpx

from app.main import app
from app.routes.approved_rubrics import repository
from app.schemas.auth import SessionUserSchema
from app.services.approved_rubrics import ApprovedRubricRepository
from app.services.crypto_service import sign_session_jwt
from test_rubric_draft import draft


class ApprovedRubricApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"AUTH_JWT_SECRET": "test-only-rubric-signing-secret-at-least-32-bytes"})
        self.env.start()
        self.config = patch("app.services.approved_rubrics._resolve_env_var", side_effect=lambda key: "https://database.example" if key == "SUPABASE_URL" else "test-service-key")
        self.config.start()
        self.calls = []
        self.fail = None
        self.owner = True
        self.rows = []
        self.transport = httpx.MockTransport(self.handle_db)

        async def test_repository():
            async with httpx.AsyncClient(transport=self.transport) as client:
                yield ApprovedRubricRepository(client)
        app.dependency_overrides[repository] = test_repository
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.path = "/api/v1/module2/assessments/asm-test/questions/q1/rubrics"
        self.payload = {"assessmentTitle": "OOP", "course": "CS", "expectedVersion": 0, "question": draft()["questions"][0]}
        self.headers = self.token("TEACHER")

    def token(self, role):
        user = SessionUserSchema(username="teacher-one", displayName="Teacher", role=role)
        return {"Authorization": "Bearer " + sign_session_jwt(user)}

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        self.config.stop()
        self.env.stop()

    def handle_db(self, request):
        import json
        self.calls.append(request)
        if self.fail == "network":
            raise httpx.ConnectError("offline", request=request)
        if self.fail:
            return httpx.Response(self.fail[0], json={"code": self.fail[1], "message": "Do not expose database details"})
        if request.url.path.endswith("/rpc/approve_module2_rubric"):
            body = json.loads(request.content)
            self.assertEqual(body["p_teacher_username"], "teacher-one")
            row = {"rubric_id": "rubric-1", "version": 1, "approved_at": "2026-11-24T10:00:00Z", "approved_by_username": "teacher-one", "approved_snapshot": body["p_question"]}
            self.rows = [row]
            return httpx.Response(200, json={"rubricId": "rubric-1", "assessmentId": "asm-test", "questionId": "q1", "version": 1, "approvedAt": row["approved_at"], "approvedBy": "teacher-one", "question": body["p_question"]})
        if request.url.path.endswith("/rpc/archive_module2_marking_scheme"):
            body = json.loads(request.content)
            self.assertEqual(body["p_assessment_id"], "asm-test")
            self.assertEqual(body["p_teacher_username"], "teacher-one")
            return httpx.Response(200, json={"archivedQuestions": 1 if body["p_question_id"] else 3})
        if request.url.path.endswith("/app_users"):
            self.assertEqual(request.url.params["username"], "eq.teacher-one")
            return httpx.Response(200, json=[{"user_id": "teacher-id"}])
        if request.url.path.endswith("/assessments"):
            self.assertEqual(request.url.params["teacher_id"], "eq.teacher-id")
            return httpx.Response(200, json=[{"assessment_id": "asm-test"}] if self.owner else [])
        if request.url.path.endswith("/questions"):
            self.assertEqual(request.url.params["assessment_id"], "eq.asm-test")
            return httpx.Response(200, json=[{"question_id": "internal-q1"}])
        if request.url.path.endswith("/rubrics"):
            return httpx.Response(200, json=[row for row in self.rows if "version" not in request.url.params or request.url.params["version"] == f"eq.{row['version']}"])
        raise AssertionError("Unexpected database request")

    async def test_requires_valid_teacher_session(self):
        for headers, status in [({}, 401), ({"Authorization": "Bearer invalid"}, 401), (self.token("STUDENT"), 403)]:
            response = await self.client.post(self.path + "/approve", json=self.payload, headers=headers)
            self.assertEqual(response.status_code, status)
        self.assertEqual(self.calls, [])

    async def test_missing_signing_secret_fails_closed(self):
        with patch.dict(os.environ, {"AUTH_JWT_SECRET": ""}):
            response = await self.client.get(self.path + "/latest", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [])

    async def test_approve_and_retrieve_preserves_complete_snapshot(self):
        response = await self.client.post(self.path + "/approve", json=self.payload, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        for suffix in ["/latest", "/1"]:
            loaded = await self.client.get(self.path + suffix, headers=self.headers)
            self.assertEqual(loaded.status_code, 200)
            self.assertEqual(loaded.json(), response.json())
        versions = await self.client.get(self.path, headers=self.headers)
        self.assertEqual(versions.json(), [response.json()])
        self.assertIn("scoringGuide", response.json()["question"]["criteria"][0])

    async def test_ownership_is_checked_before_reading_rubrics(self):
        self.owner = False
        response = await self.client.get(self.path + "/latest", headers=self.headers)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(any(call.url.path.endswith("/rubrics") for call in self.calls))

    async def test_missing_version_returns_404_and_empty_history_is_valid(self):
        self.assertEqual((await self.client.get(self.path + "/2", headers=self.headers)).status_code, 404)
        self.assertEqual((await self.client.get(self.path, headers=self.headers)).json(), [])

    async def test_rejects_bad_marks_and_spoofed_approval_metadata_before_database(self):
        for changes in [{"expectedVersion": -1}, {"approvedBy": "someone-else"}, {"approvedAt": "2020-01-01"}]:
            payload = {**copy.deepcopy(self.payload), **changes}
            self.assertEqual((await self.client.post(self.path + "/approve", json=payload, headers=self.headers)).status_code, 422)
        payload = copy.deepcopy(self.payload)
        payload["question"]["maxMarks"] = 7
        self.assertEqual((await self.client.post(self.path + "/approve", json=payload, headers=self.headers)).status_code, 422)
        self.assertEqual(self.calls, [])

    async def test_database_conflict_migration_and_network_errors_are_clear(self):
        for failure, status in [((409, "PT409"), 409), ((404, "PGRST202"), 503), ("network", 503)]:
            self.fail = failure
            response = await self.client.post(self.path + "/approve", json=self.payload, headers=self.headers)
            self.assertEqual(response.status_code, status)
            self.assertNotIn("Do not expose", response.text)

    async def test_no_update_or_delete_route_for_approved_versions(self):
        for method in ("PATCH", "DELETE"):
            self.assertEqual((await self.client.request(method, self.path + "/1", headers=self.headers)).status_code, 405)

    async def test_teacher_can_archive_one_question_or_the_current_scheme(self):
        path = "/api/v1/module2/assessments/asm-test/rubrics/archive"
        self.assertEqual((await self.client.post(path, json={}, headers=self.token("STUDENT"))).status_code, 403)
        self.assertEqual((await self.client.post(path, json={"questionId": "*"}, headers=self.headers)).status_code, 422)
        self.assertEqual(self.calls, [])
        for body, count in [({"questionId": "q1"}, 1), ({"questionId": None}, 3)]:
            result = await self.client.post(path, json=body, headers=self.headers)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json(), {"archivedQuestions": count})
        self.fail = (404, "PGRST202")
        missing_migration = await self.client.post(path, json={}, headers=self.headers)
        self.assertEqual(missing_migration.status_code, 503)
        self.assertIn("003_module2_demo_scheme_reset.sql", missing_migration.json()["detail"])


if __name__ == "__main__":
    unittest.main()
