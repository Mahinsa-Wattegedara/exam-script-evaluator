import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(assessmentId)) {
    return NextResponse.json({ detail: "Invalid assessment ID." }, { status: 400 });
  }
  const token = (await cookies()).get("ese_session_jwt")?.value;
  if (!token) return NextResponse.json({ detail: "Sign in as a teacher to remove saved rubrics." }, { status: 401 });
  const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  try {
    const response = await fetch(`${backend}/api/v1/module2/assessments/${assessmentId}/rubrics/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ detail: "The rubric service could not confirm removal. Retry the same action to check its result." }, { status: 502 });
  }
}
