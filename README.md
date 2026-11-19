# Exam Script Evaluator

> **AI-Assisted Exam Script Evaluation Platform**  
> University of Moratuwa (UOM) — Software Engineering Project, developed for Xeynergy.

Exam Script Evaluator is an enterprise platform designed for evaluating photographed and scanned handwritten exam answer scripts using evidence-based AI transcription, human moderation, and teacher supervision.

---

## How a script is marked

1. **Scheme.** The teacher defines questions, marks, and criteria, and uploads a model answer.
2. **Upload.** The teacher adds each script as page images and masks the student identity header before any model sees the page.
3. **Transcripts.** Handwritten answers are extracted, mapped to questions, and approved by the teacher. Approval produces a versioned `AnswerReady` contract.
4. **Marking.** Evaluator A and Evaluator B score the approved transcript independently against the same rubric.
5. **Review.** When the two marks disagree, the answer enters a review queue. The teacher sets the final mark.
6. **Release.** The student sees only their own released mark, criterion-level feedback, and a way to request a review. A review request does not change the mark.

Student identity stays separate from the text sent to the models. Downstream marking uses a pseudonymous script code.

---

## Repository Structure

This repository follows a clean full-stack monorepo architecture:

```text
exam-script-evaluator/
├── backend/            # FastAPI backend (Python 3.12+, Pydantic v2, OMR & Gemini Vision)
│   ├── app/            # Service modules, schemas, and API routes
│   ├── requirements.txt
│   └── .env.example
├── frontend/           # Next.js 16.4 web application (React 19, TypeScript, Tailwind CSS)
│   ├── src/            # App shell, teacher workspace, student portal, and components
│   ├── package.json
│   └── .env.example
├── .gitignore          # Global git ignore (environments, build caches, secrets)
└── README.md           # Quick-start guide and system documentation
```

---

## 👥 Team Workflow & Module Branches

The shared baseline / integration branch for development is **`Dev`**. 
Pre-configured branches have been created for each module so you can start immediately without branch configuration:

| Module | Feature Branch | Description |
| :--- | :--- | :--- |
| **Module 1** | `feature/Module1` | Script intake, student identity header masking, OCR/OMR extraction, transcript verification |
| **Module 2** | `feature/Module2` | Assessment setup, model answer upload, multi-criterion rubrics & versioning |
| **Module 3** | `feature/Module3` | Dual evaluation LLM pipeline, evidence grounding & discrepancy detection |
| **Module 4** | `feature/Module4` | Grounded feedback generation, student portal release & dispute resolution |

### 🚀 Getting Started for Teammates

1. **Fetch all remote branches from GitHub**:
   ```bash
   git fetch origin
   ```

2. **Switch to your assigned module branch**:
   ```bash
   # If working on Module 1:
   git checkout feature/Module1

   # If working on Module 2:
   git checkout feature/Module2

   # If working on Module 3:
   git checkout feature/Module3

   # If working on Module 4:
   git checkout feature/Module4
   ```

3. **Daily workflow (Commit & Push)**:
   ```bash
   # Make your changes, then commit:
   git add .
   git commit -m "feat(module): describe what you built"

   # Push your branch to GitHub:
   git push origin <your-branch-name>
   ```

4. **Integration via Pull Requests (PR)**:
   - When a feature is tested and working, open a Pull Request on GitHub from `feature/ModuleX` into **`Dev`**.
   - Always run `npm run build` in `frontend/` before creating a PR to ensure there are no build breaks.
   - Periodically pull latest updates from `Dev` into your branch to stay in sync:
     ```bash
     git fetch origin
     git merge origin/Dev
     ```

---

## Core Security & Verification Features

* **Teacher-Only Intake**: Only teachers upload scripts, mask student headers, map answer regions, and approve transcripts. Students can access only released results and dispute mechanisms.
* **Identity Header Masking**: Interactive bounding box masking (`react-image-crop`) to guarantee student anonymity before AI processing (SRS NFR-02).
* **Handwritten / Structured Answer OCR**: Region mapping, multi-page continuation joining, confidence scoring, and side-by-side transcript review.
* **Prompt Injection & OWASP ASI01 Defense**: Regex and rule-based prompt-injection scanning with isolated `<student_answer_transcript>` XML delimiters and human-in-the-loop review gating (SRS NFR-04).
* **Marking Scheme & Rubrics**: Teacher model answer upload, multi-criterion analytic rubrics with strict sum validation, and immutable rubric versioning.
* **Immutable Contract Generation**: Final teacher approval generates the strictly versioned `AnswerReady` contract for downstream evaluation.

---

## Quick Start Guide

### 🚀 One-Click Start (Windows)

From the root of `SYSTEM`, run:
```powershell
.\run.ps1
```
*Or simply double-click `run.bat` in Windows Explorer.*

This script automatically:
1. Detects your Python `.venv` and launches the **FastAPI Backend** on port 8000 in a dedicated console.
2. Launches the **Next.js Frontend** on port 3000 in a dedicated console.
3. Automatically opens `http://localhost:3000` in your default browser.

---

### Manual Setup Instructions

#### 1. Backend Setup (FastAPI)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   # On Windows:
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1

   # On macOS / Linux:
   python3 -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure environment variables:
   ```bash
   cp .env.example .env
   # Add your GEMINI_API_KEY if testing Gemini Vision extraction
   ```
5. Apply database migration:
   Apply `backend/supabase/migrations/001_fixed_er_complete_schema.sql` to your Supabase project.
6. Start the FastAPI server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   * The API runs at `http://127.0.0.1:8000`
   * Interactive Swagger documentation is available at `http://127.0.0.1:8000/docs`

---

#### 2. Frontend Setup (Next.js)

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   *(Defaults to `BACKEND_URL=http://127.0.0.1:8000`)*
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser at `http://localhost:3000`

---

## Technology Stack

* **Frontend**: Next.js 16.4, React 19, TypeScript, Tailwind CSS, `react-image-crop`, Headless UI
* **Backend**: FastAPI, Python 3.12, Pydantic v2, Pillow, HTTPX
* **AI & Vision**: Deterministic OMR Blob Geometry, Google Gemini Vision API (`gemini-3-flash-preview`)
* **Database & Auth**: Supabase PostgreSQL 15+ (Row-Level Security, AES-256-GCM encryption at rest)

---

## License & Academic Disclaimer

Developed for Xeynergy.
