/**
 * Cifrado en reposo de las credenciales de ARCA (clave privada y certificado).
 *
 * AES-256-GCM con clave maestra derivada de APP_ENCRYPTION_KEY. El texto plano
 * de la clave privada sólo existe en memoria durante la firma del TRA: nunca se
 * escribe en la base sin cifrar, nunca se loguea y ninguna ruta de la API lo devuelve.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let masterKey: Buffer | null = null;

export function initCrypto(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error(
      'APP_ENCRYPTION_KEY debe tener al menos 32 caracteres. Generá una con: openssl rand -base64 48',
    );
  }
  // Clave de 32 bytes derivada del secreto; sal fija porque el secreto ya es de alta entropía.
  masterKey = createHash('sha256').update(secret, 'utf8').digest();
}

function key(): Buffer {
  if (!masterKey) throw new Error('initCrypto() no fue invocado.');
  return masterKey;
}

/** Cifra texto y devuelve "iv.tag.ciphertext" en base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Credencial cifrada con formato inválido.');
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Hash de contraseña con scrypt. Formato: "scrypt$salt$hash" en base64url. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64url');
  const expected = Buffer.from(parts[2]!, 'base64url');
  const derived = scryptSync(password, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

/** Últimos 4 dígitos / huella corta para mostrar en la UI sin exponer el secreto. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
