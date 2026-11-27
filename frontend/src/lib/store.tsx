"use client";
// Client-side store for the frontend demo. All data is mock data held in the browser
// (localStorage + IndexedDB for uploaded files). No backend calls are made.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clearBlobs, createMaskedCopy, getBlob } from "./image-utils";
import { activeVersion, detectPromptInjection, extractAnswer, nowIso, orderedImages, uid, versionText } from "./logic";
import { buildSeed, DEFAULT_QUESTIONS } from "./seed";
import type { ImportedQuestion } from "./marking-scheme-import";
import type { AnswerRecord, FlagType, ModelAnswerImage, PaperType, Rect, RubricCriterion, RubricVersion, RubricSubquestion, ScriptImage, SessionUser, State, StudentCriterionMark, TextSpan, UploadFailure, UserRole } from "./types";

const KEY = "scriptx-clean-state-v5";
const ACTOR = "Dr. S. Silva";

const BOILERPLATE_CRITERION_RE =
  /^(Key definition \/ core principle|Primary concept and key definition|Explanation \/ justification|Explanation, evidence, or example|New criterion) for Q\d+$/i;

/** Returns true if a question prompt is empty or still uses an auto-generated "Question N" label. */
export function isPlaceholderPrompt(prompt?: string | null): boolean {
  const trimmed = (prompt || "").trim();
  return !trimmed || /^Question\s+\d+$/i.test(trimmed);
}

/** Converts legacy auto-generated criterion boilerplate descriptions into empty strings. */
export function sanitizeCriterionDescription(description?: string | null): string {
  const raw = description || "";
  return BOILERPLATE_CRITERION_RE.test(raw.trim()) ? "" : raw;
}

