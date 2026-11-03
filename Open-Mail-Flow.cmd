@echo off
rem Uses node from PATH instead of a hard-coded install path, so the file works on any machine.
rem Keep this file ASCII-only: cmd reads batch files in the console code page, and Chinese text here
rem breaks the parser on machines that are not UTF-8. Usage notes live in README.md.
cd /d "%~dp0"
node --version >nul 2>nul || goto missing
node "%~dp0automation\run.mjs" mail status
start "" "%~dp0.runtime\mail-flow\today.md"
exit /b

:missing
echo node was not found on PATH. Install Node.js, then make sure its folder is on PATH.
pause
