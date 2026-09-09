/**
 * Traducción de las respuestas de ARCA a mensajes accionables.
 *
 * Distinción clave (docs/ARCA.md §6):
 *   - `Errors`                      -> la solicitud falló, no hay CAE.
 *   - `Observaciones` + Resultado A -> el comprobante SE APROBÓ igual. Es una
 *                                      advertencia, no un error: hay que guardar el CAE.
 *   - Resultado R                   -> rechazado.
 */
import type { ArcaMessage, RespuestaCae } from './wsfev1.js';

/**
 * Mensajes en castellano llano para los códigos más frecuentes. Si un código no está
 * mapeado se usa el texto literal de ARCA, que siempre viene en la respuesta.
 */
const CODIGOS: Record<number, string> = {
  600: 'La sesión con ARCA expiró o el certificado no está autorizado. Volvé a intentar; si persiste, revisá que el certificado esté asociado al servicio "Facturación Electrónica".',
  601: 'ARCA no pudo validar el token de acceso. Revisá el CUIT del emisor y la asociación del certificado.',
  602: 'El CUIT del emisor no coincide con el del certificado usado para autenticar.',
  10002: 'El tipo de comprobante no es válido para el emisor.',
  10003: 'El punto de venta no está habilitado o no existe para este CUIT.',
  10004: 'El punto de venta informado no corresponde a factura electrónica por web service.',
  10013: 'El tipo de documento del receptor no es válido para este tipo de comprobante.',
  10015: 'La numeración no es correlativa. El número de comprobante ya fue usado o hay un salto.',
  10016: 'La fecha del comprobante está fuera del rango permitido por ARCA (hasta 5 días de antigüedad para productos, 10 para servicios).',
  10018: 'Para comprobantes de servicios hay que informar el período facturado y el vencimiento de pago.',
  10019: 'El importe total no coincide con la suma de neto, IVA, exento, no gravado y tributos.',
  10020: 'La fecha de vencimiento de pago es obligatoria para este concepto.',
  10023: 'El tipo de documento y el número informados no son consistentes.',
  10024: 'El comprobante ya fue autorizado. Consultá el historial antes de reintentar.',
  10025: 'La alícuota de IVA informada no es válida.',
  10026: 'Para comprobantes tipo C no se debe informar el detalle de alícuotas de IVA.',
  10031: 'El importe de IVA no se corresponde con la base imponible y la alícuota informadas.',
  10048: 'El receptor debe estar identificado con CUIT para este tipo de comprobante.',
  10164: 'El importe total supera el máximo permitido sin identificar al receptor.',
  10242: 'Falta la condición frente al IVA del receptor, o el valor no es compatible con el tipo de comprobante (R.G. 5616). Elegí una condición válida para la letra del comprobante.',
};

export function explicar(msg: ArcaMessage): string {
  const conocido = CODIGOS[msg.code];
  if (conocido) return conocido;
  return msg.msg || `ARCA devolvió el código ${msg.code} sin descripción.`;
}

export interface ResultadoLegible {
  aprobado: boolean;
  titulo: string;
  /** Bloquean la emisión. */
  errores: Array<{ code: number; msg: string; explicacion: string }>;
  /** Informativas: el comprobante puede haberse aprobado igual. */
  advertencias: Array<{ code: number; msg: string; explicacion: string }>;
}

export function interpretar(respuesta: RespuestaCae): ResultadoLegible {
  const aprobado = respuesta.resultado === 'A' && Boolean(respuesta.cae);

  const errores = respuesta.errores.map((m) => ({
    code: m.code,
    msg: m.msg,
    explicacion: explicar(m),
  }));

  const advertencias = respuesta.observaciones.map((m) => ({
    code: m.code,
    msg: m.msg,
    explicacion: explicar(m),
  }));

  if (aprobado) {
    return {
      aprobado: true,
      titulo:
        advertencias.length > 0
          ? 'Comprobante autorizado con observaciones'
          : 'Comprobante autorizado',
      errores,
      advertencias,
    };
  }

  // Rechazado: las observaciones explican el motivo, así que suben a errores.
  const todos = [...errores, ...advertencias];
  return {
    aprobado: false,
    titulo:
      respuesta.resultado === 'R'
        ? 'ARCA rechazó el comprobante'
        : 'ARCA no autorizó el comprobante',
    errores:
      todos.length > 0
        ? todos
        : [
            {
              code: 0,
              msg: '',
              explicacion:
                'ARCA no autorizó el comprobante y no devolvió un motivo. Reintentá en unos minutos.',
            },
          ],
    advertencias: [],
  };
}

/** Mensaje para fallas de transporte / credenciales, antes de llegar a ARCA. */
export function explicarFalla(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case 'ArcaCredentialError':
        return error.message;
      case 'ArcaTransportError':
        return `${error.message} Verificá tu conexión y el estado de los servicios de ARCA.`;
      case 'ArcaSoapFault':
        return `ARCA rechazó la comunicación: ${error.message}`;
      default:
        return error.message;
    }
  }
  return 'Error desconocido al comunicarse con ARCA.';
}
