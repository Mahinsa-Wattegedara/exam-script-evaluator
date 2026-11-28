"""
Supabase Credential & Identity Verification Service (NFR-01, NFR-02).
Executes strictly on the FastAPI backend over HTTPS/TLS against public.app_users.
"""
import os
from urllib.parse import quote
import httpx
from app.schemas.auth import RegisterRequestSchema, SessionUserSchema, UserRole
from app.services.crypto_service import (
    decrypt_aes256,
    encrypt_aes256,
    hash_password,
    password_hash_fingerprint,
    sign_password_reset_token,
    sign_session_jwt,
    verify_password,
    verify_password_reset_token,
)
from app.services.email_service import resolve_reset_base_url, send_password_reset_email

PROTECTED_DEMO_USERNAMES = {"dr.silva", "245001k", "admin"}
GENERIC_RESET_MESSAGE = (
    "If an active account matches that email or username, a 15-minute password reset link has been sent."
)


from pathlib import Path
from dotenv import load_dotenv

# Ensure environment variables are loaded
_backend_env = Path(__file__).resolve().parent.parent.parent / ".env"
_frontend_env = Path(__file__).resolve().parent.parent.parent.parent / "frontend" / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env, override=True)
elif _frontend_env.exists():
    load_dotenv(_frontend_env, override=True)

def _get_supabase_config() -> tuple[str, str] | None:
    # Always reload from file if exists to prevent stale cache across reloads
    if _backend_env.exists():
        load_dotenv(_backend_env, override=True)
    elif _frontend_env.exists():
        load_dotenv(_frontend_env, override=True)
    url = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    ).strip()
    if not url or not key:
        return None
    return url.rstrip("/"), key


async def authenticate_with_supabase(
    identifier: str,
    password: str,
    expected_role: UserRole,
) -> tuple[bool, SessionUserSchema | None, str | None, str | None]:
    """
    Verifies user credentials against Supabase public.app_users.
    Returns (ok, user, jwt_token, error).
    """
    cfg = _get_supabase_config()
    if not cfg:
        return (
            False,
            None,
            None,
            "Supabase is not configured on the backend. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in SYSTEM/backend/.env.",
        )

    base_url, api_key = cfg
    clean_id = identifier.strip().lower()
    encoded_id = quote(clean_id, safe="")
    query_url = (
        f"{base_url}/rest/v1/app_users"
        f"?or=(username.ilike.{encoded_id},email.ilike.{encoded_id})&is_active=eq.true&select=*"
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                query_url,
                headers={
                    "apikey": api_key,
                    "Authorization": f"Bearer {api_key}",
                },
            )
    except Exception as exc:
        return False, None, None, f"Could not reach Supabase over HTTPS ({type(exc).__name__}: {exc})."

    if res.status_code >= 400:
        return (
            False,
            None,
            None,
            f"Supabase query failed ({res.status_code}). {res.text[:120]}",
        )

    rows = res.json()
    if not isinstance(rows, list) or not rows:
        return False, None, None, "Invalid username or password."

    row = rows[0]
    if not verify_password(password, str(row.get("password_hash", ""))):
        return False, None, None, "Invalid username or password."

    actual_role = row.get("role")
    if actual_role != expected_role:
        return (
            False,
            None,
            None,
            f"Account '{row.get('username')}' belongs to role {actual_role}, not {expected_role}.",
        )

    student_id: str | None = None
    pseudonymous_code: str | None = None
    try:
        if row.get("encrypted_student_id"):
            student_id = decrypt_aes256(str(row["encrypted_student_id"]))
        if row.get("encrypted_pseudonym"):
            pseudonymous_code = decrypt_aes256(str(row["encrypted_pseudonym"]))
    except Exception:
        return (
            False,
            None,
            None,
            "Failed to decrypt AES-256 identity attributes. Check DATA_AES256_KEY in backend .env.",
        )

    user = SessionUserSchema(
        username=str(row["username"]),
        displayName=str(row["display_name"]),
        role=expected_role,
        studentId=student_id,
        pseudonymousCode=pseudonymous_code,
    )
    token = sign_session_jwt(user)
    return True, user, token, None


