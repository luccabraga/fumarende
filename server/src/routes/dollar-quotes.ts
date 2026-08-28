import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { upsertQuote, listQuotes, deleteQuote } from '../db/dollar-quotes.js';

interface PutBody {
  rate: number;
  salaryUsdCents?: number | null;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function registerDollarQuoteRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/dollar-quotes', { preHandler: requireAuth(db) }, async () => listQuotes(db));

  app.put<{ Params: { month: string }; Body: PutBody }>(
    '/api/dollar-quotes/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      const body = request.body;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate <= 0) {
        return reply.code(400).send({ error: 'rate must be a positive number' });
      }
      const s = body.salaryUsdCents;
      if (s !== undefined && s !== null && (!Number.isInteger(s) || s < 0)) {
        return reply.code(400).send({ error: 'salaryUsdCents must be a non-negative integer' });
      }
      return upsertQuote(db, { month, rate: body.rate, salaryUsdCents: s ?? null });
    },
  );

  app.delete<{ Params: { month: string } }>(
    '/api/dollar-quotes/:month',
    { preHandler: requireAuth(db) },
    async (request) => {
      deleteQuote(db, request.params.month);
      return { ok: true };
    },
  );
}
