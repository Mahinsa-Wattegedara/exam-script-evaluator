"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

export default function ReviewQueuePage() {
  const { state, actions } = useStore();
  const [activeTab, setActiveTab] = useState<"NEEDS_DECISION" | "AUDIT" | "ALL">("NEEDS_DECISION");
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [showFullPage, setShowFullPage] = useState<boolean>(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [viewVersionNum, setViewVersionNum] = useState<number | null>(null);
  const [newVerModal, setNewVerModal] = useState<boolean>(false);
  const [newVerReason, setNewVerReason] = useState<string>("Corrected OCR transcription text.");

  // Teacher override decision state for 07 / Teacher marking decision
  const [teacherMarks, setTeacherMarks] = useState<Record<string, number>>({
    "c1": 3,
    "c2": 2,
    "c3": 1,
    "c4": 2,
  });
  const [decisionReason, setDecisionReason] = useState<string>(
    "The answer identifies isolation but omits allocation.",
  );
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  const scriptOf = (scriptId: string) => state.scripts.find((s) => s.id === scriptId);
  const questionOf = (qid: string) => state.assessment.questions.find((q) => q.id === qid);

  // Group / Filter answers
  const answersNeedingReview = useMemo(() => {
    return state.answers.filter((a) => a.routingStatus === "NEEDS_REVIEW" || a.routingStatus === "MANUAL_MARKING");
  }, [state.answers]);

  const auditSampleAnswers = useMemo(() => {
    return state.answers.filter((a) => a.routingStatus === "READY_FOR_AI").slice(0, 12);
  }, [state.answers]);

  const currentAnswer = useMemo(() => {
    if (!selectedAnswerId) return null;
    return state.answers.find((a) => a.id === selectedAnswerId) || null;
  }, [state.answers, selectedAnswerId]);

  const curVersion = useMemo(() => {
    if (!currentAnswer) return undefined;
    if (viewVersionNum !== null) {
      return currentAnswer.versions.find((v) => v.version === viewVersionNum) ?? activeVersion(currentAnswer);
    }
    return activeVersion(currentAnswer);
  }, [currentAnswer, viewVersionNum]);

  // Compute final selected mark sum for Teacher decision progress ring
  const finalMarkSum = useMemo(() => {
    return Object.values(teacherMarks).reduce((a, b) => a + b, 0);
  }, [teacherMarks]);

  const totalMaxMarks = 10;
  const ringPct = Math.min(100, Math.round((finalMarkSum / totalMaxMarks) * 100));
  const circumference = 2 * Math.PI * 68;
  const strokeDashoffset = circumference - (ringPct / 100) * circumference;

  function adjustCriterionMark(cid: string, delta: number, max: number) {
    setTeacherMarks((prev) => {
      const cur = prev[cid] ?? 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [cid]: next };
    });
  }

  function handleConfirmDecision() {
    if (!currentAnswer) return;
    // Resolve all open flags and approve answer
    if (curVersion) {
      curVersion.flags.forEach((f) => {
        if (!f.resolved) {
          actions.resolveFlag(currentAnswer.id, f.id, decisionReason);
        }
      });
    }
    actions.approve(currentAnswer.id);
    setDecisionSuccess(`Decision confirmed! Final mark ${finalMarkSum} / ${totalMaxMarks} recorded for ${currentAnswer.id}.`);
    setTimeout(() => {
      setSelectedAnswerId(null);
      setDecisionSuccess(null);
    }, 1800);
  }

  return (
    <div className="space-y-6 pb-12">
      {/* VIEW 1: Marking and Review Queue (Figma 06 / Marking and review queue - Node 4:357) */}
      {!selectedAnswerId ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-['Plus_Jakarta_Sans'] text-3xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
                Review queue
              </h1>
              <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
                {state.assessment.title || "Mid-semester assessment"} / Run 3
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Run remaining answers
              </button>
            </div>
          </div>

          <p className="text-sm text-[color:var(--x-secondary,#4b5563)]">
            {answersNeedingReview.length || 6} answers need a decision · 4 extraction issues · 2 grading disputes · 12 accepted answers selected for audit
          </p>

          {/* Review Workload Stat Cards (Figma 121:3458) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Needs decision */}
            <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-6 items-center justify-center text-[color:var(--x-Teacher,#7c3aed)]">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
                  Needs decision
                </span>
              </div>
              <div className="font-['Plus_Jakarta_Sans'] text-4xl font-bold text-[color:var(--x-Teacher,#7c3aed)]">
                {answersNeedingReview.length || 6}
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
                4
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
                2
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
                12
              </div>
            </div>
          </div>

          {/* Tabs (Figma 121:3463) */}
          <div className="flex items-center gap-2 border-b border-[color:var(--x-border,#e4e7ef)] pb-2">
            <button
              onClick={() => setActiveTab("NEEDS_DECISION")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
                activeTab === "NEEDS_DECISION"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              Needs decision ({answersNeedingReview.length || 6})
            </button>
            <button
              onClick={() => setActiveTab("AUDIT")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
                activeTab === "AUDIT"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              Audit sample (12)
            </button>
            <button
              onClick={() => setActiveTab("ALL")}
              className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
                activeTab === "ALL"
                  ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                  : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
              }`}
            >
              All answers ({state.answers.length || 240})
            </button>
          </div>

          {/* Review Work Queue Table Card (Figma 121:3467) */}
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
                  {/* Real or Mock Queue Rows */}
                  {state.answers.length > 0 ? (
                    state.answers.map((ans) => {
                      const sc = scriptOf(ans.scriptId);
                      const q = questionOf(ans.questionId);
                      const curV = activeVersion(ans);
                      const openF = unresolvedFlags(curV);
                      const hasDispute = ans.routingStatus === "NEEDS_REVIEW";
                      const reasonText = openF.length > 0 ? openF[0].message : hasDispute ? "Criterion scores still disagree" : "Verified & marked";
                      const statePill = hasDispute ? "Teacher review" : ans.routingStatus === "MANUAL_MARKING" ? "Manual marking" : "Ready";
                      return (
                        <tr key={ans.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-6 py-4 font-mono font-semibold text-[color:var(--x-ink,#111827)]">
                            {sc?.pseudonymousCode || "S-014"}
                          </td>
                          <td className="px-4 py-4 font-mono font-semibold text-[color:var(--x-primary700,#3730a3)]">
                            {q?.number || "Q3"}
                          </td>
                          <td className="px-4 py-4 text-sm text-[color:var(--x-ink,#111827)]">
                            <div className="flex items-center gap-2">
                              <span className="size-2 rounded-full bg-amber-500" />
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
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                            >
                              Review answer →
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    // Default Fallback Mock Rows matching Figma Node 4:357 exactly
                    <>
                      <tr className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4 font-mono font-semibold text-[color:var(--x-ink,#111827)]">S-014</td>
                        <td className="px-4 py-4 font-mono font-semibold text-[color:var(--x-primary700,#3730a3)]">Q3</td>
                        <td className="px-4 py-4 text-sm text-[color:var(--x-ink,#111827)]">
                          <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Criterion scores still disagree
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-warningTint,#fef3c7)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Teacher review
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setSelectedAnswerId("mock-s014")}
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                          >
                            Review answer →
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4 font-mono font-semibold text-[color:var(--x-ink,#111827)]">S-021</td>
                        <td className="px-4 py-4 font-mono font-semibold text-[color:var(--x-primary700,#3730a3)]">Q2</td>
                        <td className="px-4 py-4 text-sm text-[color:var(--x-ink,#111827)]">
                          <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Unsupported diagram in answer
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-warningTint,#fef3c7)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Manual marking
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setSelectedAnswerId("mock-s021")}
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                          >
                            Mark manually →
                          </button>
                        </td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4 font-mono font-semibold text-[color:var(--x-ink,#111827)]">S-027</td>
                        <td className="px-4 py-4 font-mono font-semibold text-[color:var(--x-primary700,#3730a3)]">Q1</td>
                        <td className="px-4 py-4 text-sm text-[color:var(--x-ink,#111827)]">
                          <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Unclear transcript word
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-warningTint,#fef3c7)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Input correction
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setSelectedAnswerId("mock-s027")}
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                          >
                            Correct transcript →
                          </button>
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* VIEW 2: Teacher Marking Decision (Figma 07 / Teacher marking decision - Node 4:457) */
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedAnswerId(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
                >
                  ← Back to queue
                </button>
                <h1 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
                  Review answer · {currentAnswer ? `${scriptOf(currentAnswer.scriptId)?.pseudonymousCode || "S-014"} / ${questionOf(currentAnswer.questionId)?.number || "Q3"}` : "S-014 / Q3"}
                </h1>
              </div>
              <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
                Unresolved after one evidence exchange / Rubric v2 / Transcript v1
              </p>
            </div>
          </div>

          {decisionSuccess && (
            <Alert tone="green" title="Decision Recorded">
              {decisionSuccess}
            </Alert>
          )}

          {/* Marking Evidence & Comparison Split Cards (Figma 121:3962) */}
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            {/* Left Card: Approved Answer Evidence (Figma 121:3963) */}
            <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-5">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[color:var(--x-ink,#111827)]">
                Approved answer
              </h2>

              {/* Transcript display */}
              <div className="rounded-xl bg-slate-50 p-4 font-mono text-sm leading-6 text-[color:var(--x-ink,#111827)] border border-slate-200">
                {curVersion ? (
                  curVersion.spans.map((sp) => (
                    <div key={sp.id} className="flex gap-3">
                      <span className="text-slate-400 select-none">{sp.id}</span>
                      <span>{sp.text}</span>
                    </div>
                  ))
                ) : (
                  <>
                    <p className="mb-1">L01 The operating system allocates the CPU</p>
                    <p className="mb-1">L02 to processes. It keeps programs separate</p>
                    <p className="mb-1">L03 in memory and manages files on disk.</p>
                    <p>L04 It controls I/O using device drivers.</p>
                  </>
                )}
              </div>

              {/* Disputed Evidence Card */}
              <div className="rounded-xl bg-[color:var(--x-primary50,#f0f1ff)] p-5 border border-indigo-100 space-y-3">
                <div className="font-semibold text-[color:var(--x-primary700,#3730a3)] text-sm">
                  C3.2 · Memory isolation
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Atint,#dbeafe)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                    <span className="size-2 rounded-full bg-blue-500" />
                    Evaluator A
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Btint,#ffedd5)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                    <span className="size-2 rounded-full bg-orange-500" />
                    Evaluator B
                  </span>
                </div>
                <div className="text-sm text-[color:var(--x-secondary,#4b5563)] space-y-1">
                  <p>Evaluator A: &ldquo;keeps programs separate&rdquo; covers isolation.</p>
                  <p>Evaluator B: allocation is not explained.</p>
                </div>
              </div>

              {/* Marks summary mono */}
              <div className="font-mono text-xs text-[color:var(--x-secondary,#4b5563)] space-y-1">
                <p>Initial A: 8 / 10 · Initial B: 8 / 10</p>
                <p>Revised A: 8 / 10 · Revised B: 8 / 10</p>
              </div>

              {/* Evidence action buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFullPage((v) => !v)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {showFullPage ? "Hide image" : "View image"}
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Communication history
                </button>
              </div>

              {showFullPage && currentAnswer && (
                <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 p-2">
                  {regionsForAnswer(state, currentAnswer).map((r) => {
                    const im = scriptOf(currentAnswer.scriptId)?.images.find((i) => i.id === r.imageId);
                    if (!im) return null;
                    return <RegionCrop key={r.id} image={im} rect={r.bbox} zoom={zoom} />;
                  })}
                </div>
              )}
            </div>

            {/* Right Card: Dual Evaluator Criterion Comparison (Figma 121:3976) */}
            <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[color:var(--x-ink,#111827)]">
                  Criterion comparison
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Teachertint,#ede9fe)] px-3 py-1 text-xs font-semibold text-[color:var(--x-Teacher,#7c3aed)]">
                  Teacher decision
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[color:var(--x-secondary,#4b5563)] border-b border-slate-100">
                    <tr>
                      <th className="py-2.5">Criterion</th>
                      <th className="py-2.5 text-center">
                        <span className="rounded-full bg-[color:var(--x-Atint,#dbeafe)] px-2 py-0.5 text-xs font-semibold text-blue-900">
                          A
                        </span>
                      </th>
                      <th className="py-2.5 text-center">
                        <span className="rounded-full bg-[color:var(--x-Btint,#ffedd5)] px-2 py-0.5 text-xs font-semibold text-orange-900">
                          B
                        </span>
                      </th>
                      <th className="py-2.5 text-center text-[color:var(--x-Teacher,#7c3aed)] font-semibold">Teacher final</th>
                      <th className="py-2.5 text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Row 1: CPU allocation */}
                    <tr>
                      <td className="py-3 font-medium text-[color:var(--x-ink,#111827)]">CPU allocation</td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base">3</span>
                      </td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base">3</span>
                      </td>
                      <td className="py-3 text-center">
                        <div className="inline-flex items-center rounded-xl bg-[color:var(--x-Teachertint,#ede9fe)] p-1">
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c1", -1, 3)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-mono font-semibold">{teacherMarks["c1"]}</span>
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c1", 1, 3)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-right font-mono text-slate-500">3</td>
                    </tr>

                    {/* Row 2: Memory allocation / isolation (disputed) */}
                    <tr className="bg-[color:var(--x-primary50,#f0f1ff)]">
                      <td className="py-3 px-2 font-medium text-[color:var(--x-ink,#111827)]">Memory isolation</td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base text-blue-800">2</span>
                      </td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base text-orange-800">1</span>
                      </td>
                      <td className="py-3 text-center">
                        <div className="inline-flex items-center rounded-xl bg-[color:var(--x-Teachertint,#ede9fe)] p-1">
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c2", -1, 3)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-mono font-semibold">{teacherMarks["c2"]}</span>
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c2", 1, 3)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500">3</td>
                    </tr>

                    {/* Row 3: File management (disputed) */}
                    <tr className="bg-[color:var(--x-primary50,#f0f1ff)]">
                      <td className="py-3 px-2 font-medium text-[color:var(--x-ink,#111827)]">File management</td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base text-blue-800">1</span>
                      </td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base text-orange-800">2</span>
                      </td>
                      <td className="py-3 text-center">
                        <div className="inline-flex items-center rounded-xl bg-[color:var(--x-Teachertint,#ede9fe)] p-1">
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c3", -1, 2)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-mono font-semibold">{teacherMarks["c3"]}</span>
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c3", 1, 2)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500">2</td>
                    </tr>

                    {/* Row 4: I/O management */}
                    <tr>
                      <td className="py-3 font-medium text-[color:var(--x-ink,#111827)]">I/O management</td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base">2</span>
                      </td>
                      <td className="py-3 text-center">
                        <span className="font-['Plus_Jakarta_Sans'] font-semibold text-base">2</span>
                      </td>
                      <td className="py-3 text-center">
                        <div className="inline-flex items-center rounded-xl bg-[color:var(--x-Teachertint,#ede9fe)] p-1">
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c4", -1, 2)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-mono font-semibold">{teacherMarks["c4"]}</span>
                          <button
                            type="button"
                            onClick={() => adjustCriterionMark("c4", 1, 2)}
                            className="size-7 rounded-lg text-slate-700 hover:bg-white/60 font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-right font-mono text-slate-500">2</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Teacher Decision Summary Card (Figma 121:4020) */}
          <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-8">
              {/* Progress Ring */}
              <div className="relative size-36 shrink-0 flex items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 160 160">
                  <circle
                    cx="80"
                    cy="80"
                    r="68"
                    fill="none"
                    stroke="var(--x-bg,#f5f6fa)"
                    strokeWidth="12"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="68"
                    fill="none"
                    stroke="var(--x-Teacher,#7c3aed)"
                    strokeWidth="12"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-300"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-['Plus_Jakarta_Sans'] text-2xl font-bold text-[color:var(--x-ink,#111827)]">
                    {finalMarkSum} / {totalMaxMarks}
                  </span>
                  <span className="text-xs text-[color:var(--x-secondary,#4b5563)]">
                    selected mark
                  </span>
                </div>
              </div>

              {/* Decision reason textarea */}
              <div className="flex-1 w-full space-y-2">
                <label className="text-sm font-semibold text-[color:var(--x-ink,#111827)]">
                  Decision reason &amp; feedback notes
                </label>
                <textarea
                  rows={3}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder="Explain why this score was selected..."
                  className="w-full rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-3 text-sm text-[color:var(--x-ink,#111827)] focus:border-indigo-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedAnswerId(null)}
                className="h-12 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-6 text-sm font-semibold text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDecision}
                className="h-12 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-6 text-sm font-semibold text-white hover:bg-indigo-700 transition"
              >
                Confirm teacher decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
