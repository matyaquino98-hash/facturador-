/**
 * Base de datos: SQLite compilado a WebAssembly (sql.js).
 *
 * Por qué no un binding nativo: `better-sqlite3` hay que compilarlo (o bajar un
 * prebuilt) para cada sistema operativo y cada versión de Node. Eso hacía imposible
 * entregar la app lista para usar: el paquete servía en una máquina y fallaba en otra.
 * sql.js es el mismo SQLite, en WASM, así que el `node_modules` es idéntico y portable
 * en Windows, macOS y Linux, con cualquier Node 20+.
 *
 * El precio es que la base vive en memoria y se vuelca a disco después de cada
 * escritura. Para el volumen de un facturador (miles de comprobantes, unos pocos MB)
 * es irrelevante, y el volcado es atómico: se escribe un temporal y recién ahí se
 * renombra, así un corte de luz nunca deja el archivo a medio escribir.
 *
 * La interfaz que se expone imita la de better-sqlite3 (`prepare().get()/.all()/.run()`,
 * `exec()`, `pragma()`), que es la que usa el resto de la aplicación.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(sentencia: string): void;
  /** Fuerza el volcado a disco. */
  flush(): void;
}

let db: Db | null = null;

/** Convierte parámetros al tipo que acepta sql.js. */
function normalizar(params: unknown[]): Array<string | number | Uint8Array | null> {
  const planos = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return planos.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    if (typeof p === 'number' || typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    return String(p);
  });
}

