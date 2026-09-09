@echo off
REM Facturador — arranque de un clic (Windows).
cd /d "%~dp0"

echo.
echo   Facturador - facturacion electronica ARCA
echo   -----------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] No encontre Node.js, que es lo unico que hace falta tener instalado.
  echo.
  echo       Descargalo de: https://nodejs.org  ^(version LTS^)
  echo       Instalalo y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   Primera vez: instalando dependencias. Tarda un minuto y necesita internet.
  echo.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [X] Fallo la instalacion. Revisa tu conexion y volve a intentar.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  node scripts\setup.mjs
)

if "%PORT%"=="" set PORT=3000
echo.
echo   Listo. Abriendo http://localhost:%PORT%
echo   Para cerrar el programa: Ctrl+C en esta ventana.
echo.
start "" "http://localhost:%PORT%"

cd server
set NODE_ENV=production
node dist\index.js
