@echo off
rem Dubbelklik dit bestand (Windows) om alles te laten testen. De uitkomst komt in een map op je bureaublad.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is nodig voor de test. Haal het op via https://nodejs.org ^(de LTS-versie^), installeer het en dubbelklik dit bestand opnieuw.
  pause
  exit /b 1
)
node tools\zelftest\run.js %*
echo.
pause
