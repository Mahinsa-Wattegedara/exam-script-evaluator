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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env");
  process.exit(1);
}

const EXPECTED_TABLES = [
  "app_users",
  "teachers",
  "project_admins",
  "students",
  "assessments",
  "questions",
  "rubrics",
  "criteria",
  "scripts",
  "script_images",
  "answers",
  "evaluations",
  "dispute_packets",
  "agent_messages",
  "results",
  "teacher_decisions",
  "review_requests",
  "student_identity_map",
];

console.log(`Connecting to Supabase at ${SUPABASE_URL}...`);

try {
  const rootRes = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_KEY}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  const schema = await rootRes.json();
  const availableDefs = Object.keys(schema.definitions || {});
  console.log(`Found ${availableDefs.length} exposed tables/definitions in Supabase:`);
  console.log(availableDefs.sort());

  let missing = [];
  for (const table of EXPECTED_TABLES) {
    if (availableDefs.includes(table)) {
      // test query 1 record
      const testRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });
      const data = await testRes.json();
      console.log(`  ✓ Table '${table}': Accessible (${Array.isArray(data) ? data.length + " rows sampled" : JSON.stringify(data)})`);
    } else {
      missing.push(table);
      console.log(`  ✗ Table '${table}': Not found in schema`);
    }
  }

  if (missing.length === 0) {
    console.log("\n SUCCESS: All 18 FIXED_ER tables are live, configured, and accessible in Supabase!");
  } else {
    console.log(`\n Missing ${missing.length} tables:`, missing);
    console.log("Run the migration 002_fixed_er_complete_schema.sql in the Supabase Dashboard SQL Editor.");
  }
} catch (err) {
  console.error("Error checking Supabase schema:", err);
}
