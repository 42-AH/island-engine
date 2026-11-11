@echo off
cd /d "%~dp0"
if not exist "runtime\electron.exe" goto setup
if not exist "tools\vendor\jre\bin\java.exe" goto setup
if not exist "tools\vendor\ffdec.jar" goto setup
if not exist "tools\vendor\compiler\AppendAs3Classes.class" goto setup
if not exist "tools\vendor\compiler\AppendAs2Scripts.class" goto setup
if not exist "local.json" goto setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-library.ps1"
if errorlevel 1 goto setup
goto launch
:setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-wizard.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
:launch
start "" "%~dp0runtime\electron.exe" "%~dp0."
