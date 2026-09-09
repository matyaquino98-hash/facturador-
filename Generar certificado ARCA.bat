@echo off
setlocal
cd /d "%~dp0"
title Facturador - certificado de ARCA

set NODE=
if exist "node.exe" set NODE=%~dp0node.exe
if "%NODE%"=="" (
  where node >nul 2>&1
  if not errorlevel 1 set NODE=node
)
if "%NODE%"=="" (
  echo   Primero abri Facturador.bat una vez, que instala lo que falta.
  pause
  exit /b 1
)

echo.
echo   Certificado de ARCA
echo   ===================
echo.
echo   Genera dos archivos en la carpeta "certs":
echo     arca.key  tu clave privada (secreta, no la compartas)
echo     arca.csr  el pedido que tenes que pegar en la web de ARCA
echo.

set /p CUIT="  Tu CUIT (solo numeros): "
set /p NOMBRE="  Tu razon social o nombre: "
echo.

"%NODE%" scripts\certificado.mjs --cuit %CUIT% --nombre "%NOMBRE%"
echo.
pause
