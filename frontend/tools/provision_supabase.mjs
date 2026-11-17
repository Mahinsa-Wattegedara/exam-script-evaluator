/**
 * Provisions initial accounts directly into your live Supabase PostgreSQL database
 * using the keys in SYSTEM/frontend/.env (PBKDF2-HMAC-SHA256 + AES-256-GCM).
 *
 * Run after setting NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env:
 *   node tools/provision_supabase.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
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

const accounts = [
  {
    username: "dr.silva",
    email: "dr.silva@uom.lk",
    password_hash: hashPassword("Teacher@123"),
    role: "TEACHER",
    display_name: "Dr. S. Silva",
    encrypted_student_id: null,
    encrypted_pseudonym: null,
    is_active: true,
  },
  {
    username: "245001K",
    email: "245001k@uom.lk",
    password_hash: hashPassword("Student@123"),
    role: "STUDENT",
    display_name: "Kasun Jayawardena (245001K)",
    encrypted_student_id: encryptAES256("245001K"),
    encrypted_pseudonym: encryptAES256("SCR-7F3A"),
    is_active: true,
  },
  {
    username: "245017P",
    email: "245017p@uom.lk",
    password_hash: hashPassword("Student@123"),
    role: "STUDENT",
    display_name: "Nimali Fernando (245017P)",
    encrypted_student_id: encryptAES256("245017P"),
    encrypted_pseudonym: encryptAES256("SCR-2B91"),
    is_active: true,
  },
];

const res = await fetch(`${SUPABASE_URL}/rest/v1/app_users?on_conflict=username`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(accounts),
});

if (!res.ok) {
  console.error("Failed to provision accounts in Supabase:", res.status, await res.text());
  process.exit(1);
}

console.log("Successfully provisioned encrypted accounts in Supabase public.app_users!");

const identityMappings = [
  {
    assessment_id: "asm-cs2042-mid-2026",
    pseudonymous_script_code: "SCR-7F3A",
    encrypted_real_student_id: encryptAES256("245001K"),
  },
  {
    assessment_id: "asm-cs2042-mid-2026",
    pseudonymous_script_code: "SCR-2B91",
    encrypted_real_student_id: encryptAES256("245017P"),
  },
];

const mapRes = await fetch(`${SUPABASE_URL}/rest/v1/student_identity_map?on_conflict=pseudonymous_script_code`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify(identityMappings),
});

if (mapRes.ok) {
  console.log("Successfully provisioned AES-256 encrypted student_identity_map in Supabase!");
}

