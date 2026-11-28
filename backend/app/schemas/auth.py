"""
Authentication & Identity Pydantic v2 Schemas (SRS Section 4.3 & 4.4).
"""
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict

UserRole = Literal["TEACHER", "STUDENT", "ADMIN"]


class SessionUserSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    displayName: str
    role: UserRole
    studentId: Optional[str] = None
    pseudonymousCode: Optional[str] = None


class LoginRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str
    role: UserRole = "TEACHER"


class RegisterRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    email: Optional[str] = None
    password: str
    role: UserRole = "TEACHER"
    displayName: Optional[str] = None
    studentId: Optional[str] = None
    pseudonymousCode: Optional[str] = None


class AuthResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    user: Optional[SessionUserSchema] = None
    token: Optional[str] = None
    error: Optional[str] = None


class SessionVerifyRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str


class SessionVerifyResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authenticated: bool
    user: Optional[SessionUserSchema] = None


class ForgotPasswordRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifier: str
    origin: Optional[str] = None


class ForgotPasswordResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    message: str = ""
    error: Optional[str] = None


class ResetPasswordRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str
    newPassword: str


class ResetPasswordResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    message: str = ""
    error: Optional[str] = None

