import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Carga el .env sin depender de dotenv ni de la versión de Node.
 *
 * Busca hacia arriba desde el directorio actual, porque el servidor compilado
 * arranca desde `server/` mientras que el .env vive en la raíz del proyecto.
 * Nunca pisa una variable ya definida en el entorno: lo que viene del sistema
 * o del comando manda sobre el archivo.
 */
/** Raíz del proyecto: la carpeta donde está el .env. */
let raizProyecto = process.cwd();

function cargarEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const archivo = resolve(dir, '.env');
    if (existsSync(archivo)) {
      raizProyecto = dir;
      for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
        const limpia = linea.trim();
        if (limpia === '' || limpia.startsWith('#')) continue;
        const corte = limpia.indexOf('=');
        if (corte <= 0) continue;
        const clave = limpia.slice(0, corte).trim();
        let valor = limpia.slice(corte + 1).trim();
        // Admite valores entrecomillados.
        if (valor.length >= 2 && (valor[0] === '"' || valor[0] === "'") && valor.at(-1) === valor[0]) {
          valor = valor.slice(1, -1);
        }
        if (process.env[clave] === undefined) process.env[clave] = valor;
      }
      return;
    }
    const padre = dirname(dir);
    if (padre === dir) return;
    dir = padre;
  }
}

cargarEnv();

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
  /**
   * Ruta de la base. Se resuelve contra la raíz del proyecto, no contra el
   * directorio de trabajo: así la base es siempre la misma sin importar desde
   * dónde se arranque el servidor. Una ruta absoluta en DB_FILE se respeta tal cual.
   */
  dbFile: resolve(raizProyecto, process.env.DB_FILE ?? 'data/facturador.sqlite'),
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
