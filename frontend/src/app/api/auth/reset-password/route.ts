import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string; newPassword?: string };
    const token = body.token?.trim() ?? "";
    const newPassword = body.newPassword ?? "";
    if (!token || !newPassword) {
      return NextResponse.json(
        { ok: false, error: "Reset token and new password are required." },
        { status: 400 },
      );
    }

    const backendUrl = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(
      /\/$/,
      "",
    );
    const backendRes = await fetch(`${backendUrl}/api/v1/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await backendRes.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };

    if (!backendRes.ok || !data.ok) {
      return NextResponse.json(
        { ok: false, error: data.error || "Could not reset password." },
        { status: backendRes.status === 400 ? 400 : 502 },
      );
    }

    return NextResponse.json({ ok: true, message: data.message });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the authentication server." },
      { status: 502 },
    );
  }
}
