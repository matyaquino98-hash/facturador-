/**
 * Cliente HTTP. Todo pasa por el backend: el navegador nunca ve certificados,
 * claves privadas ni tokens de ARCA.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Array<{ campo: string; mensaje: string }> = [],
    readonly arca?: ResultadoArca,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      (data.error as string) ?? 'Ocurrió un error inesperado.',
      response.status,
      (data.issues as Array<{ campo: string; mensaje: string }>) ?? [],
      data.arca as ResultadoArca | undefined,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// --- Tipos compartidos con el backend ---

export interface Usuario {
  id: number;
  email: string;
}

export interface Emisor {
  id: number;
  cuit: string;
  razonSocial: string;
  condicionIva: 'responsable_inscripto' | 'monotributo' | 'exento';
  domicilio: string;
  ingresosBrutos: string;
  inicioActividades: string;
  puntoVenta: number;
  environment: 'homologacion' | 'produccion';
  emiteM: boolean;
  credenciales: {
    cargadas: boolean;
    huella: string | null;
    sujeto: string | null;
    venceEl: string | null;
    vencido: boolean;
  };
}

export interface Catalogos {
  alicuotasIva: Array<{ id: number; label: string; rateBps: number }>;
  condicionesIvaReceptor: Array<{ id: number; label: string; letras: string[] }>;
  tiposComprobante: Array<{ id: number; label: string }>;
  tiposDocumento: Array<{ id: number; label: string }>;
  conceptos: Array<{ id: number; label: string }>;
}

export interface Cliente {
  id: number;
  doc_tipo: number;
  doc_nro: string;
  nombre: string;
  condicion_iva_id: number;
  domicilio: string;
  email: string;
}

export interface Producto {
  id: number;
  descripcion: string;
  precio_cents: number;
  iva_id: number;
}

export interface Totales {
  lineas: Array<{ netoCents: number; ivaCents: number; subtotalCents: number; rateBps: number }>;
  alicuotas: Array<{ id: number; rateBps: number; baseImpCents: number; importeCents: number }>;
  impNetoCents: number;
  impIvaCents: number;
  impTribCents: number;
  impTotalCents: number;
}

export interface Factura {
  id: number;
  estado: string;
  environment: string;
  cbteTipo: number;
  letra: string;
  puntoVenta: number;
  numero: number | null;
  numeroFormateado: string | null;
  fecha: string;
  docTipo: number;
  docNro: string;
  clienteNombre: string;
  clienteDomicilio: string;
  condicionIvaReceptorId: number;
  netoCents: number;
  ivaCents: number;
  tributosCents: number;
  totalCents: number;
  cae: string | null;
  caeVto: string | null;
  observaciones: Array<{ code: number; explicacion: string }>;
  errores: Array<{ code: number; explicacion: string }>;
  items: Array<{
    descripcion: string;
    cantidadMilli: number;
    precioUnitarioCents: number;
    netoCents: number;
    subtotalCents: number;
    ivaId: number;
  }>;
  creadaEl: string;
}

export interface ResultadoArca {
  aprobado: boolean;
  titulo: string;
  errores: Array<{ code: number; msg: string; explicacion: string }>;
  advertencias: Array<{ code: number; msg: string; explicacion: string }>;
}

export interface Sugerencia {
  cbteTipo: number;
  letra: string;
  label: string;
  motivo: string;
  alternativas: Array<{ id: number; label: string }>;
}

// --- Formato ---

export function pesos(cents: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100);
}

export function fechaLegible(arcaDate: string | null): string {
  if (!arcaDate || arcaDate.length !== 8) return '—';
  return `${arcaDate.slice(6, 8)}/${arcaDate.slice(4, 6)}/${arcaDate.slice(0, 4)}`;
}

/** Fecha de hoy en AAAAMMDD, en horario de Argentina. */
export function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');
}

/** AAAAMMDD -> AAAA-MM-DD, para <input type="date">. */
export function aInputDate(arcaDate: string): string {
  return `${arcaDate.slice(0, 4)}-${arcaDate.slice(4, 6)}-${arcaDate.slice(6, 8)}`;
}
