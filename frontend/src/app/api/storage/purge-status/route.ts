import { NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/module1/storage/purge-status`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({ ok: false, lastPurgeAt: null }, { status: res.status });
    }
    return NextResponse.json({ ok: true, lastPurgeAt: data?.lastPurgeAt ?? null });
  } catch {
    return NextResponse.json({ ok: false, lastPurgeAt: null }, { status: 502 });
  }
}
