import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createExpense,
  listExpenses,
  softDeleteExpense,
  softDeleteExpenseGroup,
  type NewExpense,
} from '../db/expenses.js';

interface CreateExpenseBody {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function registerExpenseRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/expenses', { preHandler: requireAuth(db) }, async () => listExpenses(db));

  app.post<{ Body: CreateExpenseBody }>(
    '/api/expenses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;

      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }
      if (!nonBlankString(body.description)) {
        return reply.code(400).send({ error: 'description is required' });
      }
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return reply.code(400).send({ error: 'amountCents must be a positive integer' });
      }
      if (body.type !== 'essencial' && body.type !== 'nao-essencial') {
        return reply.code(400).send({ error: "type must be 'essencial' or 'nao-essencial'" });
      }
      if (!nonBlankString(body.category)) {
        return reply.code(400).send({ error: 'category is required' });
      }
      if (!nonBlankString(body.paymentMethod)) {
        return reply.code(400).send({ error: 'paymentMethod is required' });
      }
      if (
        body.installmentTotal !== undefined &&
        body.installmentTotal !== null &&
        (!Number.isInteger(body.installmentTotal) || body.installmentTotal < 1)
      ) {
        return reply.code(400).send({ error: 'installmentTotal must be an integer >= 1' });
      }

      const input: NewExpense = {
        date: body.date,
        description: body.description,
        amountCents: body.amountCents,
        category: body.category,
        type: body.type,
        paymentMethod: body.paymentMethod,
        installmentTotal: body.installmentTotal ?? null,
        notes: body.notes ?? null,
      };
      const ids = createExpense(db, input);
      return reply.code(201).send({ ids });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/expenses/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteExpense(db, Number(request.params.id));
      return { ok: true };
    },
  );

  app.delete<{ Params: { groupId: string } }>(
    '/api/expenses/group/:groupId',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteExpenseGroup(db, request.params.groupId);
      return { ok: true };
    },
  );
}
