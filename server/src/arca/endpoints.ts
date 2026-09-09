/**
 * Endpoints oficiales de ARCA. [VERIFICADO] — ver docs/ARCA.md §1 y §2.
 *
 * El entorno es una propiedad de cada emisor, no una variable global: así no hay
 * forma de emitir en producción por accidente mientras se prueba en homologación.
 */
export type Environment = 'homologacion' | 'produccion';

export const ENVIRONMENTS: Environment[] = ['homologacion', 'produccion'];

export function isEnvironment(value: string): value is Environment {
  return value === 'homologacion' || value === 'produccion';
}

export const WSAA_URL: Record<Environment, string> = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

export const WSFEV1_URL: Record<Environment, string> = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

/**
 * [NO CONFIRMADO] Constancia de Inscripción (ws_sr_constancia_inscripcion).
 * No pude leer el manual oficial en esta sesión. Requiere habilitación aparte.
 */
export const PADRON_URL: Record<Environment, string> = {
  homologacion:
    'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  produccion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
};

/** Nombres de servicio para pedir el Ticket de Acceso al WSAA. */
export const SERVICE = {
  WSFEV1: 'wsfe',
  PADRON: 'ws_sr_constancia_inscripcion',
} as const;

/** URL base del verificador de comprobantes (código QR, R.G. 4892). */
export const QR_BASE_URL = 'https://www.afip.gob.ar/fe/qr/';
