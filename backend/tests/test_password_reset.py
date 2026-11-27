import json
import os
import unittest
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import httpx

from app.main import app
from app.schemas.auth import SessionUserSchema
from app.services.crypto_service import (
    hash_password,
    sign_password_reset_token,
    sign_session_jwt,
    verify_password,
    verify_password_reset_token,
    verify_session_jwt,
)


class PasswordResetTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "AUTH_JWT_SECRET": "test-only-auth-signing-secret-at-least-32-bytes",
                "SUPABASE_URL": "https://supabase.example",
                "SUPABASE_SERVICE_ROLE_KEY": "test-service-key",
                "RESEND_API_KEY": "re_test_dummy_key",
                "FRONTEND_URL": "https://scriptx-demo.vercel.app",
            },
        )
        self.env.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.env.stop()

    def test_reset_and_session_tokens_are_domain_separated(self):
        user = SessionUserSchema(username="alice.teacher", displayName="Alice", role="TEACHER")
        session_tok = sign_session_jwt(user)
        reset_tok = sign_password_reset_token("uid-1", "alice.teacher", hash_password("OriginalPass!1"))

        self.assertIsNotNone(verify_session_jwt(session_tok))
        self.assertIsNone(verify_password_reset_token(session_tok))
        self.assertIsNotNone(verify_password_reset_token(reset_tok))
        self.assertIsNone(verify_session_jwt(reset_tok))

    async def test_demo_accounts_are_protected(self):
        for ident in ("dr.silva", "245001K", "admin", "dr.silva@uom.lk"):
            res = await self.client.post(
                "/api/v1/auth/forgot-password",
                json={"identifier": ident},
            )
            self.assertEqual(res.status_code, 400)
            self.assertIn("demonstration", res.json()["error"].lower())

        # Direct token reset for a demo account is also blocked
        demo_tok = sign_password_reset_token("uid-demo", "dr.silva", hash_password("Teacher@123"))
        res2 = await self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": demo_tok, "newPassword": "NewPassword!99"},
        )
        self.assertEqual(res2.status_code, 400)
        self.assertIn("demonstration", res2.json()["error"].lower())

    async def test_unknown_user_returns_generic_200_without_email(self):
        sent_calls = []

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def get(self, url, **kwargs):
                return httpx.Response(200, json=[])

            async def post(self, url, **kwargs):
                sent_calls.append(url)
                return httpx.Response(200, json={"id": "msg-1"})

        with patch("app.services.supabase_auth.httpx.AsyncClient", FakeAsyncClient), patch(
            "app.services.email_service.httpx.AsyncClient", FakeAsyncClient
        ):
            res = await self.client.post(
                "/api/v1/auth/forgot-password",
                json={"identifier": "nobody@example.com"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ok"])
        self.assertEqual(sent_calls, [])

    async def test_full_forgot_and_single_use_reset_flow(self):
        user_row = {
            "user_id": "11111111-1111-1111-1111-111111111111",
            "username": "lecturer.perera",
            "email": "perera@example.com",
            "display_name": "K. Perera",
            "password_hash": hash_password("OldPassword123"),
        }
        email_payloads = []

        class FakeHttpClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def get(self, url, **kwargs):
                return httpx.Response(200, json=[user_row])

            async def patch(self, url, **kwargs):
                body = kwargs.get("json") or {}
                user_row["password_hash"] = body["password_hash"]
                return httpx.Response(200, json=[user_row])

            async def post(self, url, **kwargs):
                email_payloads.append(kwargs.get("json"))
                return httpx.Response(200, json={"id": "resend-email-1"})

        with patch("app.services.supabase_auth.httpx.AsyncClient", FakeHttpClient), patch(
            "app.services.email_service.httpx.AsyncClient", FakeHttpClient
        ), patch("app.services.email_service._resolve_env_var", side_effect=lambda k, d="": {
            "RESEND_API_KEY": "re_test_dummy_key",
            "FRONTEND_URL": "https://scriptx-demo.vercel.app",
        }.get(k, d)):
            req = await self.client.post(
                "/api/v1/auth/forgot-password",
                json={"identifier": "perera@example.com"},
            )
            self.assertEqual(req.status_code, 200)
            self.assertEqual(len(email_payloads), 1)
            self.assertEqual(email_payloads[0]["to"], ["perera@example.com"])

            # Extract reset token from email body link
            text = email_payloads[0]["text"]
            url_line = [ln for ln in text.splitlines() if "reset-password?token=" in ln][0]
            token = parse_qs(urlparse(url_line.strip()).query)["token"][0]

            # Complete reset
            done = await self.client.post(
                "/api/v1/auth/reset-password",
                json={"token": token, "newPassword": "BrandNewPassword99!"},
            )
            self.assertEqual(done.status_code, 200)
            self.assertTrue(verify_password("BrandNewPassword99!", user_row["password_hash"]))

            # Token reuse must fail (fingerprint changed!)
            reuse = await self.client.post(
                "/api/v1/auth/reset-password",
                json={"token": token, "newPassword": "AnotherPassword88!"},
            )
            self.assertEqual(reuse.status_code, 400)
            self.assertIn("already been used", reuse.json()["error"].lower())
