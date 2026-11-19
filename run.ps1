# One-click runner for Exam Script Evaluator (Backend + Frontend)
$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Item -Path ".").FullName }

$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Exam Script Evaluator -- Starting All Services...        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify directories
if (-not (Test-Path $BackendDir) -or -not (Test-Path $FrontendDir)) {
    Write-Error "Could not find 'backend' or 'frontend' directories in $Root"
    exit 1
}

# 2. Determine Python executable
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PythonCmd = $VenvPython
    Write-Host "[OK] Backend virtualenv detected: .venv" -ForegroundColor Green
} else {
    $PythonCmd = "python"
    Write-Host "[!] Backend .venv not found; using system python" -ForegroundColor Yellow
}

# 3. Check frontend dependencies
$NodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[*] First-time setup: installing frontend npm dependencies..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$FrontendDir`" && npm install" -Wait
}

# 4. Start FastAPI Backend in a separate window
Write-Host "[*] Launching Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$BackendCmd = "cd /d `"$BackendDir`" && `"$PythonCmd`" -m uvicorn app.main:app --reload --port 8000"
Start-Process "cmd.exe" -ArgumentList "/k title ExamEvaluator - Backend (Port 8000) && $BackendCmd"

# 5. Start Next.js Frontend in a separate window
Write-Host "[*] Launching Frontend on http://localhost:3000 ..." -ForegroundColor Cyan
$FrontendCmd = "cd /d `"$FrontendDir`" && npm run dev"
Start-Process "cmd.exe" -ArgumentList "/k title ExamEvaluator - Frontend (Port 3000) && $FrontendCmd"

# 6. Wait briefly and open browser
Start-Sleep -Seconds 3
Write-Host ""
Write-Host "[OK] Both services are running!" -ForegroundColor Green
Write-Host "    - Frontend:  http://localhost:3000" -ForegroundColor White
Write-Host "    - Backend:   http://127.0.0.1:8000" -ForegroundColor White
Write-Host "    - API Docs:  http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "Opening http://localhost:3000 in your browser..." -ForegroundColor Cyan

Start-Process "http://localhost:3000"
Write-Host "To stop the servers, simply close the respective terminal windows.`n" -ForegroundColor DarkGray
