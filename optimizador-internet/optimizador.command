#!/bin/bash
# ============================================================
#  Optimizador de internet para Mac y Linux
#  Bloquea publicidad, rastreadores y malware en todo el sistema,
#  pone DNS rápido con filtro de malware (Cloudflare 1.1.1.2, solo Mac)
#  y limpia la caché DNS.
#
#  Uso:  doble clic (Mac)  o  bash optimizador.command [optimizar|maximo|restaurar]
# ============================================================
cd "$(dirname "$0")" || exit 1
CARPETA="$(pwd)"

HOSTS="${HOSTS_FILE:-/etc/hosts}"
RESPALDO_HOSTS="$CARPETA/respaldo-hosts.txt"
RESPALDO_DNS="$CARPETA/respaldo-dns.txt"
PERMITIDOS="$CARPETA/permitidos.txt"
MARCA_INICIO="# >>> OPTIMIZADOR INTERNET - inicio (no editar este bloque) >>>"
MARCA_FIN="# <<< OPTIMIZADOR INTERNET - fin <<<"

LISTA_ESTANDAR="https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
LISTA_MAXIMO="https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts"
DNS_SEGURO="1.1.1.2 1.0.0.2 2606:4700:4700::1112 2606:4700:4700::1002"

paso()  { echo ""; echo "  >> $1"; }
ok()    { echo "     [OK] $1"; }
aviso() { echo "     [!]  $1"; }

ACCION="$1"
if [ -z "$ACCION" ]; then
  echo ""
  echo "  OPTIMIZADOR DE INTERNET"
  echo "  ======================="
  echo ""
  echo "   1. Optimizar - bloqueo ESTÁNDAR  (publicidad, rastreadores, malware)"
  echo "   2. Optimizar - bloqueo MÁXIMO    (además apuestas, noticias falsas y adultos)"
  echo "   3. Restaurar todo como estaba"
  echo "   4. Salir"
  echo ""
  read -r -p "  Elegí una opción: " OPCION
  case "$OPCION" in
    1) ACCION=optimizar ;;
    2) ACCION=maximo ;;
    3) ACCION=restaurar ;;
    *) exit 0 ;;
  esac
fi

# El hosts y el DNS requieren permisos de administrador.
if [ "$(id -u)" -ne 0 ] && [ -z "$HOSTS_FILE" ]; then
  echo ""
  echo "  Te va a pedir la contraseña de tu usuario (no se ve mientras la escribís)."
  # Con "bash" adelante anda aunque el archivo haya perdido el permiso de ejecución.
  exec sudo bash "$0" "$ACCION"
fi

# Hosts sin nuestro bloque: las entradas propias del usuario se conservan.
hosts_sin_bloque() {
  awk -v ini="$MARCA_INICIO" -v fin="$MARCA_FIN" '
    $0 == ini { dentro = 1; next }
    $0 == fin { dentro = 0; next }
    dentro { next }
    # Las líneas vacías se guardan y solo se imprimen si sigue texto:
    # así no se acumulan al final cada vez que se optimiza.
    /^[ \t\r]*$/ { vacias = vacias $0 "\n"; next }
    { printf "%s", vacias; vacias = ""; print }
  ' "$HOSTS"
}

limpiar_cache_dns() {
  if [ "$(uname)" = "Darwin" ]; then
    dscacheutil -flushcache 2>/dev/null
    killall -HUP mDNSResponder 2>/dev/null
  elif command -v resolvectl >/dev/null 2>&1; then
    resolvectl flush-caches 2>/dev/null
  fi
  ok "Caché DNS limpia."
}

