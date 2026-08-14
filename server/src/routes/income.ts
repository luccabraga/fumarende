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

/**
 * Optional numeric fields are genuinely optional, so null/undefined pass.
 * Anything else present must be a real integer — money is always integer
 * cents, and SQLite's loose type affinity would happily store 12.75 or
 * "abc" in an INTEGER column if we did not check here.
 */
function isOptionalInteger(value: unknown): boolean {
  return value === undefined || value === null || Number.isInteger(value);
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
      if (!isOptionalInteger(body.amountUsdCents)) {
        return reply.code(400).send({ error: 'amountUsdCents must be an integer' });
      }
      if (!isOptionalInteger(body.exchangeContractId)) {
        return reply.code(400).send({ error: 'exchangeContractId must be an integer' });
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
