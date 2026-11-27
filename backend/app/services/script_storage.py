"""
Module 1 masked script storage on Supabase Storage (private bucket) via the
backend-only service key. Only header-masked / no-header pages are accepted
(NFR-02): unmasked originals never leave the teacher's browser.
"""
import base64
import binascii
import io
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from PIL import Image

from app.schemas.script_storage import (
    MaskedImageUploadRequest,
    PurgeResponse,
    SignedUrlResponse,
    StorageSummaryResponse,
    StoredImageResponse,
)
from app.services.structured_extractor import _resolve_env_var

BUCKET = "exam-scripts-masked"
MAX_BYTES = 10 * 1024 * 1024
MIGRATION_HINT = "Apply migration 003_module1_masked_script_storage.sql to Supabase first."
_EXT = {"image/jpeg": "jpg", "image/png": "png"}
_PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG"}


def decode_and_verify_image(mime_type: str, base64_data: str) -> bytes:
    """Decodes base64 and confirms the bytes really are a JPEG/PNG matching mime_type."""
    data = base64_data.split(",", 1)[1] if base64_data.startswith("data:") else base64_data
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(422, "Image payload is not valid base64.") from exc
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(422, "Image must be between 1 byte and 10 MB.")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            fmt = img.format
            img.verify()
    except Exception as exc:
        raise HTTPException(422, "Payload is not a decodable JPEG or PNG image.") from exc
    if fmt != _PIL_FORMAT[mime_type]:
        raise HTTPException(422, f"Image content ({fmt}) does not match declared type {mime_type}.")
    return raw


