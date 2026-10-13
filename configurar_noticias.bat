@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call scripts\preparar.bat
if errorlevel 1 goto erro
where node >nul 2>&1
if errorlevel 1 set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
call npm.cmd run news:setup
if errorlevel 1 goto erro
pause
exit /b 0
:erro
pause
exit /b 1