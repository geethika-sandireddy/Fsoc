@echo off
title ISRO PS-26169 · FSOC Virtual Camera Tracking System
echo =========================================================================
echo Launching ISRO PS-26169 Coarse Alignment Mission Control Workstation...
echo =========================================================================
cd /d "%~dp0"
python main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo PySide6 launch encountered an issue. Launching browser fallback...
    start http://localhost:8000/index.html
    python -m http.server 8000
)
pause
