@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-wizard.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0runtime\electron.exe" "%~dp0."
