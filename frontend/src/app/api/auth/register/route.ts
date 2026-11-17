import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SessionUser, UserRole } from "@/lib/types";

const SESSION_COOKIE_NAME = "ese_session_jwt";
const JWT_TTL_SECONDS = 60 * 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      username?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      displayName?: string;
      studentId?: string;
      pseudonymousCode?: string;
    };

    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    const role: UserRole = body.role === "STUDENT" ? "STUDENT" : "TEACHER";
    const email = body.email?.trim() || `${username.toLowerCase()}@uom.lk`;
    const displayName = body.displayName?.trim() || username;

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400 },
      );
    }

    const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const backendRes = await fetch(`${backendUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email,
        password,
        role,
        displayName,
        studentId: role === "STUDENT" ? body.studentId?.trim() || username : undefined,
        pseudonymousCode: body.pseudonymousCode?.trim(),
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await backendRes.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: SessionUser;
      token?: string;
      error?: string;
    };

    if (!backendRes.ok || !data.ok || !data.user || !data.token) {
      return NextResponse.json(
        { ok: false, error: data.error || "Could not create user." },
        { status: backendRes.status === 400 ? 400 : 502 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: JWT_TTL_SECONDS,
    });

    return NextResponse.json({ ok: true, user: data.user });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the FastAPI backend on port 8000 for registration." },
      { status: 502 },
    );
  }
}
