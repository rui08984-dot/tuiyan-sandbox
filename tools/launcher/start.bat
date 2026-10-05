@echo off
chcp 65001 >nul
rem ============================================================================
rem  P1b green-package launcher (main). Steps 1/8, 2/8 and 3/8 of the eight-step
rem  sequence; steps 4-8 run in launcher\boot.cjs.
rem
rem  ENCODING RULES (all five were measured on 2026-09-30, do not tidy them away):
rem
rem   1) LINES 1-2 MUST STAY "@echo off" + "chcp 65001", in that order.
rem      cmd.exe reads a .bat byte by byte in the current console code page and
rem      re-seeks by byte offset. Any non-ASCII byte before chcp 65001 is read as
rem      GBK, the offsets drift, and the parser lands mid-line.
rem
rem   2) THIS FILE IS ASCII-ONLY. Not even one Chinese character.
rem      Multibyte text inside a .bat makes cmd.exe's offset tracking drift, and the
rem      failure is not "ugly output" but a *silently different program*: whole lines
rem      get chopped and executed as commands ("'over' is not recognized as an
rem      internal or external command"). Measured twice on this very file, and it
rem      only showed up on the A1b path (tree unpacked under a Chinese name with a
rem      space) - which is exactly the case the spec singles out as the make-or-break one.
rem      => All Chinese wording is printed by the Node half (launcher\boot.cjs and
rem         launcher\stop.cjs), which handles UTF-8 correctly. The Chinese first-run
rem         banner lives there. Pinned by pack.test.mjs 5a and 10e.
rem
rem   3) ALL LABELS ARE ASCII. `goto` matches labels byte-wise under chcp 65001, so
rem      a Chinese label is simply unreachable. Measured three times on this file.
rem
rem   4) NO drive letters anywhere, not even in a comment: the release gate scans
rem      every byte of the package and one drive letter turns C2 red. Stepped on it.
rem
rem   5) The shipped .bat is written with CRLF by tools/pack.mjs. With LF only,
rem      cmd.exe breaks every multi-line block. The repo source stays UTF-8 + LF so
rem      `git diff --check` stays clean; the conversion happens at pack time.
rem
rem  Args: %* is forwarded verbatim to boot.cjs -- --no-browser / --debug / --port N
rem  Exit: 0 stopped / 3 data dir or config cannot be created / 4 seed or node missing
rem         5 health check timed out / 7 already running
rem ============================================================================
setlocal EnableExtensions
title P1b sandbox - local workbench

set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
rem  Node resolution (2026-10-05): packages now ship NO bundled node.exe because its
rem    redistribution rights were never cleared. Order:
rem      1) a Node already installed on this machine (where.exe / PATH)  <- new packages
rem      2) runtime\node\node.exe, if this package happens to be an older one
rem    Resolution order is deliberate: a user who has Node installed should use *that*,
rem    so upgrading it is their business, not this package's.
set "NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE set "NODE=%%I"
if not defined NODE if exist "%APPDIR%\runtime\node\node.exe" set "NODE=%APPDIR%\runtime\node\node.exe"
set "BOOT=%APPDIR%\launcher\boot.cjs"
set "SEEDCHK=%APPDIR%\launcher\seedcheck.cjs"

echo ================================================================
echo   P1b sandbox - local workbench
echo   (the Chinese first-run banner is printed further down, by boot.cjs)
echo ================================================================
echo.

rem -- Step 1: resolve the data directory (P1B_DATA_DIR, or the platform default) --
if not defined P1B_DATA_DIR set "P1B_DATA_DIR=%LOCALAPPDATA%\P1bSandbox"
if "%P1B_DATA_DIR:~-1%"=="\" set "P1B_DATA_DIR=%P1B_DATA_DIR:~0,-1%"
if not exist "%P1B_DATA_DIR%\config" mkdir "%P1B_DATA_DIR%\config" 2>nul
if not exist "%P1B_DATA_DIR%\backups" mkdir "%P1B_DATA_DIR%\backups" 2>nul
if not exist "%P1B_DATA_DIR%\logs" mkdir "%P1B_DATA_DIR%\logs" 2>nul
if not exist "%P1B_DATA_DIR%\logs\" goto datafail
echo [1/8] data dir  : %P1B_DATA_DIR%
goto step2

:datafail
echo [1/8] Cannot create the data directory: %P1B_DATA_DIR%
echo        Usual causes: no write permission, or the path is too long / has odd characters.
echo        Fix: set the environment variable P1B_DATA_DIR to a short ASCII path, then retry.
endlocal & exit /b 3

