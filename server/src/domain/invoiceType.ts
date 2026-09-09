/**
 * Determinación del tipo de comprobante a emitir.
 *
 * Reglas generales (R.G. 1415 y régimen simplificado). Ver docs/ARCA.md §4.
 *
 *   Emisor Responsable Inscripto  -> receptor RI / Monotributo        => A
 *                                 -> receptor Exento / CF / otros     => B
 *   Emisor Monotributo o Exento   -> cualquier receptor               => C
 *
 * La app **sugiere**; el usuario puede forzar otro tipo válido, porque hay casos
 * (habilitación a comprobantes M, operaciones particulares) que no se resuelven
 * sólo con la condición fiscal de las partes.
 */
import {
  CBTE_TIPO,
  CONDICION_EMISOR,
  type CondicionEmisor,
  condicionReceptorPorId,
  letraDeComprobante,
} from './catalogs.js';

export interface DeterminacionInput {
  condicionEmisor: CondicionEmisor;
  /** CondicionIVAReceptorId (R.G. 5616). */
  condicionIvaReceptorId: number;
  /**
   * El emisor RI fue habilitado por ARCA a emitir M en lugar de A
   * (R.G. 4.132-E). ARCA no expone esto de forma consultable por WSFEv1,
   * así que es una bandera de configuración del emisor.
   */
  emiteM?: boolean;
}

export interface Determinacion {
  cbteTipo: number;
  letra: string;
  /** Tipos que el usuario puede elegir manualmente para esta combinación. */
  alternativas: number[];
  motivo: string;
}

/** Condiciones de receptor que habilitan comprobante A (sujetos que computan IVA). */
const RECEPTORES_LETRA_A = new Set([1, 6, 13, 16]);

export function determinarComprobante(input: DeterminacionInput): Determinacion {
  const { condicionEmisor, condicionIvaReceptorId, emiteM = false } = input;

  const receptor = condicionReceptorPorId(condicionIvaReceptorId);
  if (!receptor) {
    throw new Error(
      `Condición de IVA del receptor desconocida (id ${condicionIvaReceptorId}). ` +
        'Sincronizá los catálogos con ARCA o elegí una condición válida.',
    );
  }

  // Monotributista y exento emiten siempre C: el IVA no se discrimina.
  if (
    condicionEmisor === CONDICION_EMISOR.MONOTRIBUTO ||
    condicionEmisor === CONDICION_EMISOR.EXENTO
  ) {
    return {
      cbteTipo: CBTE_TIPO.FACTURA_C,
      letra: 'C',
      alternativas: [CBTE_TIPO.FACTURA_C],
      motivo:
        condicionEmisor === CONDICION_EMISOR.MONOTRIBUTO
          ? 'El emisor es monotributista: emite comprobantes C, sin discriminar IVA.'
          : 'El emisor es exento: emite comprobantes C, sin discriminar IVA.',
    };
  }

  // Responsable inscripto.
  if (RECEPTORES_LETRA_A.has(receptor.id)) {
    const cbteTipo = emiteM ? CBTE_TIPO.FACTURA_M : CBTE_TIPO.FACTURA_A;
    return {
      cbteTipo,
      letra: letraDeComprobante(cbteTipo),
      alternativas: [CBTE_TIPO.FACTURA_A, CBTE_TIPO.FACTURA_M],
      motivo: emiteM
        ? `Emisor habilitado a comprobantes M. Receptor: ${receptor.label}.`
        : `Emisor responsable inscripto y receptor ${receptor.label}: corresponde A, con IVA discriminado.`,
    };
  }

  return {
    cbteTipo: CBTE_TIPO.FACTURA_B,
    letra: 'B',
    alternativas: [CBTE_TIPO.FACTURA_B],
    motivo: `Emisor responsable inscripto y receptor ${receptor.label}: corresponde B, sin discriminar IVA en el impreso.`,
  };
}

/**
 * Valida que la combinación elegida sea coherente antes de mandarla a ARCA.
 * Devuelve el mensaje de error, o null si es válida.
 */
export function validarCombinacion(
  cbteTipo: number,
  condicionEmisor: CondicionEmisor,
  condicionIvaReceptorId: number,
): string | null {
  const letra = letraDeComprobante(cbteTipo);
  if (!letra) return `Tipo de comprobante desconocido: ${cbteTipo}.`;

  if (
    (condicionEmisor === CONDICION_EMISOR.MONOTRIBUTO ||
      condicionEmisor === CONDICION_EMISOR.EXENTO) &&
    letra !== 'C'
  ) {
    return 'Un emisor monotributista o exento sólo puede emitir comprobantes C.';
  }

  if (condicionEmisor === CONDICION_EMISOR.RESPONSABLE_INSCRIPTO && letra === 'C') {
    return 'Un responsable inscripto no emite comprobantes C.';
  }

  const receptor = condicionReceptorPorId(condicionIvaReceptorId);
  if (!receptor) return `Condición de IVA del receptor desconocida (id ${condicionIvaReceptorId}).`;

  if (!receptor.letras.includes(letra)) {
    return `La condición de IVA del receptor "${receptor.label}" no es válida para un comprobante ${letra}.`;
  }

  return null;
}
