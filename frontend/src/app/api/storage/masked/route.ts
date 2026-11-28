import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "ese_session_jwt";
const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

async function authHeaders(): Promise<Record<string, string> | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export async function PUT(request: Request) {
  try {
    const auth = await authHeaders();
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Sign in as a teacher to sync masked script images." }, { status: 401 });
    }
    const body = (await request.json()) as {
      scriptCode?: string;
      imageId?: string;
      assessmentId?: string;
      pageNumber?: number;
      maskStatus?: "MASKED" | "NO_HEADER";
      mimeType?: "image/jpeg" | "image/png";
      base64Data?: string;
    };
    const scriptCode = (body.scriptCode || "").trim();
    const imageId = (body.imageId || "").trim();
    if (!SAFE_ID.test(scriptCode) || !SAFE_ID.test(imageId)) {
      return NextResponse.json({ ok: false, error: "Invalid scriptCode or imageId." }, { status: 400 });
    }

    const res = await fetch(
      `${BACKEND_URL}/api/v1/module1/scripts/${encodeURIComponent(scriptCode)}/images/${encodeURIComponent(imageId)}/masked`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          assessmentId: body.assessmentId,
          pageNumber: body.pageNumber,
          maskStatus: body.maskStatus,
          mimeType: body.mimeType,
          base64Data: body.base64Data,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.detail || data?.error || `Storage upload failed (${res.status})` },
        { status: res.status },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not reach script storage service." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authHeaders();
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    const url = new URL(request.url);
    const scriptCode = (url.searchParams.get("scriptCode") || "").trim();
    const imageId = (url.searchParams.get("imageId") || "").trim();
    if (!SAFE_ID.test(scriptCode) || !SAFE_ID.test(imageId)) {
      return NextResponse.json({ ok: false, error: "Invalid scriptCode or imageId." }, { status: 400 });
    }

    const res = await fetch(
      `${BACKEND_URL}/api/v1/module1/scripts/${encodeURIComponent(scriptCode)}/images/${encodeURIComponent(imageId)}/masked`,
      {
        method: "DELETE",
        headers: auth,
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.detail || data?.error || `Storage delete failed (${res.status})` },
        { status: res.status },
      );
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not reach script storage service." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authHeaders();
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    const url = new URL(request.url);
    const scriptCode = (url.searchParams.get("scriptCode") || "").trim();
    const imageId = (url.searchParams.get("imageId") || "").trim();
    if (!SAFE_ID.test(scriptCode) || !SAFE_ID.test(imageId)) {
      return NextResponse.json({ ok: false, error: "Invalid scriptCode or imageId." }, { status: 400 });
    }

    const res = await fetch(
      `${BACKEND_URL}/api/v1/module1/scripts/${encodeURIComponent(scriptCode)}/images/${encodeURIComponent(imageId)}/masked-url`,
      {
        method: "GET",
        headers: auth,
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.detail || data?.error || `Signed URL fetch failed (${res.status})` },
        { status: res.status },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not reach script storage service." },
      { status: 502 },
    );
  }
}
