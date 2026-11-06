@echo off
setlocal
cd /d "%~dp0"
title SignBridge launcher

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
if errorlevel 1 (
  echo [SignBridge] Startup failed. Read the message above.
  pause
  exit /b 1
)
endlocal