optimizar() {
  local url="$1"
  local tmp; tmp="$(mktemp)"

  paso "Respaldando la configuración actual"
  if [ ! -f "$RESPALDO_HOSTS" ]; then
    cp "$HOSTS" "$RESPALDO_HOSTS" && ok "Hosts original guardado en $RESPALDO_HOSTS"
  else
    ok "Ya había un respaldo del hosts original; se conserva."
  fi

  paso "Descargando listas de publicidad, rastreadores y malware"
  if ! curl -fsSL "$url" -o "$tmp"; then
    aviso "No se pudo descargar la lista. Revisá la conexión y volvé a intentar."
    rm -f "$tmp"; return 1
  fi

  # Dominios únicos, sin las entradas locales que traen las listas
  # y sin los de permitidos.txt.
  local dominios; dominios="$(mktemp)"
  awk -v permitidos="$PERMITIDOS" '
    BEGIN {
      split("localhost localhost.localdomain local broadcasthost 0.0.0.0", x, " ")
      for (i in x) excluir[x[i]] = 1
      while ((getline l < permitidos) > 0) {
        gsub(/[ \t\r]/, "", l)
        if (l != "" && substr(l, 1, 1) != "#") excluir[tolower(l)] = 1
      }
    }
    ($1 == "0.0.0.0" || $1 == "127.0.0.1") && $2 !~ /^#/ {
      d = tolower($2); sub(/\.$/, "", d)
      if (d != "" && !(d in excluir) && !(d in visto)) { visto[d] = 1; print d }
    }
  ' "$tmp" | sort > "$dominios"
  rm -f "$tmp"

  local total; total=$(wc -l < "$dominios" | tr -d ' ')
  if [ "$total" -lt 1000 ]; then
    aviso "La lista vino vacía o incompleta. No se tocó nada."
    rm -f "$dominios"; return 1
  fi
  ok "$total dominios a bloquear"

  paso "Aplicando el bloqueo en todo el sistema"
  local nuevo; nuevo="$(mktemp)"
  {
    hosts_sin_bloque
    echo ""
    echo "$MARCA_INICIO"
    echo "# Generado el $(date '+%Y-%m-%d %H:%M') - $total dominios"
    sed 's/^/0.0.0.0 /' "$dominios"
    echo "$MARCA_FIN"
  } > "$nuevo"
  # cat > conserva dueño y permisos del hosts original.
  cat "$nuevo" > "$HOSTS" && ok "Bloqueo activo para todos los navegadores y programas."
  rm -f "$nuevo" "$dominios"

  if [ "$(uname)" = "Darwin" ]; then
    paso "Configurando DNS rápido y seguro (Cloudflare 1.1.1.2)"
    local guardar=0
    [ -f "$RESPALDO_DNS" ] || guardar=1
    networksetup -listallnetworkservices | tail -n +2 | grep -v '^\*' | while IFS= read -r servicio; do
      if [ "$guardar" = 1 ]; then
        printf '%s\t%s\n' "$servicio" "$(networksetup -getdnsservers "$servicio" | grep -v "aren't any" | tr '\n' ' ')" >> "$RESPALDO_DNS"
      fi
      # shellcheck disable=SC2086
      networksetup -setdnsservers "$servicio" $DNS_SEGURO && ok "DNS aplicado en '$servicio'"
    done
  else
    paso "DNS"
    aviso "En Linux el DNS depende de la distribución: si querés, poné 1.1.1.2 y 1.0.0.2"
    aviso "en la configuración de red. El bloqueo por hosts ya está activo igual."
  fi

  paso "Ajustando la red"
  limpiar_cache_dns

  paso "Verificando"
  if grep -q " doubleclick.net$" "$HOSTS"; then ok "Publicidad bloqueada (doubleclick.net -> 0.0.0.0)."; fi

  echo ""
  echo "  ============================================================"
  echo "   LISTO. Cerrá y volvé a abrir el navegador."
  echo "   Si una página que usás deja de andar, agregá su dominio a"
  echo "   permitidos.txt y volvé a optimizar."
  echo "  ============================================================"
}

restaurar() {
  paso "Quitando el bloqueo del hosts"
  local nuevo; nuevo="$(mktemp)"
  hosts_sin_bloque > "$nuevo" && cat "$nuevo" > "$HOSTS"
  rm -f "$nuevo"
  ok "Hosts restaurado (tus entradas propias se conservan)."

  if [ "$(uname)" = "Darwin" ] && [ -f "$RESPALDO_DNS" ]; then
    paso "Devolviendo el DNS a como estaba"
    while IFS=$'\t' read -r servicio servidores; do
      # shellcheck disable=SC2086
      networksetup -setdnsservers "$servicio" ${servidores:-Empty} && ok "DNS de '$servicio' restaurado."
    done < "$RESPALDO_DNS"
    rm -f "$RESPALDO_DNS"
  fi

  limpiar_cache_dns
  echo ""
  echo "  Listo: todo quedó como antes de optimizar."
}

case "$ACCION" in
  optimizar) optimizar "$LISTA_ESTANDAR" ;;
  maximo)    optimizar "$LISTA_MAXIMO" ;;
  restaurar) restaurar ;;
  *) echo "  Uso: $0 [optimizar|maximo|restaurar]"; exit 1 ;;
esac

echo ""
[ -t 0 ] && read -r -p "  Presioná Enter para cerrar " _
exit 0
