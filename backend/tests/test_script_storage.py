import base64
import io
import json
import os
import unittest
from unittest.mock import patch

import httpx
from PIL import Image

from app.main import app
from app.routes.script_storage import storage_repository
from app.schemas.auth import SessionUserSchema
from app.schemas.script_storage import PURGE_CONFIRMATION
from app.services.crypto_service import sign_session_jwt
from app.services.script_storage import BUCKET, ScriptStorageRepository


def _sample_jpeg_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), color=(240, 240, 240)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class ScriptStorageApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"AUTH_JWT_SECRET": "test-only-storage-signing-secret-at-least-32-bytes"})
        self.env.start()
        self.config = patch(
            "app.services.script_storage._resolve_env_var",
            side_effect=lambda key: "https://storage.example" if key == "SUPABASE_URL" else "test-service-key",
        )
        self.config.start()
        self.objects: dict[str, bytes] = {}
        self.index_rows: dict[str, dict] = {}
        self.purges: list[dict] = []
        self.transport = httpx.MockTransport(self.handle_supabase)

        async def test_repo():
            async with httpx.AsyncClient(transport=self.transport) as client:
                yield ScriptStorageRepository(client)

        app.dependency_overrides[storage_repository] = test_repo
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.jpeg_b64 = _sample_jpeg_b64()

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        self.config.stop()
        self.env.stop()

    def token(self, role: str, username: str = "user-one") -> dict[str, str]:
        user = SessionUserSchema(username=username, displayName=username, role=role)
        return {"Authorization": "Bearer " + sign_session_jwt(user)}

    def handle_supabase(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.startswith(f"/storage/v1/object/{BUCKET}/") and request.method == "POST":
            obj_path = path.split(f"/storage/v1/object/{BUCKET}/", 1)[1]
            self.objects[obj_path] = request.content
            return httpx.Response(200, json={"Key": f"{BUCKET}/{obj_path}"})
        if path == f"/storage/v1/object/list/{BUCKET}" and request.method == "POST":
            body = json.loads(request.content)
            prefix = body.get("prefix", "")
            entries = []
            seen_folders = set()
            for obj_path in sorted(self.objects):
                if prefix and not obj_path.startswith(prefix + "/"):
                    continue
                rem = obj_path[len(prefix) + 1:] if prefix else obj_path
                if "/" in rem:
                    folder = rem.split("/", 1)[0]
                    if folder not in seen_folders:
                        seen_folders.add(folder)
                        entries.append({"name": folder, "id": None})
                else:
                    entries.append({"name": rem, "id": f"id-{rem}"})
            return httpx.Response(200, json=entries)
        if path == f"/storage/v1/object/{BUCKET}" and request.method == "DELETE":
            body = json.loads(request.content)
            for p in body.get("prefixes", []):
                self.objects.pop(p, None)
            return httpx.Response(200, json=[])
        if path.startswith(f"/storage/v1/object/sign/{BUCKET}/") and request.method == "POST":
            obj_path = path.split(f"/storage/v1/object/sign/{BUCKET}/", 1)[1]
            return httpx.Response(200, json={"signedURL": f"/object/sign/{BUCKET}/{obj_path}?token=abc"})
        if path == "/rest/v1/module1_script_files":
            if request.method == "GET":
                eq_id = request.url.params.get("image_id")
                if eq_id and eq_id.startswith("eq."):
                    key = eq_id[3:]
                    row = self.index_rows.get(key)
                    return httpx.Response(200, json=[row] if row else [])
                return httpx.Response(200, json=list(self.index_rows.values()))
            if request.method == "POST":
                row = json.loads(request.content)
                self.index_rows[row["image_id"]] = row
                return httpx.Response(201, json=[row])
            if request.method == "DELETE":
                eq_id = request.url.params.get("image_id")
                if eq_id and eq_id.startswith("eq."):
                    self.index_rows.pop(eq_id[3:], None)
                else:
                    self.index_rows.clear()
                return httpx.Response(204)
        if path == "/rest/v1/module1_storage_purges":
            if request.method == "GET":
                return httpx.Response(200, json=list(reversed(self.purges))[:1])
            if request.method == "POST":
                self.purges.append(json.loads(request.content))
                return httpx.Response(201)
        return httpx.Response(404, json={"message": f"Unexpected {request.method} {path}"})

    async def test_teacher_upload_signed_url_and_delete(self):
        payload = {
            "assessmentId": "asm-oop-1",
            "pageNumber": 1,
            "maskStatus": "MASKED",
            "mimeType": "image/jpeg",
            "base64Data": self.jpeg_b64,
        }
        res = await self.client.put(
            "/api/v1/module1/scripts/SCR-1234/images/img-1/masked",
            json=payload,
            headers=self.token("TEACHER", "teacher.01"),
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["objectPath"], "asm-oop-1/SCR-1234/img-1.jpg")
        self.assertIn("asm-oop-1/SCR-1234/img-1.jpg", self.objects)

        signed = await self.client.get(
            "/api/v1/module1/scripts/SCR-1234/images/img-1/masked-url",
            headers=self.token("TEACHER", "teacher.01"),
        )
        self.assertEqual(signed.status_code, 200)
        self.assertIn("token=abc", signed.json()["url"])

        deleted = await self.client.delete(
            "/api/v1/module1/scripts/SCR-1234/images/img-1/masked",
            headers=self.token("TEACHER", "teacher.01"),
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["deleted"])
        self.assertEqual(self.objects, {})
        self.assertEqual(self.index_rows, {})

    async def test_role_boundaries_and_invalid_image_rejected(self):
        payload = {
            "assessmentId": "asm-oop-1",
            "pageNumber": 1,
            "maskStatus": "MASKED",
            "mimeType": "image/jpeg",
            "base64Data": self.jpeg_b64,
        }
        # Student & Admin cannot upload masked scripts
        for role in ("STUDENT", "ADMIN"):
            res = await self.client.put(
                "/api/v1/module1/scripts/SCR-1234/images/img-1/masked",
                json=payload,
                headers=self.token(role),
            )
            self.assertEqual(res.status_code, 403)

        # Unauthenticated rejected
        res = await self.client.get("/api/v1/admin/storage/summary")
        self.assertEqual(res.status_code, 401)

        # Teacher cannot view admin summary or purge
        res = await self.client.get("/api/v1/admin/storage/summary", headers=self.token("TEACHER"))
        self.assertEqual(res.status_code, 403)

        # Corrupt / non-JPEG bytes rejected with 422
        bad = {**payload, "base64Data": base64.b64encode(b"not-a-real-jpeg-image").decode("ascii")}
        res = await self.client.put(
            "/api/v1/module1/scripts/SCR-1234/images/img-2/masked",
            json=bad,
            headers=self.token("TEACHER"),
        )
        self.assertEqual(res.status_code, 422)

    async def test_admin_summary_and_purge_all(self):
        for idx in (1, 2):
            res = await self.client.put(
                f"/api/v1/module1/scripts/SCR-999{idx}/images/img-{idx}/masked",
                json={
                    "assessmentId": "asm-oop-1",
                    "pageNumber": 1,
                    "maskStatus": "MASKED",
                    "mimeType": "image/jpeg",
                    "base64Data": self.jpeg_b64,
                },
                headers=self.token("TEACHER", "teacher.01"),
            )
            self.assertEqual(res.status_code, 200)

        before_status = await self.client.get("/api/v1/module1/storage/purge-status")
        self.assertEqual(before_status.status_code, 200)
        self.assertIsNone(before_status.json()["lastPurgeAt"])

        summary = await self.client.get("/api/v1/admin/storage/summary", headers=self.token("ADMIN", "admin.01"))
        self.assertEqual(summary.status_code, 200)
        sdata = summary.json()
        self.assertEqual(sdata["fileCount"], 2)
        self.assertEqual(sdata["scriptCount"], 2)
        self.assertGreater(sdata["totalBytes"], 0)

        # Wrong confirmation rejected
        wrong = await self.client.post(
            "/api/v1/admin/storage/purge",
            json={"confirm": "wrong", "reason": "test"},
            headers=self.token("ADMIN", "admin.01"),
        )
        self.assertEqual(wrong.status_code, 422)

        # Exact confirmation wipes bucket + index + writes purge audit
        purged = await self.client.post(
            "/api/v1/admin/storage/purge",
            json={"confirm": PURGE_CONFIRMATION, "reason": "Exams completed & marks released"},
            headers=self.token("ADMIN", "admin.01"),
        )
        self.assertEqual(purged.status_code, 200)
        pdata = purged.json()
        self.assertTrue(pdata["ok"])
        self.assertEqual(pdata["filesDeleted"], 2)
        self.assertEqual(self.objects, {})
        self.assertEqual(self.index_rows, {})
        self.assertEqual(len(self.purges), 1)
        self.assertEqual(self.purges[0]["purged_by_username"], "admin.01")

        # Summary reflects clean slate + lastPurgeBy
        after = await self.client.get("/api/v1/admin/storage/summary", headers=self.token("ADMIN", "admin.01"))
        self.assertEqual(after.status_code, 200)
        adata = after.json()
        self.assertEqual(adata["fileCount"], 0)
        self.assertEqual(adata["lastPurgeBy"], "admin.01")

        # Cross-browser purge-status reflects latest purge timestamp
        after_status = await self.client.get("/api/v1/module1/storage/purge-status")
        self.assertEqual(after_status.status_code, 200)
        self.assertEqual(after_status.json()["lastPurgeAt"], pdata["purgedAt"])
