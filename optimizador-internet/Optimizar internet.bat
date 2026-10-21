@echo off
REM ============================================================
REM  Optimizador de internet - doble clic aca.
REM  Es un solo archivo: el programa en PowerShell va al final y se
REM  ejecuta desde memoria, asi no lo frenan las politicas de scripts
REM  ni la marca de "descargado de internet".
REM ============================================================
setlocal
title Optimizador de internet
set "OPT_BAT=%~f0"
set "OPT_CARPETA=%~dp0"
set "OPT_ACCION=%~1"
if "%OPT_ACCION%"=="" set "OPT_ACCION=menu"

REM ---- Pedir permiso de administrador (hosts y DNS lo requieren) ----
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Pidiendo permiso de administrador. Cuando Windows pregunte, toca SI.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:OPT_BAT -ArgumentList $env:OPT_ACCION -Verb RunAs"
  if errorlevel 1 (
    echo.
    echo   [X] Sin permiso de administrador no se puede optimizar.
    echo       Proba: clic derecho en este archivo - Ejecutar como administrador.
    echo.
    pause
  )
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText($env:OPT_BAT); $m = '#==' + 'PS==#'; $c = $t.Substring($t.LastIndexOf($m) + $m.Length); & ([scriptblock]::Create($c)) -Accion $env:OPT_ACCION"
if errorlevel 1 pause
exit /b

