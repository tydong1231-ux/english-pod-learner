
@echo off
setlocal
title EnglishPod Learner - Engine (Python)

echo ===================================================
echo   EnglishPod Learner - AI Engine (WhisperX GPU)
echo ===================================================
echo.

REM 1. Key Check
if "%HF_TOKEN%"=="" (
    echo [WARNING] HF_TOKEN is not set.
    echo Speaker diarization will be DISABLED.
    echo To enable it, set HF_TOKEN in your shell or .env file before running this script.
    echo.
)

REM 2. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10 or 3.11.
    pause
    exit /b
)

REM 3. Create Virtual Environment if missing
if not exist "venv" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    
    echo [INFO] Installing CUDA Dependencies (This may take a while)...
    echo Installing PyTorch with CUDA 11.8 support...
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
    
    echo [INFO] Installing other requirements...
    pip install -r requirements_windows.txt
) else (
    echo [INFO] Activating virtual environment...
    call venv\Scripts\activate.bat
)

REM 4. Run Server
echo.
echo [INFO] Starting Align Server on port 8765...
echo [INFO] Press Ctrl+C to stop.
echo.
python align_server.py

pause
