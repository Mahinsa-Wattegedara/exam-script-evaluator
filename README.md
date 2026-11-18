# Exam Script Evaluator

AI-assisted marking for handwritten exam scripts. A teacher uploads photographed or scanned answer pages, the system transcribes them against an official marking scheme, two independent evaluators score each answer, and a teacher resolves disagreements. Students then receive a released mark and feedback on what they covered and what they missed.

University of Moratuwa — Software Engineering project, developed for Xeynergy.

## How a script is marked

1. **Scheme.** The teacher defines questions, marks, and criteria, and uploads a model answer.
2. **Upload.** The teacher adds each script as page images and masks the student identity header before any model sees the page.
3. **Transcripts.** Handwritten answers are extracted, mapped to questions, and approved by the teacher. Approval produces a versioned `AnswerReady` contract.
4. **Marking.** Evaluator A and Evaluator B score the approved transcript independently against the same rubric.
5. **Review.** When the two marks disagree, the answer enters a review queue. The teacher sets the final mark.
6. **Release.** The student sees only their own released mark, criterion-level feedback, and a way to request a review. A review request does not change the mark.

Student identity stays separate from the text sent to the models. Downstream marking uses a pseudonymous script code.

## Modules

Each module has a feature branch.

| Module   | Branch            | Responsibility                                                                                  |
| -------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Module 1 | `feature/Module1` | Script intake, header masking, OCR, region mapping, transcript approval, `AnswerReady` contract |
| Module 2 | `feature/Module2` | Assessment setup, model answer, multi-criterion rubrics and rubric versioning                   |
| Module 3 | `feature/Module3` | Dual evaluation, evidence grounding, discrepancy detection                                      |
| Module 4 | `feature/Module4` | Grounded feedback, releasing results to the student who owns them, review requests              |

## Repository layout

```text
exam-script-evaluator/
├── backend/            FastAPI service (Python 3.12, Pydantic v2)
│   ├── app/            Routes, schemas, OCR and auth services
│   └── supabase/       PostgreSQL schema and seed migration
├── frontend/           Next.js application (React, TypeScript, Tailwind CSS)
│   └── src/            Teacher workspace, student portal, API routes
├── run.ps1             Windows launcher for backend and frontend
└── run.bat             Double-click launcher
```

## Run it locally

From a checkout of `Dev` (or your feature branch).

**Windows, one step.** In the repository root:

```powershell
.\run.ps1
```

That starts the API on port 8000, the web app on port 3000, and opens `http://localhost:3000`.

**Backend**

```bash
cd backend
python -m venv .venv
```

Windows:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

macOS and Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

API: `http://127.0.0.1:8000`. Interactive docs: `http://127.0.0.1:8000/docs`.

Set `GEMINI_API_KEY` in `backend/.env` to run live handwriting extraction. Structured OCR is `POST /api/v1/module1/ocr/structured`. Auth routes are `POST /api/v1/auth/login`, `/register`, and `/session`.

Apply `backend/supabase/migrations/001_fixed_er_complete_schema.sql` to the Supabase project named in that env file. Seed usernames and passwords are in the comments at the bottom of that migration.

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

`BACKEND_URL` defaults to `http://127.0.0.1:8000`. Open `http://localhost:3000`.

## Stack

- **Web:** Next.js, React, TypeScript, Tailwind CSS, `react-image-crop`
- **API:** FastAPI, Pydantic v2, Pillow
- **Vision:** Google Gemini Vision for structured handwriting extraction
- **Data and auth:** Supabase Postgres, row-level security, AES-256-GCM for stored student identity

## Roles

Teachers upload scripts, maintain the marking scheme, approve transcripts, resolve disagreements, and release results. Students see their own released marks and feedback, and can submit a review request. A project admin manages student records. Students never upload scripts, and they never see another student's result.
