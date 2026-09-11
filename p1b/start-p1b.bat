@echo off
chcp 65001 >nul
title P1b sandbox server (port 8787)
cd /d "E:\music player\p1b"
echo ==================================================
echo  P1b sandbox server - REAL LLM mode
echo  DB : p1a-terminal/data/p1a.db (shared with terminal)
echo  URL: http://10.38.23.183:8787   (phone, same Wi-Fi)
echo  Keep this window OPEN while testing.
echo  Stop test: press Ctrl+C, then close window.
echo ==================================================
node src/server.js
echo.
echo [server exited] press any key to close.
pause >nul
