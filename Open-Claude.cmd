@echo off
rem Launches Claude Code from PATH instead of a hard-coded install path, so the file works on any
rem machine. Keep this file ASCII-only: cmd reads batch files in the console code page, and Chinese
rem text here breaks the parser on machines that are not UTF-8. Usage notes live in README.md.
cd /d "%~dp0"
call claude --version >nul 2>nul || goto missing
call claude %*
exit /b

:missing
echo claude was not found on PATH. Install Claude Code, then make sure its folder is on PATH.
pause
