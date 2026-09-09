/**
 * WSFEv1 — Facturación Electrónica, Comprobantes Generales (R.G. 4291).
 * Ver docs/ARCA.md §1 y §3.
 */
import { centsToArca } from '../lib/money.js';
import type { Environment } from './endpoints.js';
import { WSFEV1_URL } from './endpoints.js';
import { asArray, asNumber, asString, escapeXml, pick, soapCall } from './soap.js';

const NS = 'http://ar.gov.afip.dif.FEV1/';

export interface Auth {
  token: string;
  sign: string;
  cuit: string;
}

export interface ArcaMessage {
  code: number;
  msg: string;
}

/**
 * Orden de los elementos dentro de `FECAEDetRequest`.
 *
 * [NO CONFIRMADO — punto de mayor riesgo] El WSDL declara una `xs:sequence`, así que
 * un orden distinto al del esquema hace que ARCA rechace el mensaje. No pude leer el
 * WSDL en esta sesión (dominios de ARCA bloqueados por el proxy de egreso).
 * Está en una sola constante para poder corregirlo contra el WSDL sin tocar nada más:
 * https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
 */
export const DET_FIELD_ORDER = [
  'Concepto',
  'DocTipo',
  'DocNro',
  'CbteDesde',
  'CbteHasta',
  'CbteFch',
  'ImpTotal',
  'ImpTotConc',
  'ImpNeto',
  'ImpOpEx',
  'ImpTrib',
  'ImpIVA',
  'FchServDesde',
  'FchServHasta',
  'FchVtoPago',
  'MonId',
  'MonCotiz',
  'CondicionIVAReceptorId',
  'CbtesAsoc',
  'Tributos',
  'Iva',
] as const;

export interface AlicIva {
  Id: number;
  /** Base imponible en centavos. */
  BaseImpCents: number;
  /** Importe de IVA en centavos. */
  ImporteCents: number;
}

export interface SolicitudCae {
  ptoVta: number;
  cbteTipo: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  cbteNro: number;
  /** AAAAMMDD */
  cbteFch: string;
  impTotalCents: number;
  impTotConcCents: number;
  impNetoCents: number;
  impOpExCents: number;
  impTribCents: number;
  impIvaCents: number;
  /** AAAAMMDD — obligatorios si concepto es 2 o 3. */
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  monId: string;
  monCotiz: number;
  /** R.G. 5616 — obligatorio. */
  condicionIvaReceptorId: number;
  /** Vacío en comprobantes C: el IVA no se discrimina. */
  iva: AlicIva[];
}

export interface RespuestaCae {
  resultado: 'A' | 'R' | 'P';
  cae?: string;
  caeFchVto?: string;
  cbteDesde?: number;
  cbteHasta?: number;
  fchProceso?: string;
  reproceso?: string;
  observaciones: ArcaMessage[];
  errores: ArcaMessage[];
  eventos: ArcaMessage[];
}

function authXml(auth: Auth): string {
  return (
    '<Auth>' +
    `<Token>${escapeXml(auth.token)}</Token>` +
    `<Sign>${escapeXml(auth.sign)}</Sign>` +
    `<Cuit>${escapeXml(auth.cuit)}</Cuit>` +
    '</Auth>'
  );
}

async function call(
  environment: Environment,
  operation: string,
  inner: string,
): Promise<Record<string, unknown>> {
  const body = `<${operation} xmlns="${NS}">${inner}</${operation}>`;
  const responseBody = await soapCall({
    url: WSFEV1_URL[environment],
    soapAction: `${NS}${operation}`,
    body,
  });
  const responseNode = pick(responseBody, `${operation}Response`);
  const resultNode = responseNode ? pick(responseNode, `${operation}Result`) : undefined;
  if (!resultNode) {
    throw new Error(`ARCA no devolvió ${operation}Result.`);
  }
  return resultNode;
}

