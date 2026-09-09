/**
 * Emisores y sus credenciales de ARCA.
 *
 * Regla de seguridad: `cert_pem_enc` y `key_pem_enc` nunca salen de este módulo en
 * texto plano. `toPublicIssuer()` es la única forma en que un emisor llega a la API,
 * y no incluye material criptográfico — sólo metadatos del certificado.
 */
import { getDb } from '../db/index.js';
import { decryptSecret, encryptSecret, fingerprint } from '../lib/crypto.js';
import { inspectCertificate, keyMatchesCertificate } from '../arca/wsaa.js';
import type { Environment } from '../arca/endpoints.js';
import type { CondicionEmisor } from '../domain/catalogs.js';

export interface IssuerRow {
  id: number;
  user_id: number;
  cuit: string;
  razon_social: string;
  condicion_iva: string;
  domicilio: string;
  ingresos_brutos: string;
  inicio_actividades: string;
  punto_venta: number;
  environment: string;
  emite_m: number;
  cert_pem_enc: string | null;
  key_pem_enc: string | null;
  cert_fingerprint: string | null;
  cert_subject: string | null;
  cert_not_after: string | null;
  created_at: string;
}

export interface PublicIssuer {
  id: number;
  cuit: string;
  razonSocial: string;
  condicionIva: CondicionEmisor;
  domicilio: string;
  ingresosBrutos: string;
  inicioActividades: string;
  puntoVenta: number;
  environment: Environment;
  emiteM: boolean;
  /** Sólo metadatos: nunca el certificado ni la clave. */
  credenciales: {
    cargadas: boolean;
    huella: string | null;
    sujeto: string | null;
    venceEl: string | null;
    vencido: boolean;
  };
}

export function toPublicIssuer(row: IssuerRow): PublicIssuer {
  const venceEl = row.cert_not_after;
  return {
    id: row.id,
    cuit: row.cuit,
    razonSocial: row.razon_social,
    condicionIva: row.condicion_iva as CondicionEmisor,
    domicilio: row.domicilio,
    ingresosBrutos: row.ingresos_brutos,
    inicioActividades: row.inicio_actividades,
    puntoVenta: row.punto_venta,
    environment: row.environment as Environment,
    emiteM: row.emite_m === 1,
    credenciales: {
      cargadas: Boolean(row.cert_pem_enc && row.key_pem_enc),
      huella: row.cert_fingerprint,
      sujeto: row.cert_subject,
      venceEl,
      vencido: venceEl ? new Date(venceEl).getTime() < Date.now() : false,
    },
  };
}

export function getIssuer(userId: number, issuerId: number): IssuerRow | undefined {
  return getDb()
    .prepare('SELECT * FROM issuers WHERE id = ? AND user_id = ?')
    .get(issuerId, userId) as IssuerRow | undefined;
}

export function listIssuers(userId: number): IssuerRow[] {
  return getDb()
    .prepare('SELECT * FROM issuers WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as IssuerRow[];
}

export interface StoreCredentialsInput {
  certPem: string;
  keyPem: string;
}

/** Valida y guarda el par certificado/clave, siempre cifrado. */
export function storeCredentials(
  userId: number,
  issuerId: number,
  input: StoreCredentialsInput,
): PublicIssuer {
  const row = getIssuer(userId, issuerId);
  if (!row) throw new Error('El emisor no existe.');

  if (!keyMatchesCertificate(input.certPem, input.keyPem)) {
    throw new Error(
      'La clave privada no corresponde al certificado. Verificá que sean el par generado para este CUIT.',
    );
  }

  const meta = inspectCertificate(input.certPem);
  if (new Date(meta.notAfter).getTime() < Date.now()) {
    throw new Error(`El certificado venció el ${new Date(meta.notAfter).toLocaleDateString('es-AR')}.`);
  }

  getDb()
    .prepare(
      `UPDATE issuers
         SET cert_pem_enc = ?, key_pem_enc = ?, cert_fingerprint = ?,
             cert_subject = ?, cert_not_after = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      encryptSecret(input.certPem),
      encryptSecret(input.keyPem),
      fingerprint(input.certPem),
      meta.subject,
      meta.notAfter,
      issuerId,
      userId,
    );

  // Las credenciales cambiaron: los tickets cacheados ya no sirven.
  getDb().prepare('DELETE FROM access_tickets WHERE issuer_id = ?').run(issuerId);

  return toPublicIssuer(getIssuer(userId, issuerId)!);
}

/**
 * Descifra las credenciales. Único punto del sistema donde la clave privada
 * existe en texto plano, y sólo para pasársela al firmador del TRA.
 */
export function loadCredentials(row: IssuerRow): { certPem: string; keyPem: string } {
  if (!row.cert_pem_enc || !row.key_pem_enc) {
    throw new Error(
      'Este emisor todavía no tiene cargado el certificado de ARCA. Subilo desde Configuración.',
    );
  }
  return {
    certPem: decryptSecret(row.cert_pem_enc),
    keyPem: decryptSecret(row.key_pem_enc),
  };
}
