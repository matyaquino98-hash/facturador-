/** Clientes frecuentes, productos frecuentes y consulta de padrón. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { SERVICE, type Environment } from '../arca/endpoints.js';
import { explicarFalla } from '../arca/errors.js';
import { consultarPersona } from '../arca/padron.js';
import { DOC_TIPO } from '../domain/catalogs.js';
import { isValidCuit, normalizeDoc } from '../lib/cuit.js';
import { toCents } from '../lib/money.js';
import { getAuth } from '../services/arcaAuth.js';
import { getIssuer } from '../services/issuers.js';
import { requireAuth } from './auth.js';

const customerSchema = z.object({
  docTipo: z.number().int(),
  docNro: z.string().trim(),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(200),
  condicionIvaId: z.number().int().positive(),
  domicilio: z.string().trim().max(200).default(''),
  email: z.string().trim().max(200).default(''),
});

const productSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(200),
  precio: z.union([z.number(), z.string()]),
  ivaId: z.number().int(),
});

export async function directoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // --- Clientes ---
  app.get('/api/clientes', async (request) => {
    const q = (request.query as { q?: string }).q?.trim();
    const rows = q
      ? getDb()
          .prepare(
            `SELECT * FROM customers
              WHERE user_id = ? AND (nombre LIKE ? COLLATE NOCASE OR doc_nro LIKE ?)
              ORDER BY nombre LIMIT 50`,
          )
          .all(request.user!.id, `%${q}%`, `%${normalizeDoc(q)}%`)
      : getDb()
          .prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY nombre LIMIT 50')
          .all(request.user!.id);
    return { clientes: rows };
  });

  app.post('/api/clientes', async (request, reply) => {
    const parsed = customerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    const d = parsed.data;
    const docNro = normalizeDoc(d.docNro);
    if ((d.docTipo === DOC_TIPO.CUIT || d.docTipo === DOC_TIPO.CUIL) && !isValidCuit(docNro)) {
      return reply.status(400).send({ error: 'El CUIT/CUIL no es válido.' });
    }

    getDb()
      .prepare(
        `INSERT INTO customers (user_id, doc_tipo, doc_nro, nombre, condicion_iva_id, domicilio, email)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, doc_tipo, doc_nro)
         DO UPDATE SET nombre = excluded.nombre, condicion_iva_id = excluded.condicion_iva_id,
                       domicilio = excluded.domicilio, email = excluded.email`,
      )
      .run(request.user!.id, d.docTipo, docNro, d.nombre, d.condicionIvaId, d.domicilio, d.email);

    const row = getDb()
      .prepare('SELECT * FROM customers WHERE user_id = ? AND doc_tipo = ? AND doc_nro = ?')
      .get(request.user!.id, d.docTipo, docNro);
    return reply.send({ cliente: row });
  });

  app.delete('/api/clientes/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    getDb().prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').run(id, request.user!.id);
    return reply.send({ ok: true });
  });

  // --- Productos / servicios frecuentes ---
  app.get('/api/productos', async (request) => {
    const q = (request.query as { q?: string }).q?.trim();
    const rows = q
      ? getDb()
          .prepare(
            'SELECT * FROM products WHERE user_id = ? AND descripcion LIKE ? COLLATE NOCASE ORDER BY descripcion LIMIT 50',
          )
          .all(request.user!.id, `%${q}%`)
      : getDb()
          .prepare('SELECT * FROM products WHERE user_id = ? ORDER BY descripcion LIMIT 50')
          .all(request.user!.id);
    return { productos: rows };
  });

  app.post('/api/productos', async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    const result = getDb()
      .prepare('INSERT INTO products (user_id, descripcion, precio_cents, iva_id) VALUES (?,?,?,?)')
      .run(
        request.user!.id,
        parsed.data.descripcion,
        toCents(parsed.data.precio),
        parsed.data.ivaId,
      );
    const row = getDb().prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    return reply.send({ producto: row });
  });

  app.delete('/api/productos/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    getDb().prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(id, request.user!.id);
    return reply.send({ ok: true });
  });

  /**
   * Autocompletado del receptor por CUIT contra el servicio de Constancia de
   * Inscripción. Es una comodidad: si el emisor no tiene el servicio habilitado,
   * devuelve 200 con `disponible: false` y la carga manual sigue funcionando.
   */
  app.get('/api/padron/:cuit', async (request, reply) => {
    const cuit = normalizeDoc((request.params as { cuit: string }).cuit);
    if (!isValidCuit(cuit)) {
      return reply.status(400).send({ error: 'El CUIT no es válido.' });
    }
    const issuerId = Number((request.query as { issuerId?: string }).issuerId ?? 0);
    const issuer = getIssuer(request.user!.id, issuerId);
    if (!issuer) return reply.status(400).send({ error: 'Elegí un emisor primero.' });

    // Un cliente ya guardado responde al instante y sin gastar una llamada a ARCA.
    const guardado = getDb()
      .prepare('SELECT * FROM customers WHERE user_id = ? AND doc_nro = ?')
      .get(request.user!.id, cuit) as
      | { nombre: string; condicion_iva_id: number; domicilio: string }
      | undefined;
    if (guardado) {
      return reply.send({
        disponible: true,
        origen: 'clientes',
        datos: {
          docTipo: DOC_TIPO.CUIT,
          docNro: cuit,
          nombre: guardado.nombre,
          domicilio: guardado.domicilio,
          condicionIvaReceptorId: guardado.condicion_iva_id,
        },
      });
    }

    try {
      const auth = await getAuth(issuer, SERVICE.PADRON);
      const datos = await consultarPersona(issuer.environment as Environment, auth, cuit);
      if (!datos) {
        return reply.send({
          disponible: false,
          motivo: 'ARCA no devolvió datos para ese CUIT. Cargalos manualmente.',
        });
      }
      return reply.send({ disponible: true, origen: 'arca', datos });
    } catch (err) {
      // Nunca bloquea la emisión: informa y deja seguir a mano.
      return reply.send({
        disponible: false,
        motivo: `No se pudo consultar el padrón (${explicarFalla(err)}). Cargá los datos manualmente.`,
      });
    }
  });
}