class ScriptStorageRepository:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        url = _resolve_env_var("SUPABASE_URL") or _resolve_env_var("NEXT_PUBLIC_SUPABASE_URL")
        key = _resolve_env_var("SUPABASE_SECRET_KEY") or _resolve_env_var("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise HTTPException(503, "Configure SUPABASE_URL and a backend-only Supabase service key.")
        base = url.rstrip("/")
        self.rest = base + "/rest/v1"
        self.storage = base + "/storage/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    # ------------------------------------------------------------------ helpers
    async def _call(self, method: str, url: str, *, what: str, **kwargs) -> httpx.Response:
        headers = {**self.headers, **kwargs.pop("headers", {})}
        try:
            response = await self.client.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(503, f"Supabase is unavailable ({what}). Retry shortly.") from exc
        if response.status_code >= 400:
            try:
                body = response.json()
            except ValueError:
                body = {}
            code = str(body.get("code") or body.get("error") or "")
            message = str(body.get("message") or "")
            if code in ("PGRST202", "PGRST204", "PGRST205", "42P01", "42703") or "Bucket not found" in message:
                raise HTTPException(503, MIGRATION_HINT)
            if response.status_code == 404 or "not_found" in code.lower() or "Object not found" in message:
                raise HTTPException(404, "Stored script image not found.")
            raise HTTPException(503, f"Supabase storage operation failed ({what}).")
        return response

    @staticmethod
    def object_path(assessment_id: str, script_code: str, image_id: str, mime_type: str) -> str:
        return f"{assessment_id}/{script_code}/{image_id}.{_EXT[mime_type]}"

    async def _index_row(self, image_id: str) -> dict | None:
        rows = (await self._call(
            "GET", self.rest + "/module1_script_files", what="index lookup",
            params={"image_id": f"eq.{image_id}", "select": "object_path,size_bytes,script_code,uploaded_at"},
        )).json()
        return rows[0] if rows else None

    # --------------------------------------------------------------- teacher ops
    async def upload_masked(self, script_code: str, image_id: str, username: str, payload: MaskedImageUploadRequest) -> StoredImageResponse:
        raw = decode_and_verify_image(payload.mimeType, payload.base64Data)
        path = self.object_path(payload.assessmentId, script_code, image_id, payload.mimeType)

        previous = await self._index_row(image_id)
        await self._call(
            "POST", f"{self.storage}/object/{BUCKET}/{quote(path)}", what="upload",
            content=raw, headers={"Content-Type": payload.mimeType, "x-upsert": "true", "cache-control": "no-store"},
        )
        if previous and previous["object_path"] != path:
            await self._delete_objects([previous["object_path"]])

        rows = (await self._call(
            "POST", self.rest + "/module1_script_files", what="index upsert",
            params={"on_conflict": "image_id"},
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json={
                "image_id": image_id,
                "assessment_id": payload.assessmentId,
                "script_code": script_code,
                "page_number": payload.pageNumber,
                "mask_status": payload.maskStatus,
                "object_path": path,
                "mime_type": payload.mimeType,
                "size_bytes": len(raw),
                "uploaded_by_username": username,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            },
        )).json()
        row = rows[0] if isinstance(rows, list) and rows else {}
        return StoredImageResponse(
            imageId=image_id, scriptCode=script_code, objectPath=path,
            sizeBytes=len(raw), uploadedAt=row.get("uploaded_at"),
        )

    async def delete_image(self, image_id: str) -> bool:
        row = await self._index_row(image_id)
        if not row:
            return False
        await self._delete_objects([row["object_path"]])
        await self._call("DELETE", self.rest + "/module1_script_files", what="index delete",
                         params={"image_id": f"eq.{image_id}"})
        return True

    async def signed_url(self, image_id: str, expires_in: int = 300) -> SignedUrlResponse:
        row = await self._index_row(image_id)
        if not row:
            raise HTTPException(404, "Stored script image not found.")
        data = (await self._call(
            "POST", f"{self.storage}/object/sign/{BUCKET}/{quote(row['object_path'])}", what="sign",
            json={"expiresIn": expires_in},
        )).json()
        signed = data.get("signedURL") or data.get("signedUrl") or ""
        if not signed:
            raise HTTPException(503, "Supabase did not return a signed URL.")
        return SignedUrlResponse(url=self.storage + signed if signed.startswith("/") else signed, expiresIn=expires_in)

    # ----------------------------------------------------------------- admin ops
    async def summary(self) -> StorageSummaryResponse:
        rows = (await self._call(
            "GET", self.rest + "/module1_script_files", what="summary",
            params={"select": "assessment_id,script_code,size_bytes"},
        )).json()
        purges = (await self._call(
            "GET", self.rest + "/module1_storage_purges", what="purge history",
            params={"select": "purged_at,purged_by_username", "order": "purged_at.desc", "limit": "1"},
        )).json()
        return StorageSummaryResponse(
            bucket=BUCKET,
            fileCount=len(rows),
            scriptCount=len({(r["assessment_id"], r["script_code"]) for r in rows}),
            totalBytes=sum(int(r.get("size_bytes") or 0) for r in rows),
            lastPurgeAt=purges[0]["purged_at"] if purges else None,
            lastPurgeBy=purges[0]["purged_by_username"] if purges else None,
        )

    async def _list_all_objects(self, prefix: str = "") -> list[str]:
        """Recursively lists every object path in the bucket (folders have id == null)."""
        paths: list[str] = []
        offset = 0
        while True:
            entries = (await self._call(
                "POST", f"{self.storage}/object/list/{BUCKET}", what="list",
                json={"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            )).json()
            for entry in entries:
                full = f"{prefix}/{entry['name']}" if prefix else entry["name"]
                if entry.get("id") is None:
                    paths.extend(await self._list_all_objects(full))
                else:
                    paths.append(full)
            if len(entries) < 1000:
                return paths
            offset += 1000

    async def _delete_objects(self, paths: list[str]) -> None:
        for i in range(0, len(paths), 1000):
            await self._call("DELETE", f"{self.storage}/object/{BUCKET}", what="delete",
                             json={"prefixes": paths[i:i + 1000]})

    async def purge_all(self, username: str, reason: str) -> PurgeResponse:
        before = await self.summary()
        paths = await self._list_all_objects()
        await self._delete_objects(paths)
        await self._call("DELETE", self.rest + "/module1_script_files", what="index purge",
                         params={"image_id": "not.is.null"})
        purged_at = datetime.now(timezone.utc).isoformat()
        await self._call(
            "POST", self.rest + "/module1_storage_purges", what="purge audit",
            headers={"Prefer": "return=minimal"},
            json={"purged_by_username": username, "files_deleted": len(paths),
                  "bytes_deleted": before.totalBytes, "reason": reason, "purged_at": purged_at},
        )
        return PurgeResponse(ok=True, filesDeleted=len(paths), bytesDeleted=before.totalBytes, purgedAt=purged_at)
