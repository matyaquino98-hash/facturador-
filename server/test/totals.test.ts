import { describe, expect, it } from 'vitest';
import { calcularTotales, verificarConsistencia } from '../src/domain/totals.js';
import { CBTE_TIPO } from '../src/domain/catalogs.js';
import { toCents, toMilli } from '../src/lib/money.js';

const FACTURA_A = CBTE_TIPO.FACTURA_A;
const FACTURA_B = CBTE_TIPO.FACTURA_B;
const FACTURA_C = CBTE_TIPO.FACTURA_C;

function linea(desc: string, cant: string, precio: string, ivaId = 5, descuentoPct?: string) {
  return {
    descripcion: desc,
    cantidadMilli: toMilli(cant),
    precioUnitarioCents: toCents(precio),
    ivaId,
    descuentoBps: descuentoPct ? Number(descuentoPct) * 100 : 0,
  };
}

describe('calculo de IVA', () => {
  it('calcula 21% sobre un neto simple', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('Servicio', '1', '1000.00')] });
    expect(t.impNetoCents).toBe(100000);
    expect(t.impIvaCents).toBe(21000);
    expect(t.impTotalCents).toBe(121000);
  });

  it('aplica la alicuota de 10,5%', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('Item', '1', '1000.00', 4)] });
    expect(t.impIvaCents).toBe(10500);
    expect(t.impTotalCents).toBe(110500);
  });

  it('soporta alicuota 0%', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('Item', '1', '1000.00', 3)] });
    expect(t.impIvaCents).toBe(0);
    expect(t.impTotalCents).toBe(100000);
  });

  it('agrupa el IVA por alicuota', () => {
    const t = calcularTotales({
      cbteTipo: FACTURA_A,
      lineas: [
        linea('A', '1', '1000.00', 5),
        linea('B', '1', '2000.00', 5),
        linea('C', '1', '1000.00', 4),
      ],
    });
    expect(t.alicuotas).toHaveLength(2);
    const iva21 = t.alicuotas.find((a) => a.id === 5)!;
    const iva105 = t.alicuotas.find((a) => a.id === 4)!;
    expect(iva21.baseImpCents).toBe(300000);
    expect(iva21.importeCents).toBe(63000);
    expect(iva105.baseImpCents).toBe(100000);
    expect(iva105.importeCents).toBe(10500);
    expect(t.impIvaCents).toBe(73500);
  });
});

describe('redondeo', () => {
  it('no acumula error en importes con decimales dificiles', () => {
    // 3 x 0.07 = 0.21 neto; IVA 21% = 0.0441 -> 0.04
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('Item', '3', '0.07')] });
    expect(t.impNetoCents).toBe(21);
    expect(t.impIvaCents).toBe(4);
    expect(t.impTotalCents).toBe(25);
  });

  it('calcula el IVA sobre la base acumulada, no linea por linea', () => {
    // Tres líneas de 0.10: línea a línea el IVA daría 3 x 0.02 = 0.06.
    // Sobre la base acumulada (0.30) da 0.063 -> 0.06. Coincide, y la base cierra.
    const t = calcularTotales({
      cbteTipo: FACTURA_A,
      lineas: [linea('a', '1', '0.10'), linea('b', '1', '0.10'), linea('c', '1', '0.10')],
    });
    expect(t.impNetoCents).toBe(30);
    expect(t.alicuotas[0]!.baseImpCents).toBe(30);
    expect(t.impIvaCents).toBe(6);
    // La identidad que ARCA valida siempre se cumple.
    expect(t.impTotalCents).toBe(t.impNetoCents + t.impIvaCents);
  });

  it('mantiene ImpTotal = ImpNeto + ImpIVA en un caso con muchos decimales', () => {
    const t = calcularTotales({
      cbteTipo: FACTURA_A,
      lineas: [
        linea('x', '1.333', '99.99'),
        linea('y', '2.5', '33.33'),
        linea('z', '7', '1.11', 4),
      ],
    });
    verificarConsistencia(t);
    const sumaBases = t.alicuotas.reduce((s, a) => s + a.baseImpCents, 0);
    expect(sumaBases).toBe(t.impNetoCents);
    expect(t.impTotalCents).toBe(t.impNetoCents + t.impIvaCents);
  });

  it('redondea la cantidad por milesimas', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('Item', '1.5', '10.00')] });
    expect(t.impNetoCents).toBe(1500);
  });
});

