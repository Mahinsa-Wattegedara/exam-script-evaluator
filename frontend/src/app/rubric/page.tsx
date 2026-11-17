"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
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

  useEffect(() => {
    if (qParam && assessment.questions.some((q) => q.id === qParam)) {
      if (selectedQId !== qParam) {
        setSelectedQId(qParam);
      }
    } else if (!selectedQId && assessment.questions.length > 0) {
      setSelectedQId(assessment.questions[0].id);
    }
  }, [qParam, assessment.questions, selectedQId]);

  const currentQ = assessment.questions.find((q) => q.id === selectedQId);
  const activeRubric = rubrics.find((r) => r.questionId === selectedQId && r.approved);
  const draftRubric = rubrics.find((r) => r.questionId === selectedQId && !r.approved);

  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [modelAnswerText, setModelAnswerText] = useState<string>("");
  const [modelImages, setModelImages] = useState<ModelAnswerImage[]>([]);
  const [selectedImgIdx, setSelectedImgIdx] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isExtractingOcr, setIsExtractingOcr] = useState<boolean>(false);

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

  const criteriaSum = Number(
    criteria.reduce((acc, c) => acc + (Number(c.maxMarks) || 0), 0).toFixed(2),
  );
  const qMaxMarks = Number((currentQ?.maxMarks ?? 0).toFixed(2));
  const isSumValid = currentQ ? Math.abs(criteriaSum - qMaxMarks) < 0.001 : false;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    e.target.value = "";

    const newImages: ModelAnswerImage[] = await Promise.all(
      fileList.map((file, idx) => {
        return new Promise<ModelAnswerImage>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            const url = event.target?.result as string;
            resolve({
              id: `img-model-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
              fileName: file.name,
              fileFormat: file.type.includes("png") ? "PNG" : "JPEG",
              fileSizeBytes: file.size,
              originalUrl: url,
              pageNumber: modelImages.length + idx + 1,
            });
          };
          reader.readAsDataURL(file);
        });
      })
    );

    const updatedImages = [...modelImages, ...newImages];
    setModelImages(updatedImages);
    let targetQId = currentQ?.id;
    if (!targetQId && assessment.questions.length === 0) {
      actions.addQuestion();
      targetQId = "q1";
      setSelectedQId("q1");
    }
    if (targetQId) {
      actions.saveRubricDraft(targetQId, criteria, modelAnswerText, updatedImages);
    }
  }

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

  function handleAddQuestion() {
    actions.addQuestion();
    const nextIdx = assessment.questions.length + 1;
    setSelectedQId(`q${nextIdx}`);
  }

  function handleSaveDraft() {
    if (!currentQ) return;
    actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages);
    setValidationMsg({ ok: true, msg: "Marking scheme draft saved successfully." });
  }

  function handleApproveRubric() {
    if (!currentQ) return;
    const res = actions.approveRubric(currentQ.id, criteria, modelAnswerText, modelImages);
    if (!res.ok) {
      setValidationMsg({ ok: false, msg: res.error || "Approval failed." });
    } else {
      setValidationMsg({
        ok: true,
        msg: `Rubric approved successfully for ${currentQ.number}! Version active for evaluation.`,
      });
    }
  }

  const ringPct = qMaxMarks > 0 ? Math.min(100, Math.round((criteriaSum / qMaxMarks) * 100)) : 0;
  const circumference = 2 * Math.PI * 68; // radius 68 for 160px ring
  const strokeDashoffset = circumference - (ringPct / 100) * circumference;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header (Figma 19:241) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-['Plus_Jakarta_Sans'] text-3xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
            Marking scheme
          </h1>
          <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
            {assessment.title || "Mid-semester assessment"} / Draft version {activeRubric ? activeRubric.version + 1 : 1}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-5 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Upload model answer (JPEG / PNG)
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => handleImageUpload(e)}
            />
          </label>
        </div>
      </div>

      {validationMsg && (
        <Alert
          tone={validationMsg.ok ? "green" : "amber"}
          title={validationMsg.ok ? "Success" : "Validation"}
        >
          {validationMsg.msg}
        </Alert>
      )}

      {/* If no questions exist yet, display a clean, centered onboarding card */}
      {assessment.questions.length === 0 ? (
        <div className="w-full flex flex-col items-center justify-center rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-12 sm:p-16 text-center shadow-sm">
          <div className="size-16 rounded-2xl bg-[color:var(--x-primary50,#f0f1ff)] flex items-center justify-center text-[color:var(--x-primary700,#3730a3)] mb-4">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold text-[color:var(--x-ink,#111827)]">
            Create marking scheme
          </h2>
          <p className="mt-2 text-sm text-[color:var(--x-secondary,#4b5563)] max-w-md">
            Start by adding exam questions to define rubric criteria, set mark allocations, and attach JPEG or PNG model answer sheets.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleAddQuestion}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-6 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition cursor-pointer"
            >
              + Add first question
            </button>
            <label className="cursor-pointer inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-6 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Upload model answer (JPEG / PNG)
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(e) => handleImageUpload(e)}
              />
            </label>
          </div>
        </div>
      ) : (
        /* Main Rubric Workspace Split Layout (Figma 121:2564) */
        <div className="flex flex-col gap-6 lg:flex-row items-start">
          {/* Left: Question Rail (Figma 121:2565) */}
          <div className="w-full shrink-0 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-4 shadow-sm lg:w-64 space-y-4">
            <div className="text-xs font-semibold tracking-wider text-[color:var(--x-secondary,#4b5563)] uppercase px-2 pt-1">
              QUESTIONS
            </div>

            <div className="space-y-1">
              {assessment.questions.map((q) => {
                const active = q.id === selectedQId;
                const appR = rubrics.find((r) => r.questionId === q.id && r.approved);
                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setSelectedQId(q.id);
                      setValidationMsg(null);
                    }}
                    className={`w-full flex items-center justify-between h-12 px-4 rounded-xl text-sm font-semibold transition cursor-pointer ${
                      active
                        ? "bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]"
                        : "text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50"
                    }`}
                  >
                    <span>{q.number} · {q.maxMarks} marks</span>
                    {appR && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        v{appR.version}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleAddQuestion}
              className="w-full h-10 rounded-xl border border-dashed border-slate-300 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50 transition cursor-pointer"
            >
              + Add Question
            </button>

          {/* Circular Progress Ring (Figma 15:583) */}
          <div className="flex flex-col items-center justify-center p-4 border-t border-[color:var(--x-border,#e4e7ef)]">
            <div className="relative size-36 flex items-center justify-center">
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
                  stroke={isSumValid ? "var(--x-primary600,#4338ca)" : "#f59e0b"}
                  strokeWidth="12"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-300"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-['Plus_Jakarta_Sans'] text-2xl font-bold text-[color:var(--x-ink,#111827)]">
                  {criteriaSum} / {qMaxMarks}
                </span>
                <span className="text-xs text-[color:var(--x-secondary,#4b5563)]">
                  allocated
                </span>
              </div>
            </div>
            <div className={`mt-3 text-center text-xs font-semibold ${isSumValid ? "text-[color:var(--x-primary700,#3730a3)]" : "text-amber-600"}`}>
              {isSumValid ? `Allocated ${criteriaSum} / ${qMaxMarks} marks` : `Discrepancy: ${criteriaSum} of ${qMaxMarks} marks`}
            </div>
          </div>
        </div>

        {/* Right: Rubric Criteria & Model Answer Workspace (Figma 121:2574) */}
        {currentQ ? (
          <div className="flex-1 w-full space-y-6">
            {/* Header info */}
            <div>
              <h2 className="font-['Plus_Jakarta_Sans'] text-2xl font-semibold text-[color:var(--x-ink,#111827)]">
                {currentQ.number} · {currentQ.prompt || "Question"}
              </h2>
              <input
                type="text"
                value={currentQ.prompt}
                onChange={(e) => actions.updateQuestion(currentQ.id, e.target.value, currentQ.maxMarks)}
                placeholder="Question prompt or description..."
                className="mt-2 w-full rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3.5 py-2 text-sm text-[color:var(--x-secondary,#4b5563)] focus:border-indigo-600 focus:outline-none"
              />
            </div>

            {/* Criteria Cards List */}
            <div className="space-y-4">
              {criteria.map((c, idx) => (
                <div
                  key={c.id || idx}
                  className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-xs font-normal text-[color:var(--x-muted,#6b7280)]">ID</div>
                        <div className="font-mono text-sm font-semibold text-[color:var(--x-primary700,#3730a3)]">
                          {c.id || `C${idx + 1}`}
                        </div>
                      </div>
                      <div className="flex-1 min-w-[280px]">
                        <div className="text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
                          Criterion / accepted coverage
                        </div>
                        <input
                          type="text"
                          value={c.description}
                          onChange={(e) => {
                            const next = [...criteria];
                            next[idx].description = e.target.value;
                            setCriteria(next);
                          }}
                          placeholder="e.g. CPU allocation and process scheduling"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-[color:var(--x-ink,#111827)] focus:border-indigo-600 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div>
                        <div className="text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
                          Maximum
                        </div>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={c.maxMarks}
                          onChange={(e) => {
                            const next = [...criteria];
                            const val = parseFloat(e.target.value) || 0;
                            next[idx].maxMarks = val;
                            // Update allowed partial credit steps
                            next[idx].allowedPartialCredits = Array.from({ length: Math.floor(val) + 1 }, (_, i) => i);
                            setCriteria(next);
                          }}
                          className="mt-1 w-20 rounded-lg border border-slate-200 px-3 py-1.5 font-['Plus_Jakarta_Sans'] text-base font-semibold text-[color:var(--x-ink,#111827)] text-center focus:border-indigo-600 focus:outline-none"
                        />
                      </div>
                      {criteria.length > 1 && (
                        <button
                          onClick={() => {
                            setCriteria(criteria.filter((_, i) => i !== idx));
                          }}
                          className="text-xs text-red-500 hover:text-red-700 pt-5"
                          title="Remove criterion"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Partial Credit Allowed Marks */}
                  <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
                    <span className="text-xs font-medium text-[color:var(--x-secondary,#4b5563)]">
                      Partial credit:
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.allowedPartialCredits.map((m) => (
                        <span
                          key={m}
                          className="flex h-10 w-12 items-center justify-center rounded-xl bg-[color:var(--x-primary50,#f0f1ff)] text-sm font-semibold text-[color:var(--x-primary700,#3730a3)]"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                    <span className="font-mono text-xs text-[color:var(--x-secondary,#4b5563)] ml-auto">
                      {c.allowedPartialCredits.join(" / ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCriteria([
                  ...criteria,
                  {
                    id: `C${criteria.length + 1}`,
                    description: `New criterion for ${currentQ.number}`,
                    maxMarks: 1,
                    allowedPartialCredits: [0, 1],
                    acceptedAlternatives: [],
                  },
                ]);
              }}
            >
              + Add Criterion
            </Button>

            <p className="text-xs text-[color:var(--x-secondary,#4b5563)]">
              Optional model answer supports these criteria; it does not add new criteria.
            </p>

            {/* Supplemental Model Answer Section (Side-by-Side Image & Transcript) */}
            <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-['Plus_Jakarta_Sans'] text-base font-semibold text-[color:var(--x-ink,#111827)]">
                    Supplemental Model Answer &amp; Notes
                  </h3>
                  <p className="text-xs text-[color:var(--x-secondary,#4b5563)]">
                    Guides AI evaluators with reference handwriting and expected key points.
                  </p>
                </div>
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3 py-1.5 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50 shadow-xs">
                  + Upload Reference Image
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageUpload(e)}
                  />
                </label>
              </div>

              <div className="grid gap-6 lg:grid-cols-2 items-start">
                {/* Reference Image View */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Handwritten Model Answer
                  </div>
                  {modelImages.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
                      <p className="text-xs text-slate-500">
                        Upload a photo of your handwritten model answer sheet.
                      </p>
                      <label className="mt-3 cursor-pointer rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs">
                        Browse files
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
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1.5">
                          {modelImages.map((_, i) => (
                            <button
                              key={i}
                              onClick={() => setSelectedImgIdx(i)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                selectedImgIdx === i
                                  ? "bg-indigo-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700"
                              }`}
                            >
                              Page {i + 1}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-mono"
                          >
                            -
                          </button>
                          <span className="text-xs font-mono">{Math.round(zoom * 100)}%</span>
                          <button
                            onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-mono"
                          >
                            +
                          </button>
                          <button
                            onClick={runModelAnswerOcr}
                            disabled={isExtractingOcr}
                            className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            {isExtractingOcr ? "Extracting..." : "Extract text →"}
                          </button>
                        </div>
                      </div>
                      <div className="overflow-auto max-h-[320px] rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <img
                          src={modelImages[selectedImgIdx]?.originalUrl}
                          alt="Model Answer"
                          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                          className="w-full object-contain rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Model Answer Notes / Extracted Text */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Supplemental Notes &amp; Points
                  </div>
                  <textarea
                    rows={10}
                    value={modelAnswerText}
                    onChange={(e) => setModelAnswerText(e.target.value)}
                    placeholder="Enter key points, expected steps, or click 'Extract text' above from your uploaded sheet..."
                    className="w-full rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-3 text-sm font-mono text-[color:var(--x-ink,#111827)] focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Action Bar (Figma 121:2582) */}
            <div className="flex items-center justify-end gap-3 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-5 shadow-sm">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="h-12 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-6 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50 transition"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={handleApproveRubric}
                disabled={!isSumValid}
                className="h-12 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-6 text-sm font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve version {activeRubric ? activeRubric.version + 1 : 1}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    )}
    </div>
  );
}

export default function RubricPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading marking scheme...</div>}>
      <RubricContent />
    </Suspense>
  );
}
