"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RubricSubquestionEditor } from "@/components/rubric-subquestion";
import { Alert, Badge, Button, Card, Modal } from "@/components/ui";
import { hasMarkingScheme, isPlaceholderPrompt, questionRemovalBlock, sanitizeCriterionDescription, useStore } from "@/lib/store";
import { archiveMarkingScheme } from "@/lib/approved-rubrics";
import { parseMarkingScheme } from "@/lib/marking-scheme-import";
import type { ImportedQuestion } from "@/lib/marking-scheme-import";
import type { ModelAnswerImage, RubricCriterion, RubricSubquestion, RubricVersion } from "@/lib/types";

type ReviewProgress = {
  pendingQuestionIds: string[];
  approvedRubrics: { questionId: string; version: number }[];
};

type ReviewStatus = { reviewId: string } & (
  | { kind: "checking" }
  | { kind: "ready"; progress: ReviewProgress }
  | { kind: "error"; message: string }
);

type RubricItemToRemove = { kind: "question" | "subtopic"; id: string; label: string };

async function fetchReviewProgress(reviewId: string, options?: { signal?: AbortSignal; removeQuestionId?: string }): Promise<ReviewProgress> {
  const response = await fetch(`/api/rubric/reviews/${encodeURIComponent(reviewId)}/check`, {
    method: "POST",
    signal: options?.signal,
    ...(options?.removeQuestionId ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeQuestionId: options.removeQuestionId }),
    } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Review progress could not be checked.");
  if (!Array.isArray(data.pendingQuestionIds) || !Array.isArray(data.approvedRubrics)) {
    throw new Error("The approval status could not be read.");
  }
  return data;
}

