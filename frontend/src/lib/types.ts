// Module 1 domain types (frontend view-models). Mirrors the Module 1 ER diagram
// (SCRIPT, SCRIPT_IMAGE, ANSWER_RECORD, ANSWER_REGION, TRANSCRIPT_VERSION,
// TEXT_SPAN_EVIDENCE, REVIEW_FLAG, DOWNSTREAM_EVALUATION_RUN, STUDENT_IDENTITY_MAP).

export type Question = {
  id: string;
  number: string; // "Q1"
  prompt: string;
  maxMarks: number;
};

export type RubricCriterion = {
  id: string; // e.g. "C1", "C2" (REQ-11)
  subquestionId?: string;
  sourceExcerpt?: string;
  description: string;
  maxMarks: number;
  allowedPartialCredits: number[]; // e.g. [0, 0.5, 1.0] (REQ-11)
  acceptedAlternatives: string[]; // e.g. accepted paraphrases (REQ-11)
  scoringGuide?: { marks: number; description: string }[];
};

export type ModelAnswerImage = {
  id: string;
  fileName: string;
  fileFormat: "JPEG" | "PNG";
  fileSizeBytes: number;
  originalUrl: string;
  pageNumber: number;
  width?: number;
  height?: number;
  blobKey?: string;
};

export type RubricSubquestion = {
  id: string;
  label: string;
  prompt: string;
  originalAnswer: string;
  maxMarks: number;
};

export type RubricVersion = {
  subquestions?: RubricSubquestion[];
  version: number; // immutable v1, v2... (REQ-13)
  questionId: string;
  criteria: RubricCriterion[];
  modelAnswerText?: string; // REQ-15 supplemental model answer
  modelAnswerImages?: ModelAnswerImage[]; // Teacher uploaded answer script images
  approved: boolean;
  approvedAt?: string;
  approvedBy?: string;
};

export type Assessment = {
  id: string;
  title: string;
  course: string;
  retentionDays: number;
  questions: Question[]; // input from assessment setup (owned by Module 2) - read-only here
};

/** Percent-based rectangle (0-100) relative to the full page image. */
export type Rect = { x: number; y: number; width: number; height: number };

export type MaskStatus = "PENDING" | "MASKED" | "NO_HEADER";

export type ScriptImage = {
  id: string;
  fileName: string;
  fileFormat: "JPEG" | "PNG";
  fileSizeBytes: number;
  originalUrl: string; // untouched original (M1-02)
  maskedUrl?: string; // header-masked copy sent to providers (M1-01)
  maskRect?: Rect;
  maskStatus: MaskStatus;
  pageNumber: number; // ordered sequence (M1-01)
  width: number; // natural pixel size
  height: number;
  sampleKey?: string; // used by the mock OCR to return realistic text
  blobKey?: string; // uploaded files are kept in IndexedDB (frontend demo only)
};

export type BatchStatus = "COMPLETE" | "PARTIAL_FAILURE";

export type PaperType = "STRUCTURED";

export type Script = {
  id: string;
  pseudonymousCode: string; // e.g. SCR-7F3A
  paperType?: PaperType;
  images: ScriptImage[];
  uploadedAt: string;
  batchStatus: BatchStatus;
  pagesConfirmed: boolean;
  mappingConfirmed: boolean;
};

export type UploadFailure = {
  id: string;
  fileName: string;
  scriptCode: string;
  reason: string;
  at: string;
};

export type AnswerRegion = {
  id: string;
  scriptId: string;
  imageId: string; // page reference (M1-04)
  questionId: string;
  sequenceOrder: number; // joins continuations (M1-03)
  bbox: Rect;
  cropUrl?: string; // masked crop
};

export type FlagType =
  | "UNCLEAR_CHAR"
  | "LOW_CONFIDENCE"
  | "MISSING_PAGE"
  | "UNSUPPORTED_CONTENT"
  | "BLANK_ANSWER"
  | "EXTRACTION_FAILED"
  | "PROMPT_INJECTION";

export type ReviewFlag = {
  id: string;
  type: FlagType;
  message: string;
  spanId?: string;
  resolved: boolean;
  resolution?: string;
};

export type TextSpan = {
  id: string; // e.g. L3-S2 (M1-04)
  line: number;
  text: string;
  confidence: number | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | "unknown"; // Gemini Vision categorical or legacy float
  regionId: string; // traces span to image crop
  edited?: boolean;
};

