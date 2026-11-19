// Pure Module 1 domain logic (no React). Builds transcript versions from OCR output,
// raises review flags and assembles the AnswerReady contract.
import { mockOcr } from "./mock-ocr";
import type {
  AnswerReady,
  AnswerRecord,
  AnswerRegion,
  ReviewFlag,
  Script,
  ScriptImage,
  State,
  TextSpan,
  TranscriptVersion,
} from "./types";

export const OCR_ENGINE = "Azure AI Vision Read API v4.0 (mocked in frontend)";
export const LOW_CONFIDENCE = 0.6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_SCRIPT = 10;
export const MAX_SCRIPTS = 100;
export const MAX_QUESTIONS = 10;

let counter = 0;
export function uid(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function pseudonym(): string {
  return "SCR-" + Math.random().toString(16).slice(2, 6).toUpperCase();
}

export const nowIso = () => new Date().toISOString();

export function orderedImages(s: Script): ScriptImage[] {
  return [...s.images].sort((a, b) => a.pageNumber - b.pageNumber);
}

export function regionsForAnswer(state: State, a: AnswerRecord): AnswerRegion[] {
  return a.regionIds
    .map((id) => state.regions.find((r) => r.id === id))
    .filter((r): r is AnswerRegion => !!r)
    .sort((x, y) => x.sequenceOrder - y.sequenceOrder);
}

export function activeVersion(a: AnswerRecord): TranscriptVersion | undefined {
  return a.versions.find((v) => v.version === a.activeVersion);
}

export function latestApproved(a: AnswerRecord): TranscriptVersion | undefined {
  return [...a.versions].reverse().find((v) => v.approvalStatus === "APPROVED");
}

export function versionText(v: TranscriptVersion): string {
  const lines = new Map<number, string[]>();
  for (const s of v.spans) {
    if (!lines.has(s.line)) lines.set(s.line, []);
    lines.get(s.line)!.push(s.text);
  }
  return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.join(" ")).join("\n");
}

function isBlank(spans: TextSpan[]): boolean {
  const text = spans
    .map((s) => s.text)
    .join(" ")
    .replace(/\(?Q\d+\s*(contd\.?)?\)?\.?/gi, "")
    .trim();
  return text.length === 0;
}

