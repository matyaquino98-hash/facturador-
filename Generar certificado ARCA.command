#!/bin/bash
# Genera la clave privada y el pedido (CSR) para tramitar el certificado en ARCA.
cd "$(dirname "$0")" || exit 1

NODE=""
if [ -x "./node" ]; then NODE="./node"
elif command -v node >/dev/null 2>&1; then NODE="node"
else
  for RUTA in /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$RUTA" ] && NODE="$RUTA" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "  Primero abrí iniciar.command una vez, que resuelve lo que falta."
  read -r -p "  Enter para cerrar..."
  exit 1
fi

case "$NODE" in
  ./*) NODE="$(pwd)/${NODE#./}" ;;
esac

echo ""
echo "  Certificado de ARCA"
echo "  ==================="
echo ""
echo "  Genera dos archivos en la carpeta \"certs\":"
echo "    arca.key  tu clave privada (secreta, no la compartas)"
echo "    arca.csr  el pedido que tenés que pegar en la web de ARCA"
echo ""

read -r -p "  Tu CUIT (solo números): " CUIT
read -r -p "  Tu razón social o nombre: " NOMBRE
echo ""

"$NODE" scripts/certificado.mjs --cuit "$CUIT" --nombre "$NOMBRE"
echo ""
read -r -p "  Enter para cerrar..."
