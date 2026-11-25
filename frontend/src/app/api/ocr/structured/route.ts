import { NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${BACKEND_URL}/api/v1/module1/ocr/structured`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.detail || data?.error || `Backend structured OCR failed (${res.status})`,
        },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.message.includes("timeout") || err.message.includes("aborted"));
    return NextResponse.json(
      {
        ok: false,
        error: isTimeout
          ? "AI extraction timed out. The model is taking longer than expected on large/dense pages. Please retry or map specific question regions."
          : (err instanceof Error ? err.message : "Structured OCR proxy request failed"),
      },
      { status: 504 },
    );
  }
}