export type ApprovalStatus = "PENDING" | "APPROVED" | "SUPERSEDED";

export type TranscriptVersion = {
  version: number; // immutable v1, v2 ... (M1-04, M1-06)
  spans: TextSpan[];
  rawText: string; // initial OCR text (M1-02)
  extractionStatus: "EXTRACTED" | "FAILED";
  ocrEngine: string;
  approvalStatus: ApprovalStatus;
  flags: ReviewFlag[];
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  changeReason?: string;
};

export type RoutingStatus =
  | "NOT_EXTRACTED"
  | "NEEDS_REVIEW"
  | "READY_FOR_AI"
  | "MANUAL_MARKING"
  | "NOT_ATTEMPTED";

export type AnswerRecord = {
  id: string;
  scriptId: string;
  questionId: string;
  regionIds: string[];
  blankDetected: boolean;
  blankConfirmed: boolean;
  activeVersion: number;
  versions: TranscriptVersion[];
  routingStatus: RoutingStatus;
};

/** Downstream (Module 2/3/4) evaluation run - mocked here only to demonstrate M1-06 invalidation. */
export type DownstreamRun = {
  id: string;
  answerId: string;
  boundTranscriptVersion: number;
  kind: "EVALUATION" | "FEEDBACK";
  status: "COMPLETED" | "QUEUED";
  isStale: boolean;
  createdAt: string;
  invalidatedAt?: string;
};

export type IdentityMapEntry = {
  pseudonymousCode: string;
  realStudentId: string; // kept separate from model payloads (NFR-02)
  studentName?: string;
};

export type UserRole = "TEACHER" | "STUDENT" | "ADMIN";

export type DemoAccount = {
  id: string;
  name: string;
  identifier: string;
  role: "Teacher" | "Student" | "Administrator";
  status: "Active" | "Paused";
};

export type RuntimeSettings = {
  maxBudgetUsd: string;
  estimatedSpendUsd: string;
  modelProfile: string;
  retryPolicy: string;
  retentionDays: number;
};

export type SessionUser = {
  username: string;
  displayName: string;
  role: UserRole;
  studentId?: string; // for STUDENT role (enforces NFR-01 own-result isolation)
  pseudonymousCode?: string;
};

export type StudentCriterionMark = {
  criterionId: string;
  description: string;
  awarded: number;
  maxMark: number;
  status: "COVERED" | "PARTIAL" | "MISSING";
};

export type StudentQuestionResult = {
  questionId: string;
  questionNumber: string;
  questionPrompt: string;
  maxMarks: number;
  awardedMarks: number;
  resultVersion: number;
  releasedAt: string;
  transcriptVersion: number;
  approvedTranscript: string;
  feedbackText: string; // 40-100 words grounded feedback (M4-03)
  criteria: StudentCriterionMark[];
};

export type StudentReviewRequest = {
  id: string;
  studentId: string;
  questionId: string;
  questionNumber: string;
  issueType: "TRANSCRIPTION_ERROR" | "CRITERION_INTERPRETATION";
  reason: string;
  evidenceSpanIds?: string[];
  status: "PENDING_TEACHER_REVIEW" | "RESOLVED";
  submittedAt: string;
  teacherResolutionNote?: string;
};

export type AuditEvent = { id: string; at: string; actor: string; action: string; detail: string };

export type State = {
  assessment: Assessment;
  rubrics: RubricVersion[];
  scripts: Script[];
  failures: UploadFailure[];
  regions: AnswerRegion[];
  answers: AnswerRecord[];
  runs: DownstreamRun[];
  identityMap: IdentityMapEntry[];
  studentResults: Record<string, StudentQuestionResult[]>; // keyed by studentId
  reviewRequests: StudentReviewRequest[];
  audit: AuditEvent[];
};

/** Output contract of Module 1 (consumed by Module 2). */
export type AnswerReady = {
  contract: "AnswerReady";
  schema_version: "1.0";
  assessment_id: string;
  script_id: string;
  pseudonymous_script_code: string;
  question_id: string;
  transcript_version: number;
  approved_text: string;
  delimited_text: string;
  evidence: { span_id: string; text: string; page_number: number; region_id: string; bbox: Rect }[];
  approval_status: ApprovalStatus;
  routing_status: RoutingStatus;
};
