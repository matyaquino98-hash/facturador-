#!/bin/bash
# Facturador — arranque de un clic (macOS y Linux).
# La primera vez instala dependencias y crea la configuración; después arranca directo.

cd "$(dirname "$0")" || exit 1

echo ""
echo "  Facturador — facturación electrónica ARCA"
echo "  ─────────────────────────────────────────"
echo ""

# --- Node ---
if ! command -v node >/dev/null 2>&1; then
  echo "  ✘ No encontré Node.js, que es lo único que hace falta tener instalado."
  echo ""
  echo "    Descargalo de:  https://nodejs.org  (elegí la versión LTS)"
  echo "    Instalalo y volvé a abrir este archivo."
  echo ""
  read -r -p "  Enter para cerrar..."
  exit 1
fi

MAYOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAYOR" -lt 20 ]; then
  echo "  ✘ Tenés Node $(node -v), pero hace falta Node 20 o superior."
  echo "    Actualizalo desde https://nodejs.org"
  echo ""
  read -r -p "  Enter para cerrar..."
  exit 1
fi

# --- Dependencias (solo la primera vez) ---
if [ ! -d "node_modules" ]; then
  echo "  Primera vez: instalando dependencias. Tarda un minuto y necesita internet."
  echo ""
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo ""
    echo "  ✘ Falló la instalación. Revisá tu conexión y volvé a intentar."
    echo ""
    read -r -p "  Enter para cerrar..."
    exit 1
  fi
  echo ""
fi

# --- Configuración (solo la primera vez) ---
if [ ! -f ".env" ]; then
  node scripts/setup.mjs || exit 1
  echo ""
fi

PUERTO="${PORT:-3000}"
echo "  Listo. Abriendo http://localhost:$PUERTO"
echo "  Para cerrar el programa: Ctrl+C en esta ventana."
echo ""

# Abre el navegador cuando el servidor ya responde.
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PUERTO/api/health" 2>/dev/null; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:$PUERTO"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PUERTO" >/dev/null 2>&1
      fi
      break
    fi
    sleep 0.5
  done
) &

cd server || exit 1
NODE_ENV=production PORT="$PUERTO" node dist/index.js
