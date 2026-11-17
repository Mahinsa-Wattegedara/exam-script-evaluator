# Exam Script Evaluator

> **AI-Assisted Exam Script Evaluation Platform**  
> University of Moratuwa (UOM) — Software Engineering Project

Exam Script Evaluator is an enterprise platform designed for evaluating photographed and scanned handwritten exam answer scripts using evidence-based AI transcription, human moderation, and teacher supervision.

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

## Core Capabilities (Module 1 — Script Intake & Answer Evidence)

* **Teacher-Only Intake**: Only teachers upload scripts, mask student headers, map answer regions, and approve transcripts. Students can access only released results and dispute mechanisms.
* **Identity Header Masking**: Interactive bounding box masking (`react-image-crop`) to guarantee student anonymity before AI processing (SRS NFR-02).
* **Handwritten / Structured Answer OCR**: Region mapping, multi-page continuation joining, confidence scoring, and side-by-side transcript review.
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

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   # On Windows:
   python -m venv .venv
   .venv\Scripts\activate

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
5. Start the FastAPI server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   * The API runs at `http://127.0.0.1:8000`
   * Interactive Swagger documentation is available at `http://127.0.0.1:8000/docs`

---

### 2. Frontend Setup (Next.js)

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

Developed for Xeynergy 
