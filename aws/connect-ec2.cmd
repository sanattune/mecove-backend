@echo off
setlocal

REM Simple wrapper for Windows to run the PowerShell SSM connect script.
REM Example:
REM   aws\connect-ec2.cmd -Profile myprofile -Region ap-south-1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect-ec2.ps1" %*
exit /b %ERRORLEVEL%

