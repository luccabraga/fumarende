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
import { listRules, matchRule } from '../categorize/rules.js';
import { isOverCap, monthToDateUsdCents } from '../ai/budget.js';
import { extractStatement } from '../import/extract.js';
import { inferType } from '../import/expense-type.js';
import { ClaudeNotConfiguredError, ClaudeUpstreamError } from '../ai/client.js';
import { BudgetExceededError } from '../ai/analysis.js';

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

  app.post<{ Body: { dataBase64?: unknown; filename?: unknown } }>(
    '/api/expenses/import-preview',
    { preHandler: requireAuth(db), bodyLimit: 20 * 1024 * 1024 },
    async (request, reply) => {
      const dataBase64 = request.body?.dataBase64;
      if (typeof dataBase64 !== 'string' || dataBase64.trim() === '') {
        return reply.code(400).send({ error: 'dataBase64 is required' });
      }
      if (Buffer.from(dataBase64, 'base64').length > 12 * 1024 * 1024) {
        return reply.code(400).send({ error: 'PDF acima de 12 MB' });
      }

      let extraction;
      try {
        extraction = await extractStatement(aiConfig, dataBase64, { db });
      } catch (err) {
        if (err instanceof ClaudeNotConfiguredError) {
          return reply.code(503).send({ error: 'IA não configurada' });
        }
        if (err instanceof BudgetExceededError) {
          return reply.code(429).send({
            error: 'Limite mensal de IA atingido',
            monthToDateUsdCents: monthToDateUsdCents(db),
            capUsdCents: aiConfig.monthlyCapUsdCents,
          });
        }
        if (err instanceof ClaudeUpstreamError) {
          return reply.code(502).send({ error: 'Falha ao ler o PDF' });
        }
        throw err;
      }

      const rules = listRules(db);
      const seen = new Set(
        (
          db
            .prepare(
              'SELECT date, amount_cents AS amountCents, description FROM expenses WHERE deleted_at IS NULL',
            )
            .all() as { date: string; amountCents: number; description: string }[]
        ).map((e) => `${e.date}|${e.amountCents}|${e.description}`),
      );

      const rows = extraction.rows.map((r) => {
        const suggestedCategory = matchRule(rules, r.description)?.category ?? '';
        return {
          ...r,
          suggestedCategory,
          suggestedType: inferType(suggestedCategory),
          duplicate: seen.has(`${r.date}|${r.amountCents}|${r.description}`),
        };
      });

      return { rows, warnings: extraction.warnings };
    },
  );

  app.post<{
    Body: {
      rows?: {
        date?: unknown;
        description?: unknown;
        amountCents?: unknown;
        category?: unknown;
        type?: unknown;
      }[];
    };
  }>(
    '/api/expenses/import-confirm',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const rows = request.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return reply.code(400).send({ error: 'rows must be a non-empty array' });
      }
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        if (
          typeof r.date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
          typeof r.description !== 'string' ||
          r.description.trim() === '' ||
          !Number.isInteger(r.amountCents) ||
          (r.amountCents as number) <= 0 ||
          (r.type !== 'essencial' && r.type !== 'nao-essencial')
        ) {
          return reply.code(400).send({ error: 'linha inválida', index: i });
        }
      }

      // resolve blank categories BEFORE the synchronous transaction
      const resolved: string[] = [];
      for (const r of rows) {
        let category = typeof r.category === 'string' ? r.category : '';
        if (category.trim() === '') {
          category =
            (await categorize(db, aiConfig, { description: r.description as string })).category ?? '';
        }
        resolved.push(category);
      }

      db.transaction(() => {
        rows.forEach((r, i) => {
          createExpense(db, {
            date: r.date as string,
            description: (r.description as string).trim(),
            amountCents: r.amountCents as number,
            category: resolved[i],
            type: r.type as 'essencial' | 'nao-essencial',
            paymentMethod: 'Crédito',
            installmentTotal: null,
            notes: null,
          });
        });
      })();

      return { created: rows.length };
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
