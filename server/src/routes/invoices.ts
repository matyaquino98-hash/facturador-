import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SERVICE, type Environment } from '../arca/endpoints.js';
import { explicarFalla } from '../arca/errors.js';
import { dummy, ultimoAutorizado } from '../arca/wsfev1.js';
import {
  ALICUOTAS_IVA,
  CBTE_TIPO_LABEL,
  CONCEPTO_LABEL,
  CONDICIONES_IVA_RECEPTOR,
  DOC_TIPO_LABEL,
} from '../domain/catalogs.js';
import { determinarComprobante } from '../domain/invoiceType.js';
import { calcularTotales } from '../domain/totals.js';
import { emitirSchema } from '../domain/validate.js';
import { toCents, toMilli, parseScaled } from '../lib/money.js';
import { generarPdf } from '../pdf/invoicePdf.js';
import { getAuth } from '../services/arcaAuth.js';
import {
  EmisionError,
  emitirFactura,
  getInvoice,
  listInvoices,
  toPublicInvoice,
} from '../services/invoices.js';
import { getIssuer, toPublicIssuer } from '../services/issuers.js';
import { requireAuth } from './auth.js';

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Catálogos para poblar los selects del formulario. */
  app.get('/api/catalogos', async () => ({
    alicuotasIva: ALICUOTAS_IVA,
    condicionesIvaReceptor: CONDICIONES_IVA_RECEPTOR,
    tiposComprobante: Object.entries(CBTE_TIPO_LABEL).map(([id, label]) => ({
      id: Number(id),
      label,
    })),
    tiposDocumento: Object.entries(DOC_TIPO_LABEL).map(([id, label]) => ({
      id: Number(id),
      label,
    })),
    conceptos: Object.entries(CONCEPTO_LABEL).map(([id, label]) => ({ id: Number(id), label })),
  }));

  /** Sugerencia de tipo de comprobante en vivo, mientras se carga el formulario. */
  app.post('/api/comprobante/sugerir', async (request, reply) => {
    const schema = z.object({
      issuerId: z.number().int().positive(),
      condicionIvaReceptorId: z.number().int().positive(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Datos inválidos.' });

    const issuer = getIssuer(request.user!.id, parsed.data.issuerId);
    if (!issuer) return reply.status(404).send({ error: 'El emisor no existe.' });

    try {
      const determinacion = determinarComprobante({
        condicionEmisor: issuer.condicion_iva as never,
        condicionIvaReceptorId: parsed.data.condicionIvaReceptorId,
        emiteM: issuer.emite_m === 1,
      });
      return reply.send({
        ...determinacion,
        label: CBTE_TIPO_LABEL[determinacion.cbteTipo] ?? '',
        alternativas: determinacion.alternativas.map((id) => ({
          id,
          label: CBTE_TIPO_LABEL[id] ?? String(id),
        })),
      });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Error.' });
    }
  });

  /** Previsualización de totales: mismo cálculo que la emisión, sin tocar ARCA. */
  app.post('/api/comprobante/calcular', async (request, reply) => {
    const schema = z.object({
      cbteTipo: z.number().int().positive(),
      preciosConIva: z.boolean().default(false),
      otrosTributos: z.union([z.number(), z.string()]).optional(),
      lineas: z.array(
        z.object({
          descripcion: z.string().default(''),
          cantidad: z.union([z.number(), z.string()]),
          precioUnitario: z.union([z.number(), z.string()]),
          ivaId: z.number().int(),
          descuentoPct: z.union([z.number(), z.string()]).optional(),
        }),
      ),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Datos inválidos.' });
    if (parsed.data.lineas.length === 0) {
      return reply.send({
        lineas: [],
        alicuotas: [],
        impNetoCents: 0,
        impIvaCents: 0,
        impTribCents: 0,
        impTotalCents: 0,
      });
    }

    try {
      const totales = calcularTotales({
        cbteTipo: parsed.data.cbteTipo,
        preciosConIva: parsed.data.preciosConIva,
        impTribCents: parsed.data.otrosTributos ? toCents(parsed.data.otrosTributos) : 0,
        lineas: parsed.data.lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidadMilli: toMilli(l.cantidad),
          precioUnitarioCents: toCents(l.precioUnitario),
          ivaId: l.ivaId,
          descuentoBps: l.descuentoPct ? parseScaled(l.descuentoPct, 2) : 0,
        })),
      });
      return reply.send(totales);
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'No se pudo calcular.' });
    }
  });

  /** GENERAR FACTURA: valida, numera contra ARCA, pide el CAE y guarda. */
  app.post('/api/facturas', async (request, reply) => {
    const parsed = emitirSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Revisá los datos de la factura.',
        issues: parsed.error.issues.map((i) => ({
          campo: i.path.join('.'),
          mensaje: i.message,
        })),
      });
    }

    try {
      const { invoice, arca } = await emitirFactura(request.user!.id, parsed.data);
      return reply.send({ factura: toPublicInvoice(invoice), arca });
    } catch (err) {
      if (err instanceof EmisionError) {
        return reply.status(422).send({ error: err.message, issues: err.issues, arca: err.arca });
      }
      request.log.error({ err }, 'fallo la emision');
      return reply.status(502).send({ error: explicarFalla(err) });
    }
  });

  app.get('/api/facturas', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const { rows, total } = listInvoices(request.user!.id, {
      q: q.q,
      desde: q.desde,
      hasta: q.hasta,
      estado: q.estado,
      limit: Math.min(Number(q.limit ?? 50), 200),
      offset: Number(q.offset ?? 0),
    });
    return { facturas: rows.map(toPublicInvoice), total };
  });

  app.get('/api/facturas/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = getInvoice(request.user!.id, id);
    if (!row) return reply.status(404).send({ error: 'La factura no existe.' });
    const issuer = getIssuer(request.user!.id, row.issuer_id);
    return reply.send({
      factura: toPublicInvoice(row),
      emisor: issuer ? toPublicIssuer(issuer) : null,
    });
  });

  app.get('/api/facturas/:id/pdf', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = getInvoice(request.user!.id, id);
    if (!row) return reply.status(404).send({ error: 'La factura no existe.' });
    const issuerRow = getIssuer(request.user!.id, row.issuer_id);
    if (!issuerRow) return reply.status(404).send({ error: 'El emisor de la factura no existe.' });

    const pdf = await generarPdf(row, toPublicIssuer(issuerRow));
    const nombre =
      row.cbte_nro === null
        ? `comprobante-${row.id}.pdf`
        : `${String(row.punto_venta).padStart(5, '0')}-${String(row.cbte_nro).padStart(8, '0')}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${nombre}"`)
      .send(pdf);
  });

  /** Estado de los servidores de ARCA y del último número autorizado. */
  app.get('/api/arca/estado/:issuerId', async (request, reply) => {
    const issuerId = Number((request.params as { issuerId: string }).issuerId);
    const issuer = getIssuer(request.user!.id, issuerId);
    if (!issuer) return reply.status(404).send({ error: 'El emisor no existe.' });
    const environment = issuer.environment as Environment;

    try {
      const servidores = await dummy(environment);
      let ultimo: number | null = null;
      let credenciales = 'no cargadas';

      if (issuer.cert_pem_enc && issuer.key_pem_enc) {
        try {
          const auth = await getAuth(issuer, SERVICE.WSFEV1);
          const cbteTipo = Number((request.query as { cbteTipo?: string }).cbteTipo ?? 0);
          if (cbteTipo > 0) {
            ultimo = (await ultimoAutorizado(environment, auth, issuer.punto_venta, cbteTipo)).cbteNro;
          }
          credenciales = 'ok';
        } catch (err) {
          credenciales = explicarFalla(err);
        }
      }

      return reply.send({ environment, servidores, credenciales, ultimoAutorizado: ultimo });
    } catch (err) {
      return reply.status(502).send({ error: explicarFalla(err) });
    }
  });
}