type Ctx = {
  state: State;
  user: SessionUser | null;
  login: (username: string, password: string, role: UserRole) => Promise<{ ok: boolean; error?: string }>;
  register: (input: {
    username: string;
    password: string;
    role: UserRole;
    displayName?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  mutate: (fn: (d: State) => void) => void;
  actions: ReturnType<typeof makeActions>;
  flushPersistence: () => { ok: boolean; error?: string };
};
const StoreCtx = createContext<Ctx | null>(null);

function audit(d: State, action: string, detail: string) {
  d.audit.unshift({ id: uid("au"), at: nowIso(), actor: ACTOR, action, detail });
}

/** 81 words for Objects and classes, Encapsulation, and Inheritance. */
function feedbackFromCriteria(criteria: StudentCriterionMark[]): string {
  const awarded = criteria.reduce((sum, row) => sum + row.awarded, 0);
  const max = criteria.reduce((sum, row) => sum + row.maxMark, 0);
  const sentences = criteria.map((row) => {
    if (row.status === "COVERED") {
      return `Your answer included ${row.description}, and that point was fully covered.`;
    }
    if (row.status === "PARTIAL") {
      return `${row.description} was only partly covered: some of the expected detail is present, but not enough to award the full mark for that point.`;
    }
    return `${row.description} was missing, so that point received no marks.`;
  });
  const parts = criteria.map((row) => `${row.awarded} out of ${row.maxMark} for ${row.description}`);
  const breakdown =
    parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${sentences.join(" ")} The released mark for this question is ${awarded} out of ${max}, which is the sum of ${breakdown}.`;
}

export function getPartialOptions(criterion: Pick<RubricCriterion, "allowedPartialCredits" | "maxMarks">): number[] {
  return criterion.allowedPartialCredits
    .filter((mark) => Number.isFinite(mark) && mark > 0 && mark < criterion.maxMarks)
    .sort((a, b) => b - a);
}

function makeActions(mutate: Ctx["mutate"], getState: () => State) {
  const answerById = (d: State, id: string) => d.answers.find((a) => a.id === id)!;
  const code = (d: State, scriptId: string) => d.scripts.find((s) => s.id === scriptId)?.pseudonymousCode ?? "?";
  const qnum = (d: State, qid: string) => d.assessment.questions.find((q) => q.id === qid)?.number ?? qid;

  return {
    updateAssessment: (title: string, course: string) =>
      mutate((d) => {
        d.assessment.title = title;
        d.assessment.course = course;
      }),

    importMarkingScheme: (items: ImportedQuestion[], options?: { replaceDrafts?: boolean }) => {
      const state = getState();
      if (state.scripts.length || state.answers.length || state.rubrics.some((r) => r.approved)) {
        return { ok: false, error: "This assessment has uploaded student scripts or approved rubrics. Its questions cannot be replaced by an import." };
      }
      if (!options?.replaceDrafts && (state.rubrics.length || state.assessment.questions.some((q) => !isPlaceholderPrompt(q.prompt)))) {
        return { ok: false, error: "Review and confirm replacing the existing question and rubric drafts to import this scheme." };
      }
      if (!items.length) return { ok: false, error: "No questions were found to import." };
      mutate((d) => {
        d.assessment.questions = items.map((item) => item.question);
        d.rubrics = items.map((item) => ({
          version: 1,
          questionId: item.question.id,
          criteria: item.criteria,
          subquestions: item.subquestions,
          modelAnswerText: item.modelAnswerText,
          approved: false,
        }));
        audit(d, "IMPORT_MARKING_SCHEME", `Imported ${items.length} question drafts${options?.replaceDrafts ? "; replaced previous drafts after confirmation" : ""}`);
      });
      return { ok: true };
    },

    reset: async () => {
      localStorage.removeItem(KEY);
      localStorage.removeItem("m1-enterprise-state-v3");
      localStorage.removeItem("m1-enterprise-state-v2");
      await clearBlobs().catch(() => undefined);
      mutate((d) => Object.assign(d, buildSeed()));
    },

    ensureDefaultQuestions: () =>
      mutate((d) => {
        if (!d.assessment.questions || d.assessment.questions.length === 0) {
          d.assessment.questions = DEFAULT_QUESTIONS.map((q) => ({ ...q }));
          audit(d, "ASSESSMENT", "Initialized standard questions Q1-Q4");
        }
      }),

    addQuestion: () =>
      mutate((d) => {
        const nextIdx = Math.max(0, ...d.assessment.questions.map((q) => Number(q.number.slice(1)) || 0)) + 1;
        d.assessment.questions.push({
          id: `q${nextIdx}`,
          number: `Q${nextIdx}`,
          prompt: "",
          maxMarks: 4,
        });
      }),

    updateQuestion: (questionId: string, prompt: string, maxMarks: number) =>
      mutate((d) => {
        const q = d.assessment.questions.find((x) => x.id === questionId);
        if (q) {
          q.prompt = prompt;
          q.maxMarks = maxMarks;
        }
      }),

    deleteQuestion: (questionId: string) =>
      mutate((d) => {
        d.assessment.questions = d.assessment.questions.filter((x) => x.id !== questionId);
        d.rubrics = d.rubrics.filter((r) => r.questionId !== questionId);
      }),

    addModelAnswerImage: (questionId: string, image: ModelAnswerImage) =>
      mutate((d) => {
        if (!d.rubrics) d.rubrics = [];
        let r = d.rubrics.find((x) => x.questionId === questionId && !x.approved);
        if (!r) {
          r = {
            version: 1,
            questionId,
            criteria: [],
            modelAnswerImages: [],
            approved: false,
          };
          d.rubrics.push(r);
        }
        if (!r.modelAnswerImages) r.modelAnswerImages = [];
        r.modelAnswerImages.push(image);
        audit(d, "UPLOAD_MODEL_ANSWER_IMAGE", `Uploaded model answer image for ${qnum(d, questionId)}`);
      }),

    removeModelAnswerImage: (questionId: string, imageId: string) =>
      mutate((d) => {
        if (!d.rubrics) return;
        const r = d.rubrics.find((x) => x.questionId === questionId && !x.approved);
        if (r && r.modelAnswerImages) {
          r.modelAnswerImages = r.modelAnswerImages.filter((im) => im.id !== imageId);
        }
      }),

    saveRubricDraft: (
      questionId: string,
      criteria: RubricCriterion[],
      modelAnswerText?: string,
      modelAnswerImages?: ModelAnswerImage[],
      subquestions?: RubricSubquestion[],
    ) =>
      mutate((d) => {
        if (!d.rubrics) d.rubrics = [];
        let r = d.rubrics.find((x) => x.questionId === questionId && !x.approved);
        if (!r) {
          r = {
            version: 1,
            questionId,
            criteria: [],
            approved: false,
          };
          d.rubrics.push(r);
        }
        r.criteria = criteria;
        if (modelAnswerText !== undefined) r.modelAnswerText = modelAnswerText;
        if (modelAnswerImages !== undefined) r.modelAnswerImages = modelAnswerImages;
        if (subquestions !== undefined) r.subquestions = subquestions;
      }),

    approveRubric: (
      questionId: string,
      criteria: RubricCriterion[],
      modelAnswerText?: string,
      modelAnswerImages?: ModelAnswerImage[],
      subquestions?: RubricSubquestion[],
    ) => {
      let result: { ok: boolean; error?: string } = { ok: false, error: "" };
      mutate((d) => {
        if (!d.rubrics) d.rubrics = [];
        const q = d.assessment.questions.find((x) => x.id === questionId);
        if (!q) {
          result = { ok: false, error: "Question not found." };
          return;
        }
        if (isPlaceholderPrompt(q.prompt)) {
          result = {
            ok: false,
            error: "Please enter the question prompt / topic before approving the marking scheme.",
          };
          return;
        }
        if (!criteria.length || criteria.some((c) => !c.description?.trim())) {
          result = {
            ok: false,
            error: "Please enter a description for every marking criterion before approving.",
          };
          return;
        }
        if (criteria.some((c) => !c.acceptedAlternatives.some((answer) => answer.trim()) ||
          !c.scoringGuide || c.scoringGuide.length !== c.allowedPartialCredits.length ||
          new Set(c.scoringGuide.map((entry) => entry.marks)).size !== c.scoringGuide.length ||
          c.scoringGuide.some((entry) => !c.allowedPartialCredits.includes(entry.marks) || !entry.description.trim()))) {
          result = { ok: false, error: "Add valid alternative answers and explain every allowed score for each marking point before approval." };
          return;
        }
        if (new Set(criteria.map((c) => c.id)).size !== criteria.length || criteria.some((c) =>
          !Number.isFinite(c.maxMarks) || c.maxMarks < 0 ||
          !c.allowedPartialCredits.includes(0) || !c.allowedPartialCredits.includes(c.maxMarks) ||
          c.allowedPartialCredits.some((mark) => !Number.isFinite(mark) || mark < 0 || mark > c.maxMarks)
        )) {
          result = { ok: false, error: "Criterion IDs must be unique and allowed marks must include 0 and the criterion maximum within bounds." };
          return;
        }
        // Validate REQ-12: The system shall reject approval when the criterion maxima do not sum to the question maximum
        const sum = Number(criteria.reduce((acc, c) => acc + (Number(c.maxMarks) || 0), 0).toFixed(2));
        const qMax = Number(Number(q.maxMarks).toFixed(2));
        if (Math.abs(sum - qMax) > 0.001) {
          result = {
            ok: false,
            error: `Criteria sum (${sum} marks) must exactly equal question maximum (${qMax} marks) before approval (REQ-12).`,
          };
          return;
        }

        if (subquestions?.length && (
          new Set(subquestions.map(part => part.id)).size !== subquestions.length ||
          Math.abs(subquestions.reduce((sum, part) => sum + part.maxMarks, 0) - qMax) > 0.001 ||
          subquestions.some(part => !part.originalAnswer.trim() || !part.prompt.trim() || !Number.isFinite(part.maxMarks) || part.maxMarks <= 0 || Math.abs(criteria.filter(c => c.subquestionId === part.id).reduce((sum,c) => sum + c.maxMarks, 0) - part.maxMarks) > 0.001) ||
          criteria.some(c => !subquestions.some(part => part.id === c.subquestionId) || !c.sourceExcerpt?.trim())
        )) { result = {ok:false, error:"Each subquestion needs its original answer and a mark breakdown matching its full marks."}; return; }
        const approvedVersions = d.rubrics.filter((x) => x.questionId === questionId && x.approved);
        const nextVer = approvedVersions.length + 1;

        const approvedRubric: RubricVersion = {
          version: nextVer,
          questionId,
          criteria,
          modelAnswerText,
          modelAnswerImages,
          subquestions,
          approved: true,
          approvedAt: nowIso(),
          approvedBy: ACTOR,
        };

        // Remove unapproved draft if any
        d.rubrics = d.rubrics.filter((x) => !(x.questionId === questionId && !x.approved));
        d.rubrics.push(approvedRubric);

        audit(
          d,
          "APPROVE_RUBRIC",
          `Approved Rubric v${nextVer} for ${q.number} (${criteria.length} criteria, ${q.maxMarks} marks total)`,
        );
        result = { ok: true };
      });
      return result;
    },

    addUploads: (
      groups: { scriptId?: string; code: string; realStudentId?: string; paperType?: PaperType; images: ScriptImage[] }[],
      failures: UploadFailure[],
    ) =>
      mutate((d) => {
        for (const g of groups) {
          let s = g.scriptId ? d.scripts.find((x) => x.id === g.scriptId) : d.scripts.find((x) => x.pseudonymousCode === g.code);
          if (!s) {
            s = {
              id: uid("scr"),
              pseudonymousCode: g.code,
              paperType: g.paperType,
              images: [],
              uploadedAt: nowIso(),
              batchStatus: "COMPLETE",
              pagesConfirmed: false,
              mappingConfirmed: false,
            };
            d.scripts.push(s);
          } else if (g.paperType) {
            s.paperType = g.paperType;
          }
          const start = s.images.length;
          g.images.forEach((im, i) => s!.images.push({ ...im, pageNumber: start + i + 1 }));
          s.pagesConfirmed = false;
          const failed = failures.filter((f) => f.scriptCode === g.code).length;
          s.batchStatus = failed ? "PARTIAL_FAILURE" : s.batchStatus;
          if (g.realStudentId && !d.identityMap.some((m) => m.pseudonymousCode === g.code)) {
            d.identityMap.push({ pseudonymousCode: g.code, realStudentId: g.realStudentId });
          }
          audit(d, "UPLOAD", `Uploaded ${g.images.length} image(s) for ${g.code}${failed ? ` - ${failed} failed (PARTIAL_FAILURE)` : ""}`);
        }
        d.failures.unshift(...failures);
      }),

    setScriptPaperType: (scriptId: string, paperType: PaperType) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId);
        if (s) s.paperType = paperType;
      }),

    dismissFailure: (id: string) => mutate((d) => void (d.failures = d.failures.filter((f) => f.id !== id))),

    reorderPages: (scriptId: string, orderedIds: string[]) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        orderedIds.forEach((id, i) => {
          const im = s.images.find((x) => x.id === id);
          if (im) im.pageNumber = i + 1;
        });
        s.pagesConfirmed = false;
      }),

    removePage: (scriptId: string, imageId: string) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        s.images = s.images.filter((i) => i.id !== imageId);
        orderedImages(s).forEach((im, i) => (im.pageNumber = i + 1));
        d.regions = d.regions.filter((r) => r.imageId !== imageId);
        audit(d, "REMOVE_PAGE", `Removed a page from ${s.pseudonymousCode}`);
      }),

    confirmPages: (scriptId: string) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        s.pagesConfirmed = true;
        audit(d, "ORDER", `Confirmed page order for ${s.pseudonymousCode} (${s.images.length} pages)`);
      }),

    applyMask: async (scriptId: string, imageId: string, rect: Rect) => {
      const im = getState().scripts.find((s) => s.id === scriptId)?.images.find((i) => i.id === imageId);
      if (!im) return;
      const maskedUrl = await createMaskedCopy(im.originalUrl, rect);
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        const t = s.images.find((i) => i.id === imageId)!;
        t.maskRect = rect;
        t.maskedUrl = maskedUrl;
        t.maskStatus = "MASKED";
        audit(d, "MASK", `Masked identifying header on ${s.pseudonymousCode} page ${t.pageNumber}`);
      });
    },

    setNoHeader: (scriptId: string, imageId: string) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        const t = s.images.find((i) => i.id === imageId)!;
        t.maskStatus = "NO_HEADER";
        t.maskRect = undefined;
        t.maskedUrl = undefined;
        audit(d, "MASK", `Marked ${s.pseudonymousCode} page ${t.pageNumber} as having no identifying header`);
      }),

    clearMask: (scriptId: string, imageId: string) =>
      mutate((d) => {
        const t = d.scripts.find((x) => x.id === scriptId)!.images.find((i) => i.id === imageId)!;
        t.maskStatus = "PENDING";
        t.maskRect = undefined;
        t.maskedUrl = undefined;
      }),

    addRegion: (scriptId: string, imageId: string, questionId: string, bbox: Rect) =>
      mutate((d) => {
        // Ensure question exists in assessment
        if (!d.assessment.questions.some((q) => q.id === questionId)) {
          const num = questionId.toUpperCase().startsWith("Q") ? questionId.toUpperCase() : `Q${d.assessment.questions.length + 1}`;
          d.assessment.questions.push({
            id: questionId,
            number: num,
            prompt: "",
            maxMarks: 5,
          });
        }

        // M1-03: Support joining multiple continuation regions in sequence order per question
        const existingForQ = d.regions.filter((r) => r.scriptId === scriptId && r.questionId === questionId);
        const nextOrder = existingForQ.length + 1;
        d.regions.push({ id: uid("reg"), scriptId, imageId, questionId, sequenceOrder: nextOrder, bbox });
        audit(
          d,
          "MAP",
          nextOrder > 1
            ? `${code(d, scriptId)}: joined continuation region #${nextOrder} to ${qnum(d, questionId)}`
            : `${code(d, scriptId)}: region mapped to ${qnum(d, questionId)}`,
        );
        const s = d.scripts.find((x) => x.id === scriptId);
        if (s) s.mappingConfirmed = false;
      }),

    updateRegionBbox: (regionId: string, bbox: Rect) =>
      mutate((d) => {
        const r = d.regions.find((x) => x.id === regionId);
        if (!r) return;
        r.bbox = bbox;
        const s = d.scripts.find((x) => x.id === r.scriptId);
        if (s) s.mappingConfirmed = false;
        audit(d, "MAP", `${code(d, r.scriptId)}: updated crop boundaries for ${qnum(d, r.questionId)}`);
      }),

    reassignRegion: (regionId: string, questionId: string) =>
      mutate((d) => {
        const r = d.regions.find((x) => x.id === regionId);
        if (!r || r.questionId === questionId) return;
        const prevQid = r.questionId;
        const targetCount = d.regions.filter(
          (x) => x.scriptId === r.scriptId && x.questionId === questionId && x.id !== regionId,
        ).length;
        r.questionId = questionId;
        r.sequenceOrder = targetCount + 1;
        d.regions
          .filter((x) => x.scriptId === r.scriptId && x.questionId === prevQid)
          .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          .forEach((x, idx) => {
            x.sequenceOrder = idx + 1;
          });
        const s = d.scripts.find((x) => x.id === r.scriptId);
        if (s) s.mappingConfirmed = false;
        audit(d, "MAP", `${code(d, r.scriptId)}: corrected mapping from ${qnum(d, prevQid)} to ${qnum(d, questionId)}`);
      }),

    moveRegion: (regionId: string, dir: -1 | 1) =>
      mutate((d) => {
        const r = d.regions.find((x) => x.id === regionId)!;
        const other = d.regions.find((x) => x.scriptId === r.scriptId && x.questionId === r.questionId && x.sequenceOrder === r.sequenceOrder + dir);
        if (!other) return;
        other.sequenceOrder = r.sequenceOrder;
        r.sequenceOrder += dir;
      }),

    deleteRegion: (regionId: string) =>
      mutate((d) => {
        const r = d.regions.find((x) => x.id === regionId);
        if (!r) return;
        d.regions = d.regions.filter((x) => x.id !== regionId);
        d.regions
          .filter((x) => x.scriptId === r.scriptId && x.questionId === r.questionId)
          .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          .forEach((x, i) => (x.sequenceOrder = i + 1));
        d.scripts.find((s) => s.id === r.scriptId)!.mappingConfirmed = false;
      }),

    /** Confirms mapping and runs (mock) extraction for every question of the script. */
    confirmMappingAndExtract: (scriptId: string) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId)!;
        s.mappingConfirmed = true;
        for (const q of d.assessment.questions) {
          const regs = d.regions.filter((r) => r.scriptId === scriptId && r.questionId === q.id).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
          const existing = d.answers.find((a) => a.scriptId === scriptId && a.questionId === q.id);
          const sameRegions = existing && existing.regionIds.join() === regs.map((r) => r.id).join();
          if (existing && sameRegions) continue;
          if (existing && existing.versions.some((v) => v.approvalStatus === "APPROVED")) continue; // use "edit approved transcript" instead
          if (existing) d.answers = d.answers.filter((a) => a !== existing);
          if (!regs.length) {
            d.answers.push({
              id: uid("ans"), scriptId, questionId: q.id, regionIds: [], blankDetected: false, blankConfirmed: false, activeVersion: 1,
              routingStatus: "NEEDS_REVIEW",
              versions: [{
                version: 1, spans: [], rawText: "", extractionStatus: "FAILED", ocrEngine: "-", approvalStatus: "PENDING", createdAt: nowIso(),
                flags: [{ id: uid("flag"), type: "MISSING_PAGE", message: `No answer region is mapped to ${q.number}. Map the region or confirm the question was not attempted.`, resolved: false }],
              }],
            });
            continue;
          }
          const { version, blankDetected } = extractAnswer(regs, s.images);
          d.answers.push({
            id: uid("ans"), scriptId, questionId: q.id, regionIds: regs.map((r) => r.id), blankDetected, blankConfirmed: false,
            activeVersion: 1, versions: [version], routingStatus: "NEEDS_REVIEW",
          });
        }
        audit(d, "EXTRACT", `Ran handwriting extraction for ${s.pseudonymousCode} (header-masked crops only)`);
      }),

    applyStructuredOcrResults: (
      scriptId: string,
      model: string,
      results: {
        questionId: string;
        questionNumber?: string;
        pageNumber?: number;
        bbox?: Rect;
        rawText: string;
        blankDetected: boolean;
        spans: { id: string; lineNumber: number; text: string; confidence: number | string }[];
        flags: { type: FlagType; message: string; spanId?: string }[];
      }[],
      replaceAllRegions = false,
    ) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId);
        if (!s) return;
        s.mappingConfirmed = true;
        const orderedImgs = orderedImages(s);

        if (replaceAllRegions) {
          d.regions = d.regions.filter((r) => r.scriptId !== scriptId);
          d.answers = d.answers.filter(
            (a) => a.scriptId !== scriptId || a.versions.some((v) => v.approvalStatus === "APPROVED"),
          );
          results.forEach((res, idx) => {
            const existsQ = d.assessment.questions.find((q) => q.id === res.questionId);
            const label = res.questionNumber || `Q${idx + 1}`;
            if (!existsQ) {
              d.assessment.questions.push({
                id: res.questionId,
                number: label,
                prompt: "",
                maxMarks: 4,
              });
            } else {
              existsQ.number = label;
            }
            if (res.bbox && orderedImgs.length > 0) {
              const pageIdx = Math.max(0, Math.min(orderedImgs.length - 1, (res.pageNumber ?? 1) - 1));
              const targetImg = orderedImgs.find((im) => im.pageNumber === res.pageNumber) ?? orderedImgs[pageIdx];
              d.regions.push({
                id: uid("reg"),
                scriptId,
                imageId: targetImg.id,
                questionId: res.questionId,
                sequenceOrder: 1,
                bbox: res.bbox,
              });
            }
          });
        }

        for (const res of results) {
          const regs = d.regions
            .filter((r) => r.scriptId === scriptId && r.questionId === res.questionId)
            .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
          const existing = d.answers.find((a) => a.scriptId === scriptId && a.questionId === res.questionId);
          if (existing && existing.versions.some((v) => v.approvalStatus === "APPROVED")) continue;
          if (existing) d.answers = d.answers.filter((a) => a !== existing);

          const mergedFlags = res.flags.map((f) => ({
            id: uid("flag"),
            type: f.type,
            message: f.message,
            spanId: f.spanId,
            resolved: false,
          }));

          for (const sp of res.spans) {
            const inj = detectPromptInjection(sp.text);
            if (inj && !mergedFlags.some((f) => f.type === "PROMPT_INJECTION" && f.spanId === sp.id)) {
              mergedFlags.push({
                id: uid("flag"),
                type: "PROMPT_INJECTION",
                spanId: sp.id,
                message: `OWASP ASI01 / NFR-04 Alert (Line ${sp.lineNumber}): ${inj}. Isolated inside <student_answer_transcript> delimiters — verify or route to manual marking.`,
                resolved: false,
              });
            }
          }

          if (mergedFlags.some((f) => f.type === "PROMPT_INJECTION")) {
            audit(
              d,
              "SECURITY_ASI01",
              `${s.pseudonymousCode} ${qnum(d, res.questionId)}: OWASP ASI01 prompt-injection carrier flagged during extraction`,
            );
          }

          d.answers.push({
            id: existing?.id ?? uid("ans"),
            scriptId,
            questionId: res.questionId,
            regionIds: regs.map((r) => r.id),
            blankDetected: res.blankDetected,
            blankConfirmed: false,
            activeVersion: 1,
            routingStatus: "NEEDS_REVIEW",
            versions: [
              {
                version: 1,
                spans: res.spans.map((sp) => ({
                  id: sp.id,
                  line: sp.lineNumber,
                  text: sp.text,
                  confidence: sp.confidence as TextSpan["confidence"],
                  regionId: regs[0]?.id ?? res.questionId,
                  edited: false,
                })),
                rawText: res.rawText,
                extractionStatus: "EXTRACTED",
                ocrEngine: model,
                approvalStatus: "PENDING",
                createdAt: nowIso(),
                flags: mergedFlags,
              },
            ],
          });
        }
        audit(d, "EXTRACT", `Ran Vision OCR handwriting extraction (${model}) for ${s.pseudonymousCode}`);
      }),

    editSpan: (answerId: string, spanId: string, text: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        const v = activeVersion(a);
        if (!v || v.approvalStatus !== "PENDING") return;
        const sp = v.spans.find((s) => s.id === spanId);
        if (!sp) return;
        sp.text = text;
        sp.edited = true;
        v.rawText = versionText(v);

        // Re-evaluate OWASP ASI01 prompt-injection flag on edited line
        v.flags = v.flags.filter((f) => !(f.type === "PROMPT_INJECTION" && f.spanId === spanId));
        const inj = detectPromptInjection(text);
        if (inj) {
          v.flags.push({
            id: uid("flag"),
            type: "PROMPT_INJECTION",
            spanId,
            message: `OWASP ASI01 / NFR-04 Alert (Line ${sp.line}): ${inj}. Isolated inside <student_answer_transcript> delimiters — verify or route to manual marking.`,
            resolved: false,
          });
        }
      }),

    resolveFlag: (answerId: string, flagId: string, resolution: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        const f = activeVersion(a)?.flags.find((x) => x.id === flagId);
        if (!f) return;
        f.resolved = true;
        f.resolution = resolution;
        audit(d, "RESOLVE_FLAG", `${code(d, a.scriptId)} ${qnum(d, a.questionId)}: ${f.type} resolved - ${resolution}`);
      }),

    confirmBlank: (answerId: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        a.blankConfirmed = true;
        activeVersion(a)?.flags.filter((f) => f.type === "BLANK_ANSWER").forEach((f) => {
          f.resolved = true;
          f.resolution = "Teacher confirmed: attempted answer with no content.";
        });
        audit(d, "CONFIRM_BLANK", `${code(d, a.scriptId)} ${qnum(d, a.questionId)} confirmed blank`);
      }),

    markNotAttempted: (answerId: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        a.routingStatus = "NOT_ATTEMPTED";
        activeVersion(a)?.flags.forEach((f) => {
          f.resolved = true;
          f.resolution = "Teacher confirmed the question was not attempted.";
        });
        audit(d, "NOT_ATTEMPTED", `${code(d, a.scriptId)} ${qnum(d, a.questionId)} marked as not attempted`);
      }),

    routeManual: (answerId: string, reason: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        a.routingStatus = "MANUAL_MARKING";
        activeVersion(a)
          ?.flags.filter(
            (f) => f.type === "UNSUPPORTED_CONTENT" || f.type === "EXTRACTION_FAILED" || f.type === "PROMPT_INJECTION",
          )
          .forEach((f) => {
            f.resolved = true;
            f.resolution = reason;
          });
        audit(d, "MANUAL", `${code(d, a.scriptId)} ${qnum(d, a.questionId)} routed to manual marking: ${reason}`);
      }),

    approve: (answerId: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        const v = activeVersion(a);
        if (!v) return;
        const prev = a.versions.filter((x) => x.approvalStatus === "APPROVED");
        prev.forEach((p) => (p.approvalStatus = "SUPERSEDED"));
        v.approvalStatus = "APPROVED";
        v.approvedAt = nowIso();
        v.approvedBy = `${ACTOR} (teacher)`;
        if (a.routingStatus !== "MANUAL_MARKING") a.routingStatus = "READY_FOR_AI";
        // M1-06: dependent evaluations / feedback bound to older versions become stale (never deleted).
        let staled = 0;
        d.runs.forEach((r) => {
          if (r.answerId === a.id && r.boundTranscriptVersion < v.version && !r.isStale) {
            r.isStale = true;
            r.invalidatedAt = nowIso();
            staled += 1;
          }
        });
        if (
          a.routingStatus === "READY_FOR_AI" &&
          !d.runs.some((r) => r.answerId === a.id && r.boundTranscriptVersion === v.version && !r.isStale)
        ) {
          d.runs.push({
            id: uid("run-eval"),
            answerId: a.id,
            boundTranscriptVersion: v.version,
            kind: "EVALUATION",
            status: "QUEUED",
            isStale: false,
            createdAt: nowIso(),
          });
        }
        audit(d, "APPROVE", `${code(d, a.scriptId)} ${qnum(d, a.questionId)}: approved transcript v${v.version}${staled ? `; ${staled} downstream run(s) marked stale, new evaluation run queued` : ""}`);
      }),

    /** M1-06: editing an approved transcript creates a new pending version. */
    startNewVersion: (answerId: string, reason: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        const base = activeVersion(a);
        if (!base) return;
        const n = Math.max(...a.versions.map((v) => v.version)) + 1;
        a.versions.push({
          ...structuredClone(base),
          version: n,
          approvalStatus: "PENDING",
          approvedAt: undefined,
          approvedBy: undefined,
          createdAt: nowIso(),
          changeReason: reason,
          spans: base.spans.map((s) => ({ ...s, edited: false })),
          flags: [],
          rawText: base.rawText,
        });
        a.activeVersion = n;
        a.routingStatus = "NEEDS_REVIEW";
        audit(d, "NEW_VERSION", `${code(d, a.scriptId)} ${qnum(d, a.questionId)}: created transcript v${n} from approved v${base.version} - ${reason}`);
      }),

    discardDraft: (answerId: string) =>
      mutate((d) => {
        const a = answerById(d, answerId);
        const v = activeVersion(a);
        if (!v || v.approvalStatus !== "PENDING" || v.version === 1) return;
        a.versions = a.versions.filter((x) => x !== v);
        const back = [...a.versions].reverse().find((x) => x.approvalStatus === "APPROVED");
        a.activeVersion = back?.version ?? 1;
        a.routingStatus = back ? "READY_FOR_AI" : "NEEDS_REVIEW";
      }),

    submitReviewRequest: (
      studentId: string,
      questionId: string,
      questionNumber: string,
      issueType: "TRANSCRIPTION_ERROR" | "CRITERION_INTERPRETATION",
      reason: string,
      evidenceSpanIds?: string[],
    ) =>
      mutate((d) => {
        const id = studentId.trim();
        if (!id) return;
        const released = (d.studentResults?.[id] ?? []).some((r) => r.questionId === questionId);
        if (!released) return;
        if (
          d.reviewRequests.some(
            (r) => r.studentId === id && r.questionId === questionId && r.status === "PENDING_TEACHER_REVIEW",
          )
        )
          return;

        d.reviewRequests.unshift({
          id: uid("req"),
          studentId: id,
          questionId,
          questionNumber,
          issueType,
          reason,
          evidenceSpanIds: evidenceSpanIds?.length ? evidenceSpanIds : undefined,
          status: "PENDING_TEACHER_REVIEW",
          submittedAt: nowIso(),
        });
        audit(
          d,
          "APPEAL",
          `Student ${id} submitted review request for ${questionNumber} (${issueType}) — queued without altering mark (M4-06)`,
        );
      }),

    resolveReviewRequest: (requestId: string, note: string) =>
      mutate((d) => {
        const id = requestId.trim();
        const text = note.trim();
        if (!id || !text) return;
        const req = d.reviewRequests.find((r) => r.id === id);
        if (!req || req.status !== "PENDING_TEACHER_REVIEW") return;
        req.status = "RESOLVED";
        req.teacherResolutionNote = text;
        audit(
          d,
          "RESOLVE",
          `Student ${req.studentId} review for ${req.questionNumber} resolved; mark was not changed`,
        );
      }),

    reviseReleasedMark: (studentId: string, awardedMarks: number) => {
      let result: { ok: true } | { ok: false; error: string } = { ok: false, error: "" };
      mutate((d) => {
        const id = studentId.trim();
        if (!id) {
          result = { ok: false, error: "Enter a student ID before updating a released mark." };
          return;
        }
        const q = d.assessment.questions[0];
        if (!q) {
          result = { ok: false, error: "Q1 is not configured in this assessment." };
          return;
        }
        const rows = (d.studentResults?.[id] ?? []).filter((r) => r.questionId === q.id);
        if (!rows.length) {
          result = { ok: false, error: `No released Q1 result was found for student ${id}.` };
          return;
        }
        const latest = rows.reduce((a, b) => (b.resultVersion > a.resultVersion ? b : a));
        if (!Number.isFinite(awardedMarks)) {
          result = { ok: false, error: "Enter a numeric mark to update the released result." };
          return;
        }
        if (awardedMarks < 0) {
          result = { ok: false, error: "The updated mark cannot be below 0." };
          return;
        }
        if (awardedMarks > latest.maxMarks) {
          result = { ok: false, error: `The updated mark cannot exceed ${latest.maxMarks}.` };
          return;
        }
        if (!Number.isInteger(awardedMarks)) {
          result = { ok: false, error: "Enter a whole-number mark." };
          return;
        }
        if (awardedMarks === latest.awardedMarks) {
          result = { ok: false, error: "The new mark is unchanged from the currently released mark." };
          return;
        }
        const next = structuredClone(latest);
        next.resultVersion = latest.resultVersion + 1;
        next.awardedMarks = awardedMarks;
        next.releasedAt = nowIso();
        next.feedbackText = `The released mark for this question is now ${awardedMarks} out of ${latest.maxMarks}.`;
        (d.studentResults![id] ??= []).push(next);
        audit(
          d,
          "MARK_REVISED",
          `Student ${id} ${latest.questionNumber}: mark ${latest.awardedMarks} → ${awardedMarks}, resultVersion ${next.resultVersion}`,
        );
        result = { ok: true };
      });
      return result;
    },

    releaseResult: (
      studentId: string,
      statuses: Record<string, "" | "COVERED" | "PARTIAL" | "MISSING">,
      partialMarks: Record<string, number | undefined>,
    ) => {
      let result: { ok: true } | { ok: false; error: string } = { ok: false, error: "" };
      mutate((d) => {
        const id = studentId.trim();
        if (!id) {
          result = { ok: false, error: "Enter a student ID before releasing Q1." };
          return;
        }
        const q = d.assessment.questions[0];
        if (!q) {
          result = { ok: false, error: "Q1 is not configured in this assessment." };
          return;
        }
        if ((d.studentResults?.[id] ?? []).some((r) => r.questionId === q.id)) {
          result = { ok: false, error: `Q1 has already been released to ${id}. Use Update released mark to change the result.` };
          return;
        }

        const rubric = d.rubrics
          .filter((r) => r.questionId === q.id && r.approved)
          .sort((a, b) => b.version - a.version)[0];
        if (!rubric) {
          result = { ok: false, error: "Approve a Q1 marking scheme before releasing results." };
          return;
        }
        if (!rubric.criteria.length) {
          result = { ok: false, error: "The approved Q1 marking scheme has no criteria to release." };
          return;
        }

        const criteria: StudentCriterionMark[] = [];
        for (const rc of rubric.criteria) {
          const status = statuses?.[rc.id];
          if (status !== "COVERED" && status !== "PARTIAL" && status !== "MISSING") {
            result = { ok: false, error: `Choose Covered, Partial, or Missing for criterion ${rc.id}.` };
            return;
          }

          let awarded: number;
          if (status === "COVERED") {
            awarded = rc.maxMarks;
          } else if (status === "MISSING") {
            awarded = 0;
          } else {
            const partialOptions = getPartialOptions(rc);
            if (!partialOptions.length) {
              result = { ok: false, error: `Criterion ${rc.id} has no partial mark in the approved scheme. Choose Covered or Missing.` };
              return;
            }
            const selectedPartialMark = partialMarks?.[rc.id];
            if (selectedPartialMark === undefined) {
              result = { ok: false, error: `Choose a partial mark for criterion ${rc.id}.` };
              return;
            }
            if (!partialOptions.includes(selectedPartialMark)) {
              result = { ok: false, error: `The selected partial mark for criterion ${rc.id} is not allowed by the approved scheme.` };
              return;
            }
            awarded = selectedPartialMark;
          }

          criteria.push({
            criterionId: rc.id,
            description: rc.description,
            awarded,
            maxMark: rc.maxMarks,
            status,
          });
        }

        if (!d.studentResults) d.studentResults = {};
        const awardedMarks = criteria.reduce((sum, row) => sum + row.awarded, 0);
        const maxMarks = criteria.reduce((sum, row) => sum + row.maxMark, 0);
        (d.studentResults[id] ??= []).push({
          questionId: q.id,
          questionNumber: q.number,
          questionPrompt: q.prompt,
          maxMarks,
          awardedMarks,
          resultVersion: 1,
          releasedAt: nowIso(),
          transcriptVersion: 1,
          approvedTranscript: "",
          feedbackText: feedbackFromCriteria(criteria),
          criteria,
        });
        audit(d, "RELEASE", `Released Q1 to student ${id}`);
        result = { ok: true };
      });
      return result;
    },
  };
}

