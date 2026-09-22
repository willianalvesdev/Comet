@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call scripts\preparar.bat
if errorlevel 1 goto erro
"venv\Scripts\python.exe" scripts\configurar_banco.py
if errorlevel 1 goto erro
pause
exit /b 0
:erro
pause
exit /b 1
