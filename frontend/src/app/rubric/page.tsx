"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { ModelAnswerImage, RubricCriterion } from "@/lib/types";

function RubricContent() {
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q");
  const { state, actions } = useStore();
  const { assessment, rubrics } = state;

  const [selectedQId, setSelectedQId] = useState<string>(
    qParam || assessment.questions[0]?.id || "",
  );

  // Sync selected question when questions change or query param changes
  useEffect(() => {
    if (qParam && assessment.questions.some((q) => q.id === qParam)) {
      setSelectedQId(qParam);
    } else if (!selectedQId && assessment.questions.length > 0) {
      setSelectedQId(assessment.questions[0].id);
    }
  }, [qParam, assessment.questions, selectedQId]);

  const currentQ = assessment.questions.find((q) => q.id === selectedQId);
  const activeRubric = rubrics.find((r) => r.questionId === selectedQId && r.approved);
  const draftRubric = rubrics.find((r) => r.questionId === selectedQId && !r.approved);

  // Draft state for structured criteria
  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [modelAnswerText, setModelAnswerText] = useState<string>("");
  const [modelImages, setModelImages] = useState<ModelAnswerImage[]>([]);
  const [selectedImgIdx, setSelectedImgIdx] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isExtractingOcr, setIsExtractingOcr] = useState<boolean>(false);

  // Initialize structured rubric draft when question changes
  useEffect(() => {
    if (!currentQ) return;
    const existing = draftRubric || activeRubric;
    if (existing) {
      setCriteria(
        existing.criteria.length > 0
          ? [...existing.criteria]
          : [
              {
                id: "C1",
                description: `Primary concept and key definition for ${currentQ.number}`,
                maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
                allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
                acceptedAlternatives: ["Equivalent valid terminology accepted"],
              },
              {
                id: "C2",
                description: `Explanation, evidence, or example for ${currentQ.number}`,
                maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
                allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
                acceptedAlternatives: ["Concrete example or application accepted"],
              },
            ],
      );
      setModelAnswerText(existing.modelAnswerText || "");
      setModelImages(existing.modelAnswerImages || []);
    } else {
      setCriteria([
        {
          id: "C1",
          description: `Key definition / core principle for ${currentQ.number}`,
          maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
          allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
          acceptedAlternatives: ["Standard academic definition or paraphrase"],
        },
        {
          id: "C2",
          description: `Explanation / justification for ${currentQ.number}`,
          maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
          allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
          acceptedAlternatives: ["Grounded technical justification"],
        },
      ]);
      setModelAnswerText("");
      setModelImages([]);
    }
    setSelectedImgIdx(0);
    setValidationMsg(null);
  }, [selectedQId, currentQ?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute criteria sum
  const criteriaSum = Number(
    criteria.reduce((acc, c) => acc + (Number(c.maxMarks) || 0), 0).toFixed(2),
  );
  const qMaxMarks = Number((currentQ?.maxMarks ?? 0).toFixed(2));
  const isSumValid = currentQ ? Math.abs(criteriaSum - qMaxMarks) < 0.001 : false;

  // Handle uploading teacher model answer image
  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        const newImg: ModelAnswerImage = {
          id: `img-model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: file.name,
          fileFormat: file.type.includes("png") ? "PNG" : "JPEG",
          fileSizeBytes: file.size,
          originalUrl: url,
          pageNumber: modelImages.length + 1,
        };

        setModelImages((prev) => {
          const next = [...prev, newImg];
          if (currentQ) {
            actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, next);
          }
          return next;
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  // Handle OCR extraction on model answer image
  async function runModelAnswerOcr() {
    const curImg = modelImages[selectedImgIdx];
    if (!curImg || !currentQ) return;
    setIsExtractingOcr(true);
    try {
      const base64Data = curImg.originalUrl.includes(",")
        ? curImg.originalUrl.split(",")[1]
        : curImg.originalUrl;
      const res = await fetch("/api/ocr/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regions: [
            {
              questionId: currentQ.id,
              questionNumber: currentQ.number,
              pageNumber: curImg.pageNumber,
              mimeType: curImg.fileFormat === "PNG" ? "image/png" : "image/jpeg",
              base64Data,
            },
          ],
        }),
      });
      const data = await res.json();
      if (data.ok && data.results?.[0]?.rawText) {
        setModelAnswerText((prev) =>
          prev ? `${prev}\n\n${data.results[0].rawText}` : data.results[0].rawText,
        );
      }
    } catch {
      // Keep existing text
    } finally {
      setIsExtractingOcr(false);
    }
  }

  // Approve structured rubric
  function handleApproveRubric() {
    if (!currentQ) return;
    const res = actions.approveRubric(currentQ.id, criteria, modelAnswerText, modelImages);
    if (!res.ok) {
      setValidationMsg({ ok: false, msg: res.error || "Approval failed." });
    } else {
      setValidationMsg({
        ok: true,
        msg: `Rubric approved successfully for ${currentQ.number}! Evaluators will mark against this version.`,
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marking Scheme & Model Answers"
      />

      {validationMsg && (
        <Alert
          tone={validationMsg.ok ? "green" : "amber"}
          title={validationMsg.ok ? "Success" : "Requirements Notice"}
        >
          {validationMsg.msg}
        </Alert>
      )}

      {/* STRUCTURED / ESSAY RUBRICS WORKSPACE */}
      <div className="space-y-5">
          {/* Question Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Questions:</span>
              {assessment.questions.map((q) => {
                const appR = rubrics.find((r) => r.questionId === q.id && r.approved);
                const active = q.id === selectedQId;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setSelectedQId(q.id);
                      setValidationMsg(null);
                    }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>{q.number}</span>
                    <span className="opacity-75">({q.maxMarks}m)</span>
                    {appR && (
                      <span className={`rounded-full px-1 text-[10px] ${active ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                        v{appR.version}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                actions.addQuestion();
              }}
            >
              + Add Question
            </Button>
          </div>

          {!currentQ ? (
            <Card className="p-8 text-center text-sm text-slate-500">
              No questions found. Click &ldquo;+ Add Question&rdquo; to begin setting up marking criteria.
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-12">
              {/* LEFT PANEL: Teacher Answer Script / Marking Scheme Image */}
              <div className="space-y-4 lg:col-span-6">
                <Card>
                  <CardHeader
                    title="Teacher Model Answer Script"
                    sub="Upload photo or scan of teacher answer sheet (JPEG or PNG, up to 10 MB)"
                    right={
                      <label className="cursor-pointer">
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-xs">
                          + Upload Sheet Image
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          multiple
                          className="hidden"
                          onChange={(e) => handleImageUpload(e)}
                        />
                      </label>
                    }
                  />
                  <div className="space-y-3 p-4">
                    {modelImages.length === 0 ? (
                      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
                        <svg viewBox="0 0 24 24" className="h-10 w-10 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <div className="mt-2 text-sm font-semibold text-slate-800">No model answer sheet uploaded yet</div>
                        <p className="mt-1 max-w-sm text-xs text-slate-500">
                          Upload the teacher&apos;s handwritten model answers or marking scheme sheet to compare side-by-side with rubric criteria.
                        </p>
                        <label className="mt-4 cursor-pointer rounded-md bg-white border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs">
                          Browse image files
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            multiple
                            className="hidden"
                            onChange={(e) => handleImageUpload(e)}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            {modelImages.map((im, idx) => (
                              <button
                                key={im.id}
                                type="button"
                                onClick={() => setSelectedImgIdx(idx)}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                                  idx === selectedImgIdx
                                    ? "bg-slate-900 text-white"
                                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                }`}
                              >
                                Page {im.pageNumber}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <Button size="sm" onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}>
                                −
                              </Button>
                              <span className="w-10 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
                              <Button size="sm" onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}>
                                +
                              </Button>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isExtractingOcr}
                              onClick={runModelAnswerOcr}
                            >
                              {isExtractingOcr ? "Reading…" : "Extract text →"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const cur = modelImages[selectedImgIdx];
                                if (cur) {
                                  setModelImages((prev) => prev.filter((_, i) => i !== selectedImgIdx));
                                  setSelectedImgIdx(0);
                                }
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-[68vh] overflow-auto rounded-lg border border-slate-300 bg-slate-100 p-2 text-center">
                          <div style={{ width: `${zoom * 100}%`, margin: "0 auto" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={modelImages[selectedImgIdx]?.originalUrl}
                              alt="Teacher Model Answer Sheet"
                              className="rounded border border-slate-200 bg-white shadow-xs max-w-full"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              {/* RIGHT PANEL: Criteria & Scoring Rules */}
              <div className="space-y-4 lg:col-span-6">
                <Card>
                  <CardHeader
                    title={`${currentQ.number}: Rubric Criteria & Rules`}
                    sub={`Maximum Marks: ${currentQ.maxMarks} m • SRS Section 3.2 (REQ-10–REQ-16)`}
                    right={
                      <div className="flex items-center gap-2">
                        {activeRubric ? (
                          <Badge tone="green">Approved v{activeRubric.version} ✓</Badge>
                        ) : (
                          <Badge tone="amber">Draft (Unapproved)</Badge>
                        )}
                      </div>
                    }
                  />
                  <div className="space-y-4 p-5">
                    {/* Prompt input */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Question Prompt</label>
                      <input
                        type="text"
                        value={currentQ.prompt}
                        onChange={(e) => actions.updateQuestion(currentQ.id, e.target.value, currentQ.maxMarks)}
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                        placeholder="e.g. Explain the difference between process and thread..."
                      />
                    </div>

                    {/* Criteria List */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="text-xs font-semibold text-slate-800">Scoring Criteria (REQ-11)</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const nextCId = `C${criteria.length + 1}`;
                            setCriteria((prev) => [
                              ...prev,
                              {
                                id: nextCId,
                                description: "",
                                maxMarks: 1.0,
                                allowedPartialCredits: [0, 0.5, 1.0],
                                acceptedAlternatives: [],
                              },
                            ]);
                          }}
                        >
                          + Add Criterion
                        </Button>
                      </div>

                      {criteria.map((c, idx) => (
                        <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-indigo-700">{c.id}</span>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-slate-500">Max Mark:</label>
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                value={c.maxMarks}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setCriteria((prev) =>
                                    prev.map((item, i) => (i === idx ? { ...item, maxMarks: val } : item)),
                                  );
                                }}
                                className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-800"
                              />
                              <button
                                type="button"
                                onClick={() => setCriteria((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-xs text-rose-500 hover:text-rose-700 pl-1"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <input
                              type="text"
                              value={c.description}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCriteria((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, description: val } : item)),
                                );
                              }}
                              placeholder="Description of required knowledge or answer step..."
                              className="w-full rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-800"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-slate-500">Partial credit steps:</span>
                              <input
                                type="text"
                                value={c.allowedPartialCredits.join(", ")}
                                onChange={(e) => {
                                  const steps = e.target.value
                                    .split(",")
                                    .map((s) => parseFloat(s.trim()))
                                    .filter((n) => !isNaN(n));
                                  setCriteria((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, allowedPartialCredits: steps } : item,
                                    ),
                                  );
                                }}
                                placeholder="0, 0.5, 1.0"
                                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <span className="text-slate-500">Accepted alternatives:</span>
                              <input
                                type="text"
                                value={c.acceptedAlternatives.join("; ")}
                                onChange={(e) => {
                                  const alts = e.target.value.split(";").map((s) => s.trim()).filter(Boolean);
                                  setCriteria((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, acceptedAlternatives: alts } : item,
                                    ),
                                  );
                                }}
                                placeholder="alternative term 1; alternative 2"
                                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-0.5 text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* REQ-12 Live Sum Validation Box */}
                    <div
                      className={`rounded-lg border p-3 text-xs ${
                        isSumValid
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-amber-300 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>
                          Criteria Sum: {criteriaSum} m / Question Max: {qMaxMarks} m
                        </span>
                        <span>{isSumValid ? "✓ Exact match (REQ-12 Valid)" : "⚠️ Mismatch (REQ-12 Lock)"}</span>
                      </div>
                      <div className="mt-1 text-[11px] opacity-90">
                        {isSumValid
                          ? "Sum of criteria equals question maximum. This rubric version can be approved for AI evaluation."
                          : `Per REQ-12, the system rejects approval when criteria sum (${criteriaSum} m) does not equal question maximum (${qMaxMarks} m). Adjust criterion allocations to approve.`}
                      </div>
                    </div>

                    {/* REQ-15 Supplemental Model Answer Text */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-700">
                          Supplemental Model Answer Text (REQ-15)
                        </label>
                        <span className="text-[11px] text-slate-400">Guides evaluators; does not add criteria</span>
                      </div>
                      <textarea
                        rows={4}
                        value={modelAnswerText}
                        onChange={(e) => setModelAnswerText(e.target.value)}
                        placeholder="Official model answer text or points extracted from the teacher answer sheet on the left..."
                        className="w-full rounded-md border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (currentQ) {
                            actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages);
                            setValidationMsg({ ok: true, msg: "Draft saved locally." });
                          }
                        }}
                      >
                        Save Draft
                      </Button>
                      <Button
                        variant="primary"
                        disabled={!isSumValid}
                        onClick={handleApproveRubric}
                      >
                        Approve Rubric Version (v{(rubrics.filter((r) => r.questionId === currentQ.id && r.approved).length) + 1}) →
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}

export default function RubricPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading marking scheme…</div>}>
      <RubricContent />
    </Suspense>
  );
}
