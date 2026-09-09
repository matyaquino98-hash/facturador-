@echo off
REM ============================================================
REM  Facturador - Facturacion electronica ARCA
REM  Doble clic aca para abrir el programa.
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Facturador - no cierres esta ventana

echo.
echo   Facturador - Facturacion electronica ARCA
echo   =========================================
echo.

REM ---- 1. Node incluido en la carpeta (si esta) ----
set NODE=
if exist "node.exe" set NODE=%~dp0node.exe

REM ---- 2. Node ya instalado en la maquina ----
if "%NODE%"=="" (
  where node >nul 2>&1
  if not errorlevel 1 set NODE=node
)

REM ---- 3. Instalarlo automaticamente ----
if "%NODE%"=="" (
  echo   Falta Node.js, que es el motor que hace funcionar el programa.
  echo   Es gratis y oficial. Lo instalo por vos.
  echo.
  where winget >nul 2>&1
  if not errorlevel 1 (
    echo   Instalando... Si Windows pide permiso, aceptalo.
    echo.
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    echo.
    echo   ============================================================
    echo    Listo. CERRA esta ventana y volve a hacer doble clic en
    echo    Facturador.bat para abrir el programa.
    echo   ============================================================
    echo.
    pause
    exit /b 0
  )
  echo   No pude instalarlo solo en esta version de Windows.
  echo.
  echo   Bajalo de:  https://nodejs.org   (el boton grande que dice LTS)
  echo   Instalalo con Siguiente, Siguiente, y volve a abrir este archivo.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

REM ---- Dependencias y compilacion ----
REM El ZIP ya viene con todo resuelto; un clon del repositorio no. Compilar exige
REM las herramientas de desarrollo, asi que en ese caso NO se pueden omitir.
if not exist "server\dist\index.js" (
  echo   Primera vez: preparando la aplicacion. Tarda un par de minutos y necesita internet.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo   [X] No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
  echo.
  echo   Compilando...
  call npm run build
  if errorlevel 1 (
    echo   [X] No se pudo compilar la aplicacion.
    pause
    exit /b 1
  )
  echo.
) else (
  if not exist "node_modules" (
    echo   Primera vez: instalando dependencias. Tarda un minuto y necesita internet.
    echo.
    call npm install --omit=dev --no-audit --no-fund
    if errorlevel 1 (
      echo   [X] No se pudieron instalar las dependencias.
      pause
      exit /b 1
    )
    echo.
  )
)

REM ---- Configuracion inicial (solo la primera vez) ----
if not exist ".env" (
  echo   Preparando la configuracion inicial...
  echo.
  "%NODE%" scripts\setup.mjs
  if errorlevel 1 (
    echo.
    echo   [X] No se pudo crear la configuracion.
    pause
    exit /b 1
  )
  echo.
)

if "%PORT%"=="" set PORT=3000

echo   Abriendo el navegador en http://localhost:%PORT%
echo.
echo   IMPORTANTE: deja esta ventana abierta mientras uses el programa.
echo   Para cerrarlo, cerra esta ventana.
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:%PORT%"

cd server
set NODE_ENV=production
"%NODE%" dist\index.js

echo.
echo   El programa se detuvo.
pause
