@echo off
setlocal
cd /d "%~dp0"
title SignBridge launcher

where node >nul 2>nul || (echo [SignBridge] Node.js not found. Install Node 22.12+ and retry. & pause & exit /b 1)

if not exist node_modules (
  echo [SignBridge] node_modules missing - running npm install...
  call npm install || (echo [SignBridge] npm install failed. & pause & exit /b 1)
)

rem 1) Room server: chat + WebSocket on port 3001
netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul
if errorlevel 1 (
  start "SignBridge rooms :3001" cmd /k npm run rooms
) else (
  echo [SignBridge] Room server already running on 3001.
)

rem 2) Website: Vite dev server with local sign models on port 5174
netstat -ano | findstr /R /C:":5174 .*LISTENING" >nul
if errorlevel 1 (
  start "SignBridge web :5174" cmd /k npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
) else (
  echo [SignBridge] Website already running on 5174.
)

echo [SignBridge] Starting... browser opens in 8 seconds.
echo [SignBridge] Keep the two server windows open. Closing them stops the app.
timeout /t 8 /nobreak >nul
start "" http://127.0.0.1:5174/
endlocal
