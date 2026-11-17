/**
 * Provisions initial accounts & seed records into your live Supabase PostgreSQL database
 * based on FIXED_ER.pdf and NFR-01 / NFR-02 constraints.
 *
 * Usage:
 *   node tools/provision_supabase.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
const envVars = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) envVars[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";
const AES_RAW = process.env.DATA_AES256_KEY || envVars.DATA_AES256_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in SYSTEM/frontend/.env first.");
  process.exit(1);
}

const AES_KEY = crypto.createHash("sha256").update(AES_RAW).digest();

function encryptAES256(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2_sha256$100000$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function postTable(table, records, onConflict = "") {
  const query = onConflict ? `?on_conflict=${onConflict}` : "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`[WARN] Table ${table} sync: ${res.status} - ${txt.slice(0, 150)}`);
    return null;
  }
  const json = await res.json();
  console.log(`[OK] Table ${table} synced successfully (${records.length} records)`);
  return json;
}

const TEACHER_UID = "a1111111-1111-1111-1111-111111111111";
const STUDENT1_UID = "b2222222-2222-2222-2222-222222222222";
const STUDENT2_UID = "c3333333-3333-3333-3333-333333333333";
const ADMIN_UID = "d4444444-4444-4444-4444-444444444444";

const accounts = [
  {
    user_id: TEACHER_UID,
    username: "dr.silva",
    email: "dr.silva@uom.lk",
    name: "Dr. S. Silva",
    display_name: "Dr. S. Silva (Teacher)",
    password_hash: hashPassword("Teacher@123"),
    role: "TEACHER",
    encrypted_student_id: null,
    encrypted_pseudonym: null,
    is_active: true,
  },
  {
    user_id: STUDENT1_UID,
    username: "245001K",
    email: "245001k@uom.lk",
    name: "Kasun Jayawardena",
    display_name: "Kasun Jayawardena (245001K)",
    password_hash: hashPassword("Student@123"),
    role: "STUDENT",
    encrypted_student_id: encryptAES256("245001K"),
    encrypted_pseudonym: encryptAES256("SCR-7F3A"),
    is_active: true,
  },
  {
    user_id: STUDENT2_UID,
    username: "245017P",
    email: "245017p@uom.lk",
    name: "Nimali Fernando",
    display_name: "Nimali Fernando (245017P)",
    password_hash: hashPassword("Student@123"),
    role: "STUDENT",
    encrypted_student_id: encryptAES256("245017P"),
    encrypted_pseudonym: encryptAES256("SCR-2B91"),
    is_active: true,
  },
  {
    user_id: ADMIN_UID,
    username: "admin",
    email: "admin@uom.lk",
    name: "Project Admin",
    display_name: "Project Admin",
    password_hash: hashPassword("Admin@123"),
    role: "ADMIN",
    encrypted_student_id: null,
    encrypted_pseudonym: null,
    is_active: true,
  },
];

console.log("=== Provisioning FIXED_ER entities into Supabase ===");
await postTable("app_users", accounts, "username");

await postTable("teachers", [
  { teacher_id: TEACHER_UID, department: "Department of Computer Science & Engineering", title_prefix: "Dr." },
], "teacher_id");

await postTable("project_admins", [
  { admin_id: ADMIN_UID, access_level: "SYSTEM_ADMIN" },
], "admin_id");

await postTable("students", [
  { student_id: STUDENT1_UID, pseudonym_code: "SCR-7F3A", admin_id: ADMIN_UID },
  { student_id: STUDENT2_UID, pseudonym_code: "SCR-2B91", admin_id: ADMIN_UID },
], "student_id");

await postTable("assessments", [
  {
    assessment_id: "asm-cs2042-mid-2026",
    teacher_id: TEACHER_UID,
    title: "Mid Semester Examination 2026",
    status: "PUBLISHED",
    retention_days: 365,
  },
], "assessment_id");

await postTable("questions", [
  {
    question_id: "q1",
    assessment_id: "asm-cs2042-mid-2026",
    question_no: 1,
    prompt: "Explain the cognitive benefits of handwriting notes and how handwritten notes can be integrated into an org-mode productivity workflow.",
    max_marks: 4.0,
  },
], "question_id");

await postTable("rubrics", [
  {
    rubric_id: "rub-q1-v1",
    question_id: "q1",
    version: 1,
    approval_status: "APPROVED",
    model_answer_text: "Research suggests note taking is most effective when done by hand. Handwritten notes are retained longer due to deeper cognitive engagement. In terms of hardware, integrating handwritten notes into computer-based productivity workflows like Emacs org-mode can be achieved using optical character recognition or tablet hardware.",
    approved_by: TEACHER_UID,
  },
], "rubric_id");

await postTable("criteria", [
  {
    criterion_id: "crit-q1-c1",
    rubric_id: "rub-q1-v1",
    criterion_no: "C1",
    description: "Key definition / core principle for Q1",
    max_mark: 2.0,
    partial_credit_rules: [0, 1, 2],
    accepted_alternatives: "Standard academic definition or paraphrase",
  },
  {
    criterion_id: "crit-q1-c2",
    rubric_id: "rub-q1-v1",
    criterion_no: "C2",
    description: "Explanation / justification for Q1",
    max_mark: 2.0,
    partial_credit_rules: [0, 1, 2],
    accepted_alternatives: "Grounded technical justification",
  },
], "criterion_id");

await postTable("scripts", [
  {
    script_id: "scr-001",
    assessment_id: "asm-cs2042-mid-2026",
    uploaded_by: TEACHER_UID,
    student_id: STUDENT1_UID,
    pseudonym_code: "SCR-7F3A",
    upload_status: "EXTRACTED",
  },
  {
    script_id: "scr-002",
    assessment_id: "asm-cs2042-mid-2026",
    uploaded_by: TEACHER_UID,
    student_id: STUDENT2_UID,
    pseudonym_code: "SCR-2B91",
    upload_status: "EXTRACTED",
  },
], "script_id");

await postTable("script_images", [
  {
    image_id: "img-scr-001-p1",
    script_id: "scr-001",
    page_number: 1,
    image_url: "/samples/script1_page1.png",
    header_masked: true,
    approval_status: "APPROVED",
    approved_by: TEACHER_UID,
  },
  {
    image_id: "img-scr-002-p1",
    script_id: "scr-002",
    page_number: 1,
    image_url: "/samples/script2_page1.png",
    header_masked: true,
    approval_status: "APPROVED",
    approved_by: TEACHER_UID,
  },
], "image_id");

await postTable("answers", [
  {
    answer_id: "ans-001-q1",
    script_id: "scr-001",
    question_id: "q1",
    transcript_text: "Research suggests that note taking is most effective when done by hand. Yes, handwritten notes. Certainly, typewritten or typed out notes are more efficient, however notes written by hand are retained by the human brain much longer. Integrating handwritten notes into a computer based productivity workflow is tricky, too. In terms of hardware, if all you have is a smartphone, then we need to deal with the situation a bit differently. This talk will introduce to you a simple system to integrate handwritten notes into your org-mode (Emacs) based productivity workflow.",
    transcript_version: 1,
    ocr_confidence: 0.965,
    approval_status: "APPROVED",
    approved_by: TEACHER_UID,
    evidence_spans: [
      { text: "Research suggests that note taking is most effective when done by hand", criterion: "C1", score: 2 },
      { text: "integrate handwritten notes into your org-mode (Emacs) based productivity workflow", criterion: "C2", score: 2 },
    ],
    review_flags: [],
  },
  {
    answer_id: "ans-002-q1",
    script_id: "scr-002",
    question_id: "q1",
    transcript_text: "Taking notes with pen and paper allows better memory retention compared to typing. Although slower, handwritten notes require mental synthesis. Emacs org-mode workflows can incorporate scanned notes or camera captures using OCR tools.",
    transcript_version: 1,
    ocr_confidence: 0.942,
    approval_status: "APPROVED",
    approved_by: TEACHER_UID,
    evidence_spans: [
      { text: "Taking notes with pen and paper allows better memory retention", criterion: "C1", score: 2 },
      { text: "Emacs org-mode workflows can incorporate scanned notes", criterion: "C2", score: 1.5 },
    ],
    review_flags: [],
  },
], "answer_id");

await postTable("evaluations", [
  {
    evaluation_id: "eval-001-a",
    answer_id: "ans-001-q1",
    rubric_id: "rub-q1-v1",
    evaluator_role: "EVALUATOR_A",
    total_marks: 3.5,
    criterion_scores: [{ criterion_id: "crit-q1-c1", marks: 2.0 }, { criterion_id: "crit-q1-c2", marks: 1.5 }],
    justification: "Clear explanation of handwriting benefits and org-mode integration.",
    is_stale: false,
  },
  {
    evaluation_id: "eval-001-b",
    answer_id: "ans-001-q1",
    rubric_id: "rub-q1-v1",
    evaluator_role: "EVALUATOR_B",
    total_marks: 4.0,
    criterion_scores: [{ criterion_id: "crit-q1-c1", marks: 2.0 }, { criterion_id: "crit-q1-c2", marks: 2.0 }],
    justification: "Fully satisfies both criteria with explicit cognitive and workflow details.",
    is_stale: false,
  },
  {
    evaluation_id: "eval-001-mod",
    answer_id: "ans-001-q1",
    rubric_id: "rub-q1-v1",
    evaluator_role: "MODERATOR",
    total_marks: 4.0,
    criterion_scores: [{ criterion_id: "crit-q1-c1", marks: 2.0 }, { criterion_id: "crit-q1-c2", marks: 2.0 }],
    justification: "Consensus resolved at full 4.0 marks based on explicit org-mode evidence.",
    is_stale: false,
  },
], "evaluation_id");

await postTable("results", [
  {
    result_id: "res-001",
    answer_id: "ans-001-q1",
    final_marks: 4.0,
    feedback_text: "Excellent response demonstrating comprehensive understanding of handwritten cognition and Emacs org-mode integration.",
    result_version: 1,
    is_released: true,
  },
], "result_id");

await postTable("teacher_decisions", [
  {
    decision_id: "dec-001",
    answer_id: "ans-001-q1",
    teacher_id: TEACHER_UID,
    result_id: "res-001",
    override_marks: 4.0,
    decision_reason: "Approved automated consensus mark of 4.0 / 4.0 after reviewing evidence spans.",
  },
], "decision_id");

await postTable("student_identity_map", [
  {
    assessment_id: "asm-cs2042-mid-2026",
    student_id: STUDENT1_UID,
    pseudonym_code: "SCR-7F3A",
    encrypted_real_student_id: encryptAES256("245001K"),
  },
  {
    assessment_id: "asm-cs2042-mid-2026",
    student_id: STUDENT2_UID,
    pseudonym_code: "SCR-2B91",
    encrypted_real_student_id: encryptAES256("245017P"),
  },
], "pseudonym_code");

console.log("=== Provisioning Completed ===");
