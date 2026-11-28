import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { identifier?: string };
    const identifier = body.identifier?.trim() ?? "";
    if (!identifier) {
      return NextResponse.json(
        { ok: false, error: "Please enter your registered email address or username." },
        { status: 400 },
      );
    }

    const requestOrigin = req.headers.get("origin") || new URL(req.url).origin;
    const backendUrl = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(
      /\/$/,
      "",
    );
    const backendRes = await fetch(`${backendUrl}/api/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, origin: requestOrigin }),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await backendRes.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };

    if (!backendRes.ok || !data.ok) {
      return NextResponse.json(
        { ok: false, error: data.error || "Could not process password recovery request." },
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
