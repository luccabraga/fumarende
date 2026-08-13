import type { FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { verifySession } from './session.js';

export function requireAuth(db: Database.Database) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies.session;
    if (!token || !verifySession(db, token)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
