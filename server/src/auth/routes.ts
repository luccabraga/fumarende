import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../db/settings.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, deleteSession, verifySession } from './session.js';

const PASSWORD_KEY = 'password_hash';
const COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 365 * 24 * 60 * 60,
};

interface PasswordBody {
  password: string;
}

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/auth/status', async (request) => {
    const passwordSet = getSetting(db, PASSWORD_KEY) !== undefined;
    const token = request.cookies.session;
    const authenticated = Boolean(token && verifySession(db, token));
    return { passwordSet, authenticated };
  });

  app.post<{ Body: PasswordBody }>('/api/auth/setup', async (request, reply) => {
    if (getSetting(db, PASSWORD_KEY) !== undefined) {
      return reply.code(409).send({ error: 'password already set' });
    }

    setSetting(db, PASSWORD_KEY, hashPassword(request.body.password));
    const { token } = createSession(db);
    reply.setCookie('session', token, COOKIE_OPTIONS);
    return { ok: true };
  });

  app.post<{ Body: PasswordBody }>('/api/auth/login', async (request, reply) => {
    const stored = getSetting(db, PASSWORD_KEY);
    if (!stored) return reply.code(400).send({ error: 'password not set' });

    if (!verifyPassword(request.body.password, stored)) {
      return reply.code(401).send({ error: 'invalid password' });
    }

    const { token } = createSession(db);
    reply.setCookie('session', token, COOKIE_OPTIONS);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies.session;
    if (token) deleteSession(db, token);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
}
