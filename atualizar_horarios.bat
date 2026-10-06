@echo off
cd /d "%~dp0"
venv\Scripts\python.exe scripts\migrar_horarios_financeiros.py
pause
