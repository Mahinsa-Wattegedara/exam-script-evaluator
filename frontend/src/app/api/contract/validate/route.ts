import { NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${BACKEND_URL}/api/v1/module1/contract/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof data?.detail === "string"
              ? data.detail
              : Array.isArray(data?.detail)
                ? data.detail.map((e: { loc?: (string | number)[]; msg?: string }) => `${(e.loc || []).join(".")}: ${e.msg}`).join("; ")
                : "Backend AnswerReady schema validation failed.",
        },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not reach backend contract validator.",
      },
      { status: 502 },
    );
  }
}
