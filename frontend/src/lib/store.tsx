"use client";
// Client-side store for the frontend demo. All data is mock data held in the browser
// (localStorage + IndexedDB for uploaded files). No backend calls are made.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clearBlobs, createMaskedCopy, getBlob } from "./image-utils";
import { activeVersion, extractAnswer, nowIso, orderedImages, uid, versionText } from "./logic";
import { buildSeed } from "./seed";
import type { AnswerRecord, FlagType, McqExtraction, PaperType, Rect, ScriptImage, SessionUser, State, UploadFailure, UserRole } from "./types";

const KEY = "m1-enterprise-state-v3";
const ACTOR = "Dr. S. Silva";

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
};
const StoreCtx = createContext<Ctx | null>(null);

function audit(d: State, action: string, detail: string) {
  d.audit.unshift({ id: uid("au"), at: nowIso(), actor: ACTOR, action, detail });
}

function makeActions(mutate: Ctx["mutate"], getState: () => State) {
  const answerById = (d: State, id: string) => d.answers.find((a) => a.id === id)!;
  const code = (d: State, scriptId: string) => d.scripts.find((s) => s.id === scriptId)?.pseudonymousCode ?? "?";
  const qnum = (d: State, qid: string) => d.assessment.questions.find((q) => q.id === qid)?.number ?? qid;

  return {
    reset: async () => {
      localStorage.removeItem(KEY);
      await clearBlobs().catch(() => undefined);
      mutate((d) => Object.assign(d, buildSeed()));
    },

    addQuestion: () =>
      mutate((d) => {
        const nextIdx = d.assessment.questions.length + 1;
        d.assessment.questions.push({
          id: `q${nextIdx}`,
          number: `Q${nextIdx}`,
          prompt: `Question ${nextIdx}`,
          maxMarks: 4,
        });
      }),

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

    setMcqExtraction: (scriptId: string, extraction: McqExtraction) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId);
        if (!s) return;
        s.mcqExtraction = extraction;
        s.pagesConfirmed = true;
        s.mappingConfirmed = true;
        audit(
          d,
          "EXTRACT_MCQ",
          `${s.pseudonymousCode}: extracted ${extraction.items.length} MCQ answer(s) using ${extraction.model}`,
        );
      }),

    updateMcqItem: (scriptId: string, questionNumber: number, selectedOption: string, pageNumber?: number) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId);
        if (!s?.mcqExtraction) return;

        if (s.images.length > 1 && s.mcqExtraction.items.some((i) => i.pageNumber === undefined)) {
          const perPage = Math.ceil(s.mcqExtraction.items.length / s.images.length);
          s.mcqExtraction.items.forEach((it, idx) => {
            if (it.pageNumber === undefined) {
              const imgIdx = Math.min(s.images.length - 1, Math.floor(idx / perPage));
              it.pageNumber = s.images[imgIdx]?.pageNumber ?? (imgIdx + 1);
              if (imgIdx > 0 && it.questionNumber > perPage) {
                it.questionNumber = it.questionNumber - imgIdx * perPage;
              }
            }
          });
        }

        const item = s.mcqExtraction.items.find((i) => {
          const matchQ = i.questionNumber === questionNumber;
          if (!matchQ) return false;
          if (pageNumber !== undefined && i.pageNumber !== undefined) {
            return i.pageNumber === pageNumber;
          }
          return true;
        });
        if (item) {
          if (item.markedOptions && item.markedOptions.length > 1 && !item.markedOptions.includes(selectedOption)) {
            return;
          }
          item.selectedOption = selectedOption;
          item.edited = true;
        }
        s.mcqExtraction.verified = false;
      }),

    verifyMcqExtraction: (scriptId: string) =>
      mutate((d) => {
        const s = d.scripts.find((x) => x.id === scriptId);
        if (!s?.mcqExtraction) return;
        s.mcqExtraction.verified = true;
        audit(
          d,
          "APPROVE_MCQ",
          `${s.pseudonymousCode}: verified ${s.mcqExtraction.items.length} MCQ answer(s) for evaluation`,
        );
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
        const seq = d.regions.filter((r) => r.scriptId === scriptId && r.questionId === questionId).length + 1;
        d.regions.push({ id: uid("reg"), scriptId, imageId, questionId, sequenceOrder: seq, bbox });
        d.scripts.find((s) => s.id === scriptId)!.mappingConfirmed = false;
        audit(d, "MAP", `${code(d, scriptId)}: region mapped to ${qnum(d, questionId)}${seq > 1 ? ` (continuation part ${seq})` : ""}`);
      }),

    reassignRegion: (regionId: string, questionId: string) =>
      mutate((d) => {
        const r = d.regions.find((x) => x.id === regionId)!;
        const old = r.questionId;
        r.questionId = questionId;
        r.sequenceOrder = d.regions.filter((x) => x.scriptId === r.scriptId && x.questionId === questionId && x.id !== r.id).length + 1;
        d.regions
          .filter((x) => x.scriptId === r.scriptId && x.questionId === old)
          .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          .forEach((x, i) => (x.sequenceOrder = i + 1));
        d.scripts.find((s) => s.id === r.scriptId)!.mappingConfirmed = false;
        audit(d, "MAP", `${code(d, r.scriptId)}: corrected mapping ${qnum(d, old)} -> ${qnum(d, questionId)}`);
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
        spans: { id: string; lineNumber: number; text: string; confidence: number }[];
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
                prompt: `Question ${idx + 1}`,
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
                  confidence: sp.confidence,
                  regionId: regs[0]?.id ?? res.questionId,
                  edited: false,
                })),
                rawText: res.rawText,
                extractionStatus: "EXTRACTED",
                ocrEngine: model,
                approvalStatus: "PENDING",
                createdAt: nowIso(),
                flags: res.flags.map((f) => ({
                  id: uid("flag"),
                  type: f.type,
                  message: f.message,
                  spanId: f.spanId,
                  resolved: false,
                })),
              },
            ],
          });
        }
        audit(d, "EXTRACT", `Ran Vision OCR handwriting extraction (${model}) for ${s.pseudonymousCode}`);
      }),

    editSpan: (answerId: string, spanId: string, text: string) =>
      mutate((d) => {
        const v = activeVersion(answerById(d, answerId));
        if (!v || v.approvalStatus !== "PENDING") return;
        const sp = v.spans.find((s) => s.id === spanId);
        if (sp) {
          sp.text = text;
          sp.edited = true;
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
        activeVersion(a)?.flags.filter((f) => f.type === "UNSUPPORTED_CONTENT" || f.type === "EXTRACTION_FAILED").forEach((f) => {
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
        if (prev.length && a.routingStatus === "READY_FOR_AI") {
          d.runs.push({ id: uid("run-eval"), answerId: a.id, boundTranscriptVersion: v.version, kind: "EVALUATION", status: "QUEUED", isStale: false, createdAt: nowIso() });
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
        d.reviewRequests.unshift({
          id: uid("req"),
          studentId,
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
          `Student ${studentId} submitted review request for ${questionNumber} (${issueType}) — queued without altering mark (M4-06)`,
        );
      }),
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
    (async () => {
      let s: State;
      try {
        localStorage.removeItem("m1-enterprise-state-v2");
        const raw = localStorage.getItem(KEY);
        s = raw ? (JSON.parse(raw) as State) : buildSeed();
        if (s.assessment.course === "CS2042 Operating Systems") {
          s.assessment.course = "";
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
      setState(s);
    })();
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(KEY, serialise(state));
    } catch {
      /* quota exceeded - demo keeps working in memory */
    }
  }, [state]);

  const mutate = useCallback((fn: (d: State) => void) => {
    setState((prev) => {
      if (!prev) return prev;
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
  }, []);

  const actionsRef = useRef<ReturnType<typeof makeActions> | null>(null);
  if (!actionsRef.current) actionsRef.current = makeActions(mutate, () => ref.current);

  return (
    <StoreCtx.Provider value={{ state, user, login, register, logout, mutate, actions: actionsRef.current }}>
      {children}
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

