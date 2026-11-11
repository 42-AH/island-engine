@echo off
cd /d "%~dp0"
if not exist "%~dp0runtime\electron.exe" (
  echo This source download has not been set up yet.
  echo.
  echo Double-click Setup islandengine.cmd to choose your folders.
  echo Or run tools\setup.ps1 with your game library and build tools.
  echo See Source setup in README.md for the command and required paths.
  echo The setup script downloads the complete Electron runtime.
  echo.
  pause
  exit /b 1
)
start "" "%~dp0runtime\electron.exe" "%~dp0."
