import { resolve } from 'node:path';

function required(name: string, fallbackInDev?: string): string {
  const value = process.env[name];
  if (value && value.trim() !== '') return value;
  if (fallbackInDev && process.env.NODE_ENV !== 'production') return fallbackInDev;
  throw new Error(
    `Falta la variable de entorno ${name}. Copiá .env.example a .env y completala.`,
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbFile: resolve(process.env.DB_FILE ?? 'data/facturador.sqlite'),
  /**
   * Clave maestra para cifrar certificados y claves privadas de ARCA.
   * En producción es obligatoria: sin ella no se puede descifrar nada de lo guardado.
   */
  encryptionKey: required(
    'APP_ENCRYPTION_KEY',
    'clave-de-desarrollo-no-usar-en-produccion-32+',
  ),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Origen del front en desarrollo (Vite). */
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Sirve el build del front desde el backend. */
  serveStatic: process.env.SERVE_STATIC !== 'false',
};
