import { describe, expect, it } from 'vitest';
import { formatCuit, isValidCuit, isValidDni, normalizeDoc } from '../src/lib/cuit.js';

describe('isValidCuit', () => {
  it('acepta CUIT validos', () => {
    // Dígito verificador calculado con el algoritmo módulo 11 oficial.
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('30710260423')).toBe(true);
    expect(isValidCuit('27230938607')).toBe(true);
  });

  it('acepta CUIT con guiones y espacios', () => {
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit(' 20 12345678 6 ')).toBe(true);
  });

  it('rechaza un digito verificador incorrecto', () => {
    expect(isValidCuit('20123456780')).toBe(false);
    expect(isValidCuit('30710260429')).toBe(false);
  });

  it('rechaza longitudes incorrectas', () => {
    expect(isValidCuit('2012345678')).toBe(false); // 10 digitos
    expect(isValidCuit('201234567890')).toBe(false);
    expect(isValidCuit('')).toBe(false);
  });

  it('rechaza secuencias repetidas', () => {
    expect(isValidCuit('00000000000')).toBe(false);
    expect(isValidCuit('11111111111')).toBe(false);
  });
});

describe('isValidDni', () => {
  it('acepta 7 y 8 digitos', () => {
    expect(isValidDni('1234567')).toBe(true);
    expect(isValidDni('12345678')).toBe(true);
  });

  it('rechaza longitudes fuera de rango y ceros', () => {
    expect(isValidDni('123456')).toBe(false);
    expect(isValidDni('123456789')).toBe(false);
    expect(isValidDni('0000000')).toBe(false);
  });
});

describe('helpers', () => {
  it('normaliza quitando todo lo que no sea digito', () => {
    expect(normalizeDoc('20-12345678-6')).toBe('20123456786');
  });

  it('formatea el CUIT', () => {
    expect(formatCuit('20123456786')).toBe('20-12345678-6');
    expect(formatCuit('123')).toBe('123');
  });
});
