import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(reviewId)) {
    return NextResponse.json({ detail: "Invalid rubric review ID." }, { status: 400 });
  }
  const token = (await cookies()).get("ese_session_jwt")?.value;
  if (!token) return NextResponse.json({ detail: "Sign in as a teacher to check review progress." }, { status: 401 });
  const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  try {
    const body = await request.text();
    const response = await fetch(`${backend}/api/v1/module2/rubric/reviews/${reviewId}/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body || undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ detail: "Review progress could not be checked. Try again shortly." }, { status: 502 });
  }
}
