import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { hashPassword, randomToken, verifyPassword } from '../lib/crypto.js';
import { env } from '../env.js';

const SESSION_COOKIE = 'fact_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresá un email válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

function createSession(reply: FastifyReply, userId: number): void {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt.toISOString());

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function currentUser(request: FastifyRequest): SessionUser | undefined {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token) as { id: number; email: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return undefined;
  }
  return { id: row.id, email: row.email };
}

/** Hook de autenticación para las rutas protegidas. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = currentUser(request);
  if (!user) {
    await reply.status(401).send({ error: 'Necesitás iniciar sesión.' });
    return;
  }
  request.user = user;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' });
    }
    const { email, password } = parsed.data;

    const exists = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return reply.status(409).send({ error: 'Ya existe una cuenta con ese email.' });

    const result = getDb()
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email, hashPassword(password));

    createSession(reply, Number(result.lastInsertRowid));
    return reply.send({ user: { id: Number(result.lastInsertRowid), email } });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Email o contraseña inválidos.' });
    }
    const { email, password } = parsed.data;
    const row = getDb()
      .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
      .get(email) as { id: number; email: string; password_hash: string } | undefined;

    // Mensaje genérico: no revela si el email existe.
    if (!row || !verifyPassword(password, row.password_hash)) {
      return reply.status(401).send({ error: 'Email o contraseña incorrectos.' });
    }

    createSession(reply, row.id);
    return reply.send({ user: { id: row.id, email: row.email } });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.status(401).send({ error: 'No autenticado.' });
    return reply.send({ user });
  });
}
