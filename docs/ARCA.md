# Integración con ARCA (ex AFIP) — investigación y decisiones

> **Estado de la verificación.** Durante esta sesión el proxy de egreso del entorno
> **bloqueó todos los dominios de ARCA/AFIP** (`www.afip.gob.ar`, `www.arca.gob.ar`,
> `servicioscf.afip.gob.ar`, `wswhomo.afip.gov.ar`, `ftp.afip.gov.ar`). No fue posible
> descargar los PDF oficiales ni los WSDL. Todo lo marcado como **[VERIFICADO]** está
> corroborado por resultados de búsqueda que citan la documentación oficial; lo marcado
> como **[NO CONFIRMADO]** proviene de implementaciones de referencia ampliamente usadas
> y **debe validarse contra el WSDL/manual oficial antes de producción**.
> El código concentra estos puntos en lugares únicos y señalizados para que la
> verificación sea barata (ver `server/src/arca/`).

## 1. Servicio correcto para facturación electrónica

**WSFEv1** — "Facturación Electrónica – Comprobantes Generales", R.G. N° 4.291. Emite
comprobantes A, B, C y M **sin detalle de ítems** (ARCA no recibe el detalle de
productos; sólo los totales por alícuota) y devuelve **CAE**. **[VERIFICADO]**

- Documentación: <https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp>
- Manual del desarrollador (v4.x): <https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf>
- Contacto funcional oficial: `wsfev1@arca.gov.ar`

No se usa scraping. Toda la operación va por SOAP contra el web service oficial.

### Endpoints **[VERIFICADO]**

| Entorno | URL |
|---|---|
| Homologación | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Producción | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

Los WSDL son las mismas URLs con `?WSDL`.

## 2. Autenticación: WSAA

Todo método de WSFEv1 requiere un **Ticket de Acceso (TA)** emitido por el
**WSAA** (Web Service de Autenticación y Autorización). **[VERIFICADO]**

- Documentación: <https://www.afip.gob.ar/ws/documentacion/wsaa.asp>
- Manual: <https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf>
- Especificación técnica 1.2.2: <https://www.afip.gob.ar/ws/wsaa/especificacion_tecnica_wsaa_1.2.2.pdf>

### Endpoints **[VERIFICADO]**

| Entorno | URL |
|---|---|
| Homologación | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` |
| Producción | `https://wsaa.afip.gov.ar/ws/services/LoginCms` |

### Mecanismo **[VERIFICADO]**

1. Se arma un **TRA** (`LoginTicketRequest`) XML con `uniqueId`, `generationTime`,
   `expirationTime` y `service` (`wsfe` para WSFEv1).
2. Se firma como estructura **CMS / PKCS#7 (S/MIME)** que contiene el request, su firma
   digital y el **certificado X.509** emitido por ARCA. Se envía en **Base64**.
3. Se invoca `loginCms` y se recibe `LoginTicketResponse` con `credentials/token`,
   `credentials/sign` y `header/expirationTime`.
4. `token` + `sign` + `cuit` forman el bloque `Auth` de cada llamada a WSFEv1.

El TA tiene **validez limitada** (típicamente 12 h) y debe cachearse: pedir uno nuevo en
cada request produce rechazos por parte de ARCA. Implementado en
`server/src/arca/wsaa.ts` con caché en base de datos por (cuit, servicio, entorno).

**[NO CONFIRMADO]** El *namespace* SOAP del envelope `loginCms`
(`http://wsaa.view.sua.dvadac.desarrollo.afip.gov`) y el nombre del parámetro (`in0`)
provienen de implementaciones de referencia, no pude leer el WSDL. Está aislado en
`WSAA_SOAP` dentro de `server/src/arca/wsaa.ts`.

### Certificados y credenciales **[VERIFICADO]**

- El certificado X.509 lo emite ARCA **gratuitamente** a partir de un CSR generado por el
  contribuyente; se tramita con **Clave Fiscal**.
- Hay que **asociar el certificado al servicio de negocio** ("Facturación Electrónica"):
  - Homologación: aplicación **WSASS**.
  - Producción: **Administrador de Relaciones de Clave Fiscal**.
- El **entorno de homologación es independiente del productivo**: certificado distinto,
  asociación distinta, y los comprobantes emitidos allí no tienen validez fiscal.

Ver `docs/CERTIFICADOS.md` para el paso a paso de generación de clave y CSR.

## 3. Datos que ARCA necesita por comprobante (FECAESolicitar)

Cabecera `FeCabReq`: `CantReg`, `PtoVta`, `CbteTipo` — todos los comprobantes del lote
deben ser del mismo tipo y punto de venta. **[VERIFICADO]**

Detalle `FECAEDetRequest` (campos usados por este MVP):

