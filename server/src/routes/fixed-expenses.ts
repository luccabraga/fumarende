import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createFixedExpense,
  listFixedExpenses,
  softDeleteFixedExpense,
  applyFixedExpensesToMonth,
  type NewFixedExpense,
} from '../db/fixed-expenses.js';

interface CreateFixedExpenseBody {
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

interface ApplyBody {
  month: string;
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function registerFixedExpenseRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/fixed-expenses', { preHandler: requireAuth(db) }, async () =>
    listFixedExpenses(db),
  );

  app.post<{ Body: CreateFixedExpenseBody }>(
    '/api/fixed-expenses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;
      if (!nonBlankString(body.description)) {
        return reply.code(400).send({ error: 'description is required' });
      }
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return reply.code(400).send({ error: 'amountCents must be a positive integer' });
      }
      if (body.type !== 'essencial' && body.type !== 'nao-essencial') {
        return reply.code(400).send({ error: "type must be 'essencial' or 'nao-essencial'" });
      }
      if (!nonBlankString(body.category) || !nonBlankString(body.paymentMethod)) {
        return reply.code(400).send({ error: 'category and paymentMethod are required' });
      }

      const input: NewFixedExpense = {
        description: body.description,
        amountCents: body.amountCents,
        category: body.category,
        type: body.type,
        paymentMethod: body.paymentMethod,
      };
      const id = createFixedExpense(db, input);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/fixed-expenses/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteFixedExpense(db, Number(request.params.id));
      return { ok: true };
    },
  );

  app.post<{ Body: ApplyBody }>(
    '/api/fixed-expenses/apply',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const month = request.body?.month;
      if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      const created = applyFixedExpensesToMonth(db, month);
      return { created };
    },
  );
}