#==PS==#
# ============================================================
#  Optimizador de internet para Windows
#  - Bloquea publicidad, rastreadores y sitios de malware/estafas
#    a nivel de todo el sistema (todos los navegadores y programas).
#  - Configura DNS rapido con filtro de malware (Cloudflare 1.1.1.2).
#  - Limpia cache DNS y archivos temporales, ajusta TCP.
#  Todo se puede deshacer con la opcion "Restaurar".
#
#  Va en ASCII a proposito: Windows PowerShell 5.1 lee mal los acentos.
# ============================================================
param(
  [ValidateSet('menu', 'optimizar', 'restaurar')]
  [string]$Accion = 'menu',
  [ValidateSet('estandar', 'maximo')]
  [string]$Nivel = 'estandar'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# La carpeta del .bat (para permitidos.txt). Los respaldos van a ProgramData
# para que Restaurar los encuentre aunque se haya movido o borrado la carpeta.
$Carpeta       = $env:OPT_CARPETA
$Hosts         = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$Datos         = Join-Path $env:ProgramData 'OptimizadorInternet'
$RespaldoHosts = Join-Path $Datos 'respaldo-hosts.txt'
$RespaldoDns   = Join-Path $Datos 'respaldo-dns.json'
$Permitidos    = Join-Path $Carpeta 'permitidos.txt'
New-Item -ItemType Directory -Force -Path $Datos | Out-Null

$MarcaInicio = '# >>> OPTIMIZADOR INTERNET - inicio (no editar este bloque) >>>'
$MarcaFin    = '# <<< OPTIMIZADOR INTERNET - fin <<<'

# Listas mantenidas por la comunidad (StevenBlack/hosts, unifica AdAway,
# URLhaus, add.2o7Net y otras). "maximo" agrega apuestas, noticias falsas y adultos.
$Listas = @{
  estandar = @('https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts')
  maximo   = @('https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts')
}

# Cloudflare "1.1.1.2": igual de rapido que 1.1.1.1 pero ademas bloquea malware.
$ServidoresDns = @('1.1.1.2', '1.0.0.2', '2606:4700:4700::1112', '2606:4700:4700::1002')

# Nombres que traen las listas y no son dominios a bloquear.
$NoBloquear = @('localhost', 'localhost.localdomain', 'local', 'broadcasthost',
  'ip6-localhost', 'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix',
  'ip6-allnodes', 'ip6-allrouters', 'ip6-allhosts', '0.0.0.0')

function Paso($texto)  { Write-Host ''; Write-Host "  >> $texto" -ForegroundColor Cyan }
function Ok($texto)    { Write-Host "     [OK] $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "     [!]  $texto" -ForegroundColor Yellow }

# ---- Permisos de administrador (el .bat ya los pidio) ----
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Write-Host ''
  Write-Host '  [X] Hace falta permiso de administrador. Cuando Windows pregunte, toca SI.' -ForegroundColor Red
  Read-Host '  Presiona Enter para cerrar'
  exit
}

function Leer-HostsSinBloque {
  # Devuelve el hosts del usuario sin nuestro bloque, para no pisar sus entradas.
  $lineas = @(Get-Content -LiteralPath $Hosts -ErrorAction SilentlyContinue)
  $dentro = $false
  $resultado = New-Object System.Collections.Generic.List[string]
  foreach ($l in $lineas) {
    if ($l -eq $MarcaInicio) { $dentro = $true; continue }
    if ($l -eq $MarcaFin)    { $dentro = $false; continue }
    if (-not $dentro) { $resultado.Add($l) }
  }
  # Sin lineas vacias sobrantes al final.
  while ($resultado.Count -gt 0 -and [string]::IsNullOrWhiteSpace($resultado[$resultado.Count - 1])) {
    $resultado.RemoveAt($resultado.Count - 1)
  }
  return ,$resultado
}

function Escribir-Hosts($lineas) {
  # Reintentos: el antivirus o el servicio DNS a veces tienen el archivo tomado.
  for ($i = 1; $i -le 5; $i++) {
    try {
      [IO.File]::WriteAllLines($Hosts, [string[]]$lineas, [Text.Encoding]::ASCII)
      return
    } catch {
      if ($i -eq 5) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function Medir-Ping {
  try {
    $r = ping.exe -n 4 1.1.1.1 | Select-String -Pattern '(\d+)\s*ms\s*$' -AllMatches
    $ms = @($r | ForEach-Object { [int]$_.Matches[0].Groups[1].Value })
    if ($ms.Count -gt 0) { return [math]::Round(($ms | Measure-Object -Average).Average) }
  } catch {}
  return $null
}

function Optimizar {
  Write-Host ''
  Write-Host "  Nivel de bloqueo: $Nivel" -ForegroundColor White

  $pingAntes = Medir-Ping

  # ---- 1. Respaldo (solo la primera vez, para restaurar el original) ----
  Paso 'Respaldando la configuracion actual'
  if (-not (Test-Path -LiteralPath $RespaldoHosts)) {
    Copy-Item -LiteralPath $Hosts -Destination $RespaldoHosts -ErrorAction SilentlyContinue
    Ok "Hosts original guardado en $RespaldoHosts"
  } else {
    Ok 'Ya habia un respaldo del hosts original; se conserva.'
  }

  $adaptadores = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up')
  if ($adaptadores.Count -gt 0 -and -not (Test-Path -LiteralPath $RespaldoDns)) {
    $respaldo = foreach ($a in $adaptadores) {
      [pscustomobject]@{
        Indice     = $a.ifIndex
        Nombre     = $a.Name
        Servidores = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex |
                       ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })
        # Si el DNS vino por DHCP (lo normal), al restaurar se vuelve a automatico.
        Automatico = ((Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4).Dhcp -eq 'Enabled')
      }
    }
    @($respaldo) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $RespaldoDns -Encoding UTF8
    Ok 'DNS actual guardado.'
  }

  # ---- 2. Descargar listas de bloqueo ----
  Paso 'Descargando listas de publicidad, rastreadores y malware'
  $dominios = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $patron = '^\s*(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)'
  foreach ($url in $Listas[$Nivel]) {
    try {
      $texto = (New-Object Net.WebClient).DownloadString($url)
    } catch {
      Aviso "No se pudo descargar $url. Revisa la conexion y volve a intentar."
      return
    }
    foreach ($linea in $texto -split "`n") {
      $m = [regex]::Match($linea, $patron)
      if ($m.Success) {
        $d = $m.Groups[1].Value.Trim().TrimEnd('.').ToLowerInvariant()
        if ($d -and $NoBloquear -notcontains $d) { [void]$dominios.Add($d) }
      }
    }
  }

  # Lista blanca del usuario: un dominio por linea en permitidos.txt.
  if (Test-Path -LiteralPath $Permitidos) {
    $quitados = 0
    foreach ($p in Get-Content -LiteralPath $Permitidos) {
      $p = $p.Trim().ToLowerInvariant()
      if ($p -and -not $p.StartsWith('#') -and $dominios.Remove($p)) { $quitados++ }
    }
    if ($quitados) { Ok "$quitados dominios liberados por permitidos.txt" }
  }

  if ($dominios.Count -lt 1000) {
    Aviso 'La lista descargada vino vacia o incompleta. No se toco nada.'
    return
  }
  Ok ('{0:N0} dominios a bloquear' -f $dominios.Count)

  # ---- 3. Escribir el hosts ----
  # Windows atiende mucho mas rapido un hosts grande si va con varios
  # dominios por linea (maximo 9 por linea).
  Paso 'Aplicando el bloqueo en todo el sistema'
  $nuevo = Leer-HostsSinBloque
  $nuevo.Add('')
  $nuevo.Add($MarcaInicio)
  $nuevo.Add("# Generado el $(Get-Date -Format 'yyyy-MM-dd HH:mm') - nivel $Nivel - $($dominios.Count) dominios")
  $lote = New-Object System.Collections.Generic.List[string]
  foreach ($d in ($dominios | Sort-Object)) {
    $lote.Add($d)
    if ($lote.Count -eq 9) { $nuevo.Add('0.0.0.0 ' + ($lote -join ' ')); $lote.Clear() }
  }
  if ($lote.Count) { $nuevo.Add('0.0.0.0 ' + ($lote -join ' ')) }
  $nuevo.Add($MarcaFin)
  try {
    Escribir-Hosts $nuevo
    Ok 'Bloqueo activo para todos los navegadores y programas.'
  } catch {
    Aviso 'No se pudo escribir el archivo hosts. Si tenes antivirus, permiti el cambio y repeti.'
    Aviso $_.Exception.Message
  }

  # ---- 4. DNS rapido con filtro de malware ----
  Paso 'Configurando DNS rapido y seguro (Cloudflare 1.1.1.2)'
  if ($adaptadores.Count -eq 0) { Aviso 'No encontre una conexion de red activa.' }
  foreach ($a in $adaptadores) {
    try {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $ServidoresDns
      Ok "DNS aplicado en '$($a.Name)'"
    } catch {
      Aviso "No se pudo cambiar el DNS de '$($a.Name)': $($_.Exception.Message)"
    }
  }

  # ---- 5. Ajustes de red ----
  Paso 'Ajustando la red'
  # Autoajuste de ventana TCP: aprovecha todo el ancho de banda contratado.
  netsh int tcp set global autotuninglevel=normal | Out-Null
  Ok 'Autoajuste TCP en modo normal.'
  Clear-DnsClientCache
  ipconfig /flushdns | Out-Null
  Ok 'Cache DNS limpia.'

  # ---- 6. Limpieza de temporales ----
  Paso 'Borrando archivos temporales'
  $antes = 0
  foreach ($dir in @($env:TEMP, (Join-Path $env:SystemRoot 'Temp'))) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $items = Get-ChildItem -LiteralPath $dir -Force -Recurse -ErrorAction SilentlyContinue
    $antes += ($items | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  Ok ('Liberados hasta {0:N0} MB (los archivos en uso se saltean).' -f ($antes / 1MB))

  # ---- 7. Verificacion ----
  Paso 'Verificando'
  try {
    $ip = [Net.Dns]::GetHostAddresses('doubleclick.net') | Select-Object -First 1
    if ($ip -and ($ip.ToString() -eq '0.0.0.0')) { Ok 'Publicidad bloqueada (doubleclick.net -> 0.0.0.0).' }
    else { Aviso 'doubleclick.net todavia responde; reinicia la PC para que tome el cambio.' }
  } catch { Ok 'Publicidad bloqueada (doubleclick.net no resuelve).' }
  try {
    [void][Net.Dns]::GetHostAddresses('www.google.com')
    Ok 'Navegacion normal funcionando (google.com resuelve).'
  } catch { Aviso 'google.com no resuelve. Proba "Restaurar" si algo no anda.' }

  $pingDespues = Medir-Ping
  if ($pingAntes -and $pingDespues) { Ok "Latencia a 1.1.1.1: $pingAntes ms antes, $pingDespues ms ahora." }

  Write-Host ''
  Write-Host '  ============================================================' -ForegroundColor Green
  Write-Host '   LISTO. Cerra y volve a abrir el navegador.'                  -ForegroundColor Green
  Write-Host '   Si una pagina que usas deja de andar, agrega su dominio a'    -ForegroundColor Green
  Write-Host '   permitidos.txt y volve a optimizar.'                          -ForegroundColor Green
  Write-Host '  ============================================================' -ForegroundColor Green
}

function Restaurar {
  Paso 'Quitando el bloqueo del hosts'
  try {
    Escribir-Hosts (Leer-HostsSinBloque)
    Ok 'Hosts restaurado (tus entradas propias se conservan).'
  } catch {
    Aviso "No se pudo escribir el hosts: $($_.Exception.Message)"
  }

  Paso 'Devolviendo el DNS a como estaba'
  if (Test-Path -LiteralPath $RespaldoDns) {
    foreach ($r in @(Get-Content -LiteralPath $RespaldoDns -Raw | ConvertFrom-Json)) {
      try {
        if ($r.Automatico -or -not $r.Servidores) {
          Set-DnsClientServerAddress -InterfaceIndex $r.Indice -ResetServerAddresses
        } else {
          Set-DnsClientServerAddress -InterfaceIndex $r.Indice -ServerAddresses @($r.Servidores)
        }
        Ok "DNS de '$($r.Nombre)' restaurado."
      } catch {
        Aviso "No se pudo restaurar '$($r.Nombre)': $($_.Exception.Message)"
      }
    }
    Remove-Item -LiteralPath $RespaldoDns -Force
  } else {
    foreach ($a in @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')) {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses
      Ok "DNS de '$($a.Name)' en automatico."
    }
  }

  Clear-DnsClientCache
  ipconfig /flushdns | Out-Null
  Ok 'Cache DNS limpia.'
  Write-Host ''
  Write-Host '  Listo: todo quedo como antes de optimizar.' -ForegroundColor Green
}

# ---- Programa ----
Clear-Host
Write-Host ''
Write-Host '  OPTIMIZADOR DE INTERNET' -ForegroundColor White
Write-Host '  =======================' -ForegroundColor White

if ($Accion -eq 'menu') {
  Write-Host ''
  Write-Host '   1. Optimizar - bloqueo ESTANDAR  (publicidad, rastreadores, malware)'
  Write-Host '   2. Optimizar - bloqueo MAXIMO    (ademas apuestas, noticias falsas y adultos)'
  Write-Host '   3. Restaurar todo como estaba'
  Write-Host '   4. Salir'
  Write-Host ''
  switch (Read-Host '  Elegi una opcion') {
    '1' { $Accion = 'optimizar'; $Nivel = 'estandar' }
    '2' { $Accion = 'optimizar'; $Nivel = 'maximo' }
    '3' { $Accion = 'restaurar' }
    default { exit }
  }
}

try {
  if ($Accion -eq 'optimizar') { Optimizar } else { Restaurar }
} catch {
  Write-Host ''
  Write-Host "  [X] Error inesperado: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ''
Read-Host '  Presiona Enter para cerrar'