function RubricContent() {
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q");
  const { state, actions, flushPersistence } = useStore();
  const { assessment, rubrics } = state;
  const requestedQuestion = assessment.questions.some(question => question.id === qParam) ? qParam : null;
  const firstQuestionId = assessment.questions[0]?.id || "";

  const [selectedQId, setSelectedQId] = useState<string>(
    requestedQuestion || firstQuestionId,
  );

  useEffect(() => {
    if (requestedQuestion) setSelectedQId(requestedQuestion);
  }, [requestedQuestion]);

  const currentQ = assessment.questions.find((q) => q.id === selectedQId);
  useEffect(() => {
    if (!currentQ) setSelectedQId(firstQuestionId);
  }, [currentQ, firstQuestionId]);

  const activeRubric = rubrics.filter((r) => r.questionId === selectedQId && r.approved).sort((a, b) => b.version - a.version)[0];
  const draftRubric = rubrics.find((r) => r.questionId === selectedQId && !r.approved);

  const [approving, setApproving] = useState(false);
  const [loadingApproval, setLoadingApproval] = useState(false);
  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [subquestions, setSubquestions] = useState<RubricSubquestion[]>([]);
  const [modelAnswerText, setModelAnswerText] = useState<string>("");
  const [modelImages, setModelImages] = useState<ModelAnswerImage[]>([]);
  const [selectedImgIdx, setSelectedImgIdx] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [readingReference, setReadingReference] = useState(false);
  const [isExtractingOcr, setIsExtractingOcr] = useState<boolean>(false);
  const [ocrMessage, setOcrMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showImport, setShowImport] = useState(() => rubrics.length === 0);
  const [schemeText, setSchemeText] = useState("");
  const [importError, setImportError] = useState("");
  const [readingScheme, setReadingScheme] = useState(false);
  const [schemeFiles, setSchemeFiles] = useState<File[]>([]);
  const [generationStage, setGenerationStage] = useState<"preparing" | "drafting" | null>(null);
  const [pendingImport, setPendingImport] = useState<{ items: ImportedQuestion[]; reviewId?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<"source" | "scheme" | null>(null);
  const [keepSourceText, setKeepSourceText] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<RubricItemToRemove | null>(null);
  const [itemRemovalError, setItemRemovalError] = useState("");
  const [removingItem, setRemovingItem] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const reviewId = assessment.rubricReviewId;
  const currentReview = reviewStatus?.reviewId === reviewId ? reviewStatus : null;
  const reviewProgress = currentReview?.kind === "ready" ? currentReview.progress : null;
  const checkingReview = Boolean(reviewId && (!currentReview || currentReview.kind === "checking"));
  const generatingRubric = generationStage !== null;
  const importBlocked = state.scripts.length > 0 || state.answers.length > 0 || rubrics.some((r) => r.approved);
  const schemeResetBlock = state.scripts.length || state.answers.length ? "This assessment has uploaded student work." : undefined;
  const sourceBusy = readingScheme || generatingRubric;
  const draftBusy = sourceBusy || readingReference || isExtractingOcr;
  const itemRemovalBlock = itemToRemove?.kind === "question"
    ? questionRemovalBlock(state, itemToRemove.id)
    : undefined;

  useEffect(() => {
    if (!reviewId) return;
    const controller = new AbortController();
    setReviewStatus({ reviewId, kind: "checking" });
    async function fetchReview(id: string) {
      try {
        const progress = await fetchReviewProgress(id, { signal: controller.signal });
        if (!controller.signal.aborted) setReviewStatus({ reviewId: id, kind: "ready", progress });
      } catch (error) {
        if (!controller.signal.aborted) {
          setReviewStatus({ reviewId: id, kind: "error", message: error instanceof Error ? error.message : "Review progress could not be checked." });
        }
      }
    }
    void fetchReview(reviewId);
    return () => controller.abort();
  }, [reviewId, reviewRefresh]);

  function saveImportedQuestions(items: ImportedQuestion[], replaceDrafts = false, reviewId?: string) {
    const imported = actions.importMarkingScheme(items, { replaceDrafts, reviewId });
    if (!imported.ok) throw new Error(imported.error || "Could not save drafts.");
    setSelectedQId(items[0].question.id);
    setCriteria(items[0].criteria);
    setSubquestions(items[0].subquestions || []);
    setModelAnswerText(items[0].modelAnswerText || "");
    setModelImages([]);
    setPendingImport(null);
    setImportError("");
    setShowImport(false);
    setValidationMsg({ ok: true, msg: `${items.length} ${items.length === 1 ? "question is" : "questions are"} ready for review.` });
  }

  function reviewImport(items: ImportedQuestion[], reviewId?: string) {
    if (importBlocked) throw new Error("This assessment has student scripts or approved rubrics. Import is blocked to protect them.");
    if (rubrics.length || assessment.questions.some((q) => !isPlaceholderPrompt(q.prompt)) || hasValidPrompt || criteria.some((c) => c.description.trim()) || modelAnswerText.trim() || modelImages.length) {
      setPendingImport({ items, reviewId });
    } else {
      saveImportedQuestions(items, false, reviewId);
    }
  }

  useEffect(() => {
    if (!currentQ) return;
    const existing = draftRubric || activeRubric;
    setSubquestions(existing?.subquestions || []);
    if (existing) {
      setCriteria(
        existing.criteria.length > 0
          ? existing.criteria.map((c) => ({
              ...c,
              description: existing.approved ? c.description : sanitizeCriterionDescription(c.description),
            }))
          : [
              {
                id: "C1",
                description: "",
                maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
                allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
                acceptedAlternatives: ["Equivalent valid terminology accepted"],
              },
              {
                id: "C2",
                description: "",
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
          description: "",
          maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
          allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
          acceptedAlternatives: ["Standard academic definition or paraphrase"],
        },
        {
          id: "C2",
          description: "",
          maxMarks: Number((currentQ.maxMarks * 0.5).toFixed(1)),
          allowedPartialCredits: [0, Number((currentQ.maxMarks * 0.25).toFixed(1)), Number((currentQ.maxMarks * 0.5).toFixed(1))],
          acceptedAlternatives: ["Grounded technical justification"],
        },
      ]);
      setModelAnswerText("");
      setModelImages([]);
    }
    setSelectedImgIdx(0);
  }, [selectedQId, currentQ?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const criteriaSum = Number(
    criteria.reduce((acc, c) => acc + (Number(c.maxMarks) || 0), 0).toFixed(2),
  );
  const qMaxMarks = Number((currentQ?.maxMarks ?? 0).toFixed(2));
  const isSumValid = currentQ ? Math.abs(criteriaSum - qMaxMarks) < 0.001 : false;
  const hasValidPrompt = Boolean(currentQ && !isPlaceholderPrompt(currentQ.prompt));
  const allCriteriaFilled = criteria.length > 0 && criteria.every((c) => c.description.trim().length > 0);
  const hasCompleteScoring = criteria.every((c) => c.acceptedAlternatives.some((answer) => answer.trim()) && c.scoringGuide && c.scoringGuide.length === c.allowedPartialCredits.length && new Set(c.scoringGuide.map((entry) => entry.marks)).size === c.scoringGuide.length && c.scoringGuide.every((entry) => c.allowedPartialCredits.includes(entry.marks) && entry.description.trim()));
  const hasValidSubquestionTotals = subquestions.length > 0 && (
    Math.abs(subquestions.reduce((sum, part) => sum + part.maxMarks, 0) - qMaxMarks) < 0.001 &&
    subquestions.every(part => part.prompt.trim() && part.originalAnswer.trim() && Number.isFinite(part.maxMarks) && part.maxMarks > 0 && Math.abs(criteria.filter(c => c.subquestionId === part.id).reduce((sum,c) => sum + c.maxMarks,0) - part.maxMarks) < 0.001) &&
    criteria.every(c => subquestions.some(part => part.id === c.subquestionId) && c.sourceExcerpt?.trim())
  );
  const isReadyToApprove = hasValidPrompt && allCriteriaFilled && isSumValid && hasCompleteScoring && hasValidSubquestionTotals;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    e.target.value = "";
    const newImages: ModelAnswerImage[] = [];
    setReadingReference(true);
    try {
      for (const file of fileList) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          if (pdf.numPages > 10) throw new Error(`${file.name} has more than 10 pages. Upload a shorter PDF.`);
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Could not render a PDF page.");
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            newImages.push({
              id: `img-model-${crypto.randomUUID()}`,
              fileName: `${file.name} · page ${pageNumber}`,
              fileFormat: "JPEG",
              fileSizeBytes: file.size,
              originalUrl: canvas.toDataURL("image/jpeg", 0.85),
              pageNumber: modelImages.length + newImages.length + 1,
            });
          }
        } else if (file.type === "image/jpeg" || file.type === "image/png") {
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
            reader.readAsDataURL(file);
          });
          newImages.push({
            id: `img-model-${crypto.randomUUID()}`,
            fileName: file.name,
            fileFormat: file.type === "image/png" ? "PNG" : "JPEG",
            fileSizeBytes: file.size,
            originalUrl: url,
            pageNumber: modelImages.length + newImages.length + 1,
          });
        } else {
          throw new Error(`${file.name} must be a PDF, JPEG, or PNG file.`);
        }
      }
    } catch (error) {
      setValidationMsg({ ok: false, msg: error instanceof Error ? error.message : "Could not read the uploaded file." });
      return;
    } finally {
      setReadingReference(false);
    }

    const updatedImages = [...modelImages, ...newImages];
    setModelImages(updatedImages);
    if (newImages.length > 0) {
      setSelectedImgIdx(modelImages.length);
    }
    let targetQId = currentQ?.id;
    if (!targetQId && assessment.questions.length === 0) {
      actions.addQuestion();
      targetQId = "q1";
      setSelectedQId("q1");
    }
    if (targetQId) {
      actions.saveRubricDraft(targetQId, criteria, modelAnswerText, updatedImages, subquestions);
    }
  }

  function handleRemoveModelImage(idxToRemove: number) {
    const removed = modelImages[idxToRemove];
    const nextImages = modelImages
      .filter((_, i) => i !== idxToRemove)
      .map((im, i) => ({ ...im, pageNumber: i + 1 }));
    setModelImages(nextImages);
    setSelectedImgIdx((prev) => {
      if (nextImages.length === 0) return 0;
      if (prev >= nextImages.length) return nextImages.length - 1;
      if (prev > idxToRemove) return prev - 1;
      return prev;
    });
    if (currentQ) {
      if (removed?.id) {
        actions.removeModelAnswerImage(currentQ.id, removed.id);
      }
      actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, nextImages, subquestions);
    }
  }

  async function runModelAnswerOcr() {
    const curImg = modelImages[selectedImgIdx];
    if (!curImg || !currentQ) return;
    setIsExtractingOcr(true);
    setOcrMessage(null);
    setValidationMsg(null);
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
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || "Text extraction failed.");
      }
      const extractedText = data.results?.[0]?.rawText?.trim();
      if (!extractedText) {
        throw new Error("No text was found on this page. Try a clearer scan or type the model answer in the notes field.");
      }
      setModelAnswerText((prev) =>
        prev ? `${prev}\n\n${extractedText}` : extractedText,
      );
      setValidationMsg({ ok: true, msg: "Text extracted. Review it against the uploaded page before saving." });
      setOcrMessage({ ok: true, text: "Text extracted. Review it before saving." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Text extraction failed.";
      setValidationMsg({ ok: false, msg: message });
      setOcrMessage({ ok: false, text: message });
    } finally {
      setIsExtractingOcr(false);
    }
  }

  function handleAddQuestion() {
    if (currentQ) actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    const nextIdx = Math.max(0, ...assessment.questions.map((q) => Number(q.number.slice(1)) || 0)) + 1;
    actions.addQuestion();
    setSelectedQId(`q${nextIdx}`);
  }

  const isPdfFile = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImageFile = (file: File) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);
  const isTxtFile = (file: File) => file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
  const hasImagePages = schemeFiles.length > 0 && schemeFiles.every(isImageFile);
  const scanPdf = schemeFiles.length === 1 && isPdfFile(schemeFiles[0]) && schemeText.trim().length < 200;
  const needsOcr = hasImagePages || scanPdf;

  function fileToImagePayload(file: File, pageNumber: number): Promise<{ pageNumber: number; mimeType: string; base64Data: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const base64Data = result.includes(",") ? result.split(",")[1] : result;
        const mimeType =
          file.type && file.type.startsWith("image/")
            ? file.type
            : file.name.toLowerCase().endsWith(".png")
              ? "image/png"
              : file.name.toLowerCase().endsWith(".webp")
                ? "image/webp"
                : "image/jpeg";
        resolve({ pageNumber, mimeType, base64Data });
      };
      reader.onerror = () => reject(new Error(`Could not read image ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function handleSchemeFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setSchemeFiles(files);
    setSchemeText("");
    setReadingScheme(true);
    setImportError("");
    try {
      if (files.every(isImageFile)) {
        if (files.length > 10) throw new Error("Upload at most 10 image pages at a time.");
        // Images are sent directly to Vision OCR when generating the rubric draft.
        return;
      }
      if (files.length > 1) {
        throw new Error("Select either up to 10 images, a single PDF, or a single .txt file.");
      }
      const file = files[0];
      if (isPdfFile(file)) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (pdf.numPages > 10) throw new Error("Upload a PDF with at most 10 pages.");
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join(""));
        }
        setSchemeText(pages.join("\n"));
      } else if (isTxtFile(file)) {
        setSchemeText(await file.text());
      } else {
        throw new Error(`${file.name} is not supported. Upload JPG/PNG/WebP images, a PDF, or a .txt file.`);
      }
    } catch (error) {
      setSchemeFiles([]);
      setImportError(error instanceof Error ? error.message : "Could not read this file. Try JPG/PNG images, a PDF, or a .txt file.");
    } finally {
      setReadingScheme(false);
    }
  }

  async function handleGenerateRubric() {
    if (schemeFiles.length === 0 && !schemeText.trim()) return;
    if (importBlocked) { setImportError("This assessment has student scripts or approved rubrics. Import is blocked to protect them."); return; }
    setGenerationStage("preparing");
    setImportError("");
    try {
      let pages: { pageNumber: number; mimeType: string; base64Data: string }[] = [];
      if (hasImagePages) {
        pages = await Promise.all(schemeFiles.map((file, idx) => fileToImagePayload(file, idx + 1)));
      } else if (scanPdf) {
        const pdfFile = schemeFiles[0];
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()) }).promise;
        if (pdf.numPages > 10) throw new Error("Upload a PDF with at most 10 pages.");
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not render PDF page.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          pages.push({ pageNumber, mimeType: "image/jpeg", base64Data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] });
        }
      }
      setGenerationStage("drafting");
      const response = await fetch("/api/rubric/draft-from-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, text: schemeText, assessmentId: assessment.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Could not generate a rubric draft.");
      if (result.transcript && (needsOcr || !schemeText.trim())) {
        setSchemeText(result.transcript);
      }
      const warnings: { questionNumber: string; message: string }[] = result.warnings || [];
      const items: ImportedQuestion[] = result.questions.map((question: {
        number: string; prompt: string; maxMarks: number; modelAnswerText: string; criteria: RubricCriterion[]; subquestions: RubricSubquestion[];
      }) => ({
        question: {
          id: question.number.toLowerCase(), number: question.number, prompt: question.prompt, maxMarks: question.maxMarks,
          rubricWarnings: warnings.filter(warning => warning.questionNumber === question.number).map(warning => warning.message),
        },
        criteria: question.criteria,
        modelAnswerText: question.modelAnswerText,
        subquestions: question.subquestions,
      }));
      reviewImport(items, result.reviewId || undefined);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Rubric generation failed.");
    } finally {
      setGenerationStage(null);
    }
  }

  function handleImportScheme() {
    try {
      const items = parseMarkingScheme(schemeText);
      reviewImport(items);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not parse the scheme.");
    }
  }

  function hasSavedApproval(questionId?: string) {
    return rubrics.some(rubric => rubric.approved && rubric.rubricId && (!questionId || rubric.questionId === questionId)) ||
      Boolean(reviewProgress?.approvedRubrics.some(rubric => !questionId || rubric.questionId === questionId));
  }

  async function deleteMarkingScheme() {
    if (!deleteTarget || sourceBusy || removingItem) return;
    const resetScheme = deleteTarget === "scheme";
    if (resetScheme && (draftBusy || schemeResetBlock)) return;
    setRemovingItem(true);
    setItemRemovalError("");
    try {
      if (resetScheme) {
        const databaseArchived = hasSavedApproval();
        if (databaseArchived) await archiveMarkingScheme(assessment.id);
        const result = actions.resetMarkingScheme(databaseArchived);
        if (!result.ok) throw new Error(result.error);
        setSelectedQId("");
        setCriteria([]);
        setSubquestions([]);
        setModelAnswerText("");
        setModelImages([]);
        setOcrMessage(null);
        setShowImport(true);
        setValidationMsg(null);
      }
      setSchemeFiles([]);
      if (resetScheme || !keepSourceText) setSchemeText("");
      setPendingImport(null);
      setDeleteTarget(null);
      const saved = resetScheme ? flushPersistence() : { ok: true };
      setImportError(saved.ok ? "" : saved.error || "The reset could not be saved in this browser.");
    } catch (error) {
      setItemRemovalError(error instanceof Error ? error.message : "The marking scheme could not be reset.");
    } finally {
      setRemovingItem(false);
    }
  }

  function requestItemRemoval(item: RubricItemToRemove) {
    setItemRemovalError("");
    setItemToRemove(item);
  }

  async function removeRubricItem() {
    if (!itemToRemove || itemRemovalBlock || removingItem || draftBusy) return;
    setRemovingItem(true);
    setItemRemovalError("");
    try {
      if (itemToRemove.kind === "question") {
        const databaseArchived = hasSavedApproval(itemToRemove.id);
        if (databaseArchived) await archiveMarkingScheme(assessment.id, itemToRemove.id);
        if (reviewId) await fetchReviewProgress(reviewId, { removeQuestionId: itemToRemove.id });
        const result = actions.deleteQuestion(itemToRemove.id, databaseArchived);
        if (!result.ok) throw new Error(result.error);
        if (itemToRemove.id === selectedQId) {
          const index = assessment.questions.findIndex(question => question.id === selectedQId);
          setSelectedQId(assessment.questions[index + 1]?.id || assessment.questions[index - 1]?.id || "");
          setOcrMessage(null);
        }
        if (reviewId) setReviewRefresh(value => value + 1);
      } else if (currentQ) {
        const remainingParts = subquestions.filter(part => part.id !== itemToRemove.id);
        const remainingCriteria = criteria.filter(criterion => criterion.subquestionId !== itemToRemove.id);
        setSubquestions(remainingParts);
        setCriteria(remainingCriteria);
        actions.saveRubricDraft(currentQ.id, remainingCriteria, modelAnswerText, modelImages, remainingParts);
      }
      const saved = flushPersistence();
      setValidationMsg(saved.ok
        ? { ok: true, msg: `Removed ${itemToRemove.label}.` }
        : { ok: false, msg: saved.error || "The removal could not be saved in this browser." });
      setItemToRemove(null);
    } catch (error) {
      setItemRemovalError(error instanceof Error ? error.message : "The item could not be removed.");
    } finally {
      setRemovingItem(false);
    }
  }

  function addSubtopic() {
    if (!currentQ) return;
    const id = crypto.randomUUID();
    const prefix = `${currentQ.number} · Subtopic `;
    let number = subquestions.length + 1;
    while (subquestions.some(part => part.label === `${prefix}${number}`)) number += 1;
    const unallocated = Number((qMaxMarks - subquestions.reduce((sum, part) => sum + part.maxMarks, 0)).toFixed(2));
    const first = subquestions.length === 0;
    setSubquestions([...subquestions, {
      id,
      label: `${prefix}${number}`,
      prompt: first ? currentQ.prompt : "",
      originalAnswer: first ? modelAnswerText : "",
      maxMarks: unallocated > 0 ? unallocated : 1,
    }]);
    if (first) setCriteria(criteria.map(criterion => ({ ...criterion, subquestionId: id })));
  }

  function handleSaveDraft() {
    if (!currentQ) return;
    actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    const saved = flushPersistence();
    setValidationMsg(saved.ok
      ? { ok: true, msg: `Draft for ${currentQ.number} saved in this browser. Reopen this same address to continue editing.` }
      : { ok: false, msg: saved.error || "Draft could not be saved. Keep this page open and retry." });
  }

  function selectQuestion(questionId: string, focusEditor = false) {
    if (currentQ && questionId !== currentQ.id) {
      const approvedImages = activeRubric?.modelAnswerImages || [];
      const sameAsApproval = activeRubric && !draftRubric &&
        modelAnswerText === (activeRubric.modelAnswerText || "") &&
        JSON.stringify([criteria, subquestions]) === JSON.stringify([activeRubric.criteria, activeRubric.subquestions || []]) &&
        modelImages.length === approvedImages.length && modelImages.every((image, index) => image.id === approvedImages[index].id);
      if (!sameAsApproval) actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    }
    setSelectedQId(questionId);
    setOcrMessage(null);
    setValidationMsg(null);
    if (focusEditor) requestAnimationFrame(() => document.getElementById("rubric-question-heading")?.focus());
  }

  async function handleApproveRubric() {
    if (!currentQ) return;
    const errorMsg = !hasValidPrompt
      ? "Please enter the question prompt / topic before approving the marking scheme."
      : !allCriteriaFilled
        ? "Please enter a description for every marking criterion before approving."
        : !isSumValid
          ? `Criteria sum (${criteriaSum} marks) must exactly equal question maximum (${qMaxMarks} marks) before approving.`
          : null;
    if (errorMsg) {
      setValidationMsg({ ok: false, msg: errorMsg });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (approving) return;
    setApproving(true);
    const res = await actions.approveRubric(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    setApproving(false);
    if (!res.ok) {
      setValidationMsg({ ok: false, msg: res.error || "Approval failed." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      const saved = flushPersistence();
      setValidationMsg({
        ok: true,
        msg: saved.ok ? `Rubric for ${currentQ.number} saved to Supabase and verified.` : "Approval saved to Supabase and verified, but the browser cache could not be updated. Use Load saved approval to retrieve it.",
      });
      if (reviewId) setReviewRefresh(value => value + 1);
    }
  }

  async function handleLoadApproval() {
    if (!currentQ || loadingApproval) return;
    if (!window.confirm("Load the latest approval from Supabase? This replaces this question and its local draft with the saved version. Continue?")) return;
    setLoadingApproval(true);
    try {
      const saved = await actions.loadApprovedRubric(currentQ.id);
      setCriteria(saved.question.criteria);
      setSubquestions(saved.question.subquestions);
      setModelAnswerText(saved.question.modelAnswerText);
      setModelImages([]);
      const cached = flushPersistence();
      setValidationMsg({ ok: true, msg: `Loaded approved version ${saved.version} from Supabase.${cached.ok ? "" : " Browser cache could not be updated."}` });
      if (reviewId) setReviewRefresh(value => value + 1);
    } catch (error) {
      setValidationMsg({ ok: false, msg: error instanceof Error ? error.message : "Could not load the saved approval." });
    } finally {
      setLoadingApproval(false);
    }
  }

  const fieldClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100";
  const approvalHint = !hasValidPrompt ? "Enter the question text to continue." : !allCriteriaFilled ? "Describe each marking point before approving." : !isSumValid ? `Allocate ${qMaxMarks} marks in total. Currently allocated: ${criteriaSum}.` : !hasValidSubquestionTotals ? "Check each subquestion: its marking points must add up to its full marks and include the original answer." : !hasCompleteScoring ? "Add alternative answers and explain every allowed score before approving." : "All checks passed. This question is ready to approve.";
  const approvedByQuestion = new Map<string, RubricVersion>();
  for (const rubric of rubrics) {
    if (!rubric.approved || !rubric.rubricId) continue;
    const existing = approvedByQuestion.get(rubric.questionId);
    if (!existing || rubric.version > existing.version) approvedByQuestion.set(rubric.questionId, rubric);
  }
  const pendingQuestionIds = reviewProgress?.pendingQuestionIds ?? assessment.questions
    .filter(question => !approvedByQuestion.has(question.id)).map(question => question.id);
  const pendingQuestions = new Set(pendingQuestionIds);
  const approvedCount = reviewProgress?.approvedRubrics.length ?? assessment.questions.length - pendingQuestionIds.length;
  const totalQuestions = approvedCount + pendingQuestionIds.length;
  const approvalsComplete = totalQuestions > 0 && pendingQuestionIds.length === 0 && (!reviewId || reviewProgress !== null);
  const hasRubric = rubrics.some(rubric => rubric.approved || rubric.criteria.some(criterion => criterion.description.trim()));
  const currentStep = readingScheme || generatingRubric || !hasRubric ? 0 : approvalsComplete ? 3 : approvedCount > 0 || approving ? 2 : 1;
  const canViewSource = !importBlocked || Boolean(schemeFiles.length || schemeText.trim());
  const nextQuestion = assessment.questions.find(question => question.id !== selectedQId && pendingQuestions.has(question.id));
  const reviewVersions = reviewProgress?.approvedRubrics.map(({ questionId, version }) => `${questionId.toUpperCase()} v${version}`);

  return (
    <fieldset disabled={approving || loadingApproval || removingItem} aria-busy={approving || loadingApproval || removingItem} className="mx-auto min-w-0 max-w-7xl space-y-5 pb-12">
      <Modal open={pendingImport !== null} title="Replace existing marking scheme drafts?" onClose={() => setPendingImport(null)} footer={<>
        <Button onClick={() => setPendingImport(null)}>Keep existing drafts</Button>
        <Button variant="primary" onClick={() => { if (!pendingImport) return; try { saveImportedQuestions(pendingImport.items, true, pendingImport.reviewId); } catch (error) { setImportError(error instanceof Error ? error.message : "Import failed."); setPendingImport(null); } }}>Replace drafts & import</Button>
      </>}>
        <p>This will replace the current {assessment.questions.length} questions, their draft marking points and model answer references with {pendingImport?.items.length || 0} imported questions. Existing draft edits will be removed.</p>
        <p className="mt-3 font-medium">Review the new questions:</p>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto">{pendingImport?.items.map((item) => <li key={item.question.id} className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">{item.question.number} · {item.question.maxMarks} marks</span><p className="mt-1">{item.question.prompt}</p><p className="mt-1 text-xs text-slate-500">{item.criteria.length} marking points</p></li>)}</ul>
      </Modal>
      <Modal open={deleteTarget !== null} title={deleteTarget === "scheme" ? "Reset marking scheme?" : "Delete uploaded source?"} onClose={() => { if (!removingItem) setDeleteTarget(null); }} footer={<>
        <Button onClick={() => setDeleteTarget(null)}>{deleteTarget === "scheme" && schemeResetBlock ? "Close" : "Cancel"}</Button>
        {!(deleteTarget === "scheme" && schemeResetBlock) && <Button variant="danger" onClick={() => void deleteMarkingScheme()}>
          {removingItem ? "Working…" : deleteTarget === "scheme" ? "Reset marking scheme" : "Delete source"}
        </Button>}
      </>}>
        <p>{deleteTarget === "scheme"
          ? schemeResetBlock || "This clears the source, questions, and drafts from the current scheme. Saved approvals are archived so you can upload a fresh scheme."
          : "This removes the selected files from the marking scheme editor."}</p>
        {itemRemovalError && <p role="alert" className="mt-3 text-rose-700">{itemRemovalError}</p>}
        {deleteTarget === "source" && !importBlocked && Boolean(schemeText.trim()) && <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={keepSourceText} onChange={event => setKeepSourceText(event.target.checked)} />
          Keep the text preview
        </label>}
      </Modal>
      <Modal open={itemToRemove !== null} title={`Remove ${itemToRemove?.label || "item"}?`} onClose={() => { if (!removingItem) setItemToRemove(null); }} footer={<>
        <Button onClick={() => setItemToRemove(null)}>{itemRemovalBlock ? "Close" : "Cancel"}</Button>
        {!itemRemovalBlock && <Button variant="danger" disabled={removingItem} onClick={() => void removeRubricItem()}>
          {removingItem ? "Removing…" : itemToRemove?.kind === "question" ? "Remove question" : "Remove subtopic"}
        </Button>}
      </>}>
        <p>{itemRemovalBlock || (itemToRemove?.kind === "question"
          ? "This removes the question and its marking points from the current scheme. Any saved approvals for the question are archived."
          : "This removes the subtopic and its marking points from the draft. Review the question’s mark allocation before approving.")}</p>
        {itemRemovalError && <p role="alert" className="mt-3 text-rose-700">{itemRemovalError}</p>}
      </Modal>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Marking scheme</h1>
          <p className="mt-1 text-sm text-slate-600">Draft from a teacher’s marking scheme, then approve each question for grading.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewSource && assessment.questions.length > 0 && <Button aria-expanded={showImport} aria-controls="rubric-source" disabled={sourceBusy} onClick={() => setShowImport(open => !open)}>
            {showImport ? "Hide source" : schemeFiles.length || schemeText.trim() ? "View source" : "Import source"}
          </Button>}
          {hasMarkingScheme(state) && <Button variant="danger" onClick={() => { setItemRemovalError(""); setDeleteTarget("scheme"); }} disabled={draftBusy}>Reset marking scheme</Button>}
        </div>
      </div>

      <ol className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3" aria-label="Marking scheme workflow">
        {[
          { title: "Import & draft", detail: "The agent reads the source and checks the draft." },
          { title: "Review questions", detail: "Check flagged wording, evidence, and marks." },
          { title: "Approve versions", detail: approvalsComplete ? "All questions approved." : approvedCount ? `${approvedCount} of ${totalQuestions} questions approved.` : "Approve each question when ready." },
        ].map(({ title, detail }, index) => (
          <li key={title} aria-current={index === currentStep ? "step" : undefined} className={`flex gap-3 p-4 [&+li]:border-t [&+li]:border-slate-200 sm:[&+li]:border-l sm:[&+li]:border-t-0 ${index === currentStep ? "bg-indigo-50" : ""}`}>
            <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${index < currentStep ? "bg-emerald-100 text-emerald-800" : index === currentStep ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>
              {index < currentStep ? "✓" : index + 1}
            </span>
            <div><p className="text-sm font-semibold text-slate-900">{title}{index < currentStep && <span className="sr-only"> completed</span>}</p><p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p></div>
          </li>
        ))}
      </ol>

      <details className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Assessment details · {assessment.title || "Untitled assessment"}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">Assessment title<input value={assessment.title} onChange={(e) => actions.updateAssessment(e.target.value, assessment.course)} className={fieldClass} /></label>
          <label className="text-xs font-medium text-slate-600">Course<input value={assessment.course} onChange={(e) => actions.updateAssessment(assessment.title, e.target.value)} className={fieldClass} /></label>
        </div>
      </details>

      {canViewSource && (showImport || assessment.questions.length === 0) && (
        <Card className="overflow-hidden">
          <div id="rubric-source" className="border-b border-slate-100 px-5 py-4"><h2 className="text-base font-semibold text-slate-900">Marking scheme source</h2><p className="mt-1 text-sm text-slate-600">Use a marking guide, answer key, or model answer script with mark allocations.</p></div>
          <div className="grid gap-5 p-5 md:grid-cols-[1fr_1.2fr]">
            <div className="flex min-w-0 flex-col justify-center rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-white text-xl text-indigo-600" aria-hidden="true">↑</span>
              <p className="break-words text-sm font-semibold text-slate-900">
                {schemeFiles.length === 0
                  ? "Choose a source file"
                  : schemeFiles.length === 1
                    ? schemeFiles[0].name
                    : `${schemeFiles.length} image pages selected`}
              </p>
              <p className="mt-2 text-xs text-slate-600" role="status">
                {importBlocked ? "Source used to generate this draft." : readingScheme ? "Reading source file…" : needsOcr ? "The agent will read these pages with OCR." : schemeFiles.length ? "The agent will use the text preview." : "One PDF or TXT file, or up to 10 JPG, PNG, or WebP images. PDF limit 10 pages."}
              </p>
              {(!importBlocked || schemeFiles.length > 0) && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {!importBlocked && <label className={`rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 focus-within:ring-2 focus-within:ring-indigo-500 ${sourceBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-indigo-50"}`}>
                  {schemeFiles.length > 0 ? "Choose different files" : "Browse files"}
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,.txt,application/pdf,text/plain" disabled={readingScheme || generatingRubric} className="sr-only" onChange={(e) => { void handleSchemeFiles(e.target.files); e.target.value = ""; }} />
                </label>}
                {schemeFiles.length > 0 && <Button variant="danger" size="sm" onClick={() => { setItemRemovalError(""); setKeepSourceText(false); setDeleteTarget("source"); }} disabled={sourceBusy}>Delete source</Button>}
              </div>}
            </div>
            <div className="min-w-0">
              <label htmlFor="rubric-source-text" className="text-sm font-medium text-slate-700">{importBlocked ? "Source text" : "Paste or review source text"}</label>
              <textarea id="rubric-source-text" value={schemeText} onChange={(e) => { setSchemeText(e.target.value); setImportError(""); }} rows={6} aria-describedby="rubric-source-help" placeholder="Paste questions, marking points, model answers, and marks here." className={fieldClass} readOnly={importBlocked} disabled={readingScheme || generatingRubric} />
              <p id="rubric-source-help" className="mt-2 text-xs leading-5 text-slate-600">
                {importBlocked ? "Use the source to check each question’s wording and evidence." : needsOcr ? "OCR text appears here after generation. To draft from text alone, delete the source and keep the preview." : "Text from a PDF or TXT file appears here. You can correct it before generating a draft."}
              </p>
            </div>
          </div>
          {!importBlocked && <div className="border-t border-slate-100 px-5 py-4">
            {importError && <p className="mb-3 text-sm text-rose-700" role="alert">{importError}</p>}
            {generationStage && <p className="mb-3 flex items-center gap-2 text-sm text-indigo-800" role="status">
              <span aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-700" />
              {generationStage === "preparing" ? "Preparing the source…" : needsOcr ? "The agent is reading the pages and checking the draft. Scans can take a few minutes." : "The agent is drafting questions and checking marks against the source."}
            </p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <details className="text-xs text-slate-500"><summary className="cursor-pointer">Have a formatted scheme?</summary><p className="mt-2">Use Q1 | Question | 5 and C1 | Marking point | 5 on separate lines.</p><Button size="sm" className="mt-2" onClick={handleImportScheme} disabled={readingScheme || generatingRubric || !schemeText.trim()}>Import formatted text</Button></details>
              <Button variant="primary" onClick={() => { void handleGenerateRubric(); }} disabled={readingScheme || generatingRubric || (schemeFiles.length === 0 && !schemeText.trim())}>{generatingRubric ? "Creating draft…" : "Generate questions & rubric"}</Button>
            </div>
          </div>}
        </Card>
      )}

      {validationMsg && <Alert tone={validationMsg.ok ? "green" : "red"} title={validationMsg.ok ? "Marking scheme updated" : "Please check"}>{validationMsg.msg}</Alert>}
      {reviewId && <Alert tone={approvalsComplete ? "green" : currentReview?.kind === "error" ? "amber" : "blue"} title={approvalsComplete ? "Rubric review complete" : "Agent review"}>
        <p>{checkingReview ? "Checking saved approvals…" : currentReview?.kind === "error" ? currentReview.message : approvalsComplete ? `Approved versions recorded for grading. ${reviewVersions?.join(", ")}.` : `The agent is waiting for approval on ${pendingQuestionIds.map(id => id.toUpperCase()).join(", ")}.`}</p>
        {!approvalsComplete && !checkingReview && <Button className="mt-2" size="sm" onClick={() => setReviewRefresh(value => value + 1)}>Check approval progress</Button>}
      </Alert>}

      {assessment.questions.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">Prefer to write your own scheme? <button onClick={handleAddQuestion} className="font-semibold text-indigo-700 underline underline-offset-4">Add a question manually</button></div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-24">
            <div className="border-b border-slate-100 px-4 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Questions</h2>
              {hasRubric && totalQuestions > 0 && <div className="mt-2">
                <p id="rubric-approval-progress" className="text-xs font-medium text-slate-700">{approvedCount} of {totalQuestions} approved</p>
                <progress aria-labelledby="rubric-approval-progress" className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100 [&::-moz-progress-bar]:bg-emerald-600 [&::-webkit-progress-bar]:bg-slate-100 [&::-webkit-progress-value]:bg-emerald-600" value={approvedCount} max={totalQuestions} />
              </div>}
            </div>
            <div className="space-y-1 p-2">{assessment.questions.map((q) => {
              const savedVersion = reviewProgress?.approvedRubrics.find(item => item.questionId === q.id)?.version ?? approvedByQuestion.get(q.id)?.version;
              const approved = Boolean(savedVersion && !pendingQuestions.has(q.id));
              const flagged = !approved && Boolean(q.rubricWarnings?.length);
              const localApproval = rubrics.find(rubric => rubric.questionId === q.id && rubric.approved && !rubric.rubricId);
              return <div key={q.id} className={`rounded-lg ${q.id === selectedQId ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200" : "text-slate-700 hover:bg-slate-50"}`}>
                <button type="button" aria-pressed={q.id === selectedQId} onClick={() => selectQuestion(q.id)} className="block w-full rounded-lg px-3 pb-2 pt-3 text-left">
                  <span className="flex items-center justify-between text-sm font-semibold"><span>{q.number}</span><span className="text-xs">{q.maxMarks} marks</span></span>
                  <span className="mt-1 block truncate text-xs opacity-75">{isPlaceholderPrompt(q.prompt) ? "Add question text" : q.prompt}</span>
                  <span className={`mt-2 block text-xs font-medium ${approved ? "text-emerald-700" : flagged ? "text-amber-800" : "text-slate-600"}`}>
                    {approved ? `Approved · v${savedVersion}` : flagged ? "Review flagged" : localApproval ? `Local approval · v${localApproval.version}` : "Awaiting review"}
                  </span>
                </button>
                <div className="px-3 pb-3">
                  <Button type="button" variant="danger" size="sm" aria-label={`Remove question ${q.number}`} disabled={draftBusy} onClick={() => requestItemRemoval({ kind: "question", id: q.id, label: q.number })}>Remove question</Button>
                </div>
              </div>;
            })}</div>
            <div className="border-t border-slate-100 p-3"><Button className="w-full" onClick={handleAddQuestion}>+ Add question</Button></div>
          </Card>
          {currentQ && <div className="min-w-0 space-y-5">
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="rubric-question-heading" tabIndex={-1} className="scroll-mt-28 text-lg font-semibold text-slate-900">{currentQ.number} · Question details</h2><Badge tone={activeRubric?.rubricId ? "green" : "amber"}>{activeRubric ? `${activeRubric.rubricId ? "Approved" : "Local approval"} · v${activeRubric.version}` : "Draft"}</Badge></div>
              {pendingQuestions.has(currentQ.id) && Boolean(currentQ.rubricWarnings?.length) && <div className="mb-4">
                <Alert title="Agent flagged this question" tone="amber">
                  <ul className="list-disc space-y-1 pl-5">{currentQ.rubricWarnings?.map(warning => <li key={warning}>{warning}</li>)}</ul>
                </Alert>
              </div>}
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                <label className="text-xs font-medium text-slate-600">Question text<textarea rows={3} value={isPlaceholderPrompt(currentQ.prompt) ? "" : currentQ.prompt} onChange={(e) => actions.updateQuestion(currentQ.id, e.target.value, currentQ.maxMarks)} placeholder="Enter the full question, including subquestions…" className={fieldClass} /></label>
                <label className="text-xs font-medium text-slate-600">Total marks<input type="number" step="0.5" min="0.5" value={currentQ.maxMarks} onChange={(e) => { const val = parseFloat(e.target.value); if (val >= 0.5) actions.updateQuestion(currentQ.id, currentQ.prompt, val); }} className={fieldClass} /></label>
              </div>
            </Card>
            {/* Supplemental Model Answer Section — Directly at top so uploaded images appear immediately in viewport */}
            <details className="rounded-xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer text-sm font-semibold text-indigo-700">Model answer & reference pages (optional)</summary>
              <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-heading text-base font-semibold text-[color:var(--x-ink,#111827)]">
                    Expected answer
                  </h3>
                  <p className="text-xs text-[color:var(--x-secondary,#4b5563)]">
                    Check the answer text or attach a reference page for this question.
                  </p>
                </div>
                <label className="cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-3.5 py-2 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)] hover:bg-slate-50 shadow-xs transition">
                  + Upload Reference PDF or Image
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageUpload(e)}
                  />
                </label>
              </div>

              <div className="grid gap-6 lg:grid-cols-2 items-stretch">
                {/* Left Column: Reference Image View */}
                <div className={`flex flex-col gap-3 min-w-0 ${modelImages.length > 0 ? "h-[380px]" : "min-h-[210px]"}`}>
                  <div className="flex items-center justify-between h-6 shrink-0">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Reference pages
                    </span>
                    {modelImages.length > 0 && (
                      <span className="text-[11px] font-medium text-slate-500">
                        {modelImages.length} {modelImages.length === 1 ? "sheet" : "sheets"}
                      </span>
                    )}
                  </div>
                  {modelImages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
                      <p className="text-xs text-slate-500">
                        Upload a PDF, JPEG, or PNG model answer for this question.
                      </p>
                      <label className="mt-3 cursor-pointer rounded-xl bg-white border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs">
                        Browse files
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,.pdf"
                          multiple
                          className="hidden"
                          onChange={(e) => handleImageUpload(e)}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-2.5 min-h-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {modelImages.map((_, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setSelectedImgIdx(i)}
                              className={`whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                                selectedImgIdx === i
                                  ? "bg-indigo-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              Page {i + 1}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden shrink-0">
                            <button
                              type="button"
                              onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                              className="px-2 py-1 text-xs font-mono text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                              title="Zoom out"
                            >
                              -
                            </button>
                            <span className="px-2 text-xs font-mono text-slate-700 whitespace-nowrap select-none">
                              {Math.round(zoom * 100)}%
                            </span>
                            <button
                              type="button"
                              onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                              className="px-2 py-1 text-xs font-mono text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                              title="Zoom in"
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={runModelAnswerOcr}
                            disabled={isExtractingOcr}
                            className="whitespace-nowrap shrink-0 rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 cursor-pointer"
                          >
                            {isExtractingOcr ? "Extracting..." : "Extract text →"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveModelImage(selectedImgIdx)}
                            className="whitespace-nowrap shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 cursor-pointer"
                            title="Remove current reference image"
                            aria-label="Remove current reference image"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      {isExtractingOcr && <p className="text-xs text-slate-600" role="status">Gemini is reading this page. A dense scan can take a few minutes.</p>}
                      {ocrMessage && <p className={`text-xs ${ocrMessage.ok ? "text-emerald-700" : "text-rose-700"}`} role="status">{ocrMessage.text}</p>}
                      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
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

                {/* Right Column: Model Answer Notes / Extracted Text */}
                <div className={`flex flex-col gap-3 min-w-0 ${modelImages.length > 0 ? "h-[380px]" : "min-h-[210px]"}`}>
                  <div className="flex items-center justify-between h-6 shrink-0">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Expected answer / key points
                    </span>
                  </div>
                  <textarea
                    value={modelAnswerText}
                    onChange={(e) => setModelAnswerText(e.target.value)}
                    placeholder="Enter key points, expected steps, or click 'Extract text' from your uploaded sheet..."
                    className="flex-1 min-h-0 w-full resize-none rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-3.5 text-sm font-mono text-[color:var(--x-ink,#111827)] focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
              </div>
            </details>




            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-base font-semibold text-slate-900">Answer & mark breakdown</h3><p className="mt-1 text-xs text-slate-500">Review the original answer, marks, and alternatives for each subtopic.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={isSumValid ? "green" : "amber"}>{criteriaSum} / {qMaxMarks} marks</Badge>
                <Button type="button" size="sm" onClick={addSubtopic}>Add subtopic</Button>
              </div>
            </div>
            {!subquestions.length && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Add a subtopic to set its source answer and mark allocation before approval.</p>}
            {(subquestions.length ? subquestions : [{id:"main",label:currentQ.number,prompt:currentQ.prompt,originalAnswer:modelAnswerText,maxMarks:qMaxMarks}]).map(part => <RubricSubquestionEditor
              key={`${selectedQId}-${part.id}`}
              part={part}
              structured={subquestions.length > 0}
              points={subquestions.length ? criteria.filter(c=>c.subquestionId===part.id) : criteria}
              onPartChange={changes => { if (subquestions.length) setSubquestions(subquestions.map(item=>item.id===part.id?{...item,...changes}:item)); else { if (changes.originalAnswer!==undefined) setModelAnswerText(changes.originalAnswer); if(changes.prompt!==undefined || changes.maxMarks!==undefined) actions.updateQuestion(currentQ.id,changes.prompt??currentQ.prompt,changes.maxMarks??currentQ.maxMarks); } }}
              onPointChange={(id,changes)=>setCriteria(criteria.map(item=>item.id===id?{...item,...changes}:item))}
              onRemove={id=>setCriteria(criteria.filter(item=>item.id!==id))}
              onRemoveSubtopic={subquestions.length ? () => requestItemRemoval({ kind: "subtopic", id: part.id, label: part.label }) : undefined}
              onAdd={()=>setCriteria([...criteria,{id:`C${Math.max(0,...criteria.map(c=>Number(c.id.replace(/\D/g,''))||0))+1}`,subquestionId:subquestions.length?part.id:undefined,sourceExcerpt:"",description:"",maxMarks:1,allowedPartialCredits:[0,1],acceptedAlternatives:[],scoringGuide:[{marks:0,description:""},{marks:1,description:""}]}])}
            />)}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="min-w-0 flex-1 basis-56">
                <h3 className="text-sm font-semibold text-slate-900">Approve {currentQ.number}</h3>
                <p id="rubric-approval-help" className={`mt-1 text-xs ${isReadyToApprove ? "text-emerald-700" : "text-slate-700"}`}>{approvalHint}</p>
                <p className="mt-1 text-xs text-slate-600">Approval creates a saved version for grading. Drafts are saved in this browser.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleLoadApproval}>{loadingApproval ? "Loading…" : "Load saved approval"}</Button>
                <Button onClick={handleSaveDraft}>Save draft</Button>
                <Button variant="primary" aria-describedby="rubric-approval-help" onClick={handleApproveRubric} disabled={!isReadyToApprove || approving}>{approving ? "Saving approval…" : activeRubric?.rubricId ? "Approve new version" : `Approve ${currentQ.number}`}</Button>
                {activeRubric?.rubricId && nextQuestion && <Button variant="ghost" onClick={() => selectQuestion(nextQuestion.id, true)}>Review {nextQuestion.number}</Button>}
              </div>
            </div>
          </div>}
        </div>
      )}
    </fieldset>
  );
}

export default function RubricPage() {
  return <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading marking scheme…</div>}><RubricContent /></Suspense>;
}
