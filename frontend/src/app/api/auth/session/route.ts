import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/types";

const SESSION_COOKIE_NAME = "ese_session_jwt";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
    }

    const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const backendRes = await fetch(`${backendUrl}/api/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });

    if (!backendRes.ok) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
    }

    const data = (await backendRes.json().catch(() => ({}))) as {
      authenticated?: boolean;
      user?: SessionUser | null;
    };

    if (!data.authenticated || !data.user) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
    }

    return NextResponse.json({ authenticated: true, user: data.user }, { status: 200 });
  } catch {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }
}
