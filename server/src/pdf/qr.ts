/**
 * Código QR obligatorio en comprobantes electrónicos — R.G. 4892/2020.
 *
 * Es un JSON con los datos identificatorios del comprobante, codificado en Base64
 * y pasado como parámetro `p` a la URL de verificación de ARCA.
 * Especificación: https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
 */
import { QR_BASE_URL } from '../arca/endpoints.js';
import { arcaDateToIso } from '../domain/dates.js';

export interface DatosQr {
  /** AAAAMMDD */
  fecha: string;
  /** CUIT del emisor, sólo dígitos. */
  cuitEmisor: string;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  /** Importe total en centavos. */
  importeCents: number;
  moneda: string;
  cotizacion: number;
  tipoDocRec: number;
  nroDocRec: string;
  /** "E" = CAE, "A" = CAEA. */
  tipoCodAut?: 'E' | 'A';
  codAut: string;
}

export function buildQrPayload(d: DatosQr): Record<string, unknown> {
  return {
    ver: 1,
    fecha: arcaDateToIso(d.fecha),
    cuit: Number(d.cuitEmisor),
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    // La especificación expresa el importe con decimales, no en centavos.
    importe: Number((d.importeCents / 100).toFixed(2)),
    moneda: d.moneda,
    ctz: d.cotizacion,
    tipoDocRec: d.tipoDocRec,
    nroDocRec: Number(d.nroDocRec || 0),
    tipoCodAut: d.tipoCodAut ?? 'E',
    codAut: Number(d.codAut),
  };
}

export function buildQrUrl(d: DatosQr): string {
  const json = JSON.stringify(buildQrPayload(d));
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  return `${QR_BASE_URL}?p=${base64}`;
}
