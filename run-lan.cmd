@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-lan.ps1" %*
if errorlevel 1 (
    echo.
    echo The LAN server could not be started.
    pause
)
