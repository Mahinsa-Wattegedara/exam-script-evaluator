@echo off
title Exam Script Evaluator Launcher
cd /d "%~dp0"

echo ==========================================================
echo    Exam Script Evaluator -- Starting All Services...
echo ==========================================================

:: 1. Launch Backend (Port 8000)
echo [*] Launching FastAPI Backend on http://127.0.0.1:8000 ...
if exist "backend\.venv\Scripts\python.exe" (
    start "ExamEvaluator - Backend (Port 8000)" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
) else (
    start "ExamEvaluator - Backend (Port 8000)" cmd /k "cd /d "%~dp0backend" && python -m uvicorn app.main:app --reload --port 8000"
)

:: 2. Launch Frontend (Port 3000)
echo [*] Launching Next.js Frontend on http://localhost:3000 ...
start "ExamEvaluator - Frontend (Port 3000)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: 3. Wait and open browser
echo.
echo [OK] Both services launched in separate windows!
echo     - Frontend:  http://localhost:3000
echo     - Backend:   http://127.0.0.1:8000
echo     - API Docs:  http://127.0.0.1:8000/docs
echo.
echo Opening http://localhost:3000 in your browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo Press any key to exit this launcher window...
pause >nul