| Campo | Uso |
|---|---|
| `Concepto` | 1 Productos, 2 Servicios, 3 Productos y Servicios **[VERIFICADO]** |
| `DocTipo` / `DocNro` | 80 CUIT, 86 CUIL, 96 DNI, 99 Consumidor Final/sin identificar |
| `CbteDesde` / `CbteHasta` | Número de comprobante (igual para emisión unitaria) |
| `CbteFch` | `AAAAMMDD` |
| `ImpTotal` | Neto + IVA + no gravado + exento + tributos |
| `ImpTotConc` | Neto no gravado |
| `ImpNeto` | Neto gravado |
| `ImpOpEx` | Exento |
| `ImpTrib` | Otros tributos |
| `ImpIVA` | IVA total |
| `FchServDesde` / `FchServHasta` / `FchVtoPago` | Obligatorios si `Concepto` es 2 o 3 |
| `MonId` / `MonCotiz` | `PES` / `1` para pesos |
| `CondicionIVAReceptorId` | Condición frente al IVA del receptor |
| `Iva` → `AlicIva{Id, BaseImp, Importe}` | Una entrada por alícuota |
| `Tributos` → `Tributo{...}` | Otros tributos (no usado en el MVP) |

**`CondicionIVAReceptorId` — R.G. 5616 [VERIFICADO]**: es obligatorio. El cronograma se
prorrogó varias veces (obligatorio desde 15/04/2025, no excluyente hasta 31/08/2026) y
pasó a ser **estrictamente obligatorio a partir del 01/09/2026**. Omitirlo o mandar un
valor incompatible con el tipo de comprobante devuelve el error **10242** —
"El campo Condicion IVA receptor no es un valor válido / es obligatorio".
La lista autoritativa se obtiene con **`FEParamGetCondicionIvaReceptor`**; la app trae una
tabla local como *fallback* y ofrece `POST /api/arca/sync-catalogos` para refrescarla
desde ARCA.

**[NO CONFIRMADO] — el punto de mayor riesgo:** el **orden de los elementos** dentro de
`FECAEDetRequest`. El WSDL define una `xs:sequence`, así que un orden incorrecto produce
un rechazo del servicio. El orden usado está en la constante `DET_FIELD_ORDER`
(`server/src/arca/wsfev1.ts`), en un solo lugar y documentado, para poder corregirlo
contra el WSDL sin tocar el resto del código.

### Otros métodos utilizados

- `FEDummy` — chequeo de salud de AppServer/DbServer/AuthServer (no requiere Auth).
- `FECompUltimoAutorizado(PtoVta, CbteTipo)` — último número autorizado; el siguiente
  comprobante es `CbteNro + 1`. La app lo consulta **siempre antes de emitir** en lugar de
  llevar su propia numeración, que es la única forma de no desincronizarse con ARCA.
- `FEParamGetTiposCbte`, `FEParamGetTiposIva`, `FEParamGetTiposDoc`,
  `FEParamGetCondicionIvaReceptor`, `FEParamGetPtosVenta` — catálogos.

## 4. Determinación del tipo de comprobante

Reglas implementadas en `server/src/domain/invoiceType.ts` **[VERIFICADO]** en su forma
general (R.G. 1415 y régimen de monotributo):

| Emisor | Receptor | Comprobante |
|---|---|---|
| Responsable Inscripto | Responsable Inscripto | **A** (IVA discriminado) |
| Responsable Inscripto | Monotributista | **A** |
| Responsable Inscripto | Exento / No responsable / No categorizado | **B** |
| Responsable Inscripto | Consumidor Final | **B** (IVA no se discrimina en el impreso) |
| Monotributista | cualquiera | **C** |
| Exento | cualquiera | **C** |

Notas y límites conocidos:

- La app **sugiere** el tipo y permite override manual, porque hay situaciones que no se
  pueden resolver sólo con la condición fiscal.
- **Comprobantes M**: un RI puede quedar habilitado sólo a emitir **M** en lugar de A
  (R.G. 4.132-E, evaluación de comportamiento fiscal por parte de ARCA). La app **no**
  decide esto automáticamente: el emisor puede forzar "emitir M en vez de A" desde su
  configuración. Determinarlo automáticamente requeriría consultar el servicio de
  "Constancia de Inscripción" del **emisor** e interpretar su habilitación, algo que **no
  pude verificar en documentación oficial** en esta sesión.
- En **Factura C** el IVA **no se discrimina**: `ImpNeto` = total, `ImpIVA` = 0 y **no se
  informa el array `Iva`**. En **Factura B** el IVA **sí se informa a ARCA** discriminado
  (`ImpNeto` + `ImpIVA` = `ImpTotal`); lo que no se discrimina es la **impresión**.

## 5. Consulta de datos del receptor

Servicio **Constancia de Inscripción** (`ws_sr_constancia_inscripcion`), que **reemplaza
al deprecado Padrón Alcance 5** (`ws_sr_padron_a5`). **[VERIFICADO]**

- Catálogo: <https://www.afip.gob.ar/ws/documentacion/catalogo.asp>
- Manual v3.7: <https://www.arca.gob.ar/ws/WSCI/manual_ws_sr_ws_constancia_inscripcion_v3.7.pdf>
- El `service` para pedir el TA al WSAA es `ws_sr_constancia_inscripcion`.
- Requiere **habilitación y asociación de certificado propias**, distintas de las de
  `wsfe`. Soporte técnico oficial: `sri@arca.gob.ar`.

