#!/usr/bin/env node
/**
 * Genera la clave privada y el CSR para pedirle el certificado a ARCA.
 *
 * Hace lo mismo que los dos comandos de openssl de docs/CERTIFICADOS.md, pero sin
 * depender de que openssl esté instalado y sin que te puedas equivocar en el formato
 * del serialNumber, que es el error más común del trámite.
 *
 *   npm run certificado -- --cuit 20123456786 --nombre "ESTUDIO QUINO"
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// node-forge es dependencia del workspace `server`; npm la eleva a la raíz.
let forge;
try {
  forge = (await import('node-forge')).default;
} catch {
  console.error('✘ Falta node-forge. Corré primero:  npm install');
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(nombre) {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const cuit = (arg('cuit') ?? '').replace(/\D/g, '');
const nombre = arg('nombre') ?? '';
const alias = arg('alias') ?? 'facturador';
const salida = resolve(dirname(fileURLToPath(import.meta.url)), '..', arg('salida') ?? 'certs');

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function cuitValido(d) {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let acc = 0;
  for (let i = 0; i < 10; i++) acc += Number(d[i]) * PESOS[i];
  const mod = 11 - (acc % 11);
  return (mod === 11 ? 0 : mod === 10 ? 9 : mod) === Number(d[10]);
}

if (!cuitValido(cuit)) {
  console.error('✘ Pasá un CUIT válido:  npm run certificado -- --cuit 20123456786 --nombre "TU RAZON SOCIAL"');
  process.exit(1);
}
if (!nombre.trim()) {
  console.error('✘ Falta --nombre "TU RAZON SOCIAL".');
  process.exit(1);
}

mkdirSync(salida, { recursive: true });
const keyPath = resolve(salida, 'arca.key');
const csrPath = resolve(salida, 'arca.csr');

if (existsSync(keyPath)) {
  console.error(`✘ Ya existe ${keyPath}.`);
  console.error('  No lo piso: si ese par ya tiene un certificado emitido, perderías el acceso.');
  console.error('  Borralo a mano o usá --salida otra-carpeta si de verdad querés uno nuevo.');
  process.exit(1);
}

console.log('Generando clave RSA de 2048 bits…');
const keys = forge.pki.rsa.generateKeyPair(2048);

// serialNumber DEBE ser "CUIT 20123456786": es lo que ARCA usa para vincular el
// certificado con el contribuyente.
const sujeto = [
  { name: 'countryName', value: 'AR' },
  { name: 'organizationName', value: nombre.trim() },
  { name: 'commonName', value: alias },
  // OID 2.5.4.5 (serialNumber). node-forge no tiene shortName para este atributo,
  // así que se nombra por OID.
  { type: '2.5.4.5', value: `CUIT ${cuit}` },
];

const csr = forge.pki.createCertificationRequest();
csr.publicKey = keys.publicKey;
csr.setSubject(sujeto);
csr.sign(keys.privateKey, forge.md.sha256.create());

writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
writeFileSync(csrPath, forge.pki.certificationRequestToPem(csr));

console.log('');
console.log(`✔ Clave privada:  ${keyPath}   (permisos 600 — NO la compartas ni la subas a git)`);
console.log(`✔ Pedido (CSR):   ${csrPath}`);
console.log('');
console.log('Qué hacer ahora:');
console.log('  1. Copiá el contenido de arca.csr.');
console.log('  2. Homologación: entrá a WSASS con Clave Fiscal → "Nuevo certificado" → pegalo.');
console.log('     Producción:   Administrador de Relaciones → Computadores Fiscales →');
console.log('                   Administración de Certificados Digitales.');
console.log('  3. Descargá el .crt que te devuelve ARCA.');
console.log('  4. Asociá ese certificado al servicio "Facturación Electrónica" (wsfe).');
console.log('  5. En la app: Configuración → pegá el .crt y arca.key.');
console.log('');
console.log('Detalle completo en docs/CERTIFICADOS.md');
