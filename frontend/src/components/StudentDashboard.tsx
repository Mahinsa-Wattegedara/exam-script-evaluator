"use client";
import { useState } from "react";
import { RegionCrop } from "@/components/PageImage";
import { Badge, Button, Card, CardHeader, Modal, PageHeader } from "@/components/ui";
import { activeVersion } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { AnswerRegion, ScriptImage, StudentQuestionResult, TextSpan } from "@/lib/types";

export function StudentDashboard() {
  const { state, user, actions } = useStore();
  const studentId = user?.studentId ?? user?.username ?? "";
  const myResults = studentId ? (state.studentResults[studentId] ?? []) : [];
  const myRequests = studentId ? state.reviewRequests.filter((r) => r.studentId === studentId) : [];

  const mappedCode = studentId
    ? (state.identityMap.find((m) => m.realStudentId === studentId)?.pseudonymousCode ?? user?.pseudonymousCode)
    : undefined;
  const myScript = mappedCode ? state.scripts.find((s) => s.pseudonymousCode === mappedCode) : undefined;

  const [appealTarget, setAppealTarget] = useState<StudentQuestionResult | null>(null);
  const [issueType, setIssueType] = useState<"TRANSCRIPTION_ERROR" | "CRITERION_INTERPRETATION">("TRANSCRIPTION_ERROR");
  const [reason, setReason] = useState<string>("");
  const [selectedSpanIds, setSelectedSpanIds] = useState<string[]>([]);
  const [focusedSpanByQ, setFocusedSpanByQ] = useState<Record<string, string | null>>({});

  const totalAwarded = myResults.reduce((s, r) => s + r.awardedMarks, 0);
  const totalMax = state.assessment.questions.reduce((s, q) => s + q.maxMarks, 0);

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

  function openAppealModal(res: StudentQuestionResult) {
    const focused = focusedSpanByQ[res.questionId];
    setAppealTarget(res);
    setIssueType("TRANSCRIPTION_ERROR");
    setReason("");
    setSelectedSpanIds(focused ? [focused] : []);
  }

  function toggleSpanSelection(spanId: string) {
    setSelectedSpanIds((prev) => (prev.includes(spanId) ? prev.filter((id) => id !== spanId) : [...prev, spanId]));
  }

  function submitAppeal() {
    if (!appealTarget || !reason.trim()) return;
    actions.submitReviewRequest(
      studentId,
      appealTarget.questionId,
      appealTarget.questionNumber,
      issueType,
      reason.trim(),
      selectedSpanIds,
    );
    setAppealTarget(null);
    setReason("");
    setSelectedSpanIds([]);
  }

  const appealSpans = appealTarget ? getQuestionEvidence(appealTarget.questionId).spans : [];

  return (
    <div className="space-y-6">
      <PageHeader title="My Released Results" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="px-4 py-3.5">
          <div className="text-xs text-slate-500">Student</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{user?.displayName}</div>
        </Card>
        <Card className="px-4 py-3.5">
          <div className="text-xs text-slate-500">Total mark</div>
          {myResults.length > 0 ? (
            <div className="mt-1 text-xl font-semibold text-emerald-600">
              {totalAwarded} <span className="text-sm font-normal text-slate-400">/ {totalMax}</span>
            </div>
          ) : (
            <div className="mt-1 text-sm font-medium text-slate-500">Pending release</div>
          )}
        </Card>
        <Card className="px-4 py-3.5">
          <div className="text-xs text-slate-500">Review requests</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{myRequests.length}</div>
        </Card>
      </div>

      {myResults.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium text-slate-800">No released results yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Your examination marks and feedback will appear here once your teacher completes grading and releases the assessment results.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {myResults.map((res) => {
            const existingAppeal = myRequests.find((r) => r.questionId === res.questionId);
            const { crops, spans, versionNum } = getQuestionEvidence(res.questionId);
            const focusedSpan = focusedSpanByQ[res.questionId] ?? null;

            return (
              <Card key={res.questionId}>
                <CardHeader
                  title={`${res.questionNumber}: ${res.questionPrompt}`}
                  right={
                    <div className="flex items-center gap-3">
                      <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {res.awardedMarks} / {res.maxMarks}
                      </span>
                      <Button size="sm" onClick={() => openAppealModal(res)}>
                        Request review
                      </Button>
                    </div>
                  }
                />

                <div className="space-y-5 p-5">
                  <div className="grid gap-5 lg:grid-cols-12">
                    <div className="lg:col-span-7">
                      <div className="text-xs font-medium text-slate-500">Feedback</div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-800">{res.feedbackText}</p>
                    </div>

                    <div className="space-y-2 lg:col-span-5">
                      <div className="text-xs font-medium text-slate-500">Criteria</div>
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                        {res.criteria.map((c) => (
                          <li key={c.criterionId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <span className="text-slate-700">{c.description}</span>
                            <span className="shrink-0 font-medium text-slate-900">
                              {c.awarded} / {c.maxMark}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {existingAppeal && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Review request</span>
                            <Badge tone="amber">{existingAppeal.status === "RESOLVED" ? "Resolved" : "Pending"}</Badge>
                          </div>
                          <p className="mt-1">{existingAppeal.reason}</p>
                          {existingAppeal.evidenceSpanIds && existingAppeal.evidenceSpanIds.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {existingAppeal.evidenceSpanIds.map((sid) => (
                                <span key={sid} className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-900">
                                  {sid}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Answer Evidence: Cropped Handwritten Script Image + OCR Transcript Spans */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-700">Answer Evidence (Handwritten Scan &amp; OCR Transcript)</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        {mappedCode && <span className="font-mono">{mappedCode}</span>}
                        {versionNum ? <Badge tone="slate">Transcript v{versionNum}</Badge> : null}
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-12">
                      {/* Left: Cropped Handwritten Script Region(s) */}
                      <div className="space-y-2.5 lg:col-span-6">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Cropped Handwritten Script
                        </div>
                        {crops.length > 0 ? (
                          <div className="space-y-2.5">
                            {crops.map(({ region, image }, idx) => (
                              <div key={region.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                                  <span>
                                    Page {image.pageNumber}
                                    {crops.length > 1 ? ` (Part ${idx + 1} of ${crops.length})` : ""}
                                  </span>
                                  <span>{image.maskStatus === "MASKED" ? "Header masked" : "Scanned crop"}</span>
                                </div>
                                <div className="p-2">
                                  <RegionCrop image={image} rect={region.bbox} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
                            No cropped handwritten region linked to this question yet.
                          </div>
                        )}
                      </div>

                      {/* Right: OCR Extracted Transcript Spans */}
                      <div className="space-y-2 lg:col-span-6">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            OCR Extracted Text (click a span to inspect)
                          </span>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          {spans.length > 0 ? (
                            <div className="space-y-1.5">
                              {spans.map((sp) => {
                                const isFocused = focusedSpan === sp.id;
                                const lowConf = sp.confidence === "unknown" || sp.confidence < 0.85;
                                return (
                                  <button
                                    key={sp.id}
                                    type="button"
                                    onClick={() =>
                                      setFocusedSpanByQ((prev) => ({
                                        ...prev,
                                        [res.questionId]: isFocused ? null : sp.id,
                                      }))
                                    }
                                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition ${
                                      isFocused
                                        ? "bg-indigo-50 ring-1 ring-indigo-300"
                                        : "hover:bg-slate-50"
                                    }`}
                                  >
                                    <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                                      {sp.id}
                                    </span>
                                    <span className="flex-1 leading-relaxed text-slate-800">{sp.text}</span>
                                    {lowConf && (
                                      <span className="shrink-0 text-[10px] text-amber-600">
                                        {sp.confidence === "unknown" ? "conf: ?" : `${Math.round(sp.confidence * 100)}%`}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs leading-relaxed text-slate-700">{res.approvedTranscript}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!appealTarget}
        title={`Request review — ${appealTarget?.questionNumber ?? ""}`}
        onClose={() => setAppealTarget(null)}
        footer={
          <>
            <Button onClick={() => setAppealTarget(null)}>Cancel</Button>
            <Button variant="primary" disabled={!reason.trim()} onClick={submitAppeal}>
              Submit request
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700">Category</label>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as "TRANSCRIPTION_ERROR" | "CRITERION_INTERPRETATION")}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="TRANSCRIPTION_ERROR">Transcription / cropping issue</option>
              <option value="CRITERION_INTERPRETATION">Marking criterion question</option>
            </select>
          </div>

          {appealSpans.length > 0 && (
            <div>
              <label className="block font-medium text-slate-700">Select relevant transcript span(s) (optional)</label>
              <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                {appealSpans.map((sp) => {
                  const active = selectedSpanIds.includes(sp.id);
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      onClick={() => toggleSpanSelection(sp.id)}
                      className={`rounded px-2 py-1 font-mono text-[11px] transition ${
                        active ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      title={sp.text}
                    >
                      {sp.id}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700">Note for teacher</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain which handwritten line or criterion should be checked..."
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
