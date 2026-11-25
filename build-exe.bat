@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building Pixel Rig Studio... (log: build-exe.log)
call npm run tauri -- build --bundles nsis > build-exe.log 2>&1
set CODE=%ERRORLEVEL%
echo EXIT_CODE=%CODE%>> build-exe.log
echo Done. EXIT_CODE=%CODE%  (see build-exe.log)
timeout /t 20
