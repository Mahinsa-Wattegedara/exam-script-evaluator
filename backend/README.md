# MidGuard Evaluator — Backend Service (`Module 1`)

FastAPI `0.162.0` backend monolith for the **Exam Script Evaluator** (`ENG-UOM-2026-001`), aligned with SRS Section 4.3 & 4.4 (`ExternalInterfaces.docx`).

## Stack & Version Specifications
- **Language:** Python `3.12+`
- **API Framework:** FastAPI `0.162.0`
- **Validation & Contracts:** Pydantic `v2` (`extra="forbid"`)
- **Agent Orchestration:** LangGraph `1.2.0`
- **ORM & Migrations:** SQLAlchemy `>=2.0.36` + Alembic `>=1.14.0`

## Quick Start
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Module 1 Endpoints
- `GET /health` — Service and version health check
- `POST /api/v1/module1/ocr/mcq` — Header-masked MCQ answer sheet vision extraction with optical-mark fallback (`NFR-06`)

