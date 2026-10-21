@echo off
REM ============================================================
REM  Optimizador de internet - doble clic aca.
REM  Windows va a pedir permiso de administrador: acepta.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimizador.ps1"
