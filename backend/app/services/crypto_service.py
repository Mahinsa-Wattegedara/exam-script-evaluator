"""
Server-side Cryptographic & JWT Service (NFR-02).
Implements AES-256-GCM identity encryption, PBKDF2-HMAC-SHA256 password hashing,
and short-lived HS256 JWT session tokens (1-hour TTL per SRS Section 4.4).
"""
import hashlib
import hmac
import os
import time
import uuid
import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.schemas.auth import SessionUserSchema

JWT_TTL_SECONDS = 60 * 60


def _get_aes_key() -> bytes:
    secret = os.getenv("DATA_AES256_KEY", "")
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _get_jwt_secret() -> str:
    return os.getenv("AUTH_JWT_SECRET", "")


def encrypt_aes256(plaintext: str) -> str:
    """Encrypts plaintext using AES-256-GCM in {iv_hex}:{tag_hex}:{ciphertext_hex} format."""
    iv = os.urandom(12)
    aesgcm = AESGCM(_get_aes_key())
    ct_and_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ct = ct_and_tag[:-16]
    tag = ct_and_tag[-16:]
    return f"{iv.hex()}:{tag.hex()}:{ct.hex()}"


def decrypt_aes256(payload: str) -> str:
    """Decrypts an AES-256-GCM {iv_hex}:{tag_hex}:{ciphertext_hex} payload."""
    parts = payload.split(":")
    if len(parts) != 3 or not all(parts):
        raise ValueError("Invalid AES-256-GCM ciphertext format")
    iv_hex, tag_hex, data_hex = parts
    aesgcm = AESGCM(_get_aes_key())
    plaintext = aesgcm.decrypt(
        bytes.fromhex(iv_hex),
        bytes.fromhex(data_hex) + bytes.fromhex(tag_hex),
        None,
    )
    return plaintext.decode("utf-8")


def hash_password(password: str, salt_hex: str | None = None) -> str:
    """Hashes a password with PBKDF2-HMAC-SHA256 (100,000 iterations) and a 128-bit salt."""
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000, dklen=32)
    return f"pbkdf2_sha256$100000${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verifies a plaintext password against a stored PBKDF2-HMAC-SHA256 hash."""
    parts = stored_hash.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    _, _, salt_hex, expected_hex = parts
    candidate_hex = hash_password(password, salt_hex).split("$")[3]
    try:
        return hmac.compare_digest(bytes.fromhex(candidate_hex), bytes.fromhex(expected_hex))
    except ValueError:
        return False


def sign_session_jwt(user: SessionUserSchema) -> str:
    """Signs a short-lived HS256 JWT for HttpOnly session cookies."""
    now = int(time.time())
    claims = {
        "sub": user.username,
        "username": user.username,
        "displayName": user.displayName,
        "role": user.role,
        "studentId": user.studentId,
        "pseudonymousCode": user.pseudonymousCode,
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(claims, _get_jwt_secret(), algorithm="HS256")


def verify_session_jwt(token: str | None) -> SessionUserSchema | None:
    """Verifies an HS256 JWT signature and expiration timestamp."""
    if not token:
        return None
    try:
        claims = jwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])
        return SessionUserSchema(
            username=claims["username"],
            displayName=claims["displayName"],
            role=claims["role"],
            studentId=claims.get("studentId"),
            pseudonymousCode=claims.get("pseudonymousCode"),
        )
    except Exception:
        return None

