"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageImage, RegionCrop } from "@/components/PageImage";
import {
  Alert,
  ApprovalBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  PageHeader,
  RoutingBadge,
  flagMeta,
  fmtTime,
} from "@/components/ui";
import { LOW_CONFIDENCE, activeVersion, regionsForAnswer, unresolvedFlags } from "@/lib/logic";
import { useStore } from "@/lib/store";

export function ReviewQueueInner() {
  const { state, actions } = useStore();
  const searchParams = useSearchParams();
  const scriptParam = searchParams.get("script");
  const answerParam = searchParams.get("answer");

  const [activeTab, setActiveTab] = useState<"NEEDS_DECISION" | "AUDIT" | "ALL">("NEEDS_DECISION");
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [showFullPage, setShowFullPage] = useState<boolean>(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [viewVersionNum, setViewVersionNum] = useState<number | null>(null);
  const [newVerModal, setNewVerModal] = useState<boolean>(false);
  const [newVerReason, setNewVerReason] = useState<string>("Corrected OCR transcription text.");
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAnswerId) return;
    if (answerParam) {
      setSelectedAnswerId(answerParam);
    } else if (scriptParam) {
      const match = state.answers.find((a) => a.scriptId === scriptParam);
      if (match) {
        setSelectedAnswerId(match.id);
      }
    }
  }, [scriptParam, answerParam, selectedAnswerId, state.answers]);

  const scriptOf = (scriptId: string) => state.scripts.find((s) => s.id === scriptId);
  const questionOf = (qid: string) => state.assessment.questions.find((q) => q.id === qid);

  // Group / Filter answers
  const answersNeedingReview = useMemo(() => {
    return state.answers.filter((a) => a.routingStatus === "NEEDS_REVIEW" || a.routingStatus === "MANUAL_MARKING");
  }, [state.answers]);

  const auditSampleAnswers = useMemo(() => {
    return state.answers.filter((a) => a.routingStatus === "READY_FOR_AI").slice(0, 12);
  }, [state.answers]);

  const displayedAnswers = useMemo(() => {
    if (activeTab === "NEEDS_DECISION") return answersNeedingReview;
    if (activeTab === "AUDIT") return auditSampleAnswers;
    return state.answers;
  }, [activeTab, answersNeedingReview, auditSampleAnswers, state.answers]);

  const currentAnswer = useMemo(() => {
    if (!selectedAnswerId) return null;
    return state.answers.find((a) => a.id === selectedAnswerId) || null;
  }, [state.answers, selectedAnswerId]);

  const currentScript = useMemo(() => {
    if (!currentAnswer) return null;
    return state.scripts.find((s) => s.id === currentAnswer.scriptId) || null;
  }, [state.scripts, currentAnswer]);

  const currentQuestion = useMemo(() => {
    if (!currentAnswer) return null;
    return questionOf(currentAnswer.questionId) || null;
  }, [currentAnswer, state.assessment.questions]);

  const answerRegions = useMemo(() => {
    if (!currentAnswer) return [];
    return regionsForAnswer(state, currentAnswer);
  }, [state, currentAnswer]);

  const targetImage = useMemo(() => {
    if (!currentScript || !currentScript.images.length) {
      if (state.scripts.length > 0 && state.scripts[0].images.length > 0) {
        return state.scripts[0].images[0];
      }
      return null;
    }
    if (answerRegions.length > 0) {
      const match = currentScript.images.find((i) => i.id === answerRegions[0].imageId);
      if (match) return match;
    }
    return currentScript.images[0];
  }, [currentScript, answerRegions, state.scripts]);

  const curVersion = useMemo(() => {
    if (!currentAnswer) return undefined;
    if (viewVersionNum !== null) {
      return currentAnswer.versions.find((v) => v.version === viewVersionNum) ?? activeVersion(currentAnswer);
    }
    return activeVersion(currentAnswer);
  }, [currentAnswer, viewVersionNum]);

  return (
    <div className="space-y-6 pb-12">
      {/* VIEW 1: Marking and Review Queue */}
      {!selectedAnswerId || !currentAnswer ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-['Plus_Jakarta_Sans'] text-3xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
                Review queue
              </h1>
              <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
                {state.assessment.title || "Mid-semester assessment"}
              </p>
            </div>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Needs review */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-6 items-center justify-center text-[color:var(--x-Teacher,#7c3aed)]">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
                  Needs review
                </span>
              </div>
              <div className="font-['Plus_Jakarta_Sans'] text-4xl font-bold text-[color:var(--x-Teacher,#7c3aed)]">
                {answersNeedingReview.length}
              </div>
            </div>

            {/* Card 2: Extraction issues */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-6 items-center justify-center text-amber-600">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
                  Extraction issues
                </span>
              </div>
              <div className="font-['Plus_Jakarta_Sans'] text-4xl font-bold text-[color:var(--x-ink,#111827)]">
                {
                  state.answers.filter((a) => {
                    const v = activeVersion(a);
                    return v ? unresolvedFlags(v).length > 0 : false;
                  }).length
                }
              </div>
            </div>

            {/* Card 3: Grading disputes */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-6 items-center justify-center text-indigo-600">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
                  Grading disputes
                </span>
              </div>
              <div className="font-['Plus_Jakarta_Sans'] text-4xl font-bold text-[color:var(--x-ink,#111827)]">
                {state.answers.filter((a) => a.routingStatus === "NEEDS_REVIEW").length}
              </div>
            </div>

            {/* Card 4: Audit sample */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-6 items-center justify-center text-emerald-600">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
                  Audit sample
                </span>
              </div>
              <div className="font-['Plus_Jakarta_Sans'] text-4xl font-bold text-[color:var(--x-ink,#111827)]">
                {auditSampleAnswers.length}
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-[color:var(--x-border,#e4e7ef)] pb-2">
            <button
              onClick={() => setActiveTab("NEEDS_DECISION")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition cursor-pointer ${
                activeTab === "NEEDS_DECISION"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              Needs decision ({answersNeedingReview.length})
            </button>
            <button
              onClick={() => setActiveTab("AUDIT")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition cursor-pointer ${
                activeTab === "AUDIT"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              Audit sample ({auditSampleAnswers.length})
            </button>
            <button
              onClick={() => setActiveTab("ALL")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition cursor-pointer ${
                activeTab === "ALL"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              All answers ({state.answers.length})
            </button>
          </div>

          {/* Review Work Queue Table Card */}
          <div className="overflow-hidden rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[color:var(--x-border,#e4e7ef)] bg-slate-50/70 text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
                  <tr>
                    <th className="px-6 py-3.5">Answer</th>
                    <th className="px-4 py-3.5">Question</th>
                    <th className="px-4 py-3.5">Reason</th>
                    <th className="px-4 py-3.5">State</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--x-border,#e4e7ef)]">
                  {displayedAnswers.length > 0 ? (
                    displayedAnswers.map((ans) => {
                      const sc = scriptOf(ans.scriptId);
                      const q = questionOf(ans.questionId);
                      const curV = activeVersion(ans);
                      const openF = unresolvedFlags(curV);
                      const hasDispute = ans.routingStatus === "NEEDS_REVIEW";
                      const reasonText = openF.length > 0 ? openF[0].message : hasDispute ? "Extraction flag / Review required" : "Ready for AI evaluation";
                      const statePill = hasDispute ? "Needs review" : ans.routingStatus === "MANUAL_MARKING" ? "Manual marking" : "Ready";
                      return (
                        <tr key={ans.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-6 py-4 font-mono font-semibold text-[color:var(--x-ink,#111827)]">
                            {sc?.pseudonymousCode || ans.scriptId}
                          </td>
                          <td className="px-4 py-4 font-mono font-semibold text-[color:var(--x-primary700,#3730a3)]">
                            {q?.number || "Q"}
                          </td>
                          <td className="px-4 py-4 text-sm text-[color:var(--x-ink,#111827)]">
                            <div className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${openF.length > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                              {reasonText}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-warningTint,#fef3c7)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                              <span className="size-2 rounded-full bg-amber-500" />
                              {statePill}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setSelectedAnswerId(ans.id)}
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition cursor-pointer"
                            >
                              Review answer →
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-xs text-slate-500">
                        No answers in this review category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* VIEW 2: Teacher Transcript Review */
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAnswerId(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
                >
                  ← Back to queue
                </button>
                <h1 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
                  Review transcript · {currentScript?.pseudonymousCode || "Script"} / {currentQuestion?.number || "Question"}
                </h1>
              </div>
              <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
                {currentQuestion?.prompt || "Student answer verification"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                curVersion?.approvalStatus === "APPROVED"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}>
                <span className={`size-2 rounded-full ${curVersion?.approvalStatus === "APPROVED" ? "bg-emerald-500" : "bg-amber-500"}`} />
                {curVersion?.approvalStatus === "APPROVED" ? "Approved for AI" : "Pending Teacher Review"}
              </span>
            </div>
          </div>

          {decisionSuccess && (
            <Alert tone="green" title="Decision Recorded">
              {decisionSuccess}
            </Alert>
          )}

          {/* SIDE-BY-SIDE: Original Image (Left) & Extracted Transcript (Right) */}
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            {/* Left Column: Original Handwritten Script Image */}
            <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[color:var(--x-ink,#111827)]">
                    Original handwritten script
                  </h2>
                  <p className="text-xs text-[color:var(--x-secondary,#4b5563)] mt-0.5">
                    {targetImage ? `Page ${targetImage.pageNumber} · ${targetImage.fileName}` : "Handwritten scan"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Zoom controls */}
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
                      className="size-7 rounded-lg bg-white text-slate-700 shadow-xs hover:bg-slate-50 text-xs font-bold cursor-pointer"
                      title="Zoom out"
                    >
                      −
                    </button>
                    <span className="w-10 text-center font-mono text-[11px] font-semibold text-slate-700">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(2))))}
                      className="size-7 rounded-lg bg-white text-slate-700 shadow-xs hover:bg-slate-50 text-xs font-bold cursor-pointer"
                      title="Zoom in"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(1)}
                      className="px-2 h-7 rounded-lg bg-white text-slate-600 shadow-xs hover:bg-slate-50 text-[11px] font-medium cursor-pointer"
                      title="Reset zoom"
                    >
                      Reset
                    </button>
                  </div>

                  {/* Toggle Region Crop / Full Page */}
                  {answerRegions.length > 0 && (
                    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setShowFullPage(false)}
                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          !showFullPage ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Snippet
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFullPage(true)}
                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          showFullPage ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Full page
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Scrollable / Zoomable Image Viewport */}
              <div className="h-[520px] max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-slate-900/5 p-3 flex flex-col items-center justify-start relative select-none">
                {targetImage ? (
                  showFullPage || answerRegions.length === 0 ? (
                    <div style={{ width: `${zoom * 100}%`, minWidth: "100%", transition: "width 0.15s ease-out" }}>
                      <PageImage
                        image={targetImage}
                        highlight={answerRegions[0]?.bbox}
                        className="shadow-sm rounded-lg overflow-hidden bg-white"
                      />
                    </div>
                  ) : (
                    <div className="space-y-4 w-full flex flex-col items-center">
                      {answerRegions.map((r, i) => {
                        const im = currentScript?.images.find((x) => x.id === r.imageId) || targetImage;
                        return (
                          <div
                            key={r.id || i}
                            style={{ width: `${zoom * 100}%`, minWidth: "100%", transition: "width 0.15s ease-out" }}
                            className="rounded-lg shadow-sm border border-slate-200 overflow-hidden bg-white"
                          >
                            <RegionCrop image={im} rect={r.bbox} zoom={1} />
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-400">
                    <svg viewBox="0 0 24 24" className="size-12 stroke-[1.2] mb-3 text-slate-300" fill="none" stroke="currentColor">
                      <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="font-semibold text-slate-600 text-sm">No raw image attached</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Upload script page images in the intake page to inspect handwriting.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Approved Answer (Extracted Transcript - Scrollable within screen) */}
            <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[color:var(--x-ink,#111827)]">
                    Approved answer
                  </h2>
                  <p className="text-xs text-[color:var(--x-secondary,#4b5563)] mt-0.5">
                    {curVersion ? `${curVersion.spans.length} lines extracted · Version v${curVersion.version}` : "Draft OCR transcript"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {currentAnswer.versions.length > 1 && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-slate-400">Versions:</span>
                      {currentAnswer.versions.map((v) => (
                        <button
                          key={v.version}
                          type="button"
                          onClick={() => setViewVersionNum(v.version)}
                          className={`rounded px-2 py-0.5 font-mono text-xs font-semibold cursor-pointer ${
                            (viewVersionNum ?? curVersion?.version) === v.version
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          v{v.version}
                        </button>
                      ))}
                    </div>
                  )}
                  {curVersion?.approvalStatus === "APPROVED" && (
                    <button
                      type="button"
                      onClick={() => setNewVerModal(true)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      + New version
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Extracted Transcript Container */}
              <div className="h-[520px] max-h-[520px] overflow-y-auto rounded-xl bg-slate-50 p-4 font-mono text-xs sm:text-sm leading-relaxed text-[color:var(--x-ink,#111827)] border border-slate-200 divide-y divide-slate-200/60 shadow-inner">
                {curVersion && curVersion.spans.length > 0 ? (
                  curVersion.spans.map((sp) => (
                    <div key={sp.id} className="flex items-start gap-3 py-1.5 hover:bg-slate-100/80 px-1.5 rounded transition-colors">
                      <span className="shrink-0 text-slate-400 select-none text-[11px] font-semibold pt-0.5">{sp.id}</span>
                      <span className="flex-1 whitespace-pre-wrap">{sp.text}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400">
                    <p className="font-semibold text-slate-600 text-sm">No extracted transcript available</p>
                    <p className="text-xs text-slate-400 mt-1">
                      This answer has not produced text spans yet.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Teacher Review Actions & Flags Section */}
          <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-['Plus_Jakarta_Sans'] text-lg font-semibold text-[color:var(--x-ink,#111827)]">
                  Transcript verification &amp; routing
                </h3>
                <p className="text-xs text-[color:var(--x-secondary,#4b5563)]">
                  Confirm accuracy against the handwritten script before releasing to AI evaluation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAnswerId(null)}
                  className="h-11 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-5 text-xs font-semibold text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-50 transition cursor-pointer"
                >
                  Close
                </button>
                {curVersion?.approvalStatus !== "APPROVED" && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        actions.routeManual(currentAnswer.id, "Requires human manual grading");
                        setSelectedAnswerId(null);
                      }}
                      className="h-11 rounded-xl border border-amber-300 bg-amber-50 px-5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                    >
                      Route to manual marking
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        actions.approve(currentAnswer.id);
                        setDecisionSuccess(`Approved transcript v${curVersion?.version || 1} for ${currentScript?.pseudonymousCode || "script"}! Ready for AI evaluation.`);
                        setTimeout(() => {
                          setSelectedAnswerId(null);
                          setDecisionSuccess(null);
                        }, 1500);
                      }}
                      className="h-11 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-6 text-xs font-semibold text-white hover:bg-indigo-700 transition cursor-pointer shadow-xs"
                    >
                      Approve transcript for AI evaluation →
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Flags List if any */}
            {curVersion && unresolvedFlags(curVersion).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-semibold text-amber-800">Unresolved Extraction Flags:</span>
                <div className="space-y-2">
                  {unresolvedFlags(curVersion).map((f) => (
                    <div key={f.id} className="flex items-center justify-between rounded-xl bg-amber-50 p-3 border border-amber-200">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-amber-500" />
                        <span className="font-mono text-xs font-bold text-amber-900">{f.type}:</span>
                        <span className="text-xs text-amber-800">{f.message}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => actions.resolveFlag(currentAnswer.id, f.id, "Teacher verified")}
                        className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-300 hover:bg-amber-100 cursor-pointer"
                      >
                        Resolve flag
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal for creating a new version */}
      {selectedAnswerId && currentAnswer && (
        <Modal
          open={newVerModal}
          title={`Create version v${(curVersion?.version || 1) + 1}`}
          onClose={() => setNewVerModal(false)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewVerModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  actions.startNewVersion(currentAnswer.id, newVerReason || "Transcript edit");
                  setNewVerModal(false);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 cursor-pointer"
              >
                Create v{(curVersion?.version || 1) + 1}
              </button>
            </div>
          }
        >
          <label className="block text-xs font-medium text-slate-700 space-y-1">
            <span>Reason for new version</span>
            <textarea
              rows={3}
              value={newVerReason}
              onChange={(e) => setNewVerReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-xs"
            />
          </label>
        </Modal>
      )}
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading review queue...</div>}>
      <ReviewQueueInner />
    </Suspense>
  );
}
