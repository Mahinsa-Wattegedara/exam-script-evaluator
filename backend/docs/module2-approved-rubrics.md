# Approved rubric storage API

Approved rubrics are stored in the existing Supabase `assessments`, `questions`,
`rubrics`, and `criteria` tables. Each approved version contains a complete JSON
snapshot: original question/subquestion answers, source excerpts, marks, alternatives,
and score explanations. Later question edits do not change an older snapshot.

## Database setup

Migration 002 is supplied separately and is intentionally not committed with this
backend change. Keep a local copy for database setup and the optional SQL test below.

1. The existing schema from `001_fixed_er_complete_schema.sql` must already exist.
   **Do not rerun 001 on an existing database: it drops tables.**
2. Run only `supabase/migrations/002_module2_approved_rubrics.sql` in the Supabase SQL
   editor. It adds columns, an atomic approval function, and approval immutability
   triggers without dropping tables or deleting records.
3. Configure `SUPABASE_URL` and either `SUPABASE_SECRET_KEY` or
   `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. These keys stay on the backend.
4. Restart the backend. Missing tables, columns, or RPC produce an actionable HTTP 503.

The migration restricts `rubrics` and `criteria` to the service role; an anonymous
or Supabase authenticated client cannot directly read model answers or invoke approval.
Use these authenticated backend endpoints instead. Existing legacy approvals without
snapshots are not fabricated or silently converted: retrieval reports HTTP 409.

## Authentication

Get a session token with `POST /api/v1/auth/login`, using the existing teacher login
request (`username`, `password`, `role: "TEACHER"`). Send the returned `token` as
`Authorization: Bearer <token>` on every rubric request. Expired/invalid/missing
tokens return 401. Non-teachers return 403. The teacher must also be active in
`app_users` and present in `teachers`.

Assessment ownership is checked in the database. Another teacher's assessment or
rubric returns 404. The approving teacher and approval time come from authenticated
server/database state, never from client-supplied metadata.

## Endpoints

Prefix: `/api/v1/module2/assessments/{assessment_id}/questions/{question_id}/rubrics`

| Method | Suffix | Purpose |
| --- | --- | --- |
| POST | `/approve` | Validate and atomically save a new approved version (201). |
| GET | *(none)* | List approved versions, newest first. |
| GET | `/latest` | Retrieve the latest approved snapshot. |
| GET | `/{version}` | Retrieve an exact immutable version for both evaluators. |

Resource IDs accept letters, digits, underscores and hyphens (maximum 100 characters).
Question IDs are scoped to an assessment, so two assessments can both have `q1`.
Only positive main numbers such as `Q1` and `Q2` are accepted in the question payload.

### Approve a question

Use `examples/approved-rubric.json` as a complete request body. It includes:

- `assessmentTitle` and `course` for creating the assessment on its first approval.
- `expectedVersion`: `0` for the first approval, otherwise the version the teacher
  reviewed (obtain it from `/latest`). Version numbers are allocated by the database.
- `question`: the complete validated rubric returned by rubric generation.

The full request can be sent from `/docs` using **Authorize** and the bearer token.
For example, approve `asm-oop-2026/q1`, then retrieve:

```text
GET /api/v1/module2/assessments/asm-oop-2026/questions/q1/rubrics/1
```

The response includes `rubricId`, `assessmentId`, `questionId`, `version`,
`approvedAt`, `approvedBy` and `question` (the full snapshot).

The server checks both main and subquestion totals, original excerpts, alternatives,
and every allowed score. Marks support at most two decimal places and a maximum of
999.99. Invalid input returns 422 without writing to the database. If two clients
approve from the same prior version, one saves and the other gets 409. Fetch the
latest version and review before resubmitting. A timeout may occur after a successful
database commit: fetch `/latest` before deciding whether to submit again. Do not
increment `expectedVersion` blindly.

The transaction includes assessment creation, question creation/update, version
allocation, criteria and the approved snapshot. Any failure rolls back every write.
Approved rubrics/criteria cannot be edited or deleted; changes require a new version.

## Verification

From `backend`:

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

The Python endpoint tests use mocked Supabase HTTP responses. The additional SQL
integration test uses an isolated in-memory PostgreSQL engine, never the live database:

```powershell
# Run from the repository root; test dependency stays in tmp, outside project packages.
npm install --prefix tmp/rubric-db-test --no-package-lock @electric-sql/pglite
$env:NODE_PATH = (Resolve-Path tmp/rubric-db-test/node_modules).Path
node backend/tests/test_approved_rubrics_db.cjs
```

This tests migration application, database roundtrips, version conflicts, ownership,
immutable approvals, transaction rollback and RPC permissions. It does not replace
applying the migration and testing against your actual Supabase project.

## Frontend integration

These endpoints do not change the UI's browser-only approval flow yet. The existing
Next.js login stores the session in an HttpOnly cookie; a frontend API proxy should
read that cookie and forward it as the backend bearer token. Only show database-save
success after a 201 response. Keep `rubricId` and `version` for evaluator requests.
Reference images are not uploaded by these endpoints; only the structured rubric and
original answer text are persisted.
