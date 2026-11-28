import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type Context = { params: Promise<{ assessmentId: string; questionId: string }> };

async function forward(request: Request, context: Context) {
  const { assessmentId, questionId } = await context.params;
  if (![assessmentId, questionId].every(id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id))) {
    return NextResponse.json({ detail: "Invalid assessment or question ID." }, { status: 400 });
  }
  // The session token stays in the HttpOnly cookie, never in browser JavaScript.
  const token = (await cookies()).get("ese_session_jwt")?.value;
  if (!token) return NextResponse.json({ detail: "Sign in as a teacher to save or load approved rubrics." }, { status: 401 });
  const version = new URL(request.url).searchParams.get("version");
  if (version && !/^[1-9][0-9]*$/.test(version)) {
    return NextResponse.json({ detail: "Invalid rubric version." }, { status: 400 });
  }
  const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const suffix = request.method === "POST" ? "approve" : version || "latest";
  try {
    const response = await fetch(`${backend}/api/v1/module2/assessments/${assessmentId}/questions/${questionId}/rubrics/${suffix}`, {
      method: request.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ detail: "The rubric storage service could not be reached. Load the saved approval before retrying; the save may have completed." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
