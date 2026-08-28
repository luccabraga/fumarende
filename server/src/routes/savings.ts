import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createDeposit,
  createWithdrawal,
  listEmergencyFundEntries,
  softDeleteEmergencyFundEntry,
} from '../db/emergency-fund.js';
import { getOrCreateMonthlyTarget, updateMonthlyTargetConfig } from '../db/savings-target.js';

interface EmergencyFundBody {
  kind: string;
  date: string;
  amountCents: number;
  notes?: string | null;
}

interface TargetBody {
  pctOrFixed: string;
  pctValue?: number | null;
  fixedValueCents?: number | null;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function registerSavingsRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/emergency-fund', { preHandler: requireAuth(db) }, async () =>
    listEmergencyFundEntries(db),
  );

  app.post<{ Body: EmergencyFundBody }>(
    '/api/emergency-fund',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;
      if (body.kind !== 'deposit' && body.kind !== 'withdrawal') {
        return reply.code(400).send({ error: "kind must be 'deposit' or 'withdrawal'" });
      }
      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return reply.code(400).send({ error: 'amountCents must be a positive integer' });
      }
      const input = { date: body.date, amountCents: body.amountCents, notes: body.notes ?? null };
      const id = body.kind === 'deposit' ? createDeposit(db, input) : createWithdrawal(db, input);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/emergency-fund/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteEmergencyFundEntry(db, Number(request.params.id));
      return { ok: true };
    },
  );

  // NOTE: the first GET for a month creates and freezes its target row.
  app.get<{ Params: { month: string } }>(
    '/api/savings-target/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      return getOrCreateMonthlyTarget(db, month);
    },
  );

  app.put<{ Params: { month: string }; Body: TargetBody }>(
    '/api/savings-target/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      const body = request.body;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      if (body.pctOrFixed !== 'pct' && body.pctOrFixed !== 'fixed') {
        return reply.code(400).send({ error: "pctOrFixed must be 'pct' or 'fixed'" });
      }
      return updateMonthlyTargetConfig(
        db,
        month,
        body.pctOrFixed,
        body.pctValue ?? null,
        body.fixedValueCents ?? null,
      );
    },
  );
}
