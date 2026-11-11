@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-DECK26.ps1"
if errorlevel 1 pause