/** Construye el bloque FECAEDetRequest respetando DET_FIELD_ORDER. */
export function buildDetRequest(s: SolicitudCae): string {
  const values: Partial<Record<(typeof DET_FIELD_ORDER)[number], string>> = {
    Concepto: String(s.concepto),
    DocTipo: String(s.docTipo),
    DocNro: String(s.docNro),
    CbteDesde: String(s.cbteNro),
    CbteHasta: String(s.cbteNro),
    CbteFch: s.cbteFch,
    ImpTotal: centsToArca(s.impTotalCents),
    ImpTotConc: centsToArca(s.impTotConcCents),
    ImpNeto: centsToArca(s.impNetoCents),
    ImpOpEx: centsToArca(s.impOpExCents),
    ImpTrib: centsToArca(s.impTribCents),
    ImpIVA: centsToArca(s.impIvaCents),
    MonId: s.monId,
    MonCotiz: String(s.monCotiz),
    CondicionIVAReceptorId: String(s.condicionIvaReceptorId),
  };

  // Sólo se informan si el concepto es Servicios o Productos y Servicios.
  if (s.fchServDesde) values.FchServDesde = s.fchServDesde;
  if (s.fchServHasta) values.FchServHasta = s.fchServHasta;
  if (s.fchVtoPago) values.FchVtoPago = s.fchVtoPago;

  // En comprobantes C el array Iva no se informa.
  if (s.iva.length > 0) {
    values.Iva = s.iva
      .map(
        (a) =>
          '<AlicIva>' +
          `<Id>${a.Id}</Id>` +
          `<BaseImp>${centsToArca(a.BaseImpCents)}</BaseImp>` +
          `<Importe>${centsToArca(a.ImporteCents)}</Importe>` +
          '</AlicIva>',
      )
      .join('');
  }

  const parts: string[] = [];
  for (const field of DET_FIELD_ORDER) {
    const value = values[field];
    if (value === undefined) continue;
    // Iva ya viene serializado como hijos.
    parts.push(field === 'Iva' ? `<Iva>${value}</Iva>` : `<${field}>${escapeXml(value)}</${field}>`);
  }
  return `<FECAEDetRequest>${parts.join('')}</FECAEDetRequest>`;
}

/** FECAESolicitar — solicita el CAE para un comprobante. */
export async function solicitarCae(
  environment: Environment,
  auth: Auth,
  s: SolicitudCae,
): Promise<RespuestaCae> {
  const inner =
    authXml(auth) +
    '<FeCAEReq>' +
    '<FeCabReq>' +
    '<CantReg>1</CantReg>' +
    `<PtoVta>${s.ptoVta}</PtoVta>` +
    `<CbteTipo>${s.cbteTipo}</CbteTipo>` +
    '</FeCabReq>' +
    `<FeDetReq>${buildDetRequest(s)}</FeDetReq>` +
    '</FeCAEReq>';

  const result = await call(environment, 'FECAESolicitar', inner);
  return parseCaeResponse(result);
}

export function parseCaeResponse(result: Record<string, unknown>): RespuestaCae {
  const errores = parseMessages(pick(result, 'Errors'), 'Err');
  const eventos = parseMessages(pick(result, 'Events'), 'Evt');

  const cab = pick(result, 'FeCabResp');
  const detWrapper = pick(result, 'FeDetResp');
  const det = detWrapper ? pick(detWrapper, 'FECAEDetResponse') : undefined;

  const observaciones = det ? parseMessages(pick(det, 'Observaciones'), 'Obs') : [];

  // El resultado del detalle manda; el de cabecera es el del lote.
  const resultado =
    (asString(det ? pick(det, 'Resultado') : undefined) as 'A' | 'R' | 'P' | undefined) ??
    (asString(cab ? pick(cab, 'Resultado') : undefined) as 'A' | 'R' | 'P' | undefined) ??
    'R';

  const cae = det ? asString(pick(det, 'CAE')) : undefined;

  return {
    resultado,
    // ARCA devuelve CAE vacío en los rechazos: normalizar a undefined.
    cae: cae && cae.trim() !== '' ? cae.trim() : undefined,
    caeFchVto: det ? emptyToUndefined(asString(pick(det, 'CAEFchVto'))) : undefined,
    cbteDesde: det ? asNumber(pick(det, 'CbteDesde')) : undefined,
    cbteHasta: det ? asNumber(pick(det, 'CbteHasta')) : undefined,
    fchProceso: cab ? asString(pick(cab, 'FchProceso')) : undefined,
    reproceso: cab ? emptyToUndefined(asString(pick(cab, 'Reproceso'))) : undefined,
    observaciones,
    errores,
    eventos,
  };
}

