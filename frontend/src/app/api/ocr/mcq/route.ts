import { NextResponse } from "next/server";
import type { McqItem } from "@/lib/types";

type ImagePayload = {
  pageNumber: number;
  mimeType: string;
  base64Data: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      scriptId?: string;
      images?: ImagePayload[];
    };

    const images = body.images ?? [];
    if (images.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one script page image is required." },
        { status: 400 },
      );
    }

    const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const backendRes = await fetch(`${backendUrl}/api/v1/module1/ocr/mcq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptId: body.scriptId || "SCR-ANON",
        images,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!backendRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `FastAPI backend returned HTTP ${backendRes.status}. Ensure the backend server is running on port 8000.`,
        },
        { status: 502 },
      );
    }

    const backendData = (await backendRes.json()) as {
      ok?: boolean;
      model?: string;
      optionStyle?: "ALPHA" | "NUMERIC";
      optionLabels?: string[];
      items?: McqItem[];
      error?: string;
    };

    if (!backendData.ok || !Array.isArray(backendData.items)) {
      return NextResponse.json(
        { ok: false, error: backendData.error || "Unable to extract MCQ answers from backend." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      model: backendData.model ?? "backend-m1",
      optionStyle: backendData.optionStyle,
      optionLabels: backendData.optionLabels,
      items: backendData.items,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Could not reach the FastAPI backend on port 8000. Please ensure the backend server is running.",
      },
      { status: 502 },
    );
  }
}
