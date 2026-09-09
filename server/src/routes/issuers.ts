import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { isEnvironment } from '../arca/endpoints.js';
import { CONDICION_EMISOR } from '../domain/catalogs.js';
import { isValidCuit, normalizeDoc } from '../lib/cuit.js';
import { getIssuer, listIssuers, storeCredentials, toPublicIssuer } from '../services/issuers.js';
import { invalidateAuth } from '../services/arcaAuth.js';
import { requireAuth } from './auth.js';

const issuerSchema = z.object({
  cuit: z.string().trim(),
  razonSocial: z.string().trim().min(1, 'La razón social es obligatoria.').max(200),
  condicionIva: z.enum([
    CONDICION_EMISOR.RESPONSABLE_INSCRIPTO,
    CONDICION_EMISOR.MONOTRIBUTO,
    CONDICION_EMISOR.EXENTO,
  ]),
  domicilio: z.string().trim().max(200).default(''),
  ingresosBrutos: z.string().trim().max(50).default(''),
  inicioActividades: z.string().trim().max(20).default(''),
  puntoVenta: z.number().int().min(1).max(99999),
  environment: z.string().refine(isEnvironment, 'Entorno inválido.'),
  emiteM: z.boolean().default(false),
});

/**
 * El certificado y la clave privada entran por acá y no vuelven a salir nunca:
 * se guardan cifrados y las respuestas sólo exponen metadatos.
 */
const credentialsSchema = z.object({
  certPem: z.string().min(1, 'Pegá el certificado en formato PEM.'),
  keyPem: z.string().min(1, 'Pegá la clave privada en formato PEM.'),
});

export async function issuerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/issuers', async (request) => ({
    issuers: listIssuers(request.user!.id).map(toPublicIssuer),
  }));

  app.post('/api/issuers', async (request, reply) => {
    const parsed = issuerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    const data = parsed.data;
    const cuit = normalizeDoc(data.cuit);
    if (!isValidCuit(cuit)) {
      return reply.status(400).send({ error: 'El CUIT del emisor no es válido.' });
    }

    try {
      const result = getDb()
        .prepare(
          `INSERT INTO issuers (user_id, cuit, razon_social, condicion_iva, domicilio,
                                ingresos_brutos, inicio_actividades, punto_venta, environment, emite_m)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          request.user!.id,
          cuit,
          data.razonSocial,
          data.condicionIva,
          data.domicilio,
          data.ingresosBrutos,
          data.inicioActividades,
          data.puntoVenta,
          data.environment,
          data.emiteM ? 1 : 0,
        );
      const row = getIssuer(request.user!.id, Number(result.lastInsertRowid))!;
      return reply.send({ issuer: toPublicIssuer(row) });
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        return reply
          .status(409)
          .send({ error: 'Ya tenés un emisor con ese CUIT, punto de venta y entorno.' });
      }
      throw err;
    }
  });

  app.patch('/api/issuers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = issuerSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    const existing = getIssuer(request.user!.id, id);
    if (!existing) return reply.status(404).send({ error: 'El emisor no existe.' });

    const d = parsed.data;
    if (d.cuit !== undefined && !isValidCuit(normalizeDoc(d.cuit))) {
      return reply.status(400).send({ error: 'El CUIT del emisor no es válido.' });
    }

    getDb()
      .prepare(
        `UPDATE issuers SET
           cuit = COALESCE(?, cuit),
           razon_social = COALESCE(?, razon_social),
           condicion_iva = COALESCE(?, condicion_iva),
           domicilio = COALESCE(?, domicilio),
           ingresos_brutos = COALESCE(?, ingresos_brutos),
           inicio_actividades = COALESCE(?, inicio_actividades),
           punto_venta = COALESCE(?, punto_venta),
           environment = COALESCE(?, environment),
           emite_m = COALESCE(?, emite_m)
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        d.cuit !== undefined ? normalizeDoc(d.cuit) : null,
        d.razonSocial ?? null,
        d.condicionIva ?? null,
        d.domicilio ?? null,
        d.ingresosBrutos ?? null,
        d.inicioActividades ?? null,
        d.puntoVenta ?? null,
        d.environment ?? null,
        d.emiteM === undefined ? null : d.emiteM ? 1 : 0,
        id,
        request.user!.id,
      );

    // Cambiar CUIT o entorno invalida el ticket de acceso cacheado.
    if (d.cuit !== undefined || d.environment !== undefined) invalidateAuth(id);

    return reply.send({ issuer: toPublicIssuer(getIssuer(request.user!.id, id)!) });
  });

  app.post('/api/issuers/:id/credentials', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    try {
      const issuer = storeCredentials(request.user!.id, id, parsed.data);
      return reply.send({ issuer });
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'No se pudo guardar el certificado.' });
    }
  });

  app.delete('/api/issuers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const usadas = getDb()
      .prepare('SELECT COUNT(*) AS n FROM invoices WHERE issuer_id = ? AND user_id = ?')
      .get(id, request.user!.id) as { n: number };
    if (usadas.n > 0) {
      return reply.status(409).send({
        error: 'No se puede borrar un emisor con comprobantes emitidos. Son parte del respaldo fiscal.',
      });
    }
    getDb().prepare('DELETE FROM issuers WHERE id = ? AND user_id = ?').run(id, request.user!.id);
    return reply.send({ ok: true });
  });
}
