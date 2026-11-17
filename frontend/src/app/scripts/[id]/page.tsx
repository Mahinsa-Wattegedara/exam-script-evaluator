"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReactCrop, { type Crop, type PercentCrop } from "react-image-crop";
import { PageImage, QUESTION_COLORS, RegionCrop } from "@/components/PageImage";
import { Alert, Badge, Button, Card, CardHeader, MaskBadge, PageHeader } from "@/components/ui";
import { cropRegionToBase64, formatBytes, imageToMaskedBase64 } from "@/lib/image-utils";
import { nowIso, orderedImages } from "@/lib/logic";
import { sampleBlocks } from "@/lib/mock-ocr";
import { useStore } from "@/lib/store";
import type { FlagType, Rect } from "@/lib/types";

type Tab = "order" | "mask" | "map";

const DEFAULT_HEADER_CROP: PercentCrop = { unit: "%", x: 5.2, y: 2.4, width: 90.6, height: 12.8 };
const DEFAULT_REGION_CROP: PercentCrop = { unit: "%", x: 9, y: 17, width: 87, height: 18 };

export default function ScriptWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { state, actions } = useStore();
  const script = state.scripts.find((s) => s.id === params.id);

  const [tab, setTab] = useState<Tab>("order");
  const [selectedImageId, setSelectedImageId] = useState<string>("");
  const [maskCrop, setMaskCrop] = useState<Crop>(DEFAULT_HEADER_CROP);
  const [regionCrop, setRegionCrop] = useState<Crop>(DEFAULT_REGION_CROP);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(state.assessment.questions[0]?.id ?? "q1");
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string>("");

  useEffect(() => {
    if (!script) return;
    const imgs = orderedImages(script);
    if (imgs.length && (!selectedImageId || !imgs.some((i) => i.id === selectedImageId))) {
      setSelectedImageId(imgs[0].id);
    }
  }, [script, selectedImageId]);

  useEffect(() => {
    if (!script) return;
    if (!script.pagesConfirmed) setTab("order");
    else if (script.images.some((i) => i.maskStatus === "PENDING")) setTab("mask");
    else setTab("map");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id]);

  if (!script) {
    return (
      <div className="space-y-4">
        <Alert tone="red" title="Script not found" />
        <Link href="/scripts" className="text-sm font-medium text-indigo-600 hover:underline">
          ← Back to scripts
        </Link>
      </div>
    );
  }

  const imgs = orderedImages(script);
  const currentImg = imgs.find((i) => i.id === selectedImageId) ?? imgs[0];
  const allMasked = imgs.every((i) => i.maskStatus !== "PENDING");
  const scriptRegions = state.regions.filter((r) => r.scriptId === script.id);
  const pageRegions = scriptRegions.filter((r) => r.imageId === currentImg?.id);
  const activeRegion = scriptRegions.find((r) => r.id === activeRegionId) || null;

  function movePage(index: number, dir: -1 | 1) {
    const next = [...imgs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    actions.reorderPages(script!.id, next.map((i) => i.id));
  }

  function toRect(c: Crop): Rect {
    return {
      x: Math.max(0, Math.min(99, Number((c.x ?? 0).toFixed(2)))),
      y: Math.max(0, Math.min(99, Number((c.y ?? 0).toFixed(2)))),
      width: Math.max(1, Math.min(100, Number((c.width ?? 10).toFixed(2)))),
      height: Math.max(1, Math.min(100, Number((c.height ?? 10).toFixed(2)))),
    };
  }

  function autoMapSampleRegions() {
    if (!script) return;
    const qByKey: Record<string, string> = { Q1: "q1", Q2: "q2", Q2a: "q2", Q2b: "q2", Q3: "q3", Q4: "q4" };
    for (const im of imgs) {
      if (!im.sampleKey) continue;
      for (const b of sampleBlocks(im.sampleKey)) {
        const qid = qByKey[b.key];
        if (!qid) continue;
        const exists = scriptRegions.some((r) => r.imageId === im.id && r.questionId === qid && Math.abs(r.bbox.y - b.top) < 3);
        if (!exists) {
          actions.addRegion(script.id, im.id, qid, { x: 9, y: b.top, width: 87, height: b.height });
        }
      }
    }
  }

  const qIndex = (qid: string) => Math.max(0, state.assessment.questions.findIndex((q) => q.id === qid));
  const qNum = (qid: string) => state.assessment.questions.find((q) => q.id === qid)?.number ?? qid;

  async function runAutoStructuredOcr() {
    if (!script || !imgs.length) return;
    setOcrLoading(true);
    setOcrError("");
    try {
      const pagesPayload = await Promise.all(
        imgs.map(async (im) => {
          const { mimeType, base64Data } = await imageToMaskedBase64(im);
          return {
            pageNumber: im.pageNumber,
            mimeType,
            base64Data,
          };
        }),
      );
      const res = await fetch("/api/ocr/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: pagesPayload }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        model?: string;
        results?: {
          questionId: string;
          questionNumber?: string;
          pageNumber?: number;
          bbox?: Rect;
          rawText: string;
          blankDetected: boolean;
          spans: { id: string; lineNumber: number; text: string; confidence: number | string }[];
          flags: { type: FlagType; message: string; spanId?: string }[];
        }[];
        error?: string;
      };
      if (!res.ok || !data.ok || !data.results) {
        setOcrError(data.error || "Text extraction failed.");
        setOcrLoading(false);
        return;
      }
      actions.applyStructuredOcrResults(script.id, data.model || "gemini-3-flash-preview", data.results, true);
      setOcrLoading(false);
      router.push(`/review?script=${script.id}`);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to run structured OCR.");
      setOcrLoading(false);
    }
  }

  async function runMappedRegionsOcr() {
    if (!script || scriptRegions.length === 0) return;
    const allHaveSampleKeys = scriptRegions.every((r) => imgs.find((i) => i.id === r.imageId)?.sampleKey);
    if (allHaveSampleKeys) {
      actions.confirmMappingAndExtract(script.id);
      router.push(`/review?script=${script.id}`);
      return;
    }

    setOcrLoading(true);
    setOcrError("");
    try {
      const regionsPayload = [];
      for (const q of state.assessment.questions) {
        const regs = scriptRegions
          .filter((r) => r.questionId === q.id)
          .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        if (!regs.length) continue;
        const firstReg = regs[0];
        const im = imgs.find((i) => i.id === firstReg.imageId) ?? imgs[0];
        const { mimeType, base64Data } = await cropRegionToBase64(im, firstReg.bbox);
        regionsPayload.push({
          questionId: q.id,
          questionNumber: q.number,
          pageNumber: im.pageNumber,
          mimeType,
          base64Data,
        });
      }

      const res = await fetch("/api/ocr/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regions: regionsPayload }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        model?: string;
        results?: {
          questionId: string;
          questionNumber?: string;
          pageNumber?: number;
          bbox?: Rect;
          rawText: string;
          blankDetected: boolean;
          spans: { id: string; lineNumber: number; text: string; confidence: number | string }[];
          flags: { type: FlagType; message: string; spanId?: string }[];
        }[];
        error?: string;
      };
      if (!res.ok || !data.ok || !data.results) {
        setOcrError(data.error || "Text extraction failed.");
        setOcrLoading(false);
        return;
      }
      actions.applyStructuredOcrResults(script.id, data.model || "gemini-3-flash-preview", data.results, false);
      setOcrLoading(false);
      router.push(`/review?script=${script.id}`);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to extract mapped regions.");
      setOcrLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Script ${script.pseudonymousCode}`}
        right={
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={`/review?script=${script.id}`}
              className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Review transcripts →
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setTab("order")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "order" ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>1. Order pages</span>
          <Badge tone={script.pagesConfirmed ? "green" : "amber"}>{script.pagesConfirmed ? "Done" : "Pending"}</Badge>
        </button>
        <button
          onClick={() => setTab("mask")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "mask" ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>2. Mask header</span>
          <Badge tone={allMasked ? "green" : "amber"}>
            {imgs.filter((i) => i.maskStatus !== "PENDING").length}/{imgs.length}
          </Badge>
        </button>
        <button
          onClick={() => setTab("map")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "map" ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          <span>3. Map & extract answers</span>
          <Badge tone={script.mappingConfirmed ? "green" : "blue"}>
            {scriptRegions.length}
          </Badge>
        </button>
      </div>

      {ocrError && (
        <Alert tone="red" title="Extraction error">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span>{ocrError}</span>
            <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
              <Button size="sm" onClick={() => { setOcrError(""); runAutoStructuredOcr(); }}>
                Retry extraction
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {tab === "order" && (
        <Card>
          <CardHeader
            title="Page order"
            right={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  actions.confirmPages(script.id);
                  setTab("mask");
                }}
              >
                Confirm order →
              </Button>
            }
          />
          <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {imgs.map((im, idx) => (
              <div key={im.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3.5 py-2">
                  <span className="text-xs font-semibold text-slate-800">Page {im.pageNumber}</span>
                  <span className="text-[11px] text-slate-400">{formatBytes(im.fileSizeBytes)}</span>
                </div>
                <div className="p-3">
                  <div className="overflow-hidden rounded border border-slate-300 bg-white">
                    <PageImage image={im} />
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2">
                  <div className="flex gap-1.5">
                    <Button size="sm" disabled={idx === 0} onClick={() => movePage(idx, -1)}>
                      ← Left
                    </Button>
                    <Button size="sm" disabled={idx === imgs.length - 1} onClick={() => movePage(idx, 1)}>
                      Right →
                    </Button>
                  </div>
                  <MaskBadge s={im.maskStatus} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "mask" && currentImg && (
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <Card className="flex-1 min-w-0 w-full">
            <CardHeader
              title={`Mask header — Page ${currentImg.pageNumber}`}
              right={
                <div className="flex items-center gap-2">
                  <MaskBadge s={currentImg.maskStatus} />
                </div>
              }
            />
            <div className="p-4 sm:p-5 space-y-4">
              {/* Page Navigator bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  {imgs.map((im) => (
                    <button
                      key={im.id}
                      onClick={() => setSelectedImageId(im.id)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        im.id === currentImg.id
                          ? "bg-[color:var(--x-ink,#111827)] text-white shadow-xs"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <span>Page {im.pageNumber}</span>
                      <MaskBadge s={im.maskStatus} />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    disabled={imgs.findIndex((i) => i.id === currentImg.id) === 0}
                    onClick={() => {
                      const idx = imgs.findIndex((i) => i.id === currentImg.id);
                      if (idx > 0) setSelectedImageId(imgs[idx - 1].id);
                    }}
                  >
                    ← Prev
                  </Button>
                  <Button
                    size="sm"
                    disabled={imgs.findIndex((i) => i.id === currentImg.id) === imgs.length - 1}
                    onClick={() => {
                      const idx = imgs.findIndex((i) => i.id === currentImg.id);
                      if (idx < imgs.length - 1) setSelectedImageId(imgs[idx + 1].id);
                    }}
                  >
                    Next →
                  </Button>
                </div>
              </div>

              {/* Scrollable image viewport - Constrained to max-h so it never pushes controls away */}
              <div className="max-h-[600px] overflow-auto rounded-xl border border-slate-200 bg-slate-100/70 p-3 sm:p-4 flex justify-center items-start shadow-inner">
                <div className="max-w-2xl w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                  <ReactCrop crop={maskCrop} onChange={(_, pctCrop) => setMaskCrop(pctCrop)} className="block w-full">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={currentImg.originalUrl}
                        alt={`Page ${currentImg.pageNumber}`}
                        className="block h-auto w-full select-none"
                        draggable={false}
                      />
                      {currentImg.maskStatus === "MASKED" && currentImg.maskRect && (
                        <div
                          className="pointer-events-none absolute flex items-center justify-center bg-slate-900/90 text-xs font-semibold text-slate-200 shadow-md border border-slate-700"
                          style={{
                            left: `${currentImg.maskRect.x}%`,
                            top: `${currentImg.maskRect.y}%`,
                            width: `${currentImg.maskRect.width}%`,
                            height: `${currentImg.maskRect.height}%`,
                          }}
                        >
                          🔒 Header masked
                        </div>
                      )}
                    </div>
                  </ReactCrop>
                </div>
              </div>
              <p className="text-center text-xs text-slate-500">
                Tip: Click and drag a rectangle over the student identity header (name, ID). Scroll vertically inside the container to see full page.
              </p>
            </div>
          </Card>

          {/* Right Sidebar: Sticky Actions Panel */}
          <div className="w-full lg:w-80 xl:w-88 shrink-0 lg:sticky lg:top-6 space-y-4">
            <Card>
              <CardHeader
                title="Masking actions"
                right={<span className="text-xs text-slate-500">Page {currentImg.pageNumber}/{imgs.length}</span>}
              />
              <div className="space-y-3 p-5">
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800 mb-0.5">Step 2: Anonymization</p>
                  Drag to select student details and click <strong className="text-indigo-700">Apply mask</strong>, or mark as having no header.
                </div>

                <div className="space-y-2 pt-1">
                  <Button
                    variant="primary"
                    className="w-full justify-center py-2.5 text-xs font-semibold shadow-xs"
                    onClick={() => {
                      actions.applyMask(script.id, currentImg.id, toRect(maskCrop));
                      const nextUnmasked = imgs.find((im) => im.id !== currentImg.id && im.maskStatus === "PENDING");
                      if (nextUnmasked) {
                        setSelectedImageId(nextUnmasked.id);
                      }
                    }}
                  >
                    Apply mask
                  </Button>
                  <Button
                    className="w-full justify-center py-2 text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200"
                    onClick={() => {
                      actions.setNoHeader(script.id, currentImg.id);
                      const nextUnmasked = imgs.find((im) => im.id !== currentImg.id && im.maskStatus === "PENDING");
                      if (nextUnmasked) {
                        setSelectedImageId(nextUnmasked.id);
                      }
                    }}
                  >
                    No header on this page
                  </Button>
                  {currentImg.maskStatus !== "PENDING" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center text-xs text-slate-500 hover:text-rose-600"
                      onClick={() => actions.clearMask(script.id, currentImg.id)}
                    >
                      Clear mask
                    </Button>
                  )}
                </div>

                <div className="border-t border-slate-100 pt-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Masking status:</span>
                    <span className="font-semibold text-slate-800">
                      {imgs.filter((i) => i.maskStatus !== "PENDING").length} of {imgs.length} completed
                    </span>
                  </div>
                  <Button
                    variant="success"
                    className="w-full justify-center py-2.5 text-xs font-semibold shadow-xs"
                    disabled={!allMasked}
                    onClick={() => setTab("map")}
                  >
                    Continue to mapping →
                  </Button>
                  {!allMasked && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2 border border-amber-200/80">
                      Please mask or confirm all {imgs.length} pages before proceeding.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "map" && currentImg && (
        <div className="flex flex-col lg:flex-row items-start gap-6">
          <Card className="flex-1 min-w-0 w-full">
            <CardHeader
              title={`Map answer regions — Page ${currentImg.pageNumber}`}
              right={
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={ocrLoading || !allMasked}
                    onClick={runAutoStructuredOcr}
                  >
                    {ocrLoading ? "Extracting…" : "AI Auto-Segment & Extract All"}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={scriptRegions.length === 0 || ocrLoading || !allMasked}
                    onClick={runMappedRegionsOcr}
                  >
                    {ocrLoading ? "Extracting…" : "Extract & review →"}
                  </Button>
                </div>
              }
            />
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  {imgs.map((im) => {
                    const cnt = scriptRegions.filter((r) => r.imageId === im.id).length;
                    return (
                      <button
                        key={im.id}
                        onClick={() => setSelectedImageId(im.id)}
                        className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                          im.id === currentImg.id
                            ? "bg-[color:var(--x-ink,#111827)] text-white shadow-xs"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <span>Page {im.pageNumber}</span>
                        <Badge tone={cnt > 0 ? "indigo" : "slate"}>{cnt}</Badge>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    disabled={imgs.findIndex((i) => i.id === currentImg.id) === 0}
                    onClick={() => {
                      const idx = imgs.findIndex((i) => i.id === currentImg.id);
                      if (idx > 0) setSelectedImageId(imgs[idx - 1].id);
                    }}
                  >
                    ← Prev
                  </Button>
                  <Button
                    size="sm"
                    disabled={imgs.findIndex((i) => i.id === currentImg.id) === imgs.length - 1}
                    onClick={() => {
                      const idx = imgs.findIndex((i) => i.id === currentImg.id);
                      if (idx < imgs.length - 1) setSelectedImageId(imgs[idx + 1].id);
                    }}
                  >
                    Next →
                  </Button>
                </div>
              </div>

              <div className="max-h-[600px] overflow-auto rounded-xl border border-slate-200 bg-slate-100/70 p-3 sm:p-4 flex justify-center items-start shadow-inner">
                <div className="max-w-2xl w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                  <ReactCrop crop={regionCrop} onChange={(_, pctCrop) => setRegionCrop(pctCrop)} className="block w-full">
                    <PageImage
                      image={currentImg}
                      overlays={pageRegions.map((r) => {
                        const idx = qIndex(r.questionId);
                        const totalParts = scriptRegions.filter((x) => x.questionId === r.questionId).length;
                        return {
                          id: r.id,
                          rect: r.bbox,
                          color: QUESTION_COLORS[idx % QUESTION_COLORS.length],
                          active: r.id === activeRegionId,
                          label: `${qNum(r.questionId)}${totalParts > 1 ? ` (${r.sequenceOrder}/${totalParts})` : ""}`,
                          onClick: () => {
                            setActiveRegionId(r.id);
                            setSelectedQuestionId(r.questionId);
                            setRegionCrop({ unit: "%", x: r.bbox.x, y: r.bbox.y, width: r.bbox.width, height: r.bbox.height });
                          },
                        };
                      })}
                    />
                  </ReactCrop>
                </div>
              </div>
              <p className="text-center text-xs text-slate-500">
                Tip: Click an existing box or drag new crop handles to adjust boundaries. Select a question and save.
              </p>
            </div>
          </Card>

          <div className="w-full lg:w-80 xl:w-88 shrink-0 lg:sticky lg:top-6 space-y-4">
            <Card>
              <CardHeader
                title={activeRegion ? `Edit ${qNum(activeRegion.questionId)} crop` : "Assign region"}
                right={
                  <Button size="sm" onClick={() => actions.addQuestion()}>
                    + Add Q
                  </Button>
                }
              />
              <div className="space-y-3 p-5">
                <div className="grid grid-cols-2 gap-1.5">
                  {state.assessment.questions.map((q, i) => {
                    const existingParts = scriptRegions.filter((r) => r.questionId === q.id).length;
                    const active = selectedQuestionId === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setSelectedQuestionId(q.id)}
                        className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium transition cursor-pointer ${
                          active ? "border-indigo-600 bg-indigo-50 text-indigo-900" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: QUESTION_COLORS[i % QUESTION_COLORS.length] }} />
                          <span className="font-bold">{q.number}</span>
                        </span>
                        <span className="text-[11px] text-slate-400">{existingParts || "—"}</span>
                      </button>
                    );
                  })}
                </div>

                {activeRegion ? (
                  <div className="space-y-2 pt-1">
                    <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2 text-xs text-indigo-900 flex items-center justify-between">
                      <span>Adjusting <strong>{qNum(activeRegion.questionId)}</strong></span>
                      <span className="text-[10px] text-indigo-600">Drag handles to resize</span>
                    </div>
                    <Button
                      variant="primary"
                      className="w-full justify-center py-2.5 text-xs font-semibold shadow-xs"
                      onClick={() => {
                        actions.updateRegionBbox(activeRegion.id, toRect(regionCrop));
                        setActiveRegionId(null);
                      }}
                    >
                      ✓ Save updated crop for {qNum(activeRegion.questionId)}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 justify-center text-xs text-slate-600 hover:bg-slate-100"
                        onClick={() => {
                          setActiveRegionId(null);
                          setRegionCrop(DEFAULT_REGION_CROP);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="justify-center text-xs text-rose-600 hover:bg-rose-50"
                        onClick={() => {
                          actions.deleteRegion(activeRegion.id);
                          setActiveRegionId(null);
                        }}
                      >
                        Delete region
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full justify-center py-2.5 text-xs font-semibold shadow-xs"
                    onClick={() => actions.addRegion(script.id, currentImg.id, selectedQuestionId, toRect(regionCrop))}
                  >
                    + Assign to {qNum(selectedQuestionId)}
                  </Button>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Mapped regions (${scriptRegions.length})`} />
              <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                {state.assessment.questions.map((q) => {
                  const regs = scriptRegions
                    .filter((r) => r.questionId === q.id)
                    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
                  if (regs.length === 0) return null;
                  return (
                    <div key={q.id} className="p-3.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                        <span>{q.number}</span>
                        {regs.length > 1 && <Badge tone="indigo">{regs.length} parts</Badge>}
                      </div>
                      <ul className="mt-2 space-y-2">
                        {regs.map((r) => {
                          const im = imgs.find((i) => i.id === r.imageId);
                          return (
                            <li key={r.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-700">
                                  Part {r.sequenceOrder} · Page {im?.pageNumber ?? "?"}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (im && im.id !== currentImg.id) setSelectedImageId(im.id);
                                      setActiveRegionId(r.id);
                                      setSelectedQuestionId(r.questionId);
                                      setRegionCrop({ unit: "%", x: r.bbox.x, y: r.bbox.y, width: r.bbox.width, height: r.bbox.height });
                                    }}
                                    className="rounded px-2 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 cursor-pointer"
                                    title="Click to adjust crop handles on image"
                                  >
                                    ✎ Edit crop
                                  </button>
                                  <select
                                    aria-label="Reassign question"
                                    value={r.questionId}
                                    onChange={(e) => actions.reassignRegion(r.id, e.target.value)}
                                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                                  >
                                    {state.assessment.questions.map((qq) => (
                                      <option key={qq.id} value={qq.id}>
                                        {qq.number}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      actions.deleteRegion(r.id);
                                      if (activeRegionId === r.id) setActiveRegionId(null);
                                    }}
                                    className="rounded px-1 text-rose-600 hover:bg-rose-50 cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                              {im && (
                                <div
                                  onClick={() => {
                                    if (im && im.id !== currentImg.id) setSelectedImageId(im.id);
                                    setActiveRegionId(r.id);
                                    setSelectedQuestionId(r.questionId);
                                    setRegionCrop({ unit: "%", x: r.bbox.x, y: r.bbox.y, width: r.bbox.width, height: r.bbox.height });
                                  }}
                                  className="mt-1.5 overflow-hidden rounded border border-slate-200 bg-white cursor-pointer hover:border-indigo-400 transition"
                                  title="Click to edit this crop on the script"
                                >
                                  <RegionCrop image={im} rect={r.bbox} />
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
