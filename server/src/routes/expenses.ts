import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import type { AiConfig } from '../config.js';
import {
  createExpense,
  listExpenses,
  softDeleteExpense,
  softDeleteExpenseGroup,
  type NewExpense,
} from '../db/expenses.js';
import { categorize } from '../categorize/categorize.js';
import { listRules } from '../categorize/rules.js';
import { isOverCap } from '../ai/budget.js';

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

export function registerExpenseRoutes(
  app: FastifyInstance,
  db: Database.Database,
  aiConfig: AiConfig,
): void {
  app.get('/api/expenses', { preHandler: requireAuth(db) }, async () => listExpenses(db));

  app.post(
    '/api/expenses/categorize-pending',
    { preHandler: requireAuth(db) },
    async () => {
      const rules = listRules(db);
      const pending = db
        .prepare(
          "SELECT id, description FROM expenses WHERE deleted_at IS NULL AND category = '' ORDER BY id",
        )
        .all() as { id: number; description: string }[];

      const byDesc = new Map<string, string | null>();
      let stoppedAtCap = false;
      for (const desc of new Set(pending.map((p) => p.description))) {
        if (isOverCap(db, aiConfig)) {
          stoppedAtCap = true;
          break;
        }
        const r = await categorize(db, aiConfig, { description: desc }, { rules });
        byDesc.set(desc, r.category);
      }

      const update = db.prepare('UPDATE expenses SET category = ? WHERE id = ?');
      let updated = 0;
      db.transaction(() => {
        for (const p of pending) {
          const c = byDesc.get(p.description);
          if (c) {
            update.run(c, p.id);
            updated += 1;
          }
        }
      })();

      const stillPending = (
        db
          .prepare("SELECT COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL AND category = ''")
          .get() as { n: number }
      ).n;
      return { updated, stillPending, stoppedAtCap };
    },
  );

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

      let category = typeof body.category === 'string' ? body.category : '';
      if (category.trim() === '') {
        const resolved = await categorize(db, aiConfig, { description: body.description });
        category = resolved.category ?? '';
      }

      const input: NewExpense = {
        date: body.date,
        description: body.description,
        amountCents: body.amountCents,
        category,
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