function emptyToUndefined(v: string | undefined): string | undefined {
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export function parseMessages(container: unknown, childTag: string): ArcaMessage[] {
  if (!container) return [];
  const child = pick(container, childTag);
  if (!child) return [];
  // Un solo mensaje llega como objeto; varios, como array.
  const raw = Object.prototype.hasOwnProperty.call(child, '#text')
    ? []
    : asArray<Record<string, unknown>>(
        Array.isArray((container as Record<string, unknown>)[childTag])
          ? (container as Record<string, unknown>)[childTag]
          : child,
      );
  return raw
    .map((item) => ({
      code: asNumber(pick(item, 'Code')) ?? 0,
      msg: asString(pick(item, 'Msg'))?.trim() ?? '',
    }))
    .filter((m) => m.code !== 0 || m.msg !== '');
}

/**
 * FECompUltimoAutorizado — último comprobante autorizado para (PtoVta, CbteTipo).
 * El siguiente a emitir es `CbteNro + 1`. Se consulta siempre antes de emitir en
 * lugar de llevar numeración propia: es la única forma de no desincronizarse.
 */
export async function ultimoAutorizado(
  environment: Environment,
  auth: Auth,
  ptoVta: number,
  cbteTipo: number,
): Promise<{ cbteNro: number; errores: ArcaMessage[] }> {
  const inner = authXml(auth) + `<PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>`;
  const result = await call(environment, 'FECompUltimoAutorizado', inner);
  return {
    cbteNro: asNumber(pick(result, 'CbteNro')) ?? 0,
    errores: parseMessages(pick(result, 'Errors'), 'Err'),
  };
}

/** FEDummy — estado de los servidores de ARCA. No requiere Auth. */
export async function dummy(
  environment: Environment,
): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const result = await call(environment, 'FEDummy', '');
  return {
    appServer: asString(pick(result, 'AppServer')) ?? 'desconocido',
    dbServer: asString(pick(result, 'DbServer')) ?? 'desconocido',
    authServer: asString(pick(result, 'AuthServer')) ?? 'desconocido',
  };
}

/** Métodos FEParamGet* que devuelven catálogos {Id, Desc}. */
async function paramGet(
  environment: Environment,
  operation: string,
  auth: Auth,
  itemTag: string,
): Promise<Array<{ id: number; desc: string }>> {
  const result = await call(environment, operation, authXml(auth));
  const container = pick(result, 'ResultGet');
  if (!container) return [];
  const raw = (container as Record<string, unknown>)[itemTag];
  return asArray<Record<string, unknown>>(raw).map((item) => ({
    id: asNumber(pick(item, 'Id')) ?? 0,
    desc: asString(pick(item, 'Desc')) ?? '',
  }));
}

export const paramGetTiposCbte = (e: Environment, a: Auth) =>
  paramGet(e, 'FEParamGetTiposCbte', a, 'CbteTipo');

export const paramGetTiposIva = (e: Environment, a: Auth) =>
  paramGet(e, 'FEParamGetTiposIva', a, 'IvaTipo');

export const paramGetTiposDoc = (e: Environment, a: Auth) =>
  paramGet(e, 'FEParamGetTiposDoc', a, 'DocTipo');

/** R.G. 5616 — lista autoritativa de condiciones de IVA del receptor. */
export const paramGetCondicionIvaReceptor = (e: Environment, a: Auth) =>
  paramGet(e, 'FEParamGetCondicionIvaReceptor', a, 'CondicionIvaReceptor');
