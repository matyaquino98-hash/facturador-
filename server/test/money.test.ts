import { describe, expect, it } from 'vitest';
import {
  centsToArca,
  centsToDisplay,
  divRound,
  parseScaled,
  toCents,
  toMilli,
} from '../src/lib/money.js';

describe('divRound', () => {
  it('redondea la mitad hacia arriba', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(7, 2)).toBe(4);
    expect(divRound(4, 2)).toBe(2);
  });

  it('redondea half-away-from-zero en negativos', () => {
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(-7, 2)).toBe(-4);
  });

  it('rechaza la division por cero', () => {
    expect(() => divRound(1, 0)).toThrow();
  });
});

describe('toCents', () => {
  it('convierte decimales sin error de punto flotante', () => {
    expect(toCents('0.07')).toBe(7);
    expect(toCents(0.07)).toBe(7);
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents(1.005)).toBe(101); // half-up sobre el tercer decimal
    expect(toCents('0.1')).toBe(10);
  });

  it('es exacto donde el float falla', () => {
    // 0.1 + 0.2 en float da 0.30000000000000004
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
    // 1.15 * 100 en float da 114.99999999999999
    expect(toCents(1.15)).toBe(115);
    expect(toCents(8.475)).toBe(848);
  });

  it('maneja negativos y ceros', () => {
    expect(toCents('-5.25')).toBe(-525);
    expect(toCents('0')).toBe(0);
  });

  it('rechaza entradas invalidas', () => {
    expect(() => toCents('abc')).toThrow();
    expect(() => toCents('')).toThrow();
    expect(() => toCents('1.2.3')).toThrow();
  });
});

describe('toMilli', () => {
  it('soporta 3 decimales de cantidad', () => {
    expect(toMilli('1.5')).toBe(1500);
    expect(toMilli('0.001')).toBe(1);
    expect(toMilli(2)).toBe(2000);
    expect(toMilli('1.2345')).toBe(1235); // redondea el cuarto decimal
  });
});

describe('parseScaled', () => {
  it('respeta la escala pedida', () => {
    expect(parseScaled('12.5', 2)).toBe(1250);
    expect(parseScaled('10', 2)).toBe(1000);
  });
});

describe('formato de salida', () => {
  it('serializa a ARCA con punto y dos decimales', () => {
    expect(centsToArca(123456)).toBe('1234.56');
    expect(centsToArca(5)).toBe('0.05');
    expect(centsToArca(0)).toBe('0.00');
    expect(centsToArca(100)).toBe('1.00');
    expect(centsToArca(-525)).toBe('-5.25');
  });

  it('formatea para pantalla en formato argentino', () => {
    expect(centsToDisplay(123456)).toBe('$ 1.234,56');
    expect(centsToDisplay(100000000)).toBe('$ 1.000.000,00');
    expect(centsToDisplay(5)).toBe('$ 0,05');
  });
});