export async function initDb(file: string): Promise<Db> {
  const ruta = resolve(file);
  mkdirSync(dirname(ruta), { recursive: true });

  // El .wasm viaja dentro del paquete; se resuelve por ruta real para que funcione
  // igual ejecutando desde el código fuente o desde el compilado.
  const require = createRequire(import.meta.url);
  const wasmPath = resolve(dirname(require.resolve('sql.js')), 'sql-wasm.wasm');

  const binario = readFileSync(wasmPath);
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
    // El tipo declara ArrayBuffer; el Buffer de Node cumple el contrato en runtime.
    wasmBinary: binario.buffer.slice(
      binario.byteOffset,
      binario.byteOffset + binario.byteLength,
    ) as ArrayBuffer,
  });

  const interna: SqlJsDatabase = existsSync(ruta)
    ? new SQL.Database(readFileSync(ruta))
    : new SQL.Database();

  let sucia = false;

  /**
   * Pragmas de conexión. Hay que reaplicarlos después de cada volcado: `export()`
   * de sql.js cierra y reabre la base internamente, y eso los resetea a su valor
   * por omisión. Sin esto, `foreign_keys` queda apagado tras la primera escritura
   * y los ON DELETE CASCADE del esquema dejan de aplicarse en silencio.
   */
  function aplicarPragmas(): void {
    interna.exec('PRAGMA foreign_keys = ON;');
  }

  function volcar(): void {
    if (!sucia) return;
    const temporal = `${ruta}.tmp`;
    // Escritura atómica: si se corta la luz a mitad, el archivo bueno sigue intacto.
    writeFileSync(temporal, Buffer.from(interna.export()));
    renameSync(temporal, ruta);
    aplicarPragmas();
    sucia = false;
  }

  const instancia: Db = {
    prepare(sql: string): Statement {
      return {
        get(...params: unknown[]): unknown {
          const stmt = interna.prepare(sql);
          try {
            stmt.bind(normalizar(params));
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]): unknown[] {
          const stmt = interna.prepare(sql);
          try {
            stmt.bind(normalizar(params));
            const filas: unknown[] = [];
            while (stmt.step()) filas.push(stmt.getAsObject());
            return filas;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
          const stmt = interna.prepare(sql);
          try {
            stmt.bind(normalizar(params));
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = interna.getRowsModified();
          const resultado = interna.exec('SELECT last_insert_rowid() AS id');
          const lastInsertRowid = Number(resultado[0]?.values[0]?.[0] ?? 0);
          sucia = true;
          volcar();
          return { changes, lastInsertRowid };
        },
      };
    },
    exec(sql: string): void {
      interna.exec(sql);
      sucia = true;
      volcar();
    },
    pragma(sentencia: string): void {
      interna.exec(`PRAGMA ${sentencia};`);
    },
    flush: volcar,
  };

  aplicarPragmas();
  migrate(instancia);
  sucia = true;
  volcar();

  db = instancia;
  return instancia;
}

export function getDb(): Db {
  if (!db) throw new Error('initDb() no fue invocado.');
  return db;
}

function migrate(d: Db): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Emisores. cert_pem y key_pem se guardan CIFRADOS (AES-256-GCM).
    CREATE TABLE IF NOT EXISTS issuers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cuit              TEXT NOT NULL,
      razon_social      TEXT NOT NULL,
      condicion_iva     TEXT NOT NULL,
      domicilio         TEXT NOT NULL DEFAULT '',
      ingresos_brutos   TEXT NOT NULL DEFAULT '',
      inicio_actividades TEXT NOT NULL DEFAULT '',
      punto_venta       INTEGER NOT NULL,
      environment       TEXT NOT NULL DEFAULT 'homologacion',
      emite_m           INTEGER NOT NULL DEFAULT 0,
      cert_pem_enc      TEXT,
      key_pem_enc       TEXT,
      cert_fingerprint  TEXT,
      cert_subject      TEXT,
      cert_not_after    TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, cuit, punto_venta, environment)
    );

    -- Caché de Tickets de Acceso del WSAA. token y sign son credenciales: cifrados.
    CREATE TABLE IF NOT EXISTS access_tickets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer_id   INTEGER NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
      service     TEXT NOT NULL,
      environment TEXT NOT NULL,
      token_enc   TEXT NOT NULL,
      sign_enc    TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (issuer_id, service, environment)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_tipo       INTEGER NOT NULL,
      doc_nro        TEXT NOT NULL,
      nombre         TEXT NOT NULL,
      condicion_iva_id INTEGER NOT NULL,
      domicilio      TEXT NOT NULL DEFAULT '',
      email          TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, doc_tipo, doc_nro)
    );

    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      descripcion  TEXT NOT NULL,
      precio_cents INTEGER NOT NULL,
      iva_id       INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issuer_id         INTEGER NOT NULL REFERENCES issuers(id),
      environment       TEXT NOT NULL,
      estado            TEXT NOT NULL,               -- aprobado | rechazado | error
      cbte_tipo         INTEGER NOT NULL,
      punto_venta       INTEGER NOT NULL,
      cbte_nro          INTEGER,
      cbte_fecha        TEXT NOT NULL,               -- AAAAMMDD
      concepto          INTEGER NOT NULL,
      fch_serv_desde    TEXT,
      fch_serv_hasta    TEXT,
      fch_vto_pago      TEXT,
      doc_tipo          INTEGER NOT NULL,
      doc_nro           TEXT NOT NULL,
      cliente_nombre    TEXT NOT NULL,
      cliente_domicilio TEXT NOT NULL DEFAULT '',
      condicion_iva_receptor_id INTEGER NOT NULL,
      imp_neto_cents    INTEGER NOT NULL,
      imp_iva_cents     INTEGER NOT NULL,
      imp_tot_conc_cents INTEGER NOT NULL DEFAULT 0,
      imp_op_ex_cents   INTEGER NOT NULL DEFAULT 0,
      imp_trib_cents    INTEGER NOT NULL DEFAULT 0,
      imp_total_cents   INTEGER NOT NULL,
      moneda            TEXT NOT NULL DEFAULT 'PES',
      cotizacion        REAL NOT NULL DEFAULT 1,
      cae               TEXT,
      cae_vto           TEXT,                        -- AAAAMMDD
      observaciones     TEXT NOT NULL DEFAULT '[]',  -- JSON [{code,msg}]
      errores           TEXT NOT NULL DEFAULT '[]',  -- JSON [{code,msg}]
      items             TEXT NOT NULL,               -- JSON de las líneas calculadas
      alicuotas         TEXT NOT NULL DEFAULT '[]',  -- JSON de AlicIva
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_user     ON invoices(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invoices_doc      ON invoices(user_id, doc_nro);
    CREATE INDEX IF NOT EXISTS idx_invoices_nro      ON invoices(user_id, punto_venta, cbte_nro);
    CREATE INDEX IF NOT EXISTS idx_invoices_fecha    ON invoices(user_id, cbte_fecha);
    CREATE INDEX IF NOT EXISTS idx_customers_user    ON customers(user_id, nombre);
  `);
}