La app lo usa para autocompletar razón social y condición fiscal a partir del CUIT. Es
**opcional**: si el emisor no tiene el servicio habilitado, la carga manual sigue
funcionando y la UI lo informa sin bloquear la emisión.

**[NO CONFIRMADO]** Las URLs exactas de este servicio y la forma precisa de la respuesta
(`personaReturn`) no pude leerlas del manual. Están aisladas en
`server/src/arca/padron.ts` y el parseo es defensivo (si el shape no coincide, devuelve
"no disponible" en vez de romper la emisión).

## 6. Obtención del CAE y respuestas

`FECAESolicitarResult` devuelve: **[VERIFICADO]**

- `FeCabResp`: `Resultado` (**A** aprobado, **R** rechazado, **P** parcial), `FchProceso`,
  `Reproceso`, `CantReg`.
- `FeDetResp/FECAEDetResponse`: `CAE`, `CAEFchVto` (`AAAAMMDD`), `Resultado`, y
  `Observaciones/Obs{Code, Msg}`.
- `Errors/Err{Code, Msg}` a nivel de request y `Events/Evt{Code, Msg}`.

Distinción importante implementada en `server/src/arca/errors.ts`:

- **`Errors`** → la solicitud falló; no hay CAE.
- **`Observaciones`** con `Resultado = A` → **el comprobante fue aprobado igual**. Se
  guarda el CAE y se muestran las observaciones como advertencia, no como error.
- **`Resultado = R`** → rechazado; se muestran `Errors` + `Observaciones`.

Códigos frecuentes mapeados a mensajes en castellano llano (10016 fecha fuera de rango,
10015 numeración correlativa, 10242 condición IVA receptor, 600/601 token inválido,
etc.), con *fallback* al mensaje literal de ARCA. Ante `Resultado = R` la app **no**
consume el número: vuelve a preguntar `FECompUltimoAutorizado` en el siguiente intento.

## 7. Contenido obligatorio del comprobante impreso (PDF)

- Datos de emisor (razón social, domicilio, CUIT, condición frente al IVA, ingresos
  brutos, inicio de actividades), tipo y letra de comprobante, punto de venta y número,
  fecha, datos del receptor, detalle, totales, **CAE** y **fecha de vencimiento del CAE**
  (R.G. 1415 y concordantes).
- **Código QR obligatorio — R.G. 4892/2020 [VERIFICADO]**. Es un JSON codificado en
  Base64 y agregado como parámetro a la URL de verificación:
  `https://www.afip.gob.ar/fe/qr/?p=<base64(json)>`
  Especificación: <https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf>

  Campos del JSON (ejemplo oficial citado en la especificación):

  ```json
  {"ver":1,"fecha":"2020-10-13","cuit":30000000007,"ptoVta":10,"tipoCmp":1,
   "nroCmp":94,"importe":12100,"moneda":"DOL","ctz":65,"tipoDocRec":80,
   "nroDocRec":20000000001,"tipoCodAut":"E","codAut":70417054367476}
  ```

  `tipoCodAut`: `"E"` = autorizado por **CAE**, `"A"` = por **CAEA**. `codAut` = el código
  de autorización (14 dígitos). Implementado en `server/src/pdf/qr.ts`.

**Lo que este MVP NO resuelve** y hay que tener presente: el diseño del comprobante
impreso tiene requisitos formales adicionales (tipografías mínimas, ubicación del código
de barras/letra, datos de la imprenta en comprobantes preimpresos). El PDF generado
incluye los datos obligatorios que pude verificar; **antes de usarlo en producción
conviene que un contador valide el diseño**.

## 8. Modo homologación vs. producción

Cada emisor tiene un campo `environment` (`homologacion` | `produccion`) que selecciona
**todas** las URLs y la caché de TA. La UI muestra un banner permanente cuando el emisor
está en homologación. No hay forma de emitir en producción por accidente: el entorno es
parte del registro del emisor, no una variable global.

## Fuentes

- [Webservices de factura electrónica — ARCA](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [Manual del desarrollador ARCA COMPG v4.0](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf)
- [WSAA — Documentación ARCA](https://www.afip.gob.ar/ws/documentacion/wsaa.asp)
- [WSAA Manual del Desarrollador](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf)
- [Especificación técnica WSAA 1.2.2](https://www.afip.gob.ar/ws/wsaa/especificacion_tecnica_wsaa_1.2.2.pdf)
- [Catálogo de WS de negocio — ARCA](https://www.afip.gob.ar/ws/documentacion/catalogo.asp)
- [Manual ws_sr_constancia_inscripcion v3.7](https://www.arca.gob.ar/ws/WSCI/manual_ws_sr_ws_constancia_inscripcion_v3.7.pdf)
- [Especificaciones del QR (R.G. 4892)](https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf)
- [Error 10242 — Condición IVA receptor](https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/)
- [Actualización WSFEv1 v4.7 y obligatoriedad de IVA Receptor](https://www.signature.ar/novedades/actualizaci%C3%B3n-arca:-lanzamiento-del-wsfev1-v4.7-y-obligatoriedad-del-iva-receptor)
