"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RegionCrop } from "@/components/PageImage";
import { Badge, Button, Card } from "@/components/ui";
import { activeVersion } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { AnswerRegion, ScriptImage, StudentQuestionResult, TextSpan } from "@/lib/types";

// Default sample questions aligned with Figma "02 Student" design (38 / 50 total)
const FIGMA_SAMPLE_QUESTIONS = [
  {
    id: "q1",
    number: "Q1",
    topic: "Processes and threads",
    awardedMarks: 8,
    maxMarks: 10,
    feedback: "You clearly distinguished processes and threads and explained OS execution contexts and memory address isolation.",
    criterionId: "C1.1",
    criterionName: "C1.1 · Process vs thread concurrency and execution contexts",
  },
  {
    id: "q2",
    number: "Q2",
    topic: "Scheduling",
    awardedMarks: 7,
    maxMarks: 10,
    feedback: "Good coverage of Round Robin and FCFS; missed context switch overhead details and preemptive scheduling criteria.",
    criterionId: "C2.1",
    criterionName: "C2.1 · Preemptive scheduling and turnaround time calculation",
  },
  {
    id: "q3",
    number: "Q3",
    topic: "Resource management",
    awardedMarks: 8,
    maxMarks: 10,
    feedback: "You identified CPU allocation, file management and device drivers for managing resources.",
    criterionId: "C3.2",
    criterionName: "C3.2 · Memory allocation and isolation",
  },
  {
    id: "q4",
    number: "Q4",
    topic: "Memory",
    awardedMarks: 8,
    maxMarks: 10,
    feedback: "Well explained virtual memory, page fault handling, and page table translations.",
    criterionId: "C4.1",
    criterionName: "C4.1 · Virtual memory mapping and page replacement",
  },
  {
    id: "q5",
    number: "Q5",
    topic: "File systems",
    awardedMarks: 7,
    maxMarks: 10,
    feedback: "Understood inode allocation and directory hierarchical pointers; missed journaling recovery explanation.",
    criterionId: "C5.1",
    criterionName: "C5.1 · Inode pointers and file metadata persistence",
  },
];

function StudentDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = (searchParams.get("tab") as "dashboard" | "marks" | "review") || "dashboard";

  const { state, user, actions } = useStore();
  const studentId = user?.studentId ?? user?.username ?? "";
  const myResults = studentId ? (state.studentResults[studentId] ?? []) : [];
  const myRequests = studentId ? state.reviewRequests.filter((r) => r.studentId === studentId) : [];

  const mappedCode = studentId
    ? (state.identityMap.find((m) => m.realStudentId === studentId)?.pseudonymousCode ?? user?.pseudonymousCode)
    : undefined;
  const myScript = mappedCode ? state.scripts.find((s) => s.pseudonymousCode === mappedCode) : undefined;

  // Question selection for marks & review tabs
  const [selectedQId, setSelectedQId] = useState<string>("q3");
  const [selectedCriterion, setSelectedCriterion] = useState<string>("C3.2 · Memory allocation and isolation");
  const [reviewReason, setReviewReason] = useState<string>(
    "I wrote that programs are kept separate in memory. Could you check whether that matches the expected point about isolation?",
  );
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false);

  // Determine current active question data (from live store or Figma defaults)
  const isLiveResults = myResults.length > 0;
  const currentQuestions = isLiveResults
    ? myResults.map((r) => ({
        id: r.questionId,
        number: r.questionNumber,
        topic: state.assessment.questions.find((q) => q.id === r.questionId)?.prompt.slice(0, 30) || "Short answer",
        awardedMarks: r.awardedMarks,
        maxMarks: r.maxMarks,
        feedback: r.feedbackText || "No feedback text available.",
        criterionId: r.criteria[0]?.criterionId || "C1",
        criterionName: r.criteria[0]?.description || "General answer criterion",
      }))
    : FIGMA_SAMPLE_QUESTIONS;

  const activeQuestion =
    currentQuestions.find((q) => q.id === selectedQId) || currentQuestions[2] || currentQuestions[0];

  const totalAwarded = currentQuestions.reduce((s, q) => s + q.awardedMarks, 0);
  const totalMax = currentQuestions.reduce((s, q) => s + q.maxMarks, 0);

  // Evidence query helper
  function getQuestionEvidence(questionId: string): {
    crops: { region: AnswerRegion; image: ScriptImage }[];
    spans: TextSpan[];
    versionNum?: number;
  } {
    if (!myScript) return { crops: [], spans: [] };
    const answer = state.answers.find((a) => a.scriptId === myScript.id && a.questionId === questionId);
    const regions = state.regions
      .filter((r) => r.scriptId === myScript.id && r.questionId === questionId)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    const crops = regions
      .map((region) => {
        const image = myScript.images.find((im) => im.id === region.imageId);
        return image ? { region, image } : null;
      })
      .filter((x): x is { region: AnswerRegion; image: ScriptImage } => x !== null);

    const ver = answer ? activeVersion(answer) : undefined;
    return { crops, spans: ver?.spans ?? [], versionNum: ver?.version };
  }

  const { crops, spans } = getQuestionEvidence(activeQuestion.id);
  const existingRequest = myRequests.find((r) => r.questionId === activeQuestion.id);

  function handleTabChange(tab: "dashboard" | "marks" | "review") {
    router.push(`/?tab=${tab}`);
  }

  function handleSelectQuestion(qId: string) {
    setSelectedQId(qId);
    const q = currentQuestions.find((item) => item.id === qId);
    if (q) {
      setSelectedCriterion(q.criterionName);
    }
  }

  function handleSubmitReviewRequest() {
    if (!reviewReason.trim()) return;
    actions.submitReviewRequest(
      studentId,
      activeQuestion.id,
      activeQuestion.number,
      "CRITERION_INTERPRETATION",
      reviewReason.trim(),
      [],
    );
    setReviewSubmitted(true);
    setTimeout(() => {
      setReviewSubmitted(false);
      handleTabChange("marks");
    }, 2000);
  }

  return (
    <div className="space-y-6">
      {/* SCREEN 1: 00 / Dashboard */}
      {currentTab === "dashboard" && (
        <div className="space-y-6" data-name="00 / Dashboard">
          {/* Profile Welcome Header */}
          <div className="flex flex-wrap items-center gap-4 bg-white p-6 rounded-2xl border border-[#e4e7ef]">
            <div className="size-14 overflow-hidden rounded-full ring-2 ring-indigo-500/20 shrink-0">
              <img
                src="/student-avatar.png"
                alt="Student Avatar"
                className="size-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl lg:text-3xl font-bold text-[#111827]">
                Good day, {user?.displayName || "Demo Student1"}
              </h1>
              <p className="mt-1 text-sm text-[#6b7280]">
                Student · Object Oriented Programming Level 2 Semester 1 2026
              </p>
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#e4e7ef] bg-white p-5 shadow-2xs">
              <div className="text-sm font-medium text-[#6b7280]">Released results</div>
              <div className="mt-2 text-3xl font-bold text-[#111827]">{myResults.length > 0 ? myResults.length : 1}</div>
            </div>
            <div className="rounded-2xl border border-[#e4e7ef] bg-white p-5 shadow-2xs">
              <div className="text-sm font-medium text-[#6b7280]">Latest mark</div>
              <div className="mt-2 text-3xl font-bold text-[#111827]">
                {activeQuestion.awardedMarks} / {activeQuestion.maxMarks}
              </div>
            </div>
          </div>

          {/* Banner 1: Latest Result */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e4e7ef] bg-white p-5 shadow-2xs">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[#111827]">Latest result</div>
              <div className="text-sm text-[#6b7280]">
                Mid-semester assessment · Released 28 Oct 2026 · Version 1 · Q3 is 8 / 10.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                handleSelectQuestion("q3");
                handleTabChange("marks");
              }}
              className="rounded-xl border border-[#e4e7ef] bg-white px-5 py-2.5 text-sm font-semibold text-[#3730a3] hover:bg-slate-50 transition shadow-2xs"
            >
              View result
            </button>
          </div>

          {/* Banner 2: Review */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e4e7ef] bg-white p-5 shadow-2xs">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[#111827]">Review</div>
              <div className="text-sm text-[#6b7280]">
                {existingRequest
                  ? `Review request submitted for ${activeQuestion.number}: ${existingRequest.status}`
                  : "No review request submitted for Q3 yet."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                handleSelectQuestion("q3");
                handleTabChange("review");
              }}
              className="rounded-xl bg-[#4338ca] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3730a3] transition shadow-xs"
            >
              Request a review
            </button>
          </div>
        </div>
      )}

      {/* SCREEN 2: 10 / Student marks and feedback */}
      {currentTab === "marks" && (
        <div className="space-y-6" data-name="10 / Student marks and feedback">
          {/* Header Bar with Overall Score Display */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e4e7ef] bg-white p-6 shadow-2xs">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[#111827]">Mid-semester assessment</h1>
              <p className="mt-1 text-sm text-[#4b5563]">Released 28 Oct 2026 · Result version 1</p>
            </div>
            <div className="text-3xl lg:text-4xl font-bold text-[#111827]">
              {totalAwarded} / {totalMax}
            </div>
          </div>

          {/* Question Breakdown Table Card */}
          <div className="overflow-hidden rounded-2xl border border-[#e4e7ef] bg-white shadow-2xs">
            <div className="grid grid-cols-12 border-b border-[#e4e7ef] bg-[#f9fafb] px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6b7280]">
              <div className="col-span-2">Question</div>
              <div className="col-span-5">Topic</div>
              <div className="col-span-2 text-center">Marks</div>
              <div className="col-span-3 text-right">Action</div>
            </div>

            <div className="divide-y divide-[#e4e7ef]">
              {currentQuestions.map((q) => {
                const isSelected = q.id === selectedQId;
                return (
                  <div
                    key={q.id}
                    onClick={() => handleSelectQuestion(q.id)}
                    className={`grid grid-cols-12 items-center px-6 py-4 text-sm transition cursor-pointer ${
                      isSelected ? "bg-[#eef2ff]" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <div className="col-span-2 font-semibold text-[#111827]">{q.number}</div>
                    <div className="col-span-5 text-[#4b5563] truncate">{q.topic}</div>
                    <div className="col-span-2 text-center font-medium text-[#111827]">
                      {q.awardedMarks} / {q.maxMarks}
                    </div>
                    <div className="col-span-3 text-right">
                      {isSelected ? (
                        <span className="font-semibold text-[#4338ca]">Selected</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectQuestion(q.id);
                          }}
                          className="text-sm font-medium text-[#4b5563] hover:text-[#4338ca] transition"
                        >
                          View feedback →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail Card for Selected Question */}
          <div className="space-y-4 rounded-2xl border border-[#e4e7ef] bg-white p-6 shadow-2xs">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-[#111827]">
                {activeQuestion.number} · What your answer covered
              </h2>
              <p className="text-sm leading-relaxed text-[#4b5563]">{activeQuestion.feedback}</p>
            </div>

            {/* Answer Evidence Crops & OCR Text (If Available) */}
            {crops.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Your Handwritten Script Evidence
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium text-slate-500">Cropped Handwritten Region</div>
                    {crops.map(({ region, image }) => (
                      <div key={region.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
                        <RegionCrop image={image} rect={region.bbox} />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium text-slate-500">Verified OCR Transcript</div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-800 leading-relaxed">
                      {spans.length > 0
                        ? spans.map((s) => s.text).join(" ")
                        : "Handwritten transcript verified by examiner."}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Review Action & Privacy Footnote */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#e4e7ef]">
              <button
                type="button"
                onClick={() => handleTabChange("review")}
                className="rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white hover:bg-[#3730a3] transition shadow-xs"
              >
                Request review for {activeQuestion.number}
              </button>
              <span className="text-xs text-[#6b7280]">
                Your results are visible only to you and authorized course teachers.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN 3: 11 / Student review request */}
      {currentTab === "review" && (
        <div className="space-y-6" data-name="11 / Student review request">
          {/* Header */}
          <div className="rounded-2xl border border-[#e4e7ef] bg-white p-6 shadow-2xs">
            <h1 className="text-2xl lg:text-3xl font-bold text-[#111827]">Request a review</h1>
            <p className="mt-1 text-sm text-[#4b5563]">
              Mid-semester assessment · {activeQuestion.number} · Current released mark: {activeQuestion.awardedMarks} /{" "}
              {activeQuestion.maxMarks}
            </p>
          </div>

          {/* Form & Summary Card */}
          <div className="grid gap-6 lg:grid-cols-12 items-start">
            {/* Left Column: Form (8 cols) */}
            <div className="space-y-5 lg:col-span-8">
              {/* Field: Criterion */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-[#6b7280]">Criterion</label>
                <div className="rounded-xl border border-[#e4e7ef] bg-white p-3.5 text-sm font-medium text-[#111827] shadow-2xs">
                  {selectedCriterion}
                </div>
              </div>

              {/* Field: What should your teacher check? */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[#6b7280]">What should your teacher check?</label>
                  <span className="text-xs text-[#6b7280]">{reviewReason.length} / 500 characters</span>
                </div>
                <textarea
                  rows={5}
                  maxLength={500}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="Explain clearly what specific line or criterion should be checked..."
                  className="w-full rounded-xl border border-[#e4e7ef] bg-white p-3.5 text-sm text-[#111827] leading-relaxed focus:border-indigo-500 focus:outline-none shadow-2xs resize-none"
                />
                <p className="text-xs text-[#6b7280]">Keep your request specific to this answer. Maximum 500 characters.</p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={!reviewReason.trim() || reviewSubmitted}
                  onClick={handleSubmitReviewRequest}
                  className="rounded-xl bg-[#4338ca] px-6 py-3 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-50 transition shadow-xs"
                >
                  {reviewSubmitted ? "Submitting..." : "Submit review request"}
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange("marks")}
                  className="rounded-xl border border-[#e4e7ef] bg-white px-6 py-3 text-sm font-semibold text-[#3730a3] hover:bg-slate-50 transition shadow-2xs"
                >
                  Cancel
                </button>
              </div>

              {/* Alert Banner */}
              <div className="flex items-center gap-3 rounded-2xl bg-[#f0f1ff] p-4 text-xs lg:text-sm text-[#111827] border border-indigo-100">
                <svg className="size-5 shrink-0 text-[#4338ca]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  After submission: Pending teacher review · {activeQuestion.number} mark remains{" "}
                  {activeQuestion.awardedMarks} / {activeQuestion.maxMarks} until a correction is published.
                </span>
              </div>
            </div>

            {/* Right Column: Information Card (4 cols) */}
            <div className="lg:col-span-4">
              <div className="space-y-3 rounded-2xl border border-[#e4e7ef] bg-white p-6 shadow-2xs">
                <div className="text-2xl font-bold text-[#111827]">
                  {activeQuestion.number} · {activeQuestion.awardedMarks} / {activeQuestion.maxMarks}
                </div>
                <div className="text-sm font-medium text-[#4b5563]">Released result v1</div>
                <p className="text-xs leading-relaxed text-[#6b7280]">
                  Submitting a request does not change your mark. Your teacher will respond after reviewing the evidence.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function StudentDashboard() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading student workspace…</div>}>
      <StudentDashboardContent />
    </Suspense>
  );
}
