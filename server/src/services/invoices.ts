/**
 * Orquestación de la emisión: validar -> numerar -> solicitar CAE -> guardar.
 */
import { getDb } from '../db/index.js';
import { SERVICE, type Environment } from '../arca/endpoints.js';
import { interpretar, explicarFalla, type ResultadoLegible } from '../arca/errors.js';
import { solicitarCae, ultimoAutorizado, type SolicitudCae } from '../arca/wsfev1.js';
import {
  COTIZACION_PESOS,
  MONEDA_PESOS,
  discriminaIva,
  letraDeComprobante,
  type CondicionEmisor,
} from '../domain/catalogs.js';
import { hoyArca, toArcaDate } from '../domain/dates.js';
import { determinarComprobante, validarCombinacion } from '../domain/invoiceType.js';
import { calcularTotales, verificarConsistencia, type LineaInput } from '../domain/totals.js';
import { validarEmision, type EmitirInput, type ValidationIssue } from '../domain/validate.js';
import { normalizeDoc } from '../lib/cuit.js';
import { toCents, toMilli, parseScaled } from '../lib/money.js';
import { getAuth } from './arcaAuth.js';
import { getIssuer, type IssuerRow } from './issuers.js';

export class EmisionError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly arca?: ResultadoLegible,
  ) {
    super(message);
    this.name = 'EmisionError';
  }
}

export interface InvoiceRow {
  id: number;
  user_id: number;
  issuer_id: number;
  environment: string;
  estado: string;
  cbte_tipo: number;
  punto_venta: number;
  cbte_nro: number | null;
  cbte_fecha: string;
  concepto: number;
  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
  fch_vto_pago: string | null;
  doc_tipo: number;
  doc_nro: string;
  cliente_nombre: string;
  cliente_domicilio: string;
  condicion_iva_receptor_id: number;
  imp_neto_cents: number;
  imp_iva_cents: number;
  imp_tot_conc_cents: number;
  imp_op_ex_cents: number;
  imp_trib_cents: number;
  imp_total_cents: number;
  moneda: string;
  cotizacion: number;
  cae: string | null;
  cae_vto: string | null;
  observaciones: string;
  errores: string;
  items: string;
  alicuotas: string;
  created_at: string;
}

export interface EmitirResultado {
  invoice: InvoiceRow;
  arca: ResultadoLegible;
}

