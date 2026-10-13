@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 goto runtime
node scripts\prepare.mjs
exit /b %errorlevel%
:runtime
if not exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" goto missing
set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
node scripts\prepare.mjs
exit /b %errorlevel%
:missing
echo Instale Node.js 22.12 ou superior com npm e tente novamente.
exit /b 1