/**
 * La base corre en memoria (SQLite en WASM) y se vuelca a disco después de cada
 * escritura. Que los datos sobrevivan a un reinicio es, por eso, una propiedad que
 * hay que probar explícitamente: no la garantiza el motor como en un binding nativo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDb } from '../src/db/index.js';

let dir: string;
let archivo: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'facturador-db-'));
  archivo = join(dir, 'sub', 'carpeta', 'test.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('persistencia', () => {
  it('crea el archivo y los directorios que falten', async () => {
    await initDb(archivo);
    expect(existsSync(archivo)).toBe(true);
    expect(statSync(archivo).size).toBeGreaterThan(0);
  });

  it('los datos sobreviven a un reinicio', async () => {
    await initDb(archivo);
    getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('a@b.c', 'hash');

    // Segundo initDb sobre el mismo archivo = arrancar la app de nuevo.
    await initDb(archivo);
    const fila = getDb().prepare('SELECT email FROM users').get() as { email: string } | undefined;
    expect(fila?.email).toBe('a@b.c');
  });

  it('conserva varias tablas y sus relaciones tras reiniciar', async () => {
    await initDb(archivo);
    const u = getDb()
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run('x@y.z', 'h');
    getDb()
      .prepare(
        `INSERT INTO issuers (user_id, cuit, razon_social, condicion_iva, punto_venta, environment)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(u.lastInsertRowid, '20123456786', 'Estudio', 'responsable_inscripto', 3, 'homologacion');

    await initDb(archivo);
    const emisor = getDb().prepare('SELECT razon_social, punto_venta FROM issuers').get() as
      | { razon_social: string; punto_venta: number }
      | undefined;
    expect(emisor?.razon_social).toBe('Estudio');
    expect(emisor?.punto_venta).toBe(3);
  });
});

describe('interfaz de statements', () => {
  beforeEach(async () => {
    await initDb(archivo);
  });

  it('get() devuelve undefined cuando no hay fila', () => {
    expect(getDb().prepare('SELECT * FROM users WHERE id = ?').get(999)).toBeUndefined();
  });

  it('all() devuelve un array vacío cuando no hay filas', () => {
    expect(getDb().prepare('SELECT * FROM users').all()).toEqual([]);
  });

  it('run() informa lastInsertRowid creciente y changes', () => {
    const a = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('1@a.c', 'h');
    const b = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('2@a.c', 'h');
    expect(a.lastInsertRowid).toBeGreaterThan(0);
    expect(b.lastInsertRowid).toBe(Number(a.lastInsertRowid) + 1);
    expect(b.changes).toBe(1);
  });

  it('acepta null y undefined como parámetros', () => {
    const u = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('n@a.c', 'h');
    const e = getDb()
      .prepare(
        `INSERT INTO issuers (user_id, cuit, razon_social, condicion_iva, punto_venta, environment)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(u.lastInsertRowid, '20123456786', 'E', 'responsable_inscripto', 1, 'homologacion');
    getDb()
      .prepare(
        `INSERT INTO invoices (user_id, issuer_id, environment, estado, cbte_tipo, punto_venta,
           cbte_nro, cbte_fecha, concepto, doc_tipo, doc_nro, cliente_nombre,
           condicion_iva_receptor_id, imp_neto_cents, imp_iva_cents, imp_total_cents, items)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(u.lastInsertRowid, e.lastInsertRowid, 'homologacion', 'rechazado', 1, 3, null,
           '20260909', 1, 80, '30710260423', 'Cliente', 1, 1000, 210, 1210, '[]');
    const fila = getDb().prepare('SELECT cbte_nro FROM invoices').get() as { cbte_nro: number | null };
    expect(fila.cbte_nro).toBeNull();
  });

  it('respeta ON CONFLICT DO UPDATE', () => {
    const u = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('c@a.c', 'h');
    const upsert = `INSERT INTO customers (user_id, doc_tipo, doc_nro, nombre, condicion_iva_id)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT (user_id, doc_tipo, doc_nro)
                    DO UPDATE SET nombre = excluded.nombre`;
    getDb().prepare(upsert).run(u.lastInsertRowid, 80, '30710260423', 'Nombre viejo', 1);
    getDb().prepare(upsert).run(u.lastInsertRowid, 80, '30710260423', 'Nombre nuevo', 1);

    const filas = getDb().prepare('SELECT nombre FROM customers').all() as Array<{ nombre: string }>;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.nombre).toBe('Nombre nuevo');
  });

  it('rechaza una clave foránea inexistente', () => {
    // Las claves foráneas tienen que seguir activas después de volcar a disco:
    // export() cierra y reabre la conexión, y eso resetea los pragmas.
    expect(() =>
      getDb()
        .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
        .run('huerfano', 9999, '2030-01-01'),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('aplica ON DELETE CASCADE', () => {
    const u = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('d@a.c', 'h');
    getDb().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
      .run('tok', u.lastInsertRowid, '2030-01-01');
    getDb().prepare('DELETE FROM users WHERE id = ?').run(u.lastInsertRowid);
    expect(getDb().prepare('SELECT * FROM sessions').all()).toEqual([]);
  });
});