export async function emitirFactura(userId: number, input: EmitirInput): Promise<EmitirResultado> {
  const issuer = getIssuer(userId, input.issuerId);
  if (!issuer) throw new EmisionError('El emisor seleccionado no existe.');

  const condicionEmisor = issuer.condicion_iva as CondicionEmisor;

  // 1. Tipo de comprobante: el sugerido, o el elegido si es válido.
  const sugerido = determinarComprobante({
    condicionEmisor,
    condicionIvaReceptorId: input.condicionIvaReceptorId,
    emiteM: issuer.emite_m === 1,
  });
  const cbteTipo = input.cbteTipo ?? sugerido.cbteTipo;

  const errorCombinacion = validarCombinacion(cbteTipo, condicionEmisor, input.condicionIvaReceptorId);
  if (errorCombinacion) {
    throw new EmisionError(errorCombinacion, [{ campo: 'cbteTipo', mensaje: errorCombinacion }]);
  }

  // 2. Validaciones de negocio.
  const issues = validarEmision(input, cbteTipo);
  if (issues.length > 0) {
    throw new EmisionError('Revisá los datos de la factura.', issues);
  }

  // 3. Cálculo de totales.
  const lineas: LineaInput[] = input.lineas.map((l) => ({
    descripcion: l.descripcion.trim(),
    cantidadMilli: toMilli(l.cantidad),
    precioUnitarioCents: toCents(l.precioUnitario),
    // En comprobante C la alícuota se ignora: el IVA no se discrimina.
    ivaId: discriminaIva(cbteTipo) ? l.ivaId : 3,
    descuentoBps: l.descuentoPct ? parseScaled(l.descuentoPct, 2) : 0,
  }));

  const totales = calcularTotales({
    lineas,
    cbteTipo,
    preciosConIva: input.preciosConIva,
    impTribCents: input.otrosTributos ? toCents(input.otrosTributos) : 0,
  });
  verificarConsistencia(totales);

  // 4. Autenticación y numeración. El número lo dicta ARCA, no la app.
  const environment = issuer.environment as Environment;
  let auth;
  try {
    auth = await getAuth(issuer, SERVICE.WSFEV1);
  } catch (err) {
    throw new EmisionError(explicarFalla(err));
  }

  let siguienteNro: number;
  try {
    const ultimo = await ultimoAutorizado(environment, auth, issuer.punto_venta, cbteTipo);
    if (ultimo.errores.length > 0) {
      throw new EmisionError('ARCA no pudo informar el último comprobante autorizado.', [], {
        aprobado: false,
        titulo: 'No se pudo obtener la numeración',
        errores: ultimo.errores.map((e) => ({ code: e.code, msg: e.msg, explicacion: e.msg })),
        advertencias: [],
      });
    }
    siguienteNro = ultimo.cbteNro + 1;
  } catch (err) {
    if (err instanceof EmisionError) throw err;
    throw new EmisionError(explicarFalla(err));
  }

  const cbteFch = input.fecha ? toArcaDate(input.fecha) : hoyArca();
  const docNro = normalizeDoc(input.docNro) || '0';

  const solicitud: SolicitudCae = {
    ptoVta: issuer.punto_venta,
    cbteTipo,
    concepto: input.concepto,
    docTipo: input.docTipo,
    docNro,
    cbteNro: siguienteNro,
    cbteFch,
    impTotalCents: totales.impTotalCents,
    impTotConcCents: totales.impTotConcCents,
    impNetoCents: totales.impNetoCents,
    impOpExCents: totales.impOpExCents,
    impTribCents: totales.impTribCents,
    impIvaCents: totales.impIvaCents,
    fchServDesde: input.fchServDesde ? toArcaDate(input.fchServDesde) : undefined,
    fchServHasta: input.fchServHasta ? toArcaDate(input.fchServHasta) : undefined,
    fchVtoPago: input.fchVtoPago ? toArcaDate(input.fchVtoPago) : undefined,
    monId: MONEDA_PESOS,
    monCotiz: COTIZACION_PESOS,
    condicionIvaReceptorId: input.condicionIvaReceptorId,
    iva: totales.alicuotas.map((a) => ({
      Id: a.id,
      BaseImpCents: a.baseImpCents,
      ImporteCents: a.importeCents,
    })),
  };

  // 5. Solicitud del CAE.
  let respuesta;
  try {
    respuesta = await solicitarCae(environment, auth, solicitud);
  } catch (err) {
    throw new EmisionError(explicarFalla(err));
  }

  const arca = interpretar(respuesta);

  // 6. Persistencia. Los rechazos también se guardan, para poder auditarlos.
  const invoiceId = insertInvoice({
    userId,
    issuer,
    input,
    cbteTipo,
    cbteFch,
    docNro,
    siguienteNro: arca.aprobado ? (respuesta.cbteDesde ?? siguienteNro) : null,
    totales,
    respuesta,
    arca,
  });

  const invoice = getInvoice(userId, invoiceId)!;

  if (!arca.aprobado) {
    throw new EmisionError(arca.titulo, [], arca);
  }

  if (input.guardarCliente && input.docTipo !== 99) {
    upsertCustomer(userId, input, docNro);
  }

  return { invoice, arca };
}

