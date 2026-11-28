"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";
import { StudentDashboard } from "@/components/StudentDashboard";
import { Badge, fmtTime } from "@/components/ui";
import { STAGES, orderedImages, scriptStage, scriptStatus } from "@/lib/logic";
import { getPartialOptions, useStore } from "@/lib/store";
import type { StudentReviewRequest } from "@/lib/types";

function PendingReviewRow({
  request,
  onResolve,
}: {
  request: StudentReviewRequest;
  onResolve: (requestId: string, note: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono font-medium text-[color:var(--x-ink,#111827)]">{request.studentId}</span>
        <span className="font-medium text-[color:var(--x-ink,#111827)]">{request.questionNumber}</span>
        <span className="text-[11px] text-slate-400">{fmtTime(request.submittedAt)}</span>
      </div>
      <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">{request.reason}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resolution note"
          className="h-10 min-w-[12rem] flex-1 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 text-sm text-[color:var(--x-ink,#111827)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--x-primary600,#4338ca)]/30"
        />
        <button
          type="button"
          onClick={() => {
            const trimmed = note.trim();
            if (!trimmed) return;
            onResolve(request.id, trimmed);
          }}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
        >
          Resolve
        </button>
      </div>
    </li>
  );
}

export default function Overview() {
  const { state, user, actions } = useStore();
  const [activeTab, setActiveTab] = useState<"ALL" | "ACTIVE" | "RELEASED">("ALL");
  const [schemeOpen, setSchemeOpen] = useState(true);
  const [releaseStudentId, setReleaseStudentId] = useState("245001K");
  const [newReleasedMark, setNewReleasedMark] = useState("");
  const [criterionStatus, setCriterionStatus] = useState<
    Record<string, "" | "COVERED" | "PARTIAL" | "MISSING">
  >({});
  const [partialMarks, setPartialMarks] = useState<Record<string, number | undefined>>({});
  const [releaseMessage, setReleaseMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const { answers, scripts, assessment } = state;
  const count = (f: (s: (typeof answers)[number]["routingStatus"]) => boolean) =>
    answers.filter((a) => f(a.routingStatus)).length;

  const awaitingReviewCount = count((s) => s === "NEEDS_REVIEW");
  const approvedCount = count((s) => s === "READY_FOR_AI");
  const isReleased = Object.keys(state.studentResults || {}).length > 0;
  const pendingReviews = state.reviewRequests.filter((r) => r.status === "PENDING_TEACHER_REVIEW");

  const q1 = state.assessment.questions[0];
  const approvedQ1Rubric = q1
    ? state.rubrics
        .filter((r) => r.questionId === q1.id && r.approved)
        .sort((a, b) => b.version - a.version)[0]
    : undefined;
  const q1Criteria = approvedQ1Rubric?.criteria ?? [];
  const chosenCriterionStatusCount = q1Criteria.filter((criterion) => Boolean(criterionStatus[criterion.id])).length;
  const normalizedReleaseStudentId = releaseStudentId.trim();
  const existingQ1Results = normalizedReleaseStudentId
    ? (state.studentResults[normalizedReleaseStudentId] ?? []).filter((r) => r.questionId === q1?.id)
    : [];
  const hasReleasedQ1 = existingQ1Results.length > 0;
  const latestQ1Result = existingQ1Results.reduce<(typeof existingQ1Results)[number] | undefined>(
    (latest, result) => (!latest || result.resultVersion > latest.resultVersion ? result : latest),
    undefined,
  );
  const releaseReady =
    q1Criteria.length > 0 &&
    q1Criteria.every((criterion) => {
      const status = criterionStatus[criterion.id];
      if (status === "COVERED" || status === "MISSING") return true;
      if (status !== "PARTIAL") return false;
      const options = getPartialOptions(criterion);
      return options.length > 0 && options.includes(partialMarks[criterion.id] ?? Number.NaN);
    });
  const releaseDisabledReason = !normalizedReleaseStudentId
    ? "Enter a student ID to release Q1."
    : hasReleasedQ1
      ? `Q1 has already been released to ${normalizedReleaseStudentId}. Use Update released mark to change the result.`
      : !approvedQ1Rubric
        ? "Approve a Q1 marking scheme before releasing results."
        : !q1Criteria.length
          ? "The approved Q1 marking scheme has no criteria to release."
          : !releaseReady
            ? "Choose a valid status for every criterion and an allowed mark for each Partial status."
            : "";
  const showReleaseDisabledHint = Boolean(releaseDisabledReason) &&
    !(releaseMessage?.type === "success" && hasReleasedQ1);

  useEffect(() => {
    const criteriaById = new Map(q1Criteria.map((criterion) => [criterion.id, criterion]));
    const invalidStatusIds = new Set<string>();
    for (const [criterionId, status] of Object.entries(criterionStatus)) {
      const criterion = criteriaById.get(criterionId);
      if (
        !criterion ||
        (status !== "" && status !== "COVERED" && status !== "PARTIAL" && status !== "MISSING") ||
        (status === "PARTIAL" && getPartialOptions(criterion).length === 0)
      ) {
        invalidStatusIds.add(criterionId);
      }
    }
    const invalidPartialIds = new Set<string>();
    for (const [criterionId, mark] of Object.entries(partialMarks)) {
      const criterion = criteriaById.get(criterionId);
      if (
        !criterion ||
        criterionStatus[criterionId] !== "PARTIAL" ||
        (mark !== undefined && !getPartialOptions(criterion).includes(mark))
      ) {
        invalidPartialIds.add(criterionId);
        if (criterionStatus[criterionId] === "PARTIAL" && mark !== undefined) {
          invalidStatusIds.add(criterionId);
        }
      }
    }

    if (invalidStatusIds.size) {
      setCriterionStatus((current) => {
        let changed = false;
        const next = { ...current };
        for (const criterionId of invalidStatusIds) {
          if (next[criterionId] !== "") {
            next[criterionId] = "";
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
    if (invalidPartialIds.size) {
      setPartialMarks((current) => {
        let changed = false;
        const next = { ...current };
        for (const criterionId of invalidPartialIds) {
          if (criterionId in next) {
            delete next[criterionId];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
  }, [q1Criteria, criterionStatus, partialMarks]);

  if (user?.role === "ADMIN") {
    return <AdminDashboard />;
  }
  if (user?.role === "STUDENT") {
    return <StudentDashboard />;
  }

  function clearReleaseMessage() {
    setReleaseMessage(null);
  }

  function handleRelease() {
    const result = actions.releaseResult(normalizedReleaseStudentId, criterionStatus, partialMarks);
    if (!result.ok) {
      setReleaseMessage({ type: "error", text: result.error || "Q1 could not be released." });
      return;
    }
    const awardedMarks = q1Criteria.reduce((sum, criterion) => {
      const status = criterionStatus[criterion.id];
      return sum + (
        status === "COVERED"
          ? criterion.maxMarks
          : status === "PARTIAL"
            ? partialMarks[criterion.id] ?? 0
            : 0
      );
    }, 0);
    const maxMarks = q1Criteria.reduce((sum, criterion) => sum + criterion.maxMarks, 0);
    setReleaseMessage({
      type: "success",
      text: `Q1 released to ${normalizedReleaseStudentId}: ${Number(awardedMarks.toFixed(2))}/${Number(maxMarks.toFixed(2))}`,
    });
  }

  function handleReviseReleasedMark() {
    const input = newReleasedMark.trim();
    const awardedMarks = input ? Number(input) : Number.NaN;
    const result = actions.reviseReleasedMark(normalizedReleaseStudentId, awardedMarks);
    if (!result.ok) {
      setReleaseMessage({ type: "error", text: result.error || "The released mark could not be updated." });
      return;
    }
    setReleaseMessage({
      type: "success",
      text: `Q1 mark updated for ${normalizedReleaseStudentId}: ${awardedMarks}/${latestQ1Result?.maxMarks ?? q1?.maxMarks ?? 0}`,
    });
  }

  // Dynamic Pipeline Stage Tracking
  const hasScheme = (state.rubrics?.length ?? 0) > 0 && state.rubrics.some((r) => r.approved);
  const hasUploads = scripts.length > 0;
  const hasApprovedTranscripts =
    answers.length > 0 &&
    answers.every((a) => a.routingStatus === "READY_FOR_AI" || a.routingStatus === "MANUAL_MARKING");
  const hasEvaluation = (state.runs ?? []).some((r) => r.kind === "EVALUATION" && r.status === "COMPLETED");
  const hasReviewCompleted = hasEvaluation && awaitingReviewCount === 0;

  const currentStepIndex = !hasScheme
    ? 0
    : !hasUploads
    ? 1
    : !hasApprovedTranscripts
    ? 2
    : !hasEvaluation
    ? 3
    : !isReleased
    ? 4
    : 5;

  const pipelineSteps = [
    {
      name: "Scheme",
      href: "/rubric",
      isCompleted: hasScheme,
      isActive: currentStepIndex === 0,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      name: "Upload",
      href: "/upload",
      isCompleted: hasUploads,
      isActive: currentStepIndex === 1,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      name: "Transcripts",
      href: "/scripts",
      isCompleted: hasApprovedTranscripts,
      isActive: currentStepIndex === 2,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 6h16M4 12h16M4 18h7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      name: "Marking",
      href: "/review",
      isCompleted: hasEvaluation,
      isActive: currentStepIndex === 3,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      name: "Review",
      href: "/review",
      isCompleted: hasReviewCompleted,
      isActive: currentStepIndex === 4,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      name: "Release",
      href: "/review",
      isCompleted: isReleased,
      isActive: currentStepIndex === 5,
      icon: (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  // Real assessment row mapped from live store state
  const assessmentRows = [
    {
      id: assessment.id || "asm-mid-2026",
      name: assessment.title || "Mid-semester assessment",
      course: assessment.course || "Object Oriented Programming",
      scriptsProgress: `${scripts.length} uploaded`,
      progressPct: scripts.length > 0 ? Math.min(100, Math.round((approvedCount / scripts.length) * 100)) : 0,
      updated: scripts.length > 0 ? "Recently" : "Draft",
      status: isReleased ? "Released" : awaitingReviewCount > 0 ? "Needs review" : scripts.length > 0 ? "Preparing scripts" : "Draft",
      statusTone: isReleased ? "success" : awaitingReviewCount > 0 ? "warning" : "default",
      actionText: isReleased ? "View results →" : awaitingReviewCount > 0 ? "Open review queue →" : scripts.length > 0 ? "Approve transcripts →" : "Add marking scheme →",
      actionHref: isReleased ? "/review" : awaitingReviewCount > 0 ? "/review" : scripts.length > 0 ? "/scripts" : "/rubric",
    },
  ];

  const activeCount = isReleased ? 0 : 1;
  const releasedCount = isReleased ? 1 : 0;

  const visibleAssessments = assessmentRows.filter((r) => {
    if (activeTab === "ACTIVE") return r.status === "Needs review" || r.status === "Preparing scripts" || r.status === "Draft";
    if (activeTab === "RELEASED") return r.status === "Released";
    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header (Figma 121:2305) */}
      <div className="space-y-2">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="shrink-0">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
              Assessments
            </h1>
            <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
              Object Oriented Programming · Level 2 Semester 1 · 2026
            </p>
          </div>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 md:gap-4">
            <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[color:var(--x-secondary,#4b5563)] sm:flex-none">
                <span className="font-medium whitespace-nowrap">Student id</span>
                <input
                  type="text"
                  value={releaseStudentId}
                  onChange={(e) => {
                    clearReleaseMessage();
                    setReleaseStudentId(e.target.value);
                  }}
                  className="h-12 w-full min-w-0 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 text-sm text-[color:var(--x-ink,#111827)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--x-primary600,#4338ca)]/30 sm:w-32 sm:flex-none"
                />
              </label>
              <button
                type="button"
                onClick={handleRelease}
                disabled={Boolean(releaseDisabledReason)}
                title={releaseDisabledReason || undefined}
                className="inline-flex h-12 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
              >
                Release
              </button>
            </div>
            <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[color:var(--x-secondary,#4b5563)] sm:flex-none">
                <span className="font-medium whitespace-nowrap">New mark</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={newReleasedMark}
                  onChange={(e) => {
                    clearReleaseMessage();
                    setNewReleasedMark(e.target.value);
                  }}
                  className="h-12 w-full min-w-0 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 text-sm text-[color:var(--x-ink,#111827)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--x-primary600,#4338ca)]/30 sm:w-24 sm:flex-none"
                />
              </label>
              <button
                type="button"
                onClick={handleReviseReleasedMark}
                className="inline-flex h-12 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
              >
                Update released mark
              </button>
            </div>
            <Link
              href="/upload"
              className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition sm:w-auto"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Create assessment
            </Link>
          </div>
            </div>
          </div>
          {(showReleaseDisabledHint || releaseMessage) && (
            <div className="space-y-2">
              {showReleaseDisabledHint && (
                <p className="text-xs text-[color:var(--x-secondary,#4b5563)]" role="status">
                  {releaseDisabledReason}
                </p>
              )}
              {releaseMessage && (
                <div
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
                    releaseMessage.type === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                  role={releaseMessage.type === "error" ? "alert" : "status"}
                >
                  <span>{releaseMessage.text}</span>
                  <button
                    type="button"
                    onClick={clearReleaseMessage}
                    className="shrink-0 font-semibold underline underline-offset-2"
                    aria-label="Dismiss release message"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
        <button
          type="button"
          aria-expanded={schemeOpen}
          aria-controls="marking-scheme-body"
          onClick={() => setSchemeOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--x-primary600,#4338ca)]/50 focus-visible:ring-offset-2"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-heading text-lg font-semibold text-[color:var(--x-ink,#111827)]">
              Marking scheme
            </span>
            <span className="text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
              {q1Criteria.length} criteria · {chosenCriterionStatusCount} of {q1Criteria.length} statuses chosen
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            className={`size-5 shrink-0 text-[color:var(--x-secondary,#4b5563)] transition-transform duration-200 ${schemeOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div id="marking-scheme-body" hidden={!schemeOpen}>
          {!approvedQ1Rubric ? (
            <p className="mt-4 text-sm text-[color:var(--x-secondary,#4b5563)]">The marking scheme is not approved yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[color:var(--x-border,#e4e7ef)]">
              {q1Criteria.map((c) => {
                const partialOptions = getPartialOptions(c);
                const status = criterionStatus[c.id] ?? "";
                return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm text-[color:var(--x-ink,#111827)]"
                >
                  <span>
                    {c.description} · {c.maxMarks}
                  </span>
                  <div className="flex flex-col gap-1">
                    <select
                      value={status}
                      onChange={(e) => {
                        const nextStatus = e.target.value as "" | "COVERED" | "PARTIAL" | "MISSING";
                        clearReleaseMessage();
                        setCriterionStatus((prev) => ({ ...prev, [c.id]: nextStatus }));
                        setPartialMarks((prev) => {
                          const next = { ...prev };
                          delete next[c.id];
                          return next;
                        });
                      }}
                      aria-label={`Status for criterion ${c.id}`}
                      className="h-10 min-w-[10rem] rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 text-sm text-[color:var(--x-ink,#111827)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--x-primary600,#4338ca)]/30"
                    >
                      <option value="">Choose status</option>
                      <option value="COVERED">Covered</option>
                      <option value="PARTIAL" disabled={!partialOptions.length}>Partial</option>
                      <option value="MISSING">Missing</option>
                    </select>
                    {!partialOptions.length && (
                      <span className="max-w-64 text-xs text-[color:var(--x-secondary,#4b5563)]">
                        No partial mark defined in the approved scheme. Choose Covered or Missing.
                      </span>
                    )}
                    {status === "PARTIAL" && partialOptions.length > 0 && (
                      <label className="flex flex-col gap-1 text-xs text-[color:var(--x-secondary,#4b5563)]">
                        Partial mark
                        <select
                          value={partialMarks[c.id] === undefined ? "" : String(partialMarks[c.id])}
                          onChange={(e) => {
                            clearReleaseMessage();
                            const value = e.target.value;
                            setPartialMarks((prev) => ({
                              ...prev,
                              [c.id]: value === "" ? undefined : Number(value),
                            }));
                          }}
                          aria-label={`Partial mark for criterion ${c.id}`}
                          className="h-9 min-w-[10rem] rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 text-sm text-[color:var(--x-ink,#111827)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--x-primary600,#4338ca)]/30"
                        >
                          <option value="">Choose mark</option>
                          {partialOptions.map((mark) => (
                            <option key={mark} value={mark}>{mark}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
        <div className="font-heading text-lg font-semibold text-[color:var(--x-ink,#111827)]">
          Pending review requests
        </div>
        {pendingReviews.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--x-secondary,#4b5563)]">No pending review requests.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:var(--x-border,#e4e7ef)]">
            {pendingReviews.map((r) => (
              <PendingReviewRow
                key={r.id}
                request={r}
                onResolve={actions.resolveReviewRequest}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 5-Stage Pipeline Progress Card (Figma 121:2306) */}
      <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--x-border,#e4e7ef)] pb-4">
          <div className="font-heading text-lg font-semibold text-[color:var(--x-ink,#111827)]">
            Progress
          </div>
          {/* Dual Evaluator Motif */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Atint,#dbeafe)] px-3 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
              <span className="size-2 rounded-full bg-blue-500" />
              Evaluator A
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Btint,#ffedd5)] px-3 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
              <span className="size-2 rounded-full bg-orange-500" />
              Evaluator B
            </span>
          </div>
        </div>

        {/* Dynamic Pipeline Steps */}
        <div className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-6">
          {pipelineSteps.map((st) => {
            return (
              <Link key={st.name} href={st.href} className="group flex flex-col items-start gap-2">
                <div
                  className={`flex size-10 items-center justify-center rounded-full transition group-hover:scale-105 ${
                    st.isCompleted
                      ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                      : st.isActive
                      ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)] ring-2 ring-[color:var(--x-primary700,#3730a3)] ring-offset-2"
                      : "bg-slate-100 text-slate-400 border border-slate-200"
                  }`}
                >
                  {st.isCompleted ? (
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    st.icon
                  )}
                </div>
                <span
                  className={`text-sm ${
                    st.isActive
                      ? "font-semibold text-[color:var(--x-primary700,#3730a3)]"
                      : st.isCompleted
                      ? "font-medium text-[color:var(--x-secondary,#4b5563)] group-hover:text-[color:var(--x-primary700,#3730a3)]"
                      : "font-normal text-slate-400"
                  }`}
                >
                  {st.name}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Assessment Totals Stat Cards (Figma 121:2307) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Card 1: All assessments */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-6 items-center justify-center text-[color:var(--x-secondary,#4b5563)]">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
              All assessments
            </span>
          </div>
          <div className="font-heading text-4xl font-bold text-[color:var(--x-ink,#111827)]">
            {assessmentRows.length}
          </div>
        </div>

        {/* Card 2: Active */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-6 items-center justify-center text-amber-600">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
              Active / In progress
            </span>
          </div>
          <div className="font-heading text-4xl font-bold text-[color:var(--x-ink,#111827)]">
            {activeCount}
          </div>
        </div>

        {/* Card 3: Released */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-6 items-center justify-center text-emerald-600">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-normal text-[color:var(--x-secondary,#4b5563)]">
              Released
            </span>
          </div>
          <div className="font-heading text-4xl font-bold text-[color:var(--x-ink,#111827)]">
            {releasedCount}
          </div>
        </div>
      </div>

      {/* Warning Alert Banner - only shown when answers actually need review */}
      {awaitingReviewCount > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[color:var(--x-warningTint,#fef3c7)] p-5 border border-amber-200">
          <div className="flex items-center gap-3">
            <div className="flex size-6 shrink-0 items-center justify-center text-amber-700">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[color:var(--x-ink,#111827)]">
              {assessment.title || "Mid-semester assessment"}: {awaitingReviewCount} answer{awaitingReviewCount > 1 ? "s" : ""} need your decision before results can be released.
            </p>
          </div>
          <Link
            href="/review"
            className="shrink-0 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] hover:underline"
          >
            Open review queue →
          </Link>
        </div>
      )}

      {/* Filter Tabs (Figma 121:2312) */}
      <div className="flex items-center gap-2 border-b border-[color:var(--x-border,#e4e7ef)] pb-2">
        <button
          onClick={() => setActiveTab("ALL")}
          className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
            activeTab === "ALL"
              ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
              : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
          }`}
        >
          All assessments ({assessmentRows.length})
        </button>
        <button
          onClick={() => setActiveTab("ACTIVE")}
          className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
            activeTab === "ACTIVE"
              ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
              : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
          }`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setActiveTab("RELEASED")}
          className={`h-11 rounded-xl px-4 text-sm font-semibold transition ${
            activeTab === "RELEASED"
              ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
              : "text-[color:var(--x-secondary,#4b5563)] hover:bg-slate-100"
          }`}
        >
          Released ({releasedCount})
        </button>
      </div>

      {/* Assessment List Table Card (Figma 121:2316) */}
      <div className="overflow-hidden rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--x-border,#e4e7ef)] bg-slate-50/70 text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
              <tr>
                <th className="px-6 py-3.5">Assessment</th>
                <th className="px-4 py-3.5">Scripts</th>
                <th className="px-4 py-3.5">Updated</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--x-border,#e4e7ef)]">
              {visibleAssessments.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/50 transition">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-[color:var(--x-ink,#111827)]">{row.name}</div>
                    <div className="text-xs text-[color:var(--x-secondary,#4b5563)]">{row.course}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-mono text-sm text-[color:var(--x-ink,#111827)]">{row.scriptsProgress}</div>
                    <div className="mt-1.5 h-2 w-32 overflow-hidden rounded-full bg-[color:var(--x-border,#e4e7ef)]">
                      <div
                        className="h-full rounded-full bg-[color:var(--x-primary600,#4338ca)] transition-all"
                        style={{ width: `${row.progressPct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs text-[color:var(--x-secondary,#4b5563)]">
                    {row.updated}
                  </td>
                  <td className="px-4 py-4">
                    {row.status === "Needs review" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-warningTint,#fef3c7)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                        <span className="size-2 rounded-full bg-amber-500" />
                        Needs review
                      </span>
                    )}
                    {row.status === "Preparing scripts" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-bg,#f5f6fa)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                        <span className="size-2 rounded-full bg-slate-400" />
                        Preparing scripts
                      </span>
                    )}
                    {row.status === "Draft" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-bg,#f5f6fa)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                        <span className="size-2 rounded-full bg-slate-400" />
                        Draft
                      </span>
                    )}
                    {row.status === "Released" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Moderatortint,#d1fae5)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        Released
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={row.actionHref}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-4 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
                    >
                      {row.actionText}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Uploaded Scripts Roster Section */}
      <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-[color:var(--x-border,#e4e7ef)] pb-4">
          <div>
            <h2 className="font-heading text-lg font-semibold text-[color:var(--x-ink,#111827)]">
              Current Assessment Scripts ({scripts.length})
            </h2>
            <p className="text-xs text-[color:var(--x-secondary,#4b5563)]">
              Scripts uploaded for {assessment.title || "Mid-semester assessment"}
            </p>
          </div>
          <Link
            href="/upload"
            className="rounded-xl border border-[color:var(--x-border,#e4e7ef)] px-3.5 py-1.5 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50"
          >
            + Upload more
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-[color:var(--x-secondary,#4b5563)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Script Code</th>
                <th className="px-3 py-2.5 font-medium">Pages</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Answers</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--x-border,#e4e7ef)]">
              {scripts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                    No scripts uploaded yet. Click &ldquo;+ Upload more&rdquo; to add student handwritten papers.
                  </td>
                </tr>
              ) : (
                scripts.map((s) => {
                  const status = scriptStatus(state, s);
                  const ans = answers.filter((a) => a.scriptId === s.id);
                  const approved = ans.filter((a) => a.routingStatus !== "NEEDS_REVIEW").length;
                  const answersCol = ans.length ? `${approved} / ${ans.length}` : "—";
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                          {s.pseudonymousCode}
                        </div>
                        <div className="text-[11px] text-slate-400">{fmtTime(s.uploadedAt)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[color:var(--x-secondary,#4b5563)]">
                        {orderedImages(s).length} pages
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">
                        {answersCol}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/scripts/${s.id}`}
                          className="text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] hover:underline"
                        >
                          Approve transcript →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
