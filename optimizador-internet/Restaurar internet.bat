@echo off
REM ============================================================
REM  Deshace todo lo que hizo el optimizador.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimizador.ps1" -Accion restaurar
