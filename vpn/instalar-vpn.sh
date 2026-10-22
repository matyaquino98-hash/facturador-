#!/bin/bash
# ============================================================
#  Mi VPN - instalador del servidor (Ubuntu / Debian)
#
#  Instala Xray con VLESS + Reality en el puerto 443: para la red
#  por la que pasa, la conexion parece una visita HTTPS comun a
#  www.microsoft.com, asi que los filtros no la reconocen como VPN.
#
#  Uso (desde la Mac, ver LEEME.txt):
#    ssh -i CLAVE ubuntu@IP 'sudo bash -s' < instalar-vpn.sh
#
#  Volver a correrlo no cambia nada: solo vuelve a mostrar el enlace.
# ============================================================
set -euo pipefail

CONFIG_DIR=/usr/local/etc/xray
CONFIG="$CONFIG_DIR/config.json"
DATOS="$CONFIG_DIR/mi-vpn.env"
PUERTO=443
# Sitio que la conexion "imita". Tiene que soportar TLS 1.3 y no estar
# bloqueado en la red desde la que te conectas.
SNI="${SNI:-www.microsoft.com}"

paso()  { echo ""; echo "  >> $1"; }
ok()    { echo "     [OK] $1"; }
error() { echo ""; echo "  [X] $1"; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Hay que correrlo con sudo."
command -v apt-get >/dev/null || error "Este instalador es para Ubuntu o Debian."

mostrar_enlace() {
  # shellcheck disable=SC1090
  . "$DATOS"
  local enlace="vless://$UUID@$IP:$PUERTO?encryption=none&flow=xtls-rprx-vision&security=reality&sni=$SNI&fp=chrome&pbk=$PUBLICA&sid=$SHORT_ID&type=tcp#Mi-VPN"
  echo "$enlace" > /root/mi-vpn.txt
  echo ""
  echo "  ============================================================"
  echo "   TU VPN ESTA LISTA"
  echo "  ============================================================"
  echo ""
  echo "  Enlace (copialo entero y pegalo en la app Hiddify):"
  echo ""
  echo "$enlace"
  echo ""
  echo "  O escanea este codigo con Hiddify en el celular:"
  echo ""
  qrencode -t ansiutf8 "$enlace"
  echo ""
  echo "  (Queda guardado en el servidor en /root/mi-vpn.txt)"
}

if [ -f "$DATOS" ] && systemctl is-active --quiet mi-vpn; then
  echo "  La VPN ya estaba instalada y funcionando."
  mostrar_enlace
  exit 0
fi

paso "Instalando lo necesario"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl unzip qrencode openssl iptables >/dev/null
ok "Paquetes instalados."

paso "Descargando Xray (version oficial)"
case "$(uname -m)" in
  x86_64)        ARCH=64 ;;
  aarch64|arm64) ARCH=arm64-v8a ;;
  *) error "Procesador no soportado: $(uname -m)" ;;
esac
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/xray.zip" \
  "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-$ARCH.zip"
unzip -qo "$TMP/xray.zip" xray -d "$TMP"
install -m 755 "$TMP/xray" /usr/local/bin/xray
rm -rf "$TMP"
ok "$(/usr/local/bin/xray version | head -1)"

if ss -Hltn "sport = :$PUERTO" | grep -q .; then
  error "El puerto $PUERTO ya lo usa otro programa (por ejemplo un servidor web)."
fi

paso "Generando claves"
mkdir -p "$CONFIG_DIR"
if [ ! -f "$DATOS" ]; then
  CLAVES="$(/usr/local/bin/xray x25519)"
  # Segun la version, la publica sale como "Public key" o "Password".
  PRIVADA="$(echo "$CLAVES" | awk -F': ' 'tolower($1) ~ /^private/ { print $2 }')"
  PUBLICA="$(echo "$CLAVES" | awk -F': ' 'tolower($1) ~ /^(public|password)/ { print $2 }')"
  [ -n "$PRIVADA" ] && [ -n "$PUBLICA" ] || error "No se pudieron generar las claves."
  # IP publica: en Oracle la de la placa de red es privada (10.x), no sirve.
  IP="${IP:-}"
  for SERVICIO in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    [ -n "$IP" ] && break
    IP="$(curl -4 -fsS --max-time 10 "$SERVICIO" 2>/dev/null | tr -d '[:space:]' || true)"
  done
  [ -n "$IP" ] || error "No pude averiguar la IP publica. Corre de nuevo agregando IP=x.x.x.x antes de bash."
  cat > "$DATOS" <<EOF
UUID=$(/usr/local/bin/xray uuid)
PRIVADA=$PRIVADA
PUBLICA=$PUBLICA
SHORT_ID=$(openssl rand -hex 8)
SNI=$SNI
IP=$IP
PUERTO=$PUERTO
EOF
  chmod 600 "$DATOS"
fi
# shellcheck disable=SC1090
. "$DATOS"
ok "Claves listas."

paso "Configurando el servidor"
cat > "$CONFIG" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [{
    "listen": "0.0.0.0",
    "port": $PUERTO,
    "protocol": "vless",
    "settings": {
      "clients": [{ "id": "$UUID", "flow": "xtls-rprx-vision" }],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "dest": "$SNI:443",
        "serverNames": ["$SNI"],
        "privateKey": "$PRIVADA",
        "shortIds": ["$SHORT_ID"]
      }
    },
    "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
  }],
  "outbounds": [
    { "protocol": "freedom", "tag": "directo" },
    { "protocol": "blackhole", "tag": "bloqueado" }
  ]
}
EOF
chown root:nogroup "$CONFIG"
chmod 640 "$CONFIG"
/usr/local/bin/xray run -test -config "$CONFIG" >/dev/null || error "La configuracion no es valida."
ok "Configuracion valida."

cat > /etc/systemd/system/mi-vpn.service <<EOF
[Unit]
Description=Mi VPN (Xray VLESS + Reality)
After=network-online.target
Wants=network-online.target

[Service]
User=nobody
Group=nogroup
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/xray run -config $CONFIG
Restart=on-failure
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

paso "Abriendo el puerto $PUERTO en el firewall del servidor"
# Las imagenes de Ubuntu de Oracle Cloud traen iptables que rechaza todo
# menos SSH: hay que abrir el puerto antes de esa regla y guardarlo.
if ! iptables -C INPUT -p tcp --dport "$PUERTO" -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 1 -p tcp --dport "$PUERTO" -j ACCEPT
fi
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow "$PUERTO/tcp" >/dev/null
fi
ok "Puerto $PUERTO abierto."

paso "Acelerando la red (BBR)"
cat > /etc/sysctl.d/99-mi-vpn.conf <<EOF
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl -q --system >/dev/null 2>&1 || true
ok "Control de congestion: $(sysctl -n net.ipv4.tcp_congestion_control)"

paso "Arrancando la VPN"
systemctl daemon-reload
systemctl enable --now mi-vpn >/dev/null 2>&1
systemctl restart mi-vpn
sleep 2
systemctl is-active --quiet mi-vpn || error "La VPN no arranco. Ver: sudo journalctl -u mi-vpn"
ok "Funcionando, y arranca sola si el servidor se reinicia."

mostrar_enlace