rem -- Step 2: seed DB (only when absent; copy to .tmp, verify integrity_check, then
rem    same-volume rename). ORDER MATTERS: a same-volume rename only guarantees
rem    "all of it or none of it", it does not prove the copy is intact. A truncated DB
rem    renamed into place explodes on the next read, and by then the user believes
rem    setup succeeded.
:step2
if exist "%P1B_DATA_DIR%\p1a.db" goto have_db
copy /y "%APPDIR%\seed\p1a-seed.db" "%P1B_DATA_DIR%\p1a.db.tmp" >nul
if errorlevel 1 goto copyfail
"%NODE%" "%SEEDCHK%" "%P1B_DATA_DIR%\p1a.db.tmp"
if errorlevel 1 goto checkfail
move /y "%P1B_DATA_DIR%\p1a.db.tmp" "%P1B_DATA_DIR%\p1a.db" >nul
if errorlevel 1 goto movefail
>"%P1B_DATA_DIR%\logs\seed-copied.txt" echo seed copied at %DATE% %TIME%
echo [2/8] ledger    : created from the bundled seed DB (verified before it was put in place)
goto step3

:have_db
echo [2/8] ledger    : already there, seed copy skipped
goto step3

:copyfail
echo [2/8] Cannot copy the seed DB (target not writable?): %P1B_DATA_DIR%
endlocal & exit /b 3

:checkfail
del /q "%P1B_DATA_DIR%\p1a.db.tmp" >nul 2>nul
echo [2/8] Seed DB failed integrity_check; the copy was discarded (we never start on a bad DB).
endlocal & exit /b 4

:movefail
del /q "%P1B_DATA_DIR%\p1a.db.tmp" >nul 2>nul
echo [2/8] Seed DB could not be put in place (the rename failed).
endlocal & exit /b 4

rem -- Step 3: config template (only when absent; the template carries NO keys) --
:step3
if exist "%P1B_DATA_DIR%\config\providers.json" goto have_prov
copy /y "%APPDIR%\p1a-terminal\providers.template.json" "%P1B_DATA_DIR%\config\providers.json" >nul
if errorlevel 1 goto provfail
echo [3/8] config    : created empty (no keys; fill one in from the settings page)
goto step4

:have_prov
echo [3/8] config    : already there, left untouched (your keys are never overwritten)
goto step4

:provfail
echo [3/8] Cannot copy the config template: %P1B_DATA_DIR%\config
endlocal & exit /b 3

rem -- Step 4: env injection (env vars only; not one character of source is touched).
rem    P1B_LLM_MOCK is decided by boot.cjs: only when no api_key is filled in.
:step4
set "P1B_DB_PATH=%P1B_DATA_DIR%\p1a.db"
set "P1B_PROVIDERS_PATH=%P1B_DATA_DIR%\config\providers.json"
set "P1B_DIST=1"
if not defined PORT set "PORT=8787"
if not exist "%NODE%" goto nonode
echo [4/8] env       : injected (default port %PORT%; if taken it moves up, 3 tries)
echo [5-8/8] starting the service, health check, opening the browser - run by launcher\boot.cjs:
echo.

"%NODE%" "%BOOT%" %*
set "RC=%ERRORLEVEL%"

rem -- Attribution: a process killed via stop.bat also exits with code 1 on Windows
rem    (TerminateProcess runs no signal handlers). Without this check, stopping the
rem    service on purpose would be reported as a startup failure.
if exist "%P1B_DATA_DIR%\logs\stop-request.flag" goto stoprequested

echo.
if "%RC%"=="0" goto done_ok
echo [launcher exit code %RC%]
echo   3 = every port taken, or the log dir is not writable   4 = bundled Node missing (bad unzip)
echo   5 = health check did not pass within 30s              7 = already running, use stop.bat
echo   Read this file first: %P1B_DATA_DIR%\logs\startup.log
endlocal & exit /b %RC%

:stoprequested
del /q "%P1B_DATA_DIR%\logs\stop-request.flag" >nul 2>nul
echo.
echo Service stopped on request via stop.bat (process exit code %RC%, which is normal on Windows).
echo Your data is still here: %P1B_DATA_DIR%
endlocal & exit /b 0

:done_ok
echo Service stopped. Your data is still here: %P1B_DATA_DIR%
endlocal & exit /b 0

:nonode
echo [5/8] Node not found on this machine, and this package does not bundle one.
echo.
echo   To use this workbench you need Node.js 22.5 or newer. Install it once, then double-click start.bat again.
echo     - Windows official installer: https://nodejs.org/en/download  (choose "LTS", run the .msi, keep the defaults)
echo     - Afterwards, close and reopen this window and run start.bat again.
echo.
echo   Why the package does not bundle a Node.exe: that file is Node's own build, and
echo   redistributing it separately needs permission that was never obtained. The package
echo   only carries this project's own code, which is Apache-2.0.
endlocal & exit /b 4