describe('precios con IVA incluido', () => {
  it('despeja el neto de un precio final', () => {
    // Precio final 121.00 con IVA 21% -> neto 100.00, IVA 21.00
    const t = calcularTotales({
      cbteTipo: FACTURA_B,
      preciosConIva: true,
      lineas: [linea('Item', '1', '121.00')],
    });
    expect(t.impNetoCents).toBe(10000);
    expect(t.impIvaCents).toBe(2100);
    expect(t.impTotalCents).toBe(12100);
  });

  it('el total con IVA incluido no se desvia del precio cargado', () => {
    const t = calcularTotales({
      cbteTipo: FACTURA_B,
      preciosConIva: true,
      lineas: [linea('Item', '3', '100.00')],
    });
    // 300.00 finales: neto 247.93 + IVA 52.07 = 300.00
    expect(t.impTotalCents).toBe(30000);
    expect(t.impNetoCents + t.impIvaCents).toBe(30000);
  });
});

describe('comprobante C', () => {
  it('no discrimina IVA: el neto es el total y no hay alicuotas', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_C, lineas: [linea('Servicio', '1', '1000.00')] });
    expect(t.impNetoCents).toBe(100000);
    expect(t.impIvaCents).toBe(0);
    expect(t.impTotalCents).toBe(100000);
    // ARCA rechaza comprobantes C con detalle de alícuotas (error 10026).
    expect(t.alicuotas).toHaveLength(0);
  });

  it('ignora la alicuota cargada en el item', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_C, lineas: [linea('Servicio', '2', '500.00', 5)] });
    expect(t.impIvaCents).toBe(0);
    expect(t.impTotalCents).toBe(100000);
  });
});

describe('descuentos y tributos', () => {
  it('aplica el descuento antes del IVA', () => {
    const t = calcularTotales({
      cbteTipo: FACTURA_A,
      lineas: [linea('Item', '1', '1000.00', 5, '10')],
    });
    expect(t.impNetoCents).toBe(90000);
    expect(t.impIvaCents).toBe(18900);
    expect(t.impTotalCents).toBe(108900);
  });

  it('suma otros tributos al total sin gravarlos con IVA', () => {
    const t = calcularTotales({
      cbteTipo: FACTURA_A,
      lineas: [linea('Item', '1', '1000.00')],
      impTribCents: toCents('50.00'),
    });
    expect(t.impIvaCents).toBe(21000);
    expect(t.impTribCents).toBe(5000);
    expect(t.impTotalCents).toBe(126000);
  });
});

describe('validaciones de calculo', () => {
  it('rechaza una factura sin items', () => {
    expect(() => calcularTotales({ cbteTipo: FACTURA_A, lineas: [] })).toThrow(/no tiene ítems/i);
  });

  it('rechaza cantidad cero o negativa', () => {
    expect(() =>
      calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('x', '0', '10.00')] }),
    ).toThrow(/cantidad/i);
  });

  it('rechaza una alicuota desconocida', () => {
    expect(() =>
      calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('x', '1', '10.00', 99)] }),
    ).toThrow(/alícuota/i);
  });

  it('rechaza total cero', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('x', '1', '0.00')] });
    expect(() => verificarConsistencia(t)).toThrow(/mayor a cero/i);
  });

  it('verificarConsistencia acepta un calculo correcto', () => {
    const t = calcularTotales({ cbteTipo: FACTURA_A, lineas: [linea('x', '1', '1000.00')] });
    expect(() => verificarConsistencia(t)).not.toThrow();
  });
});
