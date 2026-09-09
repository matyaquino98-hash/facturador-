#!/bin/bash
# ============================================================
#  Facturador — Facturación electrónica ARCA
#  Doble clic acá para abrir el programa.
# ============================================================
cd "$(dirname "$0")" || exit 1

echo ""
echo "  Facturador — Facturación electrónica ARCA"
echo "  ========================================="
echo ""

# macOS marca en cuarentena todo lo que viene de un ZIP descargado. Como el
# usuario ya autorizó este archivo para llegar hasta acá, se limpia la marca
# del resto de la carpeta para que no aparezca un aviso por cada archivo.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true
fi

# ---- Buscar Node ----
NODE=""
if [ -x "./node" ]; then
  NODE="./node"
elif command -v node >/dev/null 2>&1; then
  NODE="node"
else
  # Rutas habituales cuando Node está instalado pero no en el PATH del Finder.
  for RUTA in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if [ -x "$RUTA" ]; then NODE="$RUTA"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo "  Falta Node.js, que es el motor que hace funcionar el programa."
  echo "  Es gratis y oficial."
  echo ""
  if command -v brew >/dev/null 2>&1; then
    echo "  Tenés Homebrew, así que lo instalo por vos. Puede tardar unos minutos."
    echo ""
    if brew install node; then
      echo ""
      echo "  ============================================================"
      echo "   Listo. Cerrá esta ventana y volvé a hacer doble clic en"
      echo "   iniciar.command para abrir el programa."
      echo "  ============================================================"
      echo ""
      read -r -p "  Enter para cerrar..."
      exit 0
    fi
    echo "  No se pudo instalar con Homebrew."
    echo ""
  fi
  echo "  Bajalo de:  https://nodejs.org   (el botón grande que dice LTS)"
  echo "  Instalalo (Continuar, Continuar, Instalar) y volvé a abrir este archivo."
  echo ""
  command -v open >/dev/null 2>&1 && open "https://nodejs.org"
  read -r -p "  Enter para cerrar..."
  exit 1
fi

MAYOR=$("$NODE" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$MAYOR" -lt 20 ]; then
  echo "  Tenés Node $("$NODE" -v), pero hace falta Node 20 o superior."
  echo "  Actualizalo desde https://nodejs.org"
  echo ""
  command -v open >/dev/null 2>&1 && open "https://nodejs.org"
  read -r -p "  Enter para cerrar..."
  exit 1
fi

# Ruta absoluta: más abajo se entra a server/ y una ruta relativa dejaría de valer.
case "$NODE" in
  ./*) NODE="$(pwd)/${NODE#./}" ;;
esac

# ---- Dependencias y compilación ----
# El ZIP ya viene con todo resuelto; un clon del repositorio no. Compilar exige
# las herramientas de desarrollo (vite, typescript), así que en ese caso la
# instalación NO puede omitirlas.
if [ ! -f "server/dist/index.js" ]; then
  echo "  Primera vez: preparando la aplicación. Tarda un par de minutos y necesita internet."
  echo ""
  if ! npm install --no-audit --no-fund; then
    echo ""
    echo "  No se pudieron instalar las dependencias. Revisá tu conexión."
    read -r -p "  Enter para cerrar..."
    exit 1
  fi
  echo ""
  echo "  Compilando..."
  if ! npm run build; then
    echo ""
    echo "  No se pudo compilar la aplicación."
    read -r -p "  Enter para cerrar..."
    exit 1
  fi
  echo ""
elif [ ! -d "node_modules" ]; then
  echo "  Primera vez: instalando dependencias. Tarda un minuto y necesita internet."
  echo ""
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo ""
    echo "  No se pudieron instalar las dependencias. Revisá tu conexión."
    read -r -p "  Enter para cerrar..."
    exit 1
  fi
  echo ""
fi

# ---- Configuración inicial (solo la primera vez) ----
if [ ! -f ".env" ]; then
  echo "  Preparando la configuración inicial..."
  echo ""
  "$NODE" scripts/setup.mjs || { read -r -p "  Enter para cerrar..."; exit 1; }
  echo ""
fi

PUERTO="${PORT:-3000}"
echo "  Abriendo el navegador en http://localhost:$PUERTO"
echo ""
echo "  IMPORTANTE: dejá esta ventana abierta mientras uses el programa."
echo "  Para cerrarlo: Ctrl+C acá, o cerrá esta ventana."
echo ""

(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PUERTO/api/health" 2>/dev/null; then
      command -v open >/dev/null 2>&1 && open "http://localhost:$PUERTO"
      break
    fi
    sleep 0.5
  done
) &

cd server || exit 1
NODE_ENV=production PORT="$PUERTO" "$NODE" dist/index.js

echo ""
echo "  El programa se detuvo."
read -r -p "  Enter para cerrar..."
