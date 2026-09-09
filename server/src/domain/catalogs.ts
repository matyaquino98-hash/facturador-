/**
 * Catálogos de ARCA.
 *
 * Estos valores replican los que devuelven los métodos `FEParamGet*` de WSFEv1.
 * Se mantienen locales para que la app funcione sin depender de una llamada extra,
 * pero la fuente autoritativa es siempre ARCA: `POST /api/arca/catalogos/sync`
 * refresca la copia local contra `FEParamGetTiposIva`, `FEParamGetTiposCbte`,
 * `FEParamGetTiposDoc` y `FEParamGetCondicionIvaReceptor`.
 */

/** Tipos de comprobante (FEParamGetTiposCbte). */
export const CBTE_TIPO = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_M: 51,
  NOTA_DEBITO_M: 52,
  NOTA_CREDITO_M: 53,
} as const;

export type CbteTipo = (typeof CBTE_TIPO)[keyof typeof CBTE_TIPO];

export const CBTE_TIPO_LABEL: Record<number, string> = {
  1: 'Factura A',
  2: 'Nota de Débito A',
  3: 'Nota de Crédito A',
  6: 'Factura B',
  7: 'Nota de Débito B',
  8: 'Nota de Crédito B',
  11: 'Factura C',
  12: 'Nota de Débito C',
  13: 'Nota de Crédito C',
  51: 'Factura M',
  52: 'Nota de Débito M',
  53: 'Nota de Crédito M',
};

/** Letra impresa en el comprobante. */
export function letraDeComprobante(cbteTipo: number): string {
  if ([1, 2, 3].includes(cbteTipo)) return 'A';
  if ([6, 7, 8].includes(cbteTipo)) return 'B';
  if ([11, 12, 13].includes(cbteTipo)) return 'C';
  if ([51, 52, 53].includes(cbteTipo)) return 'M';
  return '';
}

/**
 * En comprobantes C el IVA no se discrimina: ImpNeto = total, ImpIVA = 0 y
 * no se informa el array `Iva`.
 */
export function discriminaIva(cbteTipo: number): boolean {
  return letraDeComprobante(cbteTipo) !== 'C';
}

/** Tipos de documento del receptor (FEParamGetTiposDoc). */
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  /** Consumidor final / sin identificar. */
  SIN_IDENTIFICAR: 99,
} as const;

export const DOC_TIPO_LABEL: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Consumidor Final',
};

/** Conceptos (FECAEDetRequest.Concepto). */
export const CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

export const CONCEPTO_LABEL: Record<number, string> = {
  1: 'Productos',
  2: 'Servicios',
  3: 'Productos y Servicios',
};

/** Concepto 2 y 3 exigen FchServDesde / FchServHasta / FchVtoPago. */
export function requiereFechasDeServicio(concepto: number): boolean {
  return concepto === CONCEPTO.SERVICIOS || concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS;
}

/**
 * Alícuotas de IVA (FEParamGetTiposIva). `rateBps` es la alícuota en puntos básicos
 * (2100 = 21 %), para que el cálculo sea entero.
 */
export interface AlicuotaIva {
  id: number;
  label: string;
  rateBps: number;
}

export const ALICUOTAS_IVA: AlicuotaIva[] = [
  { id: 3, label: '0%', rateBps: 0 },
  { id: 9, label: '2,5%', rateBps: 250 },
  { id: 8, label: '5%', rateBps: 500 },
  { id: 4, label: '10,5%', rateBps: 1050 },
  { id: 5, label: '21%', rateBps: 2100 },
  { id: 6, label: '27%', rateBps: 2700 },
];

export function alicuotaPorId(id: number): AlicuotaIva | undefined {
  return ALICUOTAS_IVA.find((a) => a.id === id);
}

/**
 * Condición del emisor frente al IVA. Determina qué letra puede emitir.
 */
export const CONDICION_EMISOR = {
  RESPONSABLE_INSCRIPTO: 'responsable_inscripto',
  MONOTRIBUTO: 'monotributo',
  EXENTO: 'exento',
} as const;

export type CondicionEmisor = (typeof CONDICION_EMISOR)[keyof typeof CONDICION_EMISOR];

export const CONDICION_EMISOR_LABEL: Record<CondicionEmisor, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributo: 'Responsable Monotributo',
  exento: 'IVA Sujeto Exento',
};

/**
 * Condición del receptor frente al IVA — `CondicionIVAReceptorId` (R.G. 5616).
 *
 * Obligatorio en FECAESolicitar. La lista autoritativa la devuelve
 * `FEParamGetCondicionIvaReceptor`; esta copia es el fallback offline.
 */
export interface CondicionIvaReceptor {
  id: number;
  label: string;
  /** Letras de comprobante con las que ARCA acepta esta condición. */
  letras: string[];
}

export const CONDICIONES_IVA_RECEPTOR: CondicionIvaReceptor[] = [
  { id: 1, label: 'IVA Responsable Inscripto', letras: ['A', 'M', 'C'] },
  { id: 4, label: 'IVA Sujeto Exento', letras: ['B', 'C'] },
  { id: 5, label: 'Consumidor Final', letras: ['B', 'C'] },
  { id: 6, label: 'Responsable Monotributo', letras: ['A', 'M', 'C'] },
  { id: 7, label: 'Sujeto No Categorizado', letras: ['B', 'C'] },
  { id: 8, label: 'Proveedor del Exterior', letras: ['B', 'C'] },
  { id: 9, label: 'Cliente del Exterior', letras: ['B', 'C'] },
  { id: 10, label: 'IVA Liberado - Ley 19.640', letras: ['B', 'C'] },
  { id: 13, label: 'Monotributista Social', letras: ['A', 'M', 'C'] },
  { id: 15, label: 'IVA No Alcanzado', letras: ['B', 'C'] },
  { id: 16, label: 'Monotributo Trabajador Independiente Promovido', letras: ['A', 'M', 'C'] },
];

export function condicionReceptorPorId(id: number): CondicionIvaReceptor | undefined {
  return CONDICIONES_IVA_RECEPTOR.find((c) => c.id === id);
}

/** Moneda. El MVP sólo emite en pesos. */
export const MONEDA_PESOS = 'PES';
export const COTIZACION_PESOS = 1;
