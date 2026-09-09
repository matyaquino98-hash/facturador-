/**
 * SQLite con better-sqlite3: cero configuración, transacciones sincrónicas y
 * suficiente para el volumen de un facturador de una PyME.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db: Database.Database | null = null;

export function initDb(file: string): Database.Database {
  mkdirSync(dirname(file), { recursive: true });
  const instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  db = instance;
  return instance;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('initDb() no fue invocado.');
  return db;
}

function migrate(d: Database.Database): void {
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
