"""
Password-recovery email delivery service (SRS External Interfaces).
Strictly transmits account password-reset links only — never exam scripts or grades.
Supports Resend HTTPS API (primary, port 443) with optional SMTP fallback.
"""
import asyncio
from email.message import EmailMessage
import html
import smtplib
from urllib.parse import urlparse

import httpx

from app.services.structured_extractor import _resolve_env_var

DEFAULT_RESEND_FROM = "ScriptX Security <onboarding@resend.dev>"


def resolve_reset_base_url(client_origin: str | None = None) -> str:
    """Resolves a safe frontend origin for password-reset links (prevents host-header poisoning)."""
    configured = (_resolve_env_var("FRONTEND_URL") or _resolve_env_var("FRONTEND_ORIGIN") or "").strip().rstrip("/")
    if configured and configured != "*":
        return configured.split(",")[0].strip().rstrip("/")

    if client_origin:
        parsed = urlparse(client_origin.strip())
        host = (parsed.hostname or "").lower()
        if parsed.scheme in ("http", "https") and (
            host in ("localhost", "127.0.0.1") or host.endswith(".vercel.app")
        ):
            port_part = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{host}{port_part}"

    return "http://localhost:3000"


def _build_reset_email_html(display_name: str, reset_url: str) -> str:
    safe_name = html.escape(display_name or "User")
    safe_url = html.escape(reset_url, quote=True)
    return f"""<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ef;border-radius:16px;padding:32px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#4338ca;margin-bottom:8px;">
        ScriptX Account Recovery
      </div>
      <h1 style="font-size:22px;margin:0 0 12px 0;color:#111827;">Reset your password</h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 20px 0;">
        Hello {safe_name}, we received a request to reset your ScriptX workspace password. Click the button below within <strong>15 minutes</strong> to choose a new password.
      </p>
      <p style="margin:24px 0;">
        <a href="{safe_url}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">
          Reset Password
        </a>
      </p>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;margin:20px 0 0 0;word-break:break-all;">
        If the button does not open, copy and paste this single-use link:<br/>
        <a href="{safe_url}" style="color:#4338ca;">{safe_url}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e4e7ef;margin:24px 0 16px 0;" />
      <p style="font-size:11px;color:#9ca3af;margin:0;">
        If you did not request this reset, you can safely ignore this email — your password will remain unchanged.
      </p>
    </div>
  </body>
</html>"""


def _send_via_smtp_sync(to_email: str, subject: str, html_body: str, text_body: str) -> tuple[bool, str | None]:
    host = _resolve_env_var("SMTP_HOST", "smtp.gmail.com")
    port = int(_resolve_env_var("SMTP_PORT", "587") or "587")
    user = _resolve_env_var("SMTP_USER")
    password = _resolve_env_var("SMTP_PASS")
    from_addr = _resolve_env_var("SMTP_FROM") or user
    if not user or not password:
        return False, "Email recovery service is not configured on the backend (set RESEND_API_KEY or SMTP credentials)."

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(msg)
        return True, None
    except Exception as exc:
        return False, f"SMTP email delivery failed ({type(exc).__name__})."


async def send_password_reset_email(to_email: str, display_name: str, reset_url: str) -> tuple[bool, str | None]:
    """Sends a password-reset email via Resend HTTPS API (preferred) or SMTP fallback."""
    subject = "Reset your ScriptX password"
    html_body = _build_reset_email_html(display_name, reset_url)
    text_body = (
        f"Hello {display_name or 'User'},\n\n"
        f"Use the single-use link below within 15 minutes to reset your ScriptX password:\n"
        f"{reset_url}\n\n"
        f"If you did not request this, ignore this email."
    )

    resend_key = _resolve_env_var("RESEND_API_KEY")
    if resend_key:
        from_email = _resolve_env_var("RESEND_FROM_EMAIL", DEFAULT_RESEND_FROM) or DEFAULT_RESEND_FROM
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {resend_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": from_email,
                        "to": [to_email],
                        "subject": subject,
                        "html": html_body,
                        "text": text_body,
                    },
                )
            if 200 <= res.status_code < 300:
                return True, None
            detail = ""
            try:
                detail = str(res.json().get("message") or "")
            except Exception:
                detail = res.text[:160]
            if res.status_code == 403 and "own email address" in detail.lower():
                return (
                    False,
                    "Resend sandbox mode can only deliver reset emails to the verified Resend account owner's email address (or verify a custom domain in Resend).",
                )
            return False, f"Email provider rejected delivery ({res.status_code}): {detail}"
        except httpx.HTTPError as exc:
            return False, f"Could not reach Resend email service ({type(exc).__name__})."

    return await asyncio.to_thread(_send_via_smtp_sync, to_email, subject, html_body, text_body)
