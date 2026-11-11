@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0Assistente-DECK26.ps1"
if errorlevel 1 pause