const PROMPT_INJECTION_RULES: { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /\b(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+|any\s+|previous\s+|prior\s+|above\s+|the\s+)*(?:instructions?|prompts?|rubrics?|marking\s+schemes?|criteria|rules?)\b/i,
    label: "Instruction / rubric override attempt",
  },
  {
    pattern:
      /\b(?:award|give|assign|grant|output|return|set)\s+(?:me\s+|this\s+answer\s+)*(?:full|maximum|max|100\s*%|all|\d+\s*\/\s*\d+)\s*(?:marks?|scores?|points?|grades?)\b/i,
    label: "Goal hijack / score manipulation directive",
  },
  {
    pattern:
      /(?:\bsystem\s*(?:prompt|override|instruction|message)\b|\bdeveloper\s+mode\b|\bjailbreak\b|\byou\s+are\s+now\s+(?:an?\s+)?(?:evaluator|moderator|grader|assistant)\b|\bact\s+as\s+(?:the\s+)?(?:evaluator|moderator|teacher)\b)/i,
    label: "System / agent role impersonation",
  },
  {
    pattern:
      /(?:<\/?student_answer_transcript>|<\|\s*(?:im_start|im_end|system|endoftext)\s*\|>|```\s*system)/i,
    label: "Delimiter / context escape sequence",
  },
];

/**
 * OWASP Agentic Top 10 (ASI01: Agent Goal Hijack) & NFR-04 prompt-carrier detector.
 * Scans untrusted student transcript text for adversarial instruction patterns.
 */
export function detectPromptInjection(text: string): string | null {
  for (const rule of PROMPT_INJECTION_RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      return `${rule.label} ("${match[0].trim()}")`;
    }
  }
  return null;
}

/** Runs (mock) extraction for an answer and returns version 1 plus blank detection. */
export function extractAnswer(
  regions: AnswerRegion[],
  images: ScriptImage[],
): { version: TranscriptVersion; blankDetected: boolean } {
  const spans: TextSpan[] = [];
  const flags: ReviewFlag[] = [];
  let line = 0;
  let lastContinues = false;
  regions.forEach((r) => {
    const img = images.find((i) => i.id === r.imageId);
    const ocr = mockOcr(img?.sampleKey, r.bbox);
    ocr.lines.forEach((segs) => {
      line += 1;
      segs.forEach(([text, confidence], k) => {
        const id = `L${line}-S${k + 1}`;
        spans.push({ id, line, text, confidence, regionId: r.id });
        const confStr = String(confidence).toUpperCase();
        const isLow =
          (typeof confidence === "number" && confidence < LOW_CONFIDENCE) ||
          confStr === "LOW" ||
          confStr === "UNKNOWN";
        if (isLow) {
          const confLabel = typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : String(confidence);
          flags.push({
            id: uid("flag"),
            type: "UNCLEAR_CHAR",
            spanId: id,
            message: `Low OCR confidence (${confLabel}) for "${text}" on page ${img?.pageNumber}.`,
            resolved: false,
          });
        }
        const inj = detectPromptInjection(text);
        if (inj) {
          flags.push({
            id: uid("flag"),
            type: "PROMPT_INJECTION",
            spanId: id,
            message: `OWASP ASI01 / NFR-04 Alert (Line ${line}): ${inj}. Isolated inside <student_answer_transcript> delimiters — verify or route to manual marking.`,
            resolved: false,
          });
        }
      });
    });
    if (ocr.unsupported) {
      flags.push({ id: uid("flag"), type: "UNSUPPORTED_CONTENT", message: ocr.unsupported, resolved: false });
    }
    lastContinues = !!ocr.continues;
  });
  if (lastContinues) {
    flags.push({
      id: uid("flag"),
      type: "MISSING_PAGE",
      message: "The answer appears to continue (incomplete list at the end of the region) but no continuation region is joined.",
      resolved: false,
    });
  }
  const blankDetected = isBlank(spans);
  if (blankDetected) {
    flags.push({
      id: uid("flag"),
      type: "BLANK_ANSWER",
      message: "No handwriting detected apart from the question label. Confirm before treating this as an attempted answer with no content.",
      resolved: false,
    });
  }
  const v: TranscriptVersion = {
    version: 1,
    spans,
    rawText: "",
    extractionStatus: "EXTRACTED",
    ocrEngine: OCR_ENGINE,
    approvalStatus: "PENDING",
    flags,
    createdAt: nowIso(),
  };
  v.rawText = versionText(v);
  return { version: v, blankDetected };
}

export function unresolvedFlags(v?: TranscriptVersion) {
  return v ? v.flags.filter((f) => !f.resolved) : [];
}

/**
 * NFR-04 Untrusted answer content guardrail:
 * Wraps approved transcript spans inside fixed <student_answer_transcript> XML delimiters
 * and strips any attempt by handwritten text to close or forge the delimiter tag.
 */
export function wrapInStudentAnswerDelimiters(v: TranscriptVersion): string {
  const safeLines = v.spans.map((s, idx) => {
    const lineMatch = s.id?.match(/L(\d+)/i);
    const lineNum = lineMatch ? lineMatch[1] : (s.line ?? idx + 1);
    const sanitized = s.text.replace(/<\/?student_answer_transcript>/gi, "[ESCAPED_DELIMITER]");
    return `[L${lineNum}] ${sanitized}`;
  });
  return `<student_answer_transcript>\n${safeLines.join("\n")}\n</student_answer_transcript>`;
}

export function buildAnswerReady(state: State, a: AnswerRecord): AnswerReady | null {
  const v = latestApproved(a);
  const script = state.scripts.find((s) => s.id === a.scriptId);
  if (!v || !script) return null;
  return {
    contract: "AnswerReady",
    schema_version: "1.0",
    assessment_id: state.assessment.id,
    script_id: script.id,
    pseudonymous_script_code: script.pseudonymousCode,
    question_id: a.questionId,
    transcript_version: v.version,
    approved_text: versionText(v),
    delimited_text: wrapInStudentAnswerDelimiters(v),
    evidence: v.spans.map((s) => {
      const r = state.regions.find((x) => x.id === s.regionId);
      const img = script.images.find((i) => i.id === r?.imageId);
      return {
        span_id: s.id,
        text: s.text,
        page_number: img?.pageNumber ?? 0,
        region_id: s.regionId,
        bbox: r?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
      };
    }),
    approval_status: v.approvalStatus,
    routing_status: a.routingStatus,
  };
}

/** Lifecycle stage of a script for the progress indicator. */
export const STAGES = ["Uploaded", "Pages ordered", "Headers masked", "Answers mapped", "Extracted", "Transcripts approved"] as const;

export function scriptStage(state: State, s: Script): number {
  const answers = state.answers.filter((a) => a.scriptId === s.id);
  const allMasked = s.images.length > 0 && s.images.every((i) => i.maskStatus !== "PENDING");
  if (answers.length && answers.every((a) => a.routingStatus !== "NEEDS_REVIEW" && a.routingStatus !== "NOT_EXTRACTED")) return 6;
  if (answers.length) return 5;
  if (s.mappingConfirmed) return 4;
  if (allMasked && s.pagesConfirmed) return 3;
  if (s.pagesConfirmed) return 2;
  return 1;
}

export type ScriptStatusBadge = {
  label: string;
  tone: "green" | "amber" | "blue" | "slate" | "red" | "indigo";
};

export function scriptStatus(state: State, s: Script): ScriptStatusBadge {
  if (s.batchStatus === "PARTIAL_FAILURE") {
    return { label: "Upload issue", tone: "red" };
  }

  // Structured / Essay handwritten
  const answers = state.answers.filter((a) => a.scriptId === s.id);
  if (
    answers.length > 0 &&
    answers.every((a) => a.routingStatus !== "NEEDS_REVIEW" && a.routingStatus !== "NOT_EXTRACTED")
  ) {
    return { label: "Approved", tone: "green" };
  }
  if (answers.length > 0 && answers.some((a) => a.routingStatus === "NEEDS_REVIEW")) {
    return { label: "Needs review", tone: "amber" };
  }
  if (answers.length > 0) {
    return { label: "Extracted", tone: "blue" };
  }
  if (s.mappingConfirmed) {
    return { label: "Mapped", tone: "indigo" };
  }
  const allMasked = s.images.length > 0 && s.images.every((i) => i.maskStatus !== "PENDING");
  if (allMasked && s.pagesConfirmed) return { label: "Masked", tone: "slate" };
  if (s.pagesConfirmed) return { label: "Pages ordered", tone: "slate" };
  return { label: "Uploaded", tone: "slate" };
}

