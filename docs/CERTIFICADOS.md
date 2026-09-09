# Certificado y credenciales de ARCA

Para emitir comprobantes por web service hacen falta tres cosas:

1. Un **certificado X.509** emitido por ARCA a tu nombre.
2. La **clave privada** con la que generaste el pedido de ese certificado.
3. Que el certificado esté **asociado al servicio "Facturación Electrónica"** y que el
   **punto de venta** esté habilitado para web service.

Homologación y producción son **entornos separados**: certificado distinto, asociación
distinta. Empezá siempre por homologación.

## 1. Generar la clave privada y el pedido (CSR)

**El camino corto**, desde la raíz del proyecto:

```bash
npm run certificado -- --cuit 20123456786 --nombre "TU RAZON SOCIAL"
```

Deja `certs/arca.key` (con permisos 600) y `certs/arca.csr`. Se niega a pisar una clave
existente, valida el CUIT antes de trabajar y arma el `serialNumber` en el formato que
ARCA exige. Si preferís hacerlo a mano, es equivalente a esto:

```bash
# Clave privada (guardala como un secreto: quien la tiene puede facturar a tu nombre)
openssl genrsa -out arca.key 2048

# Pedido de certificado. Reemplazá el CUIT y el nombre.
openssl req -new -key arca.key \
  -subj "/C=AR/O=TU RAZON SOCIAL/CN=facturador/serialNumber=CUIT 20123456786" \
  -out arca.csr
```

`CN` es un nombre libre para identificar la aplicación. `serialNumber` **debe** contener
tu CUIT en el formato `CUIT 20123456786` (sin guiones).

La clave privada se genera **sin passphrase**: la app no soporta claves cifradas con
contraseña, porque necesita firmar el TRA sin intervención humana.

## 2. Obtener el certificado

**Homologación** — aplicación **WSASS** (Autogestión Certificados Homologación):

1. Entrá con Clave Fiscal y buscá el servicio WSASS.
2. "Nuevo certificado": pegá el contenido de `arca.csr` y descargá el `.crt` resultante.
3. En "Crear autorización a Servicio" asociá ese certificado (DN) al servicio
   **`wsfe`** (Facturación Electrónica), indicando el CUIT representado.

**Producción** — con Clave Fiscal:

1. **Administrador de Relaciones de Clave Fiscal** → "Nueva Relación".
2. Buscá **Computadores Fiscales → Administración de Certificados Digitales**, subí el
   CSR y descargá el certificado.
3. En el mismo Administrador de Relaciones, creá la relación entre el certificado (como
   representante) y el servicio **Facturación Electrónica**.

Guardá el certificado como `arca.crt`.

## 3. Habilitar el punto de venta

En "Administración de Puntos de Venta y Domicilios" (con Clave Fiscal) tiene que existir
un punto de venta del tipo **"Factura Electrónica - Monotributo - Web Services"** o
**"RECE para aplicativo y web services"**, según tu condición. Ese es el número que vas a
cargar en la app. Un punto de venta usado por el portal web de ARCA **no sirve** para web
service: ARCA devuelve el error 10004.

## 4. Cargarlos en la app

Configuración → tu emisor → *Guardar credenciales*. Pegá:

- **Certificado**: el contenido de `arca.crt` (empieza con `-----BEGIN CERTIFICATE-----`).
- **Clave privada**: el contenido de `arca.key` (empieza con `-----BEGIN PRIVATE KEY-----`
  o `-----BEGIN RSA PRIVATE KEY-----`).

La app verifica que la clave se corresponda con el certificado y que no esté vencido antes
de guardarlos. Se almacenan **cifrados con AES-256-GCM** usando `APP_ENCRYPTION_KEY` y no
vuelven a salir del servidor en ningún momento.

## Consideraciones de seguridad

- **La clave privada nunca se versiona.** El `.gitignore` ya excluye `*.key`, `*.pem`,
  `*.crt`, `*.p12` y `certs/`.
- **`APP_ENCRYPTION_KEY` es tan sensible como la clave privada**: con ella se descifra lo
  guardado en la base. Generala con `openssl rand -base64 48` y manejala como secreto de
  despliegue, no en el repositorio.
- Si perdés `APP_ENCRYPTION_KEY`, las credenciales guardadas quedan ilegibles: hay que
  volver a cargar certificado y clave. La app lo detecta y pide un ticket nuevo sin romper.
- Si sospechás que la clave privada se filtró, **revocá el certificado en ARCA** y generá
  uno nuevo. Quien tenga esa clave puede emitir comprobantes a tu nombre.
- El certificado tiene vencimiento (típicamente 2 años). La app muestra la fecha en
  Configuración y bloquea la carga de uno ya vencido.

## Errores frecuentes

| Síntoma | Causa habitual |
|---|---|
| `600` / `601` al emitir | El certificado no está asociado al servicio `wsfe`, o el CUIT del emisor no coincide con el del certificado. |
| `10003` / `10004` | El punto de venta no existe o no es del tipo "web services". |
| "La clave privada no corresponde al certificado" | Se mezclaron pares de distintos trámites. Regenerá el CSR con la misma `arca.key`. |
| "La clave privada no es un PEM válido, o está protegida con passphrase" | Generá la clave sin `-aes256` / sin contraseña. |