function insertInvoice(args: {
  userId: number;
  issuer: IssuerRow;
  input: EmitirInput;
  cbteTipo: number;
  cbteFch: string;
  docNro: string;
  siguienteNro: number | null;
  totales: ReturnType<typeof calcularTotales>;
  respuesta: Awaited<ReturnType<typeof solicitarCae>>;
  arca: ResultadoLegible;
}): number {
  const { userId, issuer, input, cbteTipo, cbteFch, docNro, totales, respuesta, arca } = args;

  const result = getDb()
    .prepare(
      `INSERT INTO invoices (
         user_id, issuer_id, environment, estado, cbte_tipo, punto_venta, cbte_nro, cbte_fecha,
         concepto, fch_serv_desde, fch_serv_hasta, fch_vto_pago, doc_tipo, doc_nro,
         cliente_nombre, cliente_domicilio, condicion_iva_receptor_id,
         imp_neto_cents, imp_iva_cents, imp_tot_conc_cents, imp_op_ex_cents, imp_trib_cents,
         imp_total_cents, moneda, cotizacion, cae, cae_vto, observaciones, errores, items, alicuotas
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      issuer.id,
      issuer.environment,
      arca.aprobado ? 'aprobado' : 'rechazado',
      cbteTipo,
      issuer.punto_venta,
      args.siguienteNro,
      cbteFch,
      input.concepto,
      input.fchServDesde ? toArcaDate(input.fchServDesde) : null,
      input.fchServHasta ? toArcaDate(input.fchServHasta) : null,
      input.fchVtoPago ? toArcaDate(input.fchVtoPago) : null,
      input.docTipo,
      docNro,
      input.clienteNombre.trim() || 'Consumidor Final',
      input.clienteDomicilio.trim(),
      input.condicionIvaReceptorId,
      totales.impNetoCents,
      totales.impIvaCents,
      totales.impTotConcCents,
      totales.impOpExCents,
      totales.impTribCents,
      totales.impTotalCents,
      MONEDA_PESOS,
      COTIZACION_PESOS,
      respuesta.cae ?? null,
      respuesta.caeFchVto ?? null,
      JSON.stringify(arca.advertencias),
      JSON.stringify(arca.errores),
      JSON.stringify(totales.lineas),
      JSON.stringify(totales.alicuotas),
    );

  return Number(result.lastInsertRowid);
}

function upsertCustomer(userId: number, input: EmitirInput, docNro: string): void {
  getDb()
    .prepare(
      `INSERT INTO customers (user_id, doc_tipo, doc_nro, nombre, condicion_iva_id, domicilio)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, doc_tipo, doc_nro)
       DO UPDATE SET nombre = excluded.nombre,
                     condicion_iva_id = excluded.condicion_iva_id,
                     domicilio = excluded.domicilio`,
    )
    .run(
      userId,
      input.docTipo,
      docNro,
      input.clienteNombre.trim(),
      input.condicionIvaReceptorId,
      input.clienteDomicilio.trim(),
    );
}

export function getInvoice(userId: number, id: number): InvoiceRow | undefined {
  return getDb()
    .prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .get(id, userId) as InvoiceRow | undefined;
}

export interface HistorialFiltros {
  q?: string;
  desde?: string;
  hasta?: string;
  estado?: string;
  limit?: number;
  offset?: number;
}

export function listInvoices(userId: number, f: HistorialFiltros): { rows: InvoiceRow[]; total: number } {
  const where: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (f.q && f.q.trim() !== '') {
    const q = f.q.trim();
    const digits = normalizeDoc(q);
    // Busca por nombre, por documento y por número de comprobante en una sola consulta.
    where.push(
      '(cliente_nombre LIKE ? COLLATE NOCASE' +
        (digits ? ' OR doc_nro LIKE ? OR CAST(cbte_nro AS TEXT) LIKE ?' : '') +
        ')',
    );
    params.push(`%${q}%`);
    if (digits) {
      params.push(`%${digits}%`);
      params.push(`%${digits}%`);
    }
  }
  if (f.desde) {
    where.push('cbte_fecha >= ?');
    params.push(toArcaDate(f.desde));
  }
  if (f.hasta) {
    where.push('cbte_fecha <= ?');
    params.push(toArcaDate(f.hasta));
  }
  if (f.estado && f.estado !== 'todos') {
    where.push('estado = ?');
    params.push(f.estado);
  }

  const clause = where.join(' AND ');
  const total = (
    getDb().prepare(`SELECT COUNT(*) AS n FROM invoices WHERE ${clause}`).get(...params) as {
      n: number;
    }
  ).n;

  const rows = getDb()
    .prepare(
      `SELECT * FROM invoices WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, f.limit ?? 50, f.offset ?? 0) as InvoiceRow[];

  return { rows, total };
}

/** Serializa una factura para la API y la UI. */
export function toPublicInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    estado: row.estado,
    environment: row.environment,
    cbteTipo: row.cbte_tipo,
    letra: letraDeComprobante(row.cbte_tipo),
    puntoVenta: row.punto_venta,
    numero: row.cbte_nro,
    numeroFormateado:
      row.cbte_nro === null
        ? null
        : `${String(row.punto_venta).padStart(5, '0')}-${String(row.cbte_nro).padStart(8, '0')}`,
    fecha: row.cbte_fecha,
    concepto: row.concepto,
    docTipo: row.doc_tipo,
    docNro: row.doc_nro,
    clienteNombre: row.cliente_nombre,
    clienteDomicilio: row.cliente_domicilio,
    condicionIvaReceptorId: row.condicion_iva_receptor_id,
    netoCents: row.imp_neto_cents,
    ivaCents: row.imp_iva_cents,
    tributosCents: row.imp_trib_cents,
    totalCents: row.imp_total_cents,
    cae: row.cae,
    caeVto: row.cae_vto,
    observaciones: JSON.parse(row.observaciones) as unknown[],
    errores: JSON.parse(row.errores) as unknown[],
    items: JSON.parse(row.items) as unknown[],
    alicuotas: JSON.parse(row.alicuotas) as unknown[],
    creadaEl: row.created_at,
  };
}
