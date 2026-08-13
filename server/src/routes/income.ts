import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { createIncome, listIncome, softDeleteIncome, type NewIncomeEntry } from '../db/income.js';

interface CreateIncomeBody {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
  source?: string | null;
  exchangeContractId?: number | null;
  notes?: string | null;
}

export function registerIncomeRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/income', { preHandler: requireAuth(db) }, async () => listIncome(db));

  app.post<{ Body: CreateIncomeBody }>(
    '/api/income',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;
      if (!Number.isInteger(body.amountBrlCents) || body.amountBrlCents <= 0) {
        return reply.code(400).send({ error: 'amountBrlCents must be a positive integer' });
      }
      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }

      const id = createIncome(db, body as NewIncomeEntry);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/income/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteIncome(db, Number(request.params.id));
      return { ok: true };
    },
  );
}
