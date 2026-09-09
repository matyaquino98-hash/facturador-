import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';
import { initDb } from './db/index.js';
import { initCrypto } from './lib/crypto.js';
import { authRoutes } from './routes/auth.js';
import { issuerRoutes } from './routes/issuers.js';
import { invoiceRoutes } from './routes/invoices.js';
import { directoryRoutes } from './routes/directory.js';

export async function buildApp() {
  initCrypto(env.encryptionKey);
  await initDb(env.dbFile);

  const app = Fastify({
    // Nunca loguear cuerpos: podrían contener certificados o claves privadas.
    logger: {
      level: env.nodeEnv === 'production' ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    bodyLimit: 2 * 1024 * 1024, // suficiente para un PEM, no para subir archivos grandes
  });

  await app.register(cookie);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });

  // CORS sólo para el dev server de Vite.
  if (env.nodeEnv !== 'production') {
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin === env.webOrigin) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Credentials', 'true');
        reply.header('Access-Control-Allow-Headers', 'content-type');
        reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      }
      if (request.method === 'OPTIONS') await reply.status(204).send();
    });
  }

  await app.register(authRoutes);
  await app.register(issuerRoutes);
  await app.register(invoiceRoutes);
  await app.register(directoryRoutes);

  app.get('/api/health', async () => ({ ok: true, env: env.nodeEnv }));

  // Front compilado (SPA).
  const webDist = resolve(process.cwd(), '../web/dist');
  if (env.serveStatic && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Ruta no encontrada.' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (isMain || process.env.START_SERVER === 'true') {
  const app = await buildApp();
  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`Facturador escuchando en http://localhost:${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
