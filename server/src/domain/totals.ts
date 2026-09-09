/**
 * Cálculo de netos, IVA y totales.
 *
 * Reglas de precisión:
 *  - Todo entero: importes en centavos, cantidades en milésimas, alícuotas en bps.
 *  - El neto de cada línea se redondea una sola vez (half-up).
 *  - El IVA se calcula **por alícuota sobre la base acumulada**, no línea por línea:
 *    así ImpIVA cierra exactamente contra la suma de los AlicIva que se le informan
 *    a ARCA, que es lo que el servicio valida.
 *  - ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA (identidad exacta).
 */
import { divRound, sum } from '../lib/money.js';
import { alicuotaPorId, discriminaIva } from './catalogs.js';

export interface LineaInput {
  descripcion: string;
  /** Cantidad en milésimas (1500 = 1,5). */
  cantidadMilli: number;
  /** Precio unitario en centavos. */
  precioUnitarioCents: number;
  /** Id de alícuota de IVA (FEParamGetTiposIva). */
  ivaId: number;
  /** Descuento sobre la línea, en puntos básicos (1000 = 10 %). */
  descuentoBps?: number;
}

export interface LineaCalculada extends LineaInput {
  /** Neto gravado de la línea, en centavos. */
  netoCents: number;
  /** IVA de la línea (informativo para el PDF; el total se calcula por alícuota). */
  ivaCents: number;
  /** Neto + IVA de la línea. */
  subtotalCents: number;
  rateBps: number;
}

export interface AlicuotaCalculada {
  id: number;
  rateBps: number;
  baseImpCents: number;
  importeCents: number;
}

export interface TotalesCalculados {
  lineas: LineaCalculada[];
  alicuotas: AlicuotaCalculada[];
  impNetoCents: number;
  impIvaCents: number;
  impTotConcCents: number;
  impOpExCents: number;
  impTribCents: number;
  impTotalCents: number;
}

export interface CalcularInput {
  lineas: LineaInput[];
  /** Tipo de comprobante: define si se discrimina IVA. */
  cbteTipo: number;
  /**
   * Los precios unitarios ya incluyen IVA (típico de un comprobante B a
   * consumidor final, donde el usuario piensa en precio final).
   */
  preciosConIva?: boolean;
  /** Otros tributos, en centavos. */
  impTribCents?: number;
}

export function calcularTotales(input: CalcularInput): TotalesCalculados {
  const { lineas, cbteTipo, preciosConIva = false, impTribCents = 0 } = input;

  if (lineas.length === 0) throw new Error('La factura no tiene ítems.');
  if (impTribCents < 0) throw new Error('Los otros tributos no pueden ser negativos.');

  const discrimina = discriminaIva(cbteTipo);

  const calculadas: LineaCalculada[] = lineas.map((linea, index) => {
    const alicuota = alicuotaPorId(linea.ivaId);
    if (!alicuota) {
      throw new Error(`Ítem ${index + 1}: alícuota de IVA desconocida (id ${linea.ivaId}).`);
    }
    if (linea.cantidadMilli <= 0) {
      throw new Error(`Ítem ${index + 1}: la cantidad debe ser mayor a cero.`);
    }
    if (linea.precioUnitarioCents < 0) {
      throw new Error(`Ítem ${index + 1}: el precio unitario no puede ser negativo.`);
    }
    const descuentoBps = linea.descuentoBps ?? 0;
    if (descuentoBps < 0 || descuentoBps >= 10000) {
      throw new Error(`Ítem ${index + 1}: el descuento debe estar entre 0 % y 99,99 %.`);
    }

    // En comprobante C el IVA está integrado: no hay alícuota que separar.
    const rateBps = discrimina ? alicuota.rateBps : 0;

    // bruto = cantidad * precio, con la cantidad en milésimas.
    const brutoCents = divRound(linea.cantidadMilli * linea.precioUnitarioCents, 1000);
    const conDescuento = brutoCents - divRound(brutoCents * descuentoBps, 10000);

    // Si el precio viene con IVA incluido, el neto se despeja: neto = bruto / (1 + tasa).
    const netoCents =
      preciosConIva && rateBps > 0
        ? divRound(conDescuento * 10000, 10000 + rateBps)
        : conDescuento;

    const ivaCents = divRound(netoCents * rateBps, 10000);

    return {
      ...linea,
      descuentoBps,
      rateBps,
      netoCents,
      ivaCents,
      subtotalCents: netoCents + ivaCents,
    };
  });

  // IVA por alícuota sobre la base acumulada.
  const porAlicuota = new Map<number, AlicuotaCalculada>();
  if (discrimina) {
    for (const linea of calculadas) {
      const actual = porAlicuota.get(linea.ivaId);
      if (actual) {
        actual.baseImpCents += linea.netoCents;
      } else {
        porAlicuota.set(linea.ivaId, {
          id: linea.ivaId,
          rateBps: linea.rateBps,
          baseImpCents: linea.netoCents,
          importeCents: 0,
        });
      }
    }
    for (const alic of porAlicuota.values()) {
      alic.importeCents = divRound(alic.baseImpCents * alic.rateBps, 10000);
    }
  }

  const alicuotas = [...porAlicuota.values()].sort((a, b) => a.rateBps - b.rateBps);
  const impNetoCents = sum(calculadas.map((l) => l.netoCents));
  const impIvaCents = sum(alicuotas.map((a) => a.importeCents));

  // El MVP no maneja conceptos no gravados ni exentos por línea.
  const impTotConcCents = 0;
  const impOpExCents = 0;

  return {
    lineas: calculadas,
    alicuotas,
    impNetoCents,
    impIvaCents,
    impTotConcCents,
    impOpExCents,
    impTribCents,
    impTotalCents: impTotConcCents + impNetoCents + impOpExCents + impTribCents + impIvaCents,
  };
}

/**
 * Chequeo de consistencia que ARCA aplica del lado del servicio. Se corre antes de
 * enviar para fallar con un mensaje claro en lugar de con un código de rechazo.
 */
export function verificarConsistencia(t: TotalesCalculados): void {
  const sumaAlicuotas = sum(t.alicuotas.map((a) => a.importeCents));
  if (sumaAlicuotas !== t.impIvaCents) {
    throw new Error('ImpIVA no coincide con la suma de las alícuotas informadas.');
  }
  const baseAlicuotas = sum(t.alicuotas.map((a) => a.baseImpCents));
  if (t.alicuotas.length > 0 && baseAlicuotas !== t.impNetoCents) {
    throw new Error('ImpNeto no coincide con la suma de las bases imponibles.');
  }
  const esperado =
    t.impTotConcCents + t.impNetoCents + t.impOpExCents + t.impTribCents + t.impIvaCents;
  if (esperado !== t.impTotalCents) {
    throw new Error('ImpTotal no coincide con la suma de sus componentes.');
  }
  if (t.impTotalCents <= 0) {
    throw new Error('El total del comprobante debe ser mayor a cero.');
  }
}
