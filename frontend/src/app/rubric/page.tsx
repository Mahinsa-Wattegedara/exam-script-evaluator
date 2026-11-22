"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RubricSubquestionEditor } from "@/components/rubric-subquestion";
import { Alert, Badge, Button, Card, Modal } from "@/components/ui";
import { isPlaceholderPrompt, sanitizeCriterionDescription, useStore } from "@/lib/store";
import { parseMarkingScheme } from "@/lib/marking-scheme-import";
import type { ImportedQuestion } from "@/lib/marking-scheme-import";
import type { ModelAnswerImage, RubricCriterion, RubricSubquestion } from "@/lib/types";

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
  const activeRubric = rubrics.filter((r) => r.questionId === selectedQId && r.approved).sort((a, b) => b.version - a.version)[0];
  const draftRubric = rubrics.find((r) => r.questionId === selectedQId && !r.approved);

  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [subquestions, setSubquestions] = useState<RubricSubquestion[]>([]);
  const [modelAnswerText, setModelAnswerText] = useState<string>("");
  const [modelImages, setModelImages] = useState<ModelAnswerImage[]>([]);
  const [selectedImgIdx, setSelectedImgIdx] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isExtractingOcr, setIsExtractingOcr] = useState<boolean>(false);
  const [ocrMessage, setOcrMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showImport, setShowImport] = useState(true);
  const [schemeText, setSchemeText] = useState("");
  const [importError, setImportError] = useState("");
  const [readingScheme, setReadingScheme] = useState(false);
  const [schemeFiles, setSchemeFiles] = useState<File[]>([]);
  const [generatingRubric, setGeneratingRubric] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportedQuestion[] | null>(null);
  const importBlocked = state.scripts.length > 0 || state.answers.length > 0 || rubrics.some((r) => r.approved);

  function saveImportedQuestions(items: ImportedQuestion[], replaceDrafts = false) {
    const imported = actions.importMarkingScheme(items, { replaceDrafts });
    if (!imported.ok) throw new Error(imported.error || "Could not save drafts.");
    setSelectedQId(items[0].question.id);
    setCriteria(items[0].criteria);
    setSubquestions(items[0].subquestions || []);
    setModelAnswerText(items[0].modelAnswerText || "");
    setModelImages([]);
    setPendingImport(null);
    setImportError("");
    setShowImport(false);
    setValidationMsg({ ok: true, msg: `Created ${items.length} unapproved rubric drafts. Review every question, answer, criterion, and mark before approval.` });
  }

  function reviewImport(items: ImportedQuestion[]) {
    if (importBlocked) throw new Error("This assessment has student scripts or approved rubrics. Import is blocked to protect them.");
    if (rubrics.length || assessment.questions.some((q) => !isPlaceholderPrompt(q.prompt)) || hasValidPrompt || criteria.some((c) => c.description.trim()) || modelAnswerText.trim() || modelImages.length) {
      setPendingImport(items);
    } else {
      saveImportedQuestions(items);
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
    setValidationMsg(null);
  }, [selectedQId, currentQ?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const criteriaSum = Number(
    criteria.reduce((acc, c) => acc + (Number(c.maxMarks) || 0), 0).toFixed(2),
  );
  const qMaxMarks = Number((currentQ?.maxMarks ?? 0).toFixed(2));
  const isSumValid = currentQ ? Math.abs(criteriaSum - qMaxMarks) < 0.001 : false;
  const hasValidPrompt = Boolean(currentQ && !isPlaceholderPrompt(currentQ.prompt));
  const allCriteriaFilled = criteria.length > 0 && criteria.every((c) => c.description.trim().length > 0);
  const hasCompleteScoring = criteria.every((c) => c.acceptedAlternatives.some((answer) => answer.trim()) && c.scoringGuide && c.scoringGuide.length === c.allowedPartialCredits.length && new Set(c.scoringGuide.map((entry) => entry.marks)).size === c.scoringGuide.length && c.scoringGuide.every((entry) => c.allowedPartialCredits.includes(entry.marks) && entry.description.trim()));
  const hasValidSubquestionTotals = !subquestions.length || (
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
    setGeneratingRubric(true);
    setImportError("");
    try {
      let pages: { pageNumber: number; mimeType: string; base64Data: string }[] = [];
      if (schemeFiles.length > 0 && schemeFiles.every(isImageFile)) {
        pages = await Promise.all(schemeFiles.map((file, idx) => fileToImagePayload(file, idx + 1)));
      } else if (schemeFiles.length === 1 && isPdfFile(schemeFiles[0]) && schemeText.trim().length < 200) {
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
      const response = await fetch("/api/rubric/draft-from-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, text: schemeText }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not generate a rubric draft.");
      if (result.transcript && !schemeText.trim()) {
        setSchemeText(result.transcript);
      }
      const items: ImportedQuestion[] = result.questions.map((question: {
        number: string; prompt: string; maxMarks: number; modelAnswerText: string; criteria: RubricCriterion[]; subquestions: RubricSubquestion[];
      }) => ({
        question: { id: question.number.toLowerCase(), number: question.number, prompt: question.prompt, maxMarks: question.maxMarks },
        criteria: question.criteria,
        modelAnswerText: question.modelAnswerText,
        subquestions: question.subquestions,
      }));
      reviewImport(items);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Rubric generation failed.");
    } finally {
      setGeneratingRubric(false);
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

  function handleSaveDraft() {
    if (!currentQ) return;
    actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    setValidationMsg({ ok: true, msg: "Marking scheme draft saved successfully." });
  }

  function handleApproveRubric() {
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
    const res = actions.approveRubric(currentQ.id, criteria, modelAnswerText, modelImages, subquestions);
    if (!res.ok) {
      setValidationMsg({ ok: false, msg: res.error || "Approval failed." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setValidationMsg({
        ok: true,
        msg: `Rubric approved successfully for ${currentQ.number}! Version active for evaluation.`,
      });
    }
  }

  const fieldClass = "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100";
  const approvalHint = !hasValidPrompt ? "Enter the question text to continue." : !allCriteriaFilled ? "Describe each marking point before approving." : !isSumValid ? `Allocate ${qMaxMarks} marks in total. Currently allocated: ${criteriaSum}.` : !hasValidSubquestionTotals ? "Check each subquestion: its marking points must add up to its full marks and include the original answer." : !hasCompleteScoring ? "Add alternative answers and explain every allowed score before approving." : "All checks passed. This question is ready to approve.";

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12">
      <Modal open={pendingImport !== null} title="Replace existing marking scheme drafts?" onClose={() => setPendingImport(null)} footer={<>
        <Button onClick={() => setPendingImport(null)}>Keep existing drafts</Button>
        <Button variant="primary" onClick={() => { if (!pendingImport) return; try { saveImportedQuestions(pendingImport, true); } catch (error) { setImportError(error instanceof Error ? error.message : "Import failed."); setPendingImport(null); } }}>Replace drafts & import</Button>
      </>}>
        <p>This will replace the current {assessment.questions.length} questions, their draft marking points and model answer references with {pendingImport?.length || 0} imported questions. Existing draft edits will be removed.</p>
        <p className="mt-3 font-medium">Review the new questions:</p>
        <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto">{pendingImport?.map((item) => <li key={item.question.id} className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">{item.question.number} · {item.question.maxMarks} marks</span><p className="mt-1">{item.question.prompt}</p><p className="mt-1 text-xs text-slate-500">{item.criteria.length} marking points</p></li>)}</ul>
      </Modal>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Assessment preparation</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Marking scheme</h1>
          <p className="mt-1 text-sm text-slate-500">Turn your model answer into a marking guide, then review each question.</p>
        </div>
        <Button onClick={() => setShowImport((open) => !open)}>{showImport ? "Hide upload" : "Upload marking script"}</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" aria-label="Marking scheme workflow">
        {[['1', 'Upload your script', 'Use images, a PDF, or paste your model answer.'], ['2', 'Review each question', 'Check the question, answer and marks.'], ['3', 'Approve the scheme', 'Save a draft, then approve when ready.']].map(([n, title, help]) => (
          <div key={n} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">{n}</span>
            <div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{help}</p></div>
          </div>
        ))}
      </div>

      <details className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Assessment details · {assessment.title || "Untitled assessment"}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">Assessment title<input value={assessment.title} onChange={(e) => actions.updateAssessment(e.target.value, assessment.course)} className={fieldClass} /></label>
          <label className="text-xs font-medium text-slate-600">Course<input value={assessment.course} onChange={(e) => actions.updateAssessment(assessment.title, e.target.value)} className={fieldClass} /></label>
        </div>
      </details>

      {(showImport || assessment.questions.length === 0) && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-base font-semibold text-slate-900">Upload your complete marking script</h2><p className="mt-1 text-sm text-slate-500">Include questions, model answers and marks. AI creates editable rubric drafts for you to review.</p></div>
          <div className="grid gap-5 p-5 md:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col justify-center rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-white text-xl text-indigo-600" aria-hidden="true">↑</span>
              <p className="text-sm font-semibold text-slate-900">
                {schemeFiles.length === 0
                  ? "Choose your answer script"
                  : schemeFiles.length === 1
                    ? schemeFiles[0].name
                    : `${schemeFiles.length} image pages selected`}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {schemeFiles.length > 0 && schemeFiles.every(isImageFile)
                  ? "Ready for Vision OCR — click Generate questions & rubric"
                  : "PNG, JPG, PDF, or TXT · up to 10 pages"}
              </p>
              <label className="mx-auto mt-4 cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                {readingScheme ? "Reading file…" : schemeFiles.length > 0 ? "Choose other files" : "Browse files"}
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,.txt,application/pdf,text/plain" disabled={readingScheme || generatingRubric} className="hidden" onChange={(e) => { void handleSchemeFiles(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            <label className="text-xs font-medium text-slate-600">Or paste / review the script text
              <textarea value={schemeText} onChange={(e) => { setSchemeText(e.target.value); setImportError(""); }} rows={6} aria-label="Full marking scheme text" placeholder={"Q1. Explain encapsulation. (5 marks)\nModel answer: ..."} className={fieldClass} />
              <span className="mt-2 block font-normal leading-5 text-slate-500">Uploaded images and scanned PDFs are read automatically with Vision OCR. Check generated questions and marks before approval.</span>
            </label>
          </div>
          <div className="border-t border-slate-100 px-5 py-4">
            {importError && <p className="mb-3 text-sm text-rose-700" role="alert">{importError}</p>}
            {generatingRubric && <p className="mb-3 text-sm text-indigo-700" role="status">Reading your script and building marking points. This can take a few minutes.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <details className="text-xs text-slate-500"><summary className="cursor-pointer">Have a formatted scheme?</summary><p className="mt-2">Use Q1 | Question | 5 and C1 | Marking point | 5 on separate lines.</p><Button size="sm" className="mt-2" onClick={handleImportScheme} disabled={readingScheme || generatingRubric || !schemeText.trim()}>Import formatted text</Button></details>
              <Button variant="primary" onClick={() => { void handleGenerateRubric(); }} disabled={readingScheme || generatingRubric || (schemeFiles.length === 0 && !schemeText.trim())}>{generatingRubric ? "Creating draft…" : "Generate questions & rubric →"}</Button>
            </div>
          </div>
        </Card>
      )}

      {validationMsg && <Alert tone={validationMsg.ok ? "green" : "amber"} title={validationMsg.ok ? "Saved" : "Please check"}>{validationMsg.msg}</Alert>}

      {assessment.questions.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-500">Prefer to write your own scheme? <button onClick={handleAddQuestion} className="font-semibold text-indigo-700 underline underline-offset-4">Add a question manually</button></div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-24">
            <div className="border-b border-slate-100 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Questions <span className="ml-1 text-slate-400">{assessment.questions.length}</span></h2><p className="mt-1 text-xs text-slate-500">Select a question to edit its rubric.</p></div>
            <div className="space-y-1 p-2">{assessment.questions.map((q) => {
              const approved = rubrics.filter((r) => r.questionId === q.id && r.approved).sort((a,b) => b.version-a.version)[0];
              return <button key={q.id} aria-pressed={q.id === selectedQId} onClick={() => { if (currentQ) actions.saveRubricDraft(currentQ.id, criteria, modelAnswerText, modelImages, subquestions); setSelectedQId(q.id); setOcrMessage(null); }} className={`w-full rounded-lg px-3 py-3 text-left transition ${q.id === selectedQId ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="flex items-center justify-between text-sm font-semibold"><span>{q.number}</span><span className="text-xs">{q.maxMarks} marks</span></span>
                <span className="mt-1 block truncate text-xs opacity-75">{isPlaceholderPrompt(q.prompt) ? "Add question text" : q.prompt}</span>
                <span className={`mt-2 block text-[11px] ${approved ? "text-emerald-700" : "text-slate-500"}`}>{approved ? `Approved · v${approved.version}` : "Draft · review required"}</span>
              </button>;
            })}</div>
            <div className="border-t border-slate-100 p-3"><Button className="w-full" onClick={handleAddQuestion}>+ Add question</Button></div>
          </Card>
          {currentQ && <div className="min-w-0 space-y-5">
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">{currentQ.number} · Question details</h2><Badge tone={activeRubric ? "green" : "amber"}>{activeRubric ? `Approved v${activeRubric.version}` : "Draft"}</Badge></div>
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
                  <h3 className="font-['Plus_Jakarta_Sans'] text-base font-semibold text-[color:var(--x-ink,#111827)]">
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




            <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-900">Answer & mark breakdown</h3><p className="mt-1 text-xs text-slate-500">Review the original answer, then its marks and alternatives for each subquestion.</p></div><Badge tone={isSumValid ? "green" : "amber"}>{criteriaSum} / {qMaxMarks} marks</Badge></div>
            {!subquestions.length && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This earlier draft has no separate original answers for subquestions. Regenerate from the marking script to organise (a), (b), (c) automatically. Your current answer and points are shown below.</p>}
            {(subquestions.length ? subquestions : [{id:"main",label:currentQ.number,prompt:currentQ.prompt,originalAnswer:modelAnswerText,maxMarks:qMaxMarks}]).map(part => <RubricSubquestionEditor
              key={`${selectedQId}-${part.id}`}
              part={part}
              structured={subquestions.length > 0}
              points={subquestions.length ? criteria.filter(c=>c.subquestionId===part.id) : criteria}
              onPartChange={changes => { if (subquestions.length) setSubquestions(subquestions.map(item=>item.id===part.id?{...item,...changes}:item)); else { if (changes.originalAnswer!==undefined) setModelAnswerText(changes.originalAnswer); if(changes.prompt!==undefined || changes.maxMarks!==undefined) actions.updateQuestion(currentQ.id,changes.prompt??currentQ.prompt,changes.maxMarks??currentQ.maxMarks); } }}
              onPointChange={(id,changes)=>setCriteria(criteria.map(item=>item.id===id?{...item,...changes}:item))}
              onRemove={id=>setCriteria(criteria.filter(item=>item.id!==id))}
              onAdd={()=>setCriteria([...criteria,{id:`C${Math.max(0,...criteria.map(c=>Number(c.id.replace(/\D/g,''))||0))+1}`,subquestionId:subquestions.length?part.id:undefined,sourceExcerpt:"",description:"",maxMarks:1,allowedPartialCredits:[0,1],acceptedAlternatives:[],scoringGuide:[{marks:0,description:""},{marks:1,description:""}]}])}
            />)}
            <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div><p className={`text-sm font-medium ${isReadyToApprove ? "text-emerald-700" : "text-slate-700"}`}>{approvalHint}</p><p className="mt-1 text-xs text-slate-500">Approval makes this version available for evaluation.</p></div>
              <div className="flex shrink-0 gap-2"><Button onClick={handleSaveDraft}>Save draft</Button><Button variant="primary" onClick={handleApproveRubric} disabled={!isReadyToApprove}>Approve {currentQ.number}</Button></div>
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}

export default function RubricPage() {
  return <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading marking scheme…</div>}><RubricContent /></Suspense>;
}
