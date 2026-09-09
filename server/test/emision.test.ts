/**
 * Emisión end-to-end contra un ARCA simulado: firma CMS real, SOAP real,
 * persistencia real. Sólo la red está interceptada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDb } from '../src/db/index.js';
import { initCrypto } from '../src/lib/crypto.js';
import { EmisionError, emitirFactura, listInvoices } from '../src/services/invoices.js';
import { storeCredentials } from '../src/services/issuers.js';
import { hoyArca } from '../src/domain/dates.js';
import { generarPdf } from '../src/pdf/invoicePdf.js';
import { getIssuer, toPublicIssuer } from '../src/services/issuers.js';
import { getInvoice } from '../src/services/invoices.js';
import { installFakeArca, generarCertificadoDePrueba, type FakeArcaHandle } from './helpers/fakeArca.js';

let dir: string;
let arca: FakeArcaHandle;
let userId: number;
let issuerRI: number;
let issuerMono: number;

const credenciales = generarCertificadoDePrueba();

function crearEmisor(condicion: string, cuit: string): number {
  const r = getDb()
    .prepare(
      `INSERT INTO issuers (user_id, cuit, razon_social, condicion_iva, domicilio, punto_venta, environment)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(userId, cuit, `Emisor ${condicion}`, condicion, 'Av. Siempreviva 742', 1, 'homologacion');
  const id = Number(r.lastInsertRowid);
  storeCredentials(userId, id, credenciales);
  return id;
}

function facturaBase(issuerId: number) {
  return {
    issuerId,
    concepto: 1,
    docTipo: 80,
    docNro: '30710260423',
    clienteNombre: 'Cliente S.A.',
    clienteDomicilio: 'Calle Falsa 123',
    condicionIvaReceptorId: 1,
    preciosConIva: false,
    guardarCliente: false,
    lineas: [{ descripcion: 'Consultoría', cantidad: '1', precioUnitario: '1000.00', ivaId: 5 }],
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'facturador-test-'));
  initCrypto('clave-de-prueba-con-mas-de-32-caracteres-ok');
  await initDb(join(dir, "test.sqlite"));
  const u = getDb()
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run('test@example.com', 'x');
  userId = Number(u.lastInsertRowid);
  issuerRI = crearEmisor('responsable_inscripto', '20123456786');
  issuerMono = crearEmisor('monotributo', '27230938607');
});

afterEach(() => {
  arca?.restore();
  rmSync(dir, { recursive: true, force: true });
});

describe('emision exitosa', () => {
  it('obtiene el CAE y guarda la factura', async () => {
    arca = installFakeArca({ ultimoAutorizado: 14 });
    const { invoice, arca: resultado } = await emitirFactura(userId, facturaBase(issuerRI) as never);

    expect(resultado.aprobado).toBe(true);
    expect(invoice.cae).toBe('70417054367476');
    expect(invoice.cae_vto).toBe('20260919');
    expect(invoice.estado).toBe('aprobado');
    expect(invoice.imp_neto_cents).toBe(100000);
    expect(invoice.imp_iva_cents).toBe(21000);
    expect(invoice.imp_total_cents).toBe(121000);
  });

  it('toma la numeracion de ARCA, no propia', async () => {
    arca = installFakeArca({ ultimoAutorizado: 14 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerRI) as never);
    // ARCA informó 14 como último: el siguiente es el 15.
    expect(invoice.cbte_nro).toBe(15);
    expect(arca.requests.some((r) => r.action.endsWith('FECompUltimoAutorizado'))).toBe(true);
  });

  it('arranca en 1 cuando no hay comprobantes previos', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerRI) as never);
    expect(invoice.cbte_nro).toBe(1);
  });

  it('determina factura A para RI a RI y la envia con las alicuotas', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerRI) as never);
    expect(invoice.cbte_tipo).toBe(1);

    const solicitud = arca.requests.find((r) => r.action.endsWith('FECAESolicitar'))!;
    expect(solicitud.body).toContain('<CbteTipo>1</CbteTipo>');
    expect(solicitud.body).toContain('<AlicIva><Id>5</Id>');
    expect(solicitud.body).toContain('<CondicionIVAReceptorId>1</CondicionIVAReceptorId>');
  });

  it('un monotributista emite C sin detalle de IVA', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerMono) as never);
    expect(invoice.cbte_tipo).toBe(11);
    expect(invoice.imp_iva_cents).toBe(0);
    expect(invoice.imp_neto_cents).toBe(100000);
    expect(invoice.imp_total_cents).toBe(100000);

    const solicitud = arca.requests.find((r) => r.action.endsWith('FECAESolicitar'))!;
    expect(solicitud.body).not.toContain('<AlicIva>');
  });

  it('usa el entorno de homologacion del emisor', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, facturaBase(issuerRI) as never);
    expect(arca.requests.every((r) => r.url.includes('homo'))).toBe(true);
    expect(arca.requests.some((r) => r.url.includes('servicios1.afip.gov.ar'))).toBe(false);
  });

  it('reutiliza el ticket de acceso entre emisiones', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, facturaBase(issuerRI) as never);
    await emitirFactura(userId, facturaBase(issuerRI) as never);
    const logins = arca.requests.filter((r) => r.url.includes('LoginCms'));
    expect(logins).toHaveLength(1);
  });

  it('guarda el cliente cuando se pide', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, { ...facturaBase(issuerRI), guardarCliente: true } as never);
    const cliente = getDb()
      .prepare('SELECT * FROM customers WHERE user_id = ?')
      .get(userId) as { nombre: string } | undefined;
    expect(cliente?.nombre).toBe('Cliente S.A.');
  });

  it('aprueba con observaciones y conserva el CAE', async () => {
    arca = installFakeArca({
      ultimoAutorizado: 0,
      observaciones: [{ code: 10013, msg: 'El numero de documento no se corresponde' }],
    });
    const { invoice, arca: resultado } = await emitirFactura(userId, facturaBase(issuerRI) as never);
    expect(resultado.aprobado).toBe(true);
    expect(resultado.advertencias).toHaveLength(1);
    expect(invoice.cae).toBe('70417054367476');
    expect(invoice.estado).toBe('aprobado');
  });
});

describe('manejo de errores de ARCA', () => {
  it('traduce un rechazo a un mensaje comprensible', async () => {
    arca = installFakeArca({
      ultimoAutorizado: 0,
      cae: { resultado: 'R' },
      errores: [{ code: 10016, msg: 'Fecha de comprobante invalida' }],
    });

    await expect(emitirFactura(userId, facturaBase(issuerRI) as never)).rejects.toThrow(EmisionError);

    try {
      await emitirFactura(userId, facturaBase(issuerRI) as never);
    } catch (err) {
      const e = err as EmisionError;
      expect(e.arca?.aprobado).toBe(false);
      expect(e.arca?.errores[0]?.code).toBe(10016);
      // El mensaje traducido, no el críptico de ARCA.
      expect(e.arca?.errores[0]?.explicacion).toMatch(/fecha del comprobante está fuera del rango/i);
    }
  });

  it('guarda el rechazo en el historial para poder auditarlo', async () => {
    arca = installFakeArca({
      ultimoAutorizado: 0,
      cae: { resultado: 'R' },
      errores: [{ code: 10015, msg: 'Numeracion incorrecta' }],
    });
    await expect(emitirFactura(userId, facturaBase(issuerRI) as never)).rejects.toThrow();

    const { rows } = listInvoices(userId, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estado).toBe('rechazado');
    expect(rows[0]!.cae).toBeNull();
    // No consume número: se vuelve a pedir en el próximo intento.
    expect(rows[0]!.cbte_nro).toBeNull();
  });

  it('explica el error 10242 de condicion de IVA del receptor', async () => {
    arca = installFakeArca({
      ultimoAutorizado: 0,
      cae: { resultado: 'R' },
      errores: [{ code: 10242, msg: 'El campo Condicion IVA receptor es obligatorio' }],
    });
    try {
      await emitirFactura(userId, facturaBase(issuerRI) as never);
      expect.unreachable();
    } catch (err) {
      expect((err as EmisionError).arca?.errores[0]?.explicacion).toMatch(/R\.G\. 5616/);
    }
  });

  it('informa una caida de red sin exponer detalles internos', async () => {
    arca = installFakeArca({ networkError: true });
    await expect(emitirFactura(userId, facturaBase(issuerRI) as never)).rejects.toThrow(
      /no se pudo contactar/i,
    );
  });
});

describe('validaciones previas a ARCA', () => {
  it('rechaza un CUIT invalido sin llamar a ARCA', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const input = { ...facturaBase(issuerRI), docNro: '20123456789' };
    await expect(emitirFactura(userId, input as never)).rejects.toThrow(/revisá los datos/i);
    expect(arca.requests).toHaveLength(0);
  });

  it('exige CUIT del receptor en una factura A', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const input = { ...facturaBase(issuerRI), docTipo: 96, docNro: '12345678' };
    try {
      await emitirFactura(userId, input as never);
      expect.unreachable();
    } catch (err) {
      expect((err as EmisionError).issues.some((i) => /CUIT/.test(i.mensaje))).toBe(true);
    }
    expect(arca.requests).toHaveLength(0);
  });

  it('exige el periodo facturado en comprobantes de servicios', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const input = { ...facturaBase(issuerRI), concepto: 2 };
    try {
      await emitirFactura(userId, input as never);
      expect.unreachable();
    } catch (err) {
      const campos = (err as EmisionError).issues.map((i) => i.campo);
      expect(campos).toContain('fchServDesde');
      expect(campos).toContain('fchServHasta');
      expect(campos).toContain('fchVtoPago');
    }
  });

  it('acepta un comprobante de servicios con las fechas completas', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const hoy = hoyArca();
    const { invoice } = await emitirFactura(userId, {
      ...facturaBase(issuerRI),
      concepto: 2,
      fchServDesde: hoy,
      fchServHasta: hoy,
      fchVtoPago: hoy,
    } as never);
    expect(invoice.cae).toBe('70417054367476');
    const solicitud = arca.requests.find((r) => r.action.endsWith('FECAESolicitar'))!;
    expect(solicitud.body).toContain(`<FchServDesde>${hoy}</FchServDesde>`);
  });

  it('rechaza un monotributista intentando emitir A', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const input = { ...facturaBase(issuerMono), cbteTipo: 1 };
    await expect(emitirFactura(userId, input as never)).rejects.toThrow(/sólo puede emitir/i);
    expect(arca.requests).toHaveLength(0);
  });

  it('rechaza consumidor final en un comprobante A', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const input = { ...facturaBase(issuerRI), condicionIvaReceptorId: 5, cbteTipo: 1 };
    await expect(emitirFactura(userId, input as never)).rejects.toThrow(/no es válida/i);
  });
});

describe('historial', () => {
  it('filtra por cliente, documento y numero', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, facturaBase(issuerRI) as never);

    expect(listInvoices(userId, { q: 'Cliente' }).rows).toHaveLength(1);
    expect(listInvoices(userId, { q: '30710260423' }).rows).toHaveLength(1);
    expect(listInvoices(userId, { q: 'Inexistente' }).rows).toHaveLength(0);
  });

  it('filtra por fecha y estado', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, facturaBase(issuerRI) as never);
    const hoy = hoyArca();

    expect(listInvoices(userId, { desde: hoy, hasta: hoy }).rows).toHaveLength(1);
    expect(listInvoices(userId, { desde: '20990101' }).rows).toHaveLength(0);
    expect(listInvoices(userId, { estado: 'aprobado' }).rows).toHaveLength(1);
    expect(listInvoices(userId, { estado: 'rechazado' }).rows).toHaveLength(0);
  });

  it('no muestra facturas de otro usuario', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    await emitirFactura(userId, facturaBase(issuerRI) as never);
    const otro = Number(
      getDb()
        .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
        .run('otro@example.com', 'x').lastInsertRowid,
    );
    expect(listInvoices(otro, {}).rows).toHaveLength(0);
  });
});

describe('generacion del PDF', () => {
  it('genera un PDF valido con el CAE', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerRI) as never);
    const issuer = toPublicIssuer(getIssuer(userId, issuerRI)!);

    const pdf = await generarPdf(invoice, issuer);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
    // El PDF termina con el trailer estándar.
    expect(pdf.subarray(-8).toString()).toContain('EOF');
  });

  it('genera el PDF de un comprobante C', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const { invoice } = await emitirFactura(userId, facturaBase(issuerMono) as never);
    const issuer = toPublicIssuer(getIssuer(userId, issuerMono)!);
    const pdf = await generarPdf(invoice, issuer);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('genera el PDF de una factura con muchos items', async () => {
    arca = installFakeArca({ ultimoAutorizado: 0 });
    const lineas = Array.from({ length: 40 }, (_, i) => ({
      descripcion: `Producto ${i + 1} con una descripción larga para forzar el salto de línea`,
      cantidad: '2',
      precioUnitario: '150.50',
      ivaId: 5,
    }));
    const { invoice } = await emitirFactura(userId, {
      ...facturaBase(issuerRI),
      lineas,
    } as never);
    const issuer = toPublicIssuer(getIssuer(userId, issuerRI)!);
    const pdf = await generarPdf(invoice, issuer);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('genera el PDF de un comprobante rechazado, marcandolo sin CAE', async () => {
    arca = installFakeArca({
      ultimoAutorizado: 0,
      cae: { resultado: 'R' },
      errores: [{ code: 10015, msg: 'Numeracion incorrecta' }],
    });
    await expect(emitirFactura(userId, facturaBase(issuerRI) as never)).rejects.toThrow();
    const row = listInvoices(userId, {}).rows[0]!;
    const invoice = getInvoice(userId, row.id)!;
    const issuer = toPublicIssuer(getIssuer(userId, issuerRI)!);
    const pdf = await generarPdf(invoice, issuer);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
