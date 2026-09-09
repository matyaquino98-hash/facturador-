/**
 * Cliente SOAP mínimo.
 *
 * Se arma el envelope a mano en lugar de usar una librería que descargue el WSDL:
 * los servicios de ARCA son SOAP 1.1 con mensajes simples, y evitar la descarga del
 * WSDL en cada arranque elimina un punto de falla y una dependencia pesada.
 */
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  // Quita prefijos de namespace (soap:Body -> Body) para simplificar el acceso.
  transformTagName: (tag) => (tag.includes(':') ? tag.split(':').pop()! : tag),
});

export class ArcaTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ArcaTransportError';
  }
}

export class ArcaSoapFault extends Error {
  constructor(
    message: string,
    readonly faultCode?: string,
  ) {
    super(message);
    this.name = 'ArcaSoapFault';
  }
}

export function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SoapCallOptions {
  url: string;
  soapAction: string;
  /** Cuerpo del elemento raíz de la operación, ya serializado. */
  body: string;
  timeoutMs?: number;
}

export async function soapCall(opts: SoapCallOptions): Promise<Record<string, unknown>> {
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    opts.body +
    '</soap:Body></soap:Envelope>';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: opts.soapAction,
      },
      body: envelope,
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ArcaTransportError(
      `No se pudo contactar al servicio de ARCA (${opts.url}): ${reason}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();

  // ARCA devuelve los SOAP Fault con status 500, así que se parsea igual.
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(text) as Record<string, unknown>;
  } catch {
    throw new ArcaTransportError(
      `Respuesta ilegible de ARCA (HTTP ${response.status}).`,
      response.status,
      text.slice(0, 2000),
    );
  }

  const envelopeNode = pick(parsed, 'Envelope');
  const bodyNode = envelopeNode ? pick(envelopeNode, 'Body') : undefined;

  if (!bodyNode) {
    throw new ArcaTransportError(
      `Respuesta inesperada de ARCA (HTTP ${response.status}).`,
      response.status,
      text.slice(0, 2000),
    );
  }

  const fault = pick(bodyNode, 'Fault');
  if (fault) {
    const faultString =
      asString(pick(fault, 'faultstring')) ?? asString(pick(fault, 'Reason')) ?? 'SOAP Fault';
    throw new ArcaSoapFault(faultString, asString(pick(fault, 'faultcode')));
  }

  if (!response.ok) {
    throw new ArcaTransportError(
      `ARCA respondió HTTP ${response.status}.`,
      response.status,
      text.slice(0, 2000),
    );
  }

  return bodyNode;
}

/** Acceso tolerante a mayúsculas/minúsculas dentro de un nodo parseado. */
export function pick(node: unknown, key: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const obj = node as Record<string, unknown>;
  const found = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
  if (found === undefined) return undefined;
  const value = obj[found];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : ({ '#text': value } as Record<string, unknown>);
}

export function asString(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined || t === null ? undefined : String(t);
  }
  return undefined;
}

export function asNumber(node: unknown): number | undefined {
  const s = asString(node);
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Normaliza un nodo que puede venir como objeto único o como array. */
export function asArray<T = unknown>(node: unknown): T[] {
  if (node === undefined || node === null) return [];
  return (Array.isArray(node) ? node : [node]) as T[];
}
