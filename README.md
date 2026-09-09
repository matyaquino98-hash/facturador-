# Facturador — facturación electrónica ARCA

MVP de facturación electrónica para Argentina. Un flujo, pocos pasos:

```
Nueva factura → Cliente → Producto/servicio → Total → Generar → ARCA → CAE → PDF
```

Integra el web service oficial **WSFEv1** de ARCA (R.G. 4291) con autenticación por
**WSAA**. No hay scraping del sitio de ARCA en ninguna parte.

> **Leé [`docs/ARCA.md`](docs/ARCA.md) antes de usar esto en producción.** Ahí está la
> investigación de la documentación oficial, y marcado con claridad qué pude verificar
> contra las fuentes de ARCA y **qué no** — durante el desarrollo el entorno tenía
> bloqueado el acceso a los dominios de ARCA, así que hay tres puntos (el namespace SOAP
> del WSAA, el orden de elementos de `FECAEDetRequest` y el servicio de padrón) que
> requieren una verificación final contra el WSDL.

## Qué hace

- **Emisor**: CUIT, razón social, condición frente al IVA, domicilio, punto de venta y
  certificado de ARCA. Multi-emisor, con entorno (homologación/producción) por emisor.
- **Receptor**: CUIT / CUIL / DNI / consumidor final, con autocompletado por el servicio
  de Constancia de Inscripción y clientes frecuentes.
- **Comprobante**: determina A / B / C según la condición fiscal de ambas partes, y deja
  cambiarlo a mano cuando corresponde.
- **Ítems**: carga rápida, productos frecuentes, IVA por línea, precios con IVA incluido.
- **Cálculo**: neto, IVA por alícuota y total, en **aritmética entera** (sin floats).
- **Emisión**: valida, pide el número a ARCA, solicita el CAE, guarda y muestra el
  resultado. Los errores de ARCA se traducen a castellano llano.
- **PDF**: comprobante con los datos obligatorios y el **código QR de la R.G. 4892**.
- **Historial**: búsqueda por cliente, CUIT y número; filtros por fecha y estado.

## Stack

| Capa | Elección | Por qué |
|---|---|---|
| Backend | Node 20+ · TypeScript · Fastify | Liviano, tipado, sin ceremonia |
| Base de datos | SQLite (better-sqlite3) | Cero configuración para el volumen de una PyME |
| Integración ARCA | SOAP armado a mano + `node-forge` | Sin descargar WSDL en runtime; firma CMS/PKCS#7 real |
| PDF | `pdfkit` + `qrcode` | Sin navegador headless |
| Frontend | React · Vite | SPA simple, responsive |
| Tests | Vitest | 102 tests, incluido el flujo completo contra un ARCA simulado |

El repositorio estaba vacío, así que la arquitectura se eligió desde cero priorizando
simplicidad y mantenibilidad.

## Puesta en marcha

```bash
npm install
cp .env.example .env
# Generá la clave maestra y pegala en APP_ENCRYPTION_KEY
openssl rand -base64 48

npm run dev          # backend en :3000 + frontend en :5173
```

Después, en la app: crear cuenta → **Configuración** → cargar el emisor → pegar
certificado y clave privada (ver [`docs/CERTIFICADOS.md`](docs/CERTIFICADOS.md)).

Empezá siempre en **homologación**. La app muestra un banner permanente y estampa
"SIN VALIDEZ FISCAL" en el PDF mientras estés en ese entorno.

### Producción

```bash
npm run build
NODE_ENV=production APP_ENCRYPTION_KEY=... COOKIE_SECURE=true npm start
```

El backend sirve el build del frontend, así que queda un solo proceso. Poné un reverse
proxy con TLS adelante: la cookie de sesión sólo se marca `Secure` con `COOKIE_SECURE=true`.

## Tests

```bash
npm test           # 102 tests
npm run typecheck
```

Cubren cálculo de IVA, totales y redondeos, validación de CUIT, validación de datos
obligatorios, determinación del comprobante, construcción y parseo de los mensajes de
WSFEv1, manejo de errores de ARCA, emisión exitosa y generación del PDF.

El flujo de emisión se prueba de punta a punta contra un **ARCA simulado**
(`server/test/helpers/fakeArca.ts`): la firma CMS, el SOAP y la persistencia son reales;
sólo la red está interceptada. Eso permite ejercitar rechazos, observaciones y caídas de
red sin depender de la disponibilidad de ARCA.

## Seguridad

- El certificado y la clave privada se guardan **cifrados con AES-256-GCM**. Ninguna ruta
  de la API los devuelve: sólo se exponen metadatos (sujeto, vencimiento, huella).
- Los tickets de acceso del WSAA también se guardan cifrados y se cachean hasta su
  expiración, como exige el servicio.
- El frontend **nunca** ve credenciales de ARCA: todo pasa por el backend.
- El logger redacta cookies y cabeceras de autorización, y no loguea cuerpos de request.
- Contraseñas con `scrypt`; sesiones en cookie `httpOnly` + `SameSite=Lax`.
- Cada consulta filtra por usuario: no hay forma de leer comprobantes ajenos.

## Estructura

```
server/src/
  arca/        endpoints, WSAA, WSFEv1, padrón, traducción de errores
  domain/      catálogos, determinación de comprobante, totales, validación, fechas
  lib/         aritmética monetaria entera, CUIT, cifrado
  pdf/         comprobante y código QR (R.G. 4892)
  routes/      auth, emisores, facturas, clientes/productos
  services/    emisores + credenciales, caché de TA, orquestación de la emisión
web/src/       SPA (nueva factura, resultado, historial, configuración)
docs/          investigación de ARCA y guía de certificados
```

## Fuera de alcance (segunda etapa)

Notas de crédito y débito, comprobantes asociados, moneda extranjera, otros tributos por
línea, exportación (WSFEXv1), CAEA, lotes de más de un comprobante y reportes.
