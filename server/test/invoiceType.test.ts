import { describe, expect, it } from 'vitest';
import { determinarComprobante, validarCombinacion } from '../src/domain/invoiceType.js';
import { CBTE_TIPO, CONDICION_EMISOR } from '../src/domain/catalogs.js';

const RI = CONDICION_EMISOR.RESPONSABLE_INSCRIPTO;
const MONO = CONDICION_EMISOR.MONOTRIBUTO;
const EXENTO = CONDICION_EMISOR.EXENTO;

// CondicionIVAReceptorId (R.G. 5616)
const REC_RI = 1;
const REC_EXENTO = 4;
const REC_CONSUMIDOR_FINAL = 5;
const REC_MONOTRIBUTO = 6;
const REC_NO_CATEGORIZADO = 7;

describe('determinarComprobante', () => {
  it('RI a RI emite factura A', () => {
    const d = determinarComprobante({ condicionEmisor: RI, condicionIvaReceptorId: REC_RI });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_A);
    expect(d.letra).toBe('A');
  });

  it('RI a monotributista emite factura A', () => {
    const d = determinarComprobante({ condicionEmisor: RI, condicionIvaReceptorId: REC_MONOTRIBUTO });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_A);
  });

  it('RI a consumidor final emite factura B', () => {
    const d = determinarComprobante({
      condicionEmisor: RI,
      condicionIvaReceptorId: REC_CONSUMIDOR_FINAL,
    });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_B);
    expect(d.letra).toBe('B');
  });

  it('RI a exento emite factura B', () => {
    const d = determinarComprobante({ condicionEmisor: RI, condicionIvaReceptorId: REC_EXENTO });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_B);
  });

  it('RI a sujeto no categorizado emite factura B', () => {
    const d = determinarComprobante({
      condicionEmisor: RI,
      condicionIvaReceptorId: REC_NO_CATEGORIZADO,
    });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_B);
  });

  it('monotributista emite siempre C, sin importar el receptor', () => {
    for (const receptor of [REC_RI, REC_CONSUMIDOR_FINAL, REC_MONOTRIBUTO, REC_EXENTO]) {
      const d = determinarComprobante({ condicionEmisor: MONO, condicionIvaReceptorId: receptor });
      expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_C);
      expect(d.letra).toBe('C');
    }
  });

  it('exento emite siempre C', () => {
    const d = determinarComprobante({ condicionEmisor: EXENTO, condicionIvaReceptorId: REC_RI });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_C);
  });

  it('un RI habilitado a M emite M en lugar de A', () => {
    const d = determinarComprobante({
      condicionEmisor: RI,
      condicionIvaReceptorId: REC_RI,
      emiteM: true,
    });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_M);
    expect(d.letra).toBe('M');
  });

  it('la bandera M no afecta a un comprobante B', () => {
    const d = determinarComprobante({
      condicionEmisor: RI,
      condicionIvaReceptorId: REC_CONSUMIDOR_FINAL,
      emiteM: true,
    });
    expect(d.cbteTipo).toBe(CBTE_TIPO.FACTURA_B);
  });

  it('explica el motivo de la determinacion', () => {
    const d = determinarComprobante({ condicionEmisor: MONO, condicionIvaReceptorId: REC_RI });
    expect(d.motivo).toMatch(/monotributista/i);
  });

  it('rechaza una condicion de receptor desconocida', () => {
    expect(() => determinarComprobante({ condicionEmisor: RI, condicionIvaReceptorId: 999 })).toThrow(
      /desconocida/i,
    );
  });
});

describe('validarCombinacion', () => {
  it('acepta combinaciones validas', () => {
    expect(validarCombinacion(CBTE_TIPO.FACTURA_A, RI, REC_RI)).toBeNull();
    expect(validarCombinacion(CBTE_TIPO.FACTURA_B, RI, REC_CONSUMIDOR_FINAL)).toBeNull();
    expect(validarCombinacion(CBTE_TIPO.FACTURA_C, MONO, REC_RI)).toBeNull();
  });

  it('un monotributista no puede emitir A', () => {
    expect(validarCombinacion(CBTE_TIPO.FACTURA_A, MONO, REC_RI)).toMatch(/sólo puede emitir/i);
  });

  it('un RI no puede emitir C', () => {
    expect(validarCombinacion(CBTE_TIPO.FACTURA_C, RI, REC_RI)).toMatch(/no emite comprobantes C/i);
  });

  it('rechaza consumidor final en un comprobante A', () => {
    // Un comprobante A exige un receptor que compute IVA (error 10242 en ARCA).
    expect(validarCombinacion(CBTE_TIPO.FACTURA_A, RI, REC_CONSUMIDOR_FINAL)).toMatch(
      /no es válida para un comprobante A/i,
    );
  });

  it('rechaza un tipo de comprobante inexistente', () => {
    expect(validarCombinacion(999, RI, REC_RI)).toMatch(/desconocido/i);
  });
});
