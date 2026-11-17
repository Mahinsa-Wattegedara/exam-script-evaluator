<#
.SYNOPSIS
    One-click runner for Exam Script Evaluator (Backend + Frontend).
.DESCRIPTION
    Launches the FastAPI backend on port 8000 and Next.js frontend on port 3000
    in dedicated console windows, then opens the app in your browser.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = $PSScriptRoot
if (-not $Root) { $Root = Get-Location }

$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Exam Script Evaluator — Starting All Services...        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check directories
if (-not (Test-Path $BackendDir) -or -not (Test-Path $FrontendDir)) {
    Write-Error "Could not find 'backend' or 'frontend' directories in $Root"
    exit 1
}

# 2. Determine Python executable in backend
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PythonCmd = $VenvPython
    Write-Host "[✓] Backend virtualenv detected: .venv" -ForegroundColor Green
} else {
    $PythonCmd = "python"
    Write-Host "[!] Backend .venv not found; falling back to system python" -ForegroundColor Yellow
}

# 3. Check frontend node_modules
$NodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[*] First-time setup: installing frontend npm dependencies..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$FrontendDir`" && npm install" -Wait
}

# 4. Start FastAPI Backend in a separate window
Write-Host "[*] Launching Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$BackendScript = @"
`$host.UI.RawUI.WindowTitle = 'ExamEvaluator - Backend (Port 8000)'
Set-Location '$BackendDir'
Write-Host '=========================================' -ForegroundColor Cyan
Write-Host '  FastAPI Backend Server (Port 8000)     ' -ForegroundColor Cyan
Write-Host '  Docs: http://127.0.0.1:8000/docs       ' -ForegroundColor Cyan
Write-Host '=========================================' -ForegroundColor Cyan
& '$PythonCmd' -m uvicorn app.main:app --reload --port 8000
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $BackendScript

# 5. Start Next.js Frontend in a separate window
Write-Host "[*] Launching Frontend on http://localhost:3000 ..." -ForegroundColor Cyan
$FrontendScript = @"
`$host.UI.RawUI.WindowTitle = 'ExamEvaluator - Frontend (Port 3000)'
Set-Location '$FrontendDir'
Write-Host '=========================================' -ForegroundColor Cyan
Write-Host '  Next.js Frontend App (Port 3000)       ' -ForegroundColor Cyan
Write-Host '  URL: http://localhost:3000             ' -ForegroundColor Cyan
Write-Host '=========================================' -ForegroundColor Cyan
npm run dev
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $FrontendScript

# 6. Wait briefly and open browser
Start-Sleep -Seconds 3
Write-Host "`n[✓] Both services are running!" -ForegroundColor Green
Write-Host "    - Frontend:  http://localhost:3000" -ForegroundColor White
Write-Host "    - Backend:   http://127.0.0.1:8000" -ForegroundColor White
Write-Host "    - API Docs:  http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "`nOpening http://localhost:3000 in your browser..." -ForegroundColor Cyan

Start-Process "http://localhost:3000"
Write-Host "`nTo stop the servers, simply close the respective terminal windows.`n" -ForegroundColor DarkGray
