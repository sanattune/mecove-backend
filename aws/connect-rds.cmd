@echo off
setlocal

REM Simple wrapper for Windows to run the PowerShell RDS tunnel script.
REM Example:
REM   aws\connect-rds.cmd -Profile myprofile -Region ap-south-1 -LocalPort 15432

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect-rds.ps1" %*
exit /b %ERRORLEVEL%
