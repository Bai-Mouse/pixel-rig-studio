@echo off
chcp 65001 >nul
cd /d "%~dp0"
set SRC=%~dp0src-tauri\target\release\pixel-rig-studio.exe
set DST=%LOCALAPPDATA%\Pixel Rig Studio\pixel-rig-studio.exe
if not exist "%SRC%" (echo Build not found. Run build-exe.bat first. & pause & exit /b 1)
echo Closing Pixel Rig Studio and updating the installed copy...
taskkill /f /t /im pixel-rig-studio.exe >nul 2>&1
timeout /t 2 /nobreak >nul
copy /y "%SRC%" "%DST%"
if errorlevel 1 (echo Update failed. & pause & exit /b 1)
start "" "%DST%"
echo Done. Pixel Rig Studio updated and started.
timeout /t 5