async def register_user_in_supabase(
    payload: RegisterRequestSchema,
) -> tuple[bool, SessionUserSchema | None, str | None, str | None]:
    """
    Registers a new user in Supabase public.app_users with PBKDF2 hashing and AES-256-GCM encryption.
    Returns (ok, user, jwt_token, error).
    """
    cfg = _get_supabase_config()
    if not cfg:
        return (
            False,
            None,
            None,
            "Supabase is not configured on the backend. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in SYSTEM/backend/.env.",
        )

    base_url, api_key = cfg
    username = payload.username.strip()
    email = (payload.email or f"{username.lower()}@uom.lk").strip().lower()
    display_name = (payload.displayName or username).strip() or username
    student_id = (
        (payload.studentId.strip() if payload.studentId else username)
        if payload.role == "STUDENT"
        else None
    )
    pseudonym = payload.pseudonymousCode.strip() if payload.pseudonymousCode else None

    password_hash = hash_password(payload.password)
    encrypted_student_id = encrypt_aes256(student_id) if student_id else None
    encrypted_pseudonym = encrypt_aes256(pseudonym) if pseudonym else None

    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"{base_url}/rest/v1/app_users",
                headers=headers,
                json={
                    "username": username,
                    "email": email,
                    "name": display_name,
                    "display_name": display_name,
                    "password_hash": password_hash,
                    "role": payload.role,
                    "encrypted_student_id": encrypted_student_id,
                    "encrypted_pseudonym": encrypted_pseudonym,
                    "is_active": True,
                },
            )
            if res.status_code >= 400:
                return (
                    False,
                    None,
                    None,
                    f"Could not create user in Supabase ({res.status_code}): {res.text[:140]}",
                )

            created_rows = res.json()
            user_id = created_rows[0].get("user_id") if isinstance(created_rows, list) and created_rows else None

            # Propagate subtype according to FIXED_ER.pdf
            if user_id:
                if payload.role == "TEACHER":
                    await client.post(
                        f"{base_url}/rest/v1/teachers",
                        headers={"apikey": api_key, "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={"teacher_id": user_id, "department": "Department of Computer Science & Engineering", "title_prefix": "Dr."},
                    )
                elif payload.role == "STUDENT":
                    await client.post(
                        f"{base_url}/rest/v1/students",
                        headers={"apikey": api_key, "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={"student_id": user_id, "pseudonym_code": pseudonym},
                    )
                    if encrypted_student_id and pseudonym:
                        await client.post(
                            f"{base_url}/rest/v1/student_identity_map",
                            headers={
                                "apikey": api_key,
                                "Authorization": f"Bearer {api_key}",
                                "Content-Type": "application/json",
                            },
                            json={
                                "assessment_id": "asm-cs2042-mid-2026",
                                "student_id": user_id,
                                "pseudonym_code": pseudonym,
                                "encrypted_real_student_id": encrypted_student_id,
                            },
                        )
                elif payload.role == "ADMIN":
                    await client.post(
                        f"{base_url}/rest/v1/project_admins",
                        headers={"apikey": api_key, "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={"admin_id": user_id, "access_level": "SYSTEM_ADMIN"},
                    )
    except Exception:
        return False, None, None, "Registration service error communicating with Supabase."

    user = SessionUserSchema(
        username=username,
        displayName=display_name,
        role=payload.role,
        studentId=student_id,
        pseudonymousCode=pseudonym,
    )
    token = sign_session_jwt(user)
    return True, user, token, None


async def request_password_reset(
    identifier: str,
    client_origin: str | None = None,
) -> tuple[bool, str, str | None]:
    """
    Generates a 15-minute single-use reset link and emails it to the user's registered email.
    Protects built-in demo accounts and avoids account enumeration.
    Returns (ok, message, error).
    """
    cfg = _get_supabase_config()
    if not cfg:
        return False, "", "Supabase is not configured on the backend."

    clean_id = identifier.strip().lower()
    if not clean_id:
        return False, "", "Please enter your registered email address or username."

    if clean_id in PROTECTED_DEMO_USERNAMES or clean_id in {f"{u}@uom.lk" for u in PROTECTED_DEMO_USERNAMES}:
        return (
            False,
            "",
            "Built-in demonstration accounts (dr.silva, 245001K, admin) have fixed credentials so live demos remain consistent. Register a personal account with your email to use password recovery.",
        )

    base_url, api_key = cfg
    encoded_id = quote(clean_id, safe="")
    query_url = (
        f"{base_url}/rest/v1/app_users"
        f"?or=(username.ilike.{encoded_id},email.ilike.{encoded_id})&is_active=eq.true&select=user_id,username,email,display_name,password_hash"
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                query_url,
                headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"},
            )
    except Exception:
        return False, "", "Could not reach authentication database."

    if res.status_code >= 400:
        return False, "", "Authentication database lookup failed."

    rows = res.json()
    if not isinstance(rows, list) or not rows:
        return True, GENERIC_RESET_MESSAGE, None

    row = rows[0]
    username = str(row.get("username") or "")
    if username.lower() in PROTECTED_DEMO_USERNAMES:
        return (
            False,
            "",
            "Built-in demonstration accounts have fixed credentials. Register a personal account with your email to use password recovery.",
        )

    to_email = str(row.get("email") or "").strip()
    if not to_email or "@" not in to_email:
        return True, GENERIC_RESET_MESSAGE, None

    try:
        token = sign_password_reset_token(
            user_id=str(row["user_id"]),
            username=username,
            stored_password_hash=str(row.get("password_hash") or ""),
        )
    except RuntimeError as exc:
        return False, "", str(exc)

    origin = resolve_reset_base_url(client_origin)
    reset_url = f"{origin}/reset-password?token={quote(token, safe='')}"
    sent, err = await send_password_reset_email(
        to_email=to_email,
        display_name=str(row.get("display_name") or username),
        reset_url=reset_url,
    )
    if not sent:
        return False, "", err or "Could not send password recovery email."

    return True, GENERIC_RESET_MESSAGE, None


async def complete_password_reset(token: str, new_password: str) -> tuple[bool, str, str | None]:
    """
    Verifies the 15-minute single-use token (including password-hash fingerprint)
    and updates password_hash in public.app_users.
    """
    if len(new_password) < 8:
        return False, "", "New password must be at least 8 characters long."

    claims = verify_password_reset_token(token.strip())
    if not claims:
        return False, "", "This password reset link is invalid or has expired. Please request a new link."

    if claims["username"].lower() in PROTECTED_DEMO_USERNAMES:
        return False, "", "Built-in demonstration account passwords cannot be modified."

    cfg = _get_supabase_config()
    if not cfg:
        return False, "", "Supabase is not configured on the backend."
    base_url, api_key = cfg

    user_id_enc = quote(claims["user_id"], safe="")
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            lookup = await client.get(
                f"{base_url}/rest/v1/app_users?user_id=eq.{user_id_enc}&is_active=eq.true&select=user_id,username,password_hash",
                headers=headers,
            )
            if lookup.status_code >= 400:
                return False, "", "Could not verify account status."
            rows = lookup.json()
            if not isinstance(rows, list) or not rows:
                return False, "", "This password reset link is invalid or has expired."

            current_hash = str(rows[0].get("password_hash") or "")
            if password_hash_fingerprint(current_hash) != claims["pwd_fp"]:
                return False, "", "This password reset link has already been used. Please request a new link if needed."

            updated_hash = hash_password(new_password)
            patch_res = await client.patch(
                f"{base_url}/rest/v1/app_users?user_id=eq.{user_id_enc}",
                headers={**headers, "Prefer": "return=representation"},
                json={"password_hash": updated_hash},
            )
            if patch_res.status_code >= 400:
                return False, "", "Could not update password in database."
    except Exception:
        return False, "", "Could not reach authentication database."

    return True, "Your password has been updated. You can now log in with your new password.", None

