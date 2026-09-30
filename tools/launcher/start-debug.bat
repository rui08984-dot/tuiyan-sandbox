@echo off
chcp 65001 >nul
rem ============================================================================
rem  P1b - debug launcher
rem
rem  See start.bat for the five encoding/syntax rules that apply here too. This file
rem  is ASCII-ONLY and every label is ASCII.
rem
rem  It runs the SAME eight-step sequence as start.bat (no second copy of the logic,
rem  because two copies drift apart), and does the three things start.bat does not:
rem    1) appends --debug: boot.cjs prints the port probe, the MOCK decision and
rem       every health-check attempt
rem    2) keeps the window open after the service exits: prints the exit code,
rem       then pauses
rem    3) forwards your own args ahead of --debug (so --no-browser still works)
rem ============================================================================
setlocal EnableExtensions
title P1b sandbox - debug launcher

echo [start-debug] calling start.bat with --debug appended.
echo The window stays open after the service stops, so you can read the error.
echo.

call "%~dp0start.bat" %* --debug
set "RC=%ERRORLEVEL%"

echo.
echo ================================================================
echo   [start-debug] exit code %RC%
echo   Log file: %P1B_DATA_DIR%\logs\startup.log
echo ================================================================
echo The service has stopped. This window stays open on purpose; press any key to close.
pause >nul
endlocal & exit /b %RC%
