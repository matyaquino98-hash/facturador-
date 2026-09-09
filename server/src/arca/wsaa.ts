/**
 * WSAA — Web Service de Autenticación y Autorización de ARCA.
 *
 * Flujo (docs/ARCA.md §2):
 *   1. Armar el TRA (LoginTicketRequest XML).
 *   2. Firmarlo como CMS/PKCS#7 con la clave privada + certificado X.509 de ARCA.
 *   3. Enviarlo en Base64 al método `loginCms`.
 *   4. Recibir el TA con `token`, `sign` y `expirationTime`.
 *
 * El TA se cachea en base de datos por (emisor, servicio, entorno). Pedir un TA nuevo
 * mientras el anterior sigue vigente hace que ARCA rechace la solicitud, así que el
 * caché no es una optimización: es parte del contrato del servicio.
 */
import forge from 'node-forge';
import type { Environment } from './endpoints.js';
import { WSAA_URL } from './endpoints.js';
import { asString, escapeXml, pick, soapCall } from './soap.js';

/**
 * [NO CONFIRMADO] Namespace y nombre de parámetro del envelope `loginCms`.
 * Provienen de implementaciones de referencia; no pude leer el WSDL oficial
 * (dominios de ARCA bloqueados por el proxy de egreso). Verificar contra
 * https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL antes de producción.
 */
export const WSAA_SOAP = {
  namespace: 'http://wsaa.view.sua.dvadac.desarrollo.afip.gov',
  operation: 'loginCms',
  parameter: 'in0',
  soapAction: '',
} as const;

/** Margen de seguridad: se renueva el TA antes de su expiración real. */
const RENEW_MARGIN_MS = 10 * 60 * 1000;

export interface AccessTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export interface TraOptions {
  service: string;
  /** Ventana de validez solicitada. ARCA acepta ventanas cortas. */
  ttlMinutes?: number;
}

/** Arma el LoginTicketRequest XML. */
export function buildTra(opts: TraOptions): string {
  const now = Date.now();
  // generationTime hacia atrás: cubre desfasajes de reloj contra el servidor de ARCA.
  const generation = new Date(now - 10 * 60 * 1000);
  const expiration = new Date(now + (opts.ttlMinutes ?? 10) * 60 * 1000);
  const uniqueId = Math.floor(now / 1000) % 4294967295;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0">' +
    '<header>' +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${toArcaDateTime(generation)}</generationTime>` +
    `<expirationTime>${toArcaDateTime(expiration)}</expirationTime>` +
    '</header>' +
    `<service>${escapeXml(opts.service)}</service>` +
    '</loginTicketRequest>'
  );
}

/** ISO-8601 con offset, formato aceptado por el WSAA. */
export function toArcaDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** `forge.pki.oids` está tipado como Record<string, string|undefined>. */
function oid(name: string): string {
  const value = forge.pki.oids[name];
  if (!value) throw new Error(`OID desconocido: ${name}`);
  return value;
}

export class ArcaCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArcaCredentialError';
  }
}

/** Firma el TRA como CMS/PKCS#7 (SignedData) y lo devuelve en Base64. */
export function signTra(tra: string, certPem: string, keyPem: string): string {
  let certificate: forge.pki.Certificate;
  let privateKey: forge.pki.rsa.PrivateKey;

  try {
    certificate = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaCredentialError(
      'El certificado no es un PEM válido. Debe empezar con "-----BEGIN CERTIFICATE-----".',
    );
  }
  try {
    privateKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new ArcaCredentialError(
      'La clave privada no es un PEM válido, o está protegida con passphrase (no soportado).',
    );
  }

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(certificate);
  p7.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: oid('sha256'),
    authenticatedAttributes: [
      { type: oid('contentType'), value: oid('data') },
      { type: oid('messageDigest') },
      { type: oid('signingTime'), value: new Date().toISOString() },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

export interface LoginOptions {
  service: string;
  environment: Environment;
  certPem: string;
  keyPem: string;
}

/** Pide un Ticket de Acceso nuevo al WSAA. */
export async function login(opts: LoginOptions): Promise<AccessTicket> {
  const tra = buildTra({ service: opts.service });
  const cms = signTra(tra, opts.certPem, opts.keyPem);

  const body =
    `<${WSAA_SOAP.operation} xmlns="${WSAA_SOAP.namespace}">` +
    `<${WSAA_SOAP.parameter}>${cms}</${WSAA_SOAP.parameter}>` +
    `</${WSAA_SOAP.operation}>`;

  const responseBody = await soapCall({
    url: WSAA_URL[opts.environment],
    soapAction: WSAA_SOAP.soapAction,
    body,
  });

  const responseNode = pick(responseBody, 'loginCmsResponse');
  const returnNode = responseNode ? pick(responseNode, 'loginCmsReturn') : undefined;
  const xml = asString(returnNode);

  if (!xml) {
    throw new ArcaCredentialError('El WSAA no devolvió un Ticket de Acceso.');
  }

  return parseLoginTicketResponse(xml);
}

/** Parsea el LoginTicketResponse que devuelve `loginCms` (viene como XML escapado). */
export function parseLoginTicketResponse(xml: string): AccessTicket {
  const token = matchTag(xml, 'token');
  const sign = matchTag(xml, 'sign');
  const expiration = matchTag(xml, 'expirationTime');

  if (!token || !sign) {
    throw new ArcaCredentialError('El Ticket de Acceso del WSAA no contiene token y sign.');
  }

  const expiresAt = expiration ? new Date(expiration) : new Date(Date.now() + 11 * 3600 * 1000);
  return {
    token,
    sign,
    expiresAt: Number.isNaN(expiresAt.getTime())
      ? new Date(Date.now() + 11 * 3600 * 1000)
      : expiresAt,
  };
}

function matchTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m?.[1]?.trim();
}

export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() - RENEW_MARGIN_MS <= Date.now();
}

/** Metadatos del certificado, para mostrarlos en la UI sin exponer el material. */
export function inspectCertificate(certPem: string): {
  subject: string;
  notAfter: string;
  serial: string;
} {
  let certificate: forge.pki.Certificate;
  try {
    certificate = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaCredentialError('El certificado no es un PEM válido.');
  }
  const subject = certificate.subject.attributes
    .map((a) => `${a.shortName ?? a.name}=${String(a.value)}`)
    .join(', ');
  return {
    subject,
    notAfter: certificate.validity.notAfter.toISOString(),
    serial: certificate.serialNumber,
  };
}

/** Verifica que la clave privada corresponda al certificado antes de guardarlos. */
export function keyMatchesCertificate(certPem: string, keyPem: string): boolean {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    const pub = cert.publicKey as forge.pki.rsa.PublicKey;
    return pub.n.compareTo(key.n) === 0 && pub.e.compareTo(key.e) === 0;
  } catch {
    return false;
  }
}