function serialise(s: State): string {
  // Uploaded files live in IndexedDB; object URLs are not persisted.
  const copy = structuredClone(s);
  copy.scripts.forEach((sc) => sc.images.forEach((im) => im.blobKey && (im.originalUrl = "")));
  return JSON.stringify(copy);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => buildSeed());
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const ref = useRef<State>(state);
  ref.current = state;

  const login = useCallback(
    async (username: string, password: string, role: UserRole): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, role }),
        });
        const data = (await res.json()) as { ok: boolean; user?: SessionUser; error?: string };
        if (!res.ok || !data.ok || !data.user) {
          return { ok: false, error: data.error || "Authentication failed." };
        }
        setUser(data.user);
        return { ok: true };
      } catch {
        return { ok: false, error: "Could not reach authentication server." };
      }
    },
    [],
  );

  const register = useCallback(
    async (input: {
      username: string;
      password: string;
      role: UserRole;
      displayName?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = (await res.json()) as { ok: boolean; user?: SessionUser; error?: string };
        if (!res.ok || !data.ok || !data.user) {
          return { ok: false, error: data.error || "Could not create account." };
        }
        setUser(data.user);
        return { ok: true };
      } catch {
        return { ok: false, error: "Could not reach authentication server." };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s: State;
      try {
        localStorage.removeItem("m1-enterprise-state-v3");
        localStorage.removeItem("m1-enterprise-state-v2");
        const raw = localStorage.getItem(KEY);
        s = raw ? (JSON.parse(raw) as State) : buildSeed();
        if (!s.rubrics) {
          s.rubrics = [];
        } else {
          s.rubrics = s.rubrics.map((r) =>
            r.approved
              ? r
              : {
                  ...r,
                  criteria: (r.criteria || []).map((c) => ({
                    ...c,
                    description: sanitizeCriterionDescription(c.description),
                  })),
                },
          );
        }
        if (!s.assessment.questions || s.assessment.questions.length === 0) {
          s.assessment.questions = DEFAULT_QUESTIONS.map((q) => ({ ...q }));
        } else {
          s.assessment.questions = s.assessment.questions.map((q) => ({
            ...q,
            prompt: isPlaceholderPrompt(q.prompt) ? "" : q.prompt,
          }));
        }
        if (!s.assessment.course || s.assessment.course === "CS2042 Operating Systems") {
          s.assessment.course = "Object Oriented Programming";
        }
      } catch {
        s = buildSeed();
      }
      for (const sc of s.scripts) {
        for (const im of sc.images) {
          if (im.blobKey) {
            const b = await getBlob(im.blobKey).catch(() => undefined);
            im.originalUrl = b ? URL.createObjectURL(b) : "";
          }
        }
      }
      // regenerate masked copies (not persisted for seeded samples)
      for (const sc of s.scripts) {
        for (const im of sc.images) {
          if (im.maskStatus === "MASKED" && im.maskRect && !im.maskedUrl && im.originalUrl) {
            im.maskedUrl = await createMaskedCopy(im.originalUrl, im.maskRect).catch(() => undefined);
          }
        }
      }
      try {
        const sess = await fetch("/api/auth/session", { cache: "no-store" });
        if (sess.ok) {
          const j = (await sess.json()) as { authenticated: boolean; user: SessionUser | null };
          if (j.authenticated && j.user) setUser(j.user);
        }
      } catch {
        // Not signed in
      }
      if (cancelled) return;
      ref.current = s;
      setState(s);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const flushPersistence = useCallback(() => {
    try {
      localStorage.setItem(KEY, serialise(ref.current));
      setStorageError(null);
      return { ok: true };
    } catch {
      const error = "Changes could not be saved in this browser. Browser storage may be full or disabled. Keep this page open and reduce large reference attachments or enable site storage before retrying.";
      setStorageError(error);
      return { ok: false, error };
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    flushPersistence();
  }, [state, ready, flushPersistence]);

  const mutate = useCallback((fn: (d: State) => void) => {
    const d = structuredClone(ref.current);
    fn(d);
    ref.current = d;
    setState(d);
  }, []);

  const actionsRef = useRef<ReturnType<typeof makeActions> | null>(null);
  if (!actionsRef.current) actionsRef.current = makeActions(mutate, () => ref.current);

  return (
    <StoreCtx.Provider value={{ state, user, login, register, logout, mutate, actions: actionsRef.current, flushPersistence }}>
      {storageError && <div role="alert" className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">{storageError}</div>}
      {ready ? children : <div role="status" className="p-8 text-center text-sm text-slate-500">Loading saved assessment…</div>}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside provider");
  return c;
}

export { versionText };
export type { AnswerRecord };

