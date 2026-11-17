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
import type { FlagType, McqItem, McqOptionStyle, Rect } from "@/lib/types";

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
  const [mcqZoom, setMcqZoom] = useState<number>(1);
  const [mcqSection, setMcqSection] = useState<number>(0);
  const [mcqFlaggedOnly, setMcqFlaggedOnly] = useState<boolean>(false);
  const [optionStyle, setOptionStyle] = useState<McqOptionStyle>(script?.mcqExtraction?.optionStyle ?? "ALPHA");

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
  const isMcq = script.paperType === "MCQ";

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
          spans: { id: string; lineNumber: number; text: string; confidence: number }[];
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
          spans: { id: string; lineNumber: number; text: string; confidence: number }[];
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

  async function runMcqOcr() {
    if (!script || !imgs.length) return;
    setOcrLoading(true);
    setOcrError("");
    try {
      const payloadImages = await Promise.all(
        imgs.map(async (im) => {
          const { mimeType, base64Data } = await imageToMaskedBase64(im);
          return {
            pageNumber: im.pageNumber,
            mimeType,
            base64Data,
          };
        }),
      );
      const res = await fetch("/api/ocr/mcq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: payloadImages }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        model?: string;
        optionStyle?: McqOptionStyle;
        optionLabels?: string[];
        items?: McqItem[];
        error?: string;
      };
      if (!res.ok || !data.ok || !data.items) {
        setOcrError(data.error || "Answer extraction failed.");
        setOcrLoading(false);
        return;
      }
      if (data.optionStyle) setOptionStyle(data.optionStyle);
      actions.setMcqExtraction(script.id, {
        extractedAt: nowIso(),
        model: data.model || "gemini-3-flash-preview",
        optionStyle: data.optionStyle || optionStyle,
        optionLabels: data.optionLabels || (optionStyle === "NUMERIC" ? ["1", "2", "3", "4", "5"] : ["A", "B", "C", "D"]),
        verified: false,
        items: data.items,
      });
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to extract answers.");
    } finally {
      setOcrLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Script ${script.pseudonymousCode}`}
        right={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => actions.setScriptPaperType(script.id, "STRUCTURED")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  !isMcq ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Handwritten / Essay
              </button>
              <button
                type="button"
                onClick={() => actions.setScriptPaperType(script.id, "MCQ")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  isMcq ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                MCQ Bubble Sheet
              </button>
            </div>
            {!isMcq && (
              <Link
                href={`/review?script=${script.id}`}
                className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Review transcripts →
              </Link>
            )}
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
          <span>{isMcq ? "3. Extract & verify MCQ" : "3. Map & extract answers"}</span>
          <Badge tone={script.mappingConfirmed ? "green" : "blue"}>
            {isMcq ? (script.mcqExtraction?.items.length ?? 0) : scriptRegions.length}
          </Badge>
        </button>
      </div>

      {ocrError && <Alert tone="red" title="Extraction error">{ocrError}</Alert>}

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
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title={`Mask header — Page ${currentImg.pageNumber}`}
              right={<MaskBadge s={currentImg.maskStatus} />}
            />
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {imgs.map((im) => (
                  <button
                    key={im.id}
                    onClick={() => setSelectedImageId(im.id)}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      im.id === currentImg.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>Page {im.pageNumber}</span>
                    <MaskBadge s={im.maskStatus} />
                  </button>
                ))}
              </div>

              <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-slate-300 bg-white">
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
                        className="pointer-events-none absolute flex items-center justify-center bg-slate-900 text-xs font-medium text-slate-300"
                        style={{
                          left: `${currentImg.maskRect.x}%`,
                          top: `${currentImg.maskRect.y}%`,
                          width: `${currentImg.maskRect.width}%`,
                          height: `${currentImg.maskRect.height}%`,
                        }}
                      >
                        Header masked
                      </div>
                    )}
                  </div>
                </ReactCrop>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Actions" />
              <div className="space-y-2.5 p-5">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => actions.applyMask(script.id, currentImg.id, toRect(maskCrop))}
                >
                  Apply mask
                </Button>
                <Button
                  className="w-full"
                  onClick={() => actions.setNoHeader(script.id, currentImg.id)}
                >
                  No header on this page
                </Button>
                {currentImg.maskStatus !== "PENDING" && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => actions.clearMask(script.id, currentImg.id)}>
                    Clear mask
                  </Button>
                )}
                <div className="border-t border-slate-100 pt-3">
                  <Button variant="success" className="w-full" disabled={!allMasked} onClick={() => setTab("map")}>
                    Continue to mapping →
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "map" && currentImg && isMcq && (
        <Card>
          <CardHeader
            title="MCQ Answer Sheet Extraction & Verification"
            sub={
              script.mcqExtraction
                ? imgs.length > 1
                  ? `Page ${currentImg.pageNumber}: Showing questions for this sheet. Compare each answer with the scanned paper on the left.`
                  : `${script.mcqExtraction.items.length} question(s) detected. Compare each answer with the scanned sheet on the left and correct any mistakes.`
                : "Detect the shaded bubbles on the masked answer sheet, then verify them against the scan."
            }
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" disabled={ocrLoading || !allMasked} onClick={runMcqOcr}>
                  {ocrLoading ? "Extracting…" : script.mcqExtraction ? "Re-run extraction" : "Extract answers"}
                </Button>
                {script.mcqExtraction && (
                  <Button
                    variant={script.mcqExtraction.verified ? "secondary" : "success"}
                    size="sm"
                    onClick={() => {
                      actions.verifyMcqExtraction(script.id);
                      router.push("/");
                    }}
                  >
                    {script.mcqExtraction.verified ? "Verified ✓" : "Approve & Complete →"}
                  </Button>
                )}
              </div>
            }
          />
          <div className="space-y-4 p-5">
            {!allMasked && (
              <Alert tone="amber" title="Header masking required">
                Please mask the student-identifying header on every page in Step 2 before extracting answers.
              </Alert>
            )}

            <div className="grid gap-5 lg:grid-cols-12">
              {/* Left: scanned answer sheet */}
              <div className="lg:col-span-6">
                <div className="sticky top-20 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {imgs.map((im) => (
                        <button
                          key={im.id}
                          type="button"
                          onClick={() => {
                            setSelectedImageId(im.id);
                            setMcqSection(0);
                            setMcqFlaggedOnly(false);
                          }}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            im.id === currentImg.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          Page {im.pageNumber}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" onClick={() => setMcqZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}>
                        −
                      </Button>
                      <span className="w-11 text-center font-mono text-xs">{Math.round(mcqZoom * 100)}%</span>
                      <Button size="sm" onClick={() => setMcqZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}>
                        +
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[75vh] overflow-auto rounded-lg border border-slate-300 bg-slate-50">
                    <div style={{ width: `${mcqZoom * 100}%` }}>
                      <PageImage image={currentImg} showMask={true} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: extracted answers */}
              <div className="space-y-4 lg:col-span-6">
                {!script.mcqExtraction ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                    No answers extracted yet. Click &ldquo;Extract answers&rdquo; to read the shaded bubbles from this sheet.
                  </div>
                ) : (
                  (() => {
                    const allRawItems = script.mcqExtraction.items;
                    const totalImgs = Math.max(imgs.length, 1);
                    const itemsPerPage = Math.ceil(allRawItems.length / totalImgs);

                    // Normalize legacy items if pageNumber was not previously saved
                    const normalizedItems = allRawItems.map((item, idx) => {
                      if (item.pageNumber !== undefined) return item;
                      const pageIdx = Math.min(imgs.length - 1, Math.floor(idx / itemsPerPage));
                      const assignedPage = imgs[pageIdx]?.pageNumber ?? (pageIdx + 1);
                      const qNum =
                        pageIdx > 0 && item.questionNumber > itemsPerPage
                          ? item.questionNumber - pageIdx * itemsPerPage
                          : item.questionNumber;
                      return { ...item, pageNumber: assignedPage, questionNumber: qNum };
                    });

                    // Strictly filter items belonging to the currently selected page
                    const pageItems = normalizedItems
                      .filter((i) => i.pageNumber === currentImg.pageNumber)
                      .sort((a, b) => a.questionNumber - b.questionNumber);

                    const flaggedOf = (i: McqItem) =>
                      i.selectedOption === "BLANK" ||
                      i.selectedOption === "MULTIPLE" ||
                      (typeof i.confidence === "number" && i.confidence < 0.8);

                    const answeredCount = pageItems.filter(
                      (i) => i.selectedOption && i.selectedOption !== "BLANK" && i.selectedOption !== "MULTIPLE",
                    ).length;
                    const flaggedCount = pageItems.filter(flaggedOf).length;

                    // Section chunking based strictly on the current page's questions
                    const total = pageItems.length;
                    const size = total <= 20 ? Math.max(total, 1) : total <= 60 ? 10 : 20;
                    const sections: { label: string; items: McqItem[]; flagged: number }[] = [];
                    for (let i = 0; i < total; i += size) {
                      const chunk = pageItems.slice(i, i + size);
                      sections.push({
                        label: `${chunk[0].questionNumber}–${chunk[chunk.length - 1].questionNumber}`,
                        items: chunk,
                        flagged: chunk.filter(flaggedOf).length,
                      });
                    }
                    const safeIdx = Math.min(mcqSection, Math.max(sections.length - 1, 0));
                    const visible = mcqFlaggedOnly ? pageItems.filter(flaggedOf) : sections[safeIdx]?.items ?? [];

                    return (
                      <>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] text-slate-500">
                              {imgs.length > 1 ? `Page ${currentImg.pageNumber} detected` : "Total detected"}
                            </div>
                            <div className="mt-0.5 text-lg font-semibold text-slate-900">{pageItems.length}</div>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                            <div className="text-[11px] text-emerald-700">Answered</div>
                            <div className="mt-0.5 text-lg font-semibold text-emerald-800">{answeredCount}</div>
                          </div>
                          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                            <div className="text-[11px] text-amber-700">Flagged</div>
                            <div className="mt-0.5 text-lg font-semibold text-amber-800">{flaggedCount}</div>
                          </div>
                        </div>

                        {pageItems.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                            No questions detected for Page {currentImg.pageNumber}. Switch pages or re-run extraction.
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Question sections">
                              {sections.length > 1 &&
                                sections.map((sec, idx) => {
                                  const active = !mcqFlaggedOnly && idx === safeIdx;
                                  return (
                                    <button
                                      key={sec.label}
                                      type="button"
                                      aria-pressed={active}
                                      onClick={() => {
                                        setMcqFlaggedOnly(false);
                                        setMcqSection(idx);
                                      }}
                                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                        active
                                          ? "border-indigo-600 bg-indigo-600 text-white"
                                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                      }`}
                                    >
                                      Q{sec.label}
                                      {sec.flagged > 0 && (
                                        <span
                                          className={`rounded-full px-1.5 text-[10px] ${
                                            active ? "bg-white/25 text-white" : "bg-amber-100 text-amber-800"
                                          }`}
                                          aria-label={`${sec.flagged} flagged`}
                                        >
                                          {sec.flagged}
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              <button
                                type="button"
                                aria-pressed={mcqFlaggedOnly}
                                onClick={() => setMcqFlaggedOnly((v) => !v)}
                                className={`ml-auto rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                                  mcqFlaggedOnly
                                    ? "border-amber-500 bg-amber-500 text-white"
                                    : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                }`}
                              >
                                Flagged only ({flaggedCount})
                              </button>
                            </div>

                            {sections.length > 1 && !mcqFlaggedOnly && (
                              <div className="flex items-center justify-between text-xs text-slate-500">
                                <Button size="sm" disabled={safeIdx === 0} onClick={() => setMcqSection(safeIdx - 1)}>
                                  ← Previous
                                </Button>
                                <span>
                                  Section {safeIdx + 1} of {sections.length}
                                </span>
                                <Button
                                  size="sm"
                                  disabled={safeIdx >= sections.length - 1}
                                  onClick={() => setMcqSection(safeIdx + 1)}
                                >
                                  Next →
                                </Button>
                              </div>
                            )}

                            {visible.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                                No flagged answers on Page {currentImg.pageNumber}.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {visible.map((item) => {
                                  const labels = script.mcqExtraction?.optionLabels ?? ["A", "B", "C", "D"];
                                  const isFlagged =
                                    item.selectedOption === "BLANK" ||
                                    item.selectedOption === "MULTIPLE" ||
                                    (typeof item.confidence === "number" && item.confidence < 0.8);
                                  return (
                                    <div
                                      key={`${item.pageNumber ?? currentImg.pageNumber}-${item.questionNumber}`}
                                      role="group"
                                      aria-label={`Question ${item.questionNumber}`}
                                      className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
                                        isFlagged ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="w-10 font-mono font-semibold text-slate-800">
                                          Q{item.questionNumber}
                                        </span>
                                        {item.edited && <Badge tone="indigo">Edited</Badge>}
                                        {isFlagged && <Badge tone="amber">{item.selectedOption}</Badge>}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {labels.map((opt) => {
                                          const active = item.selectedOption === opt;
                                          return (
                                            <button
                                              key={opt}
                                              type="button"
                                              aria-pressed={active}
                                              aria-label={`Question ${item.questionNumber}, option ${opt}`}
                                              onClick={() =>
                                                actions.updateMcqItem(
                                                  script.id,
                                                  item.questionNumber,
                                                  opt,
                                                  currentImg.pageNumber,
                                                )
                                              }
                                              className={`h-8 w-8 rounded-full font-mono text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                                active
                                                  ? "bg-indigo-600 text-white shadow-xs"
                                                  : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                              }`}
                                            >
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                              {script.mcqExtraction.verified ? (
                                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                                    ✓
                                  </span>
                                  All MCQ answers verified and approved for evaluation.
                                </div>
                              ) : (
                                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs text-slate-500">
                                    Done checking answers? Approve this script to complete verification.
                                  </span>
                                  <Button
                                    variant="success"
                                    onClick={() => {
                                      actions.verifyMcqExtraction(script.id);
                                      router.push("/");
                                    }}
                                  >
                                    Approve &amp; Complete Verification →
                                  </Button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {tab === "map" && currentImg && !isMcq && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
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
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {imgs.map((im) => {
                  const cnt = scriptRegions.filter((r) => r.imageId === im.id).length;
                  return (
                    <button
                      key={im.id}
                      onClick={() => setSelectedImageId(im.id)}
                      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        im.id === currentImg.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <span>Page {im.pageNumber}</span>
                      <Badge tone={cnt > 0 ? "indigo" : "slate"}>{cnt}</Badge>
                    </button>
                  );
                })}
              </div>

              <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-slate-300 bg-white">
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
                        onClick: () => setActiveRegionId(r.id),
                      };
                    })}
                  />
                </ReactCrop>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Assign region"
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
                        className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium transition ${
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

                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => actions.addRegion(script.id, currentImg.id, selectedQuestionId, toRect(regionCrop))}
                >
                  + Assign to {qNum(selectedQuestionId)}
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader title={`Mapped regions (${scriptRegions.length})`} />
              <div className="divide-y divide-slate-100">
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
                                <span>
                                  Part {r.sequenceOrder} · Page {im?.pageNumber ?? "?"}
                                </span>
                                <div className="flex items-center gap-1">
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
                                    onClick={() => actions.deleteRegion(r.id)}
                                    className="rounded px-1 text-rose-600 hover:bg-rose-50"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                              {im && (
                                <div className="mt-1.5 overflow-hidden rounded border border-slate-200 bg-white">
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
