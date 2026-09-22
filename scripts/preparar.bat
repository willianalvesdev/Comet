@echo off
setlocal
cd /d "%~dp0.."
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" scripts\bootstrap.py
    exit /b
)
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
    py -3 scripts\bootstrap.py
    exit /b
)
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
    python scripts\bootstrap.py
    exit /b
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\bootstrap.py
    exit /b
)
echo Instale Python 3.10 ou superior e tente novamente.
exit /b 1
