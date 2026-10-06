@echo off
rem Shows the door screen full screen (no browser bars) and keeps it there:
rem waits for the door server and restarts the screen if it ever closes.
setlocal
set "URL=%~1"
if "%URL%"=="" if exist "%~dp0door-url.txt" set /p URL=<"%~dp0door-url.txt"
if "%URL%"=="" set "URL=http://localhost:8080"
if "%URL:~-1%"=="/" set "URL=%URL:~0,-1%"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" ( echo Microsoft Edge was not found. & pause & exit /b 1 )

:loop
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%URL%/healthz' | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 ( timeout /t 3 /nobreak >nul & goto loop )
start "" /wait "%EDGE%" --kiosk "%URL%/" --edge-kiosk-type=fullscreen --no-first-run --user-data-dir="%LOCALAPPDATA%\DoorScreen" --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch --noerrdialogs
timeout /t 2 /nobreak >nul
goto loop
