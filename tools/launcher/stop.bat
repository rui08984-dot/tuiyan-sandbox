@echo off
chcp 65001 >nul
rem ============================================================================
rem  P1b - stop the service (keep the data)
rem
rem  See start.bat for the five encoding/syntax rules that apply here too. The two
rem  that bite hardest: this file is ASCII-ONLY, and every label is ASCII.
rem
rem  It calls launcher\stop.cjs, which reads the service's own pid from the data
rem  directory, writes a stop-request marker, and waits until the process is really
rem  gone before reporting success. All Chinese wording is printed by that Node half.
rem
rem  It only stops the service. It deletes nothing: ledger, config, logs, backups stay.
rem
rem  Exit: 0 stopped or was not running / 1 could not kill / 2 no data dir set / 3 still up
rem ============================================================================
setlocal EnableExtensions
title P1b sandbox - stop

set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "NODE=%APPDIR%\runtime\node\node.exe"
set "STOP=%APPDIR%\launcher\stop.cjs"

if not defined P1B_DATA_DIR set "P1B_DATA_DIR=%LOCALAPPDATA%\P1bSandbox"
if "%P1B_DATA_DIR:~-1%"=="\" set "P1B_DATA_DIR=%P1B_DATA_DIR:~0,-1%"

echo Stopping the P1b sandbox service (your data is kept, nothing is deleted)...

if not exist "%NODE%" goto nonode
if not exist "%STOP%" goto nostop

"%NODE%" "%STOP%"
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%

:nonode
echo [stop] Bundled Node not found: runtime\node\node.exe
echo        Fallback: end node.exe in Task Manager (your data is not affected).
endlocal & exit /b 1

:nostop
echo [stop] launcher\stop.cjs not found (this package was not unpacked completely).
endlocal & exit /b 1
