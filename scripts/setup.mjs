#!/usr/bin/env node
/**
 * Prepara el .env con una clave maestra nueva. Idempotente: si ya existe un
 * APP_ENCRYPTION_KEY cargado, no lo pisa — sobrescribirlo dejaría ilegibles las
 * credenciales de ARCA ya guardadas.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(raiz, '.env');
const ejemploPath = resolve(raiz, '.env.example');

const clave = randomBytes(48).toString('base64');

if (existsSync(envPath)) {
  const actual = readFileSync(envPath, 'utf8');
  const tieneClave = /^APP_ENCRYPTION_KEY=.+$/m.test(actual);
  if (tieneClave) {
    console.log('✔ .env ya existe y tiene APP_ENCRYPTION_KEY. No se toca nada.');
    console.log('  (Cambiarla dejaría ilegibles los certificados ya guardados.)');
    process.exit(0);
  }
  writeFileSync(envPath, actual.replace(/^APP_ENCRYPTION_KEY=\s*$/m, `APP_ENCRYPTION_KEY=${clave}`));
  console.log('✔ .env ya existía: se completó APP_ENCRYPTION_KEY.');
} else {
  const base = existsSync(ejemploPath) ? readFileSync(ejemploPath, 'utf8') : 'APP_ENCRYPTION_KEY=\n';
  writeFileSync(envPath, base.replace(/^APP_ENCRYPTION_KEY=\s*$/m, `APP_ENCRYPTION_KEY=${clave}`));
  console.log('✔ .env creado con una APP_ENCRYPTION_KEY nueva.');
}

console.log('');
console.log('Guardá esa clave junto con tus secretos de despliegue: sin ella no se');
console.log('pueden descifrar el certificado y la clave privada de ARCA.');
console.log('');
console.log('Siguiente paso:  npm run certificado -- --cuit TU_CUIT --nombre "TU RAZON SOCIAL"');
