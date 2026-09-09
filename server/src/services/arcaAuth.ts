/**
 * Obtención y caché del Ticket de Acceso (TA) del WSAA.
 *
 * ARCA rechaza pedir un TA nuevo mientras el anterior sigue vigente, así que el caché
 * es parte del contrato del servicio, no una optimización. Se guarda cifrado: token y
 * sign son credenciales de sesión con las que se podría emitir en nombre del emisor.
 */
import { getDb } from '../db/index.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { isExpired, login } from '../arca/wsaa.js';
import type { Environment } from '../arca/endpoints.js';
import type { Auth } from '../arca/wsfev1.js';
import { loadCredentials, type IssuerRow } from './issuers.js';

interface TicketRow {
  token_enc: string;
  sign_enc: string;
  expires_at: string;
}

/** Serializa los logins concurrentes por emisor+servicio. */
const inFlight = new Map<string, Promise<Auth>>();

export async function getAuth(row: IssuerRow, service: string): Promise<Auth> {
  const environment = row.environment as Environment;
  const cacheKey = `${row.id}:${service}:${environment}`;

  const cached = readCache(row.id, service, environment);
  if (cached) return { ...cached, cuit: row.cuit };

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    const { certPem, keyPem } = loadCredentials(row);
    const ticket = await login({ service, environment, certPem, keyPem });

    getDb()
      .prepare(
        `INSERT INTO access_tickets (issuer_id, service, environment, token_enc, sign_enc, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (issuer_id, service, environment)
         DO UPDATE SET token_enc = excluded.token_enc,
                       sign_enc  = excluded.sign_enc,
                       expires_at = excluded.expires_at`,
      )
      .run(
        row.id,
        service,
        environment,
        encryptSecret(ticket.token),
        encryptSecret(ticket.sign),
        ticket.expiresAt.toISOString(),
      );

    return { token: ticket.token, sign: ticket.sign, cuit: row.cuit };
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

function readCache(
  issuerId: number,
  service: string,
  environment: Environment,
): { token: string; sign: string } | null {
  const row = getDb()
    .prepare(
      'SELECT token_enc, sign_enc, expires_at FROM access_tickets WHERE issuer_id = ? AND service = ? AND environment = ?',
    )
    .get(issuerId, service, environment) as TicketRow | undefined;

  if (!row) return null;
  if (isExpired(new Date(row.expires_at))) return null;

  try {
    return { token: decryptSecret(row.token_enc), sign: decryptSecret(row.sign_enc) };
  } catch {
    // Cambió APP_ENCRYPTION_KEY: el caché es ilegible, se pide un TA nuevo.
    return null;
  }
}

export function invalidateAuth(issuerId: number): void {
  getDb().prepare('DELETE FROM access_tickets WHERE issuer_id = ?').run(issuerId);
}
