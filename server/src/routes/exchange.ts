import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createExchangeContract,
  listExchangeContracts,
  softDeleteExchangeContract,
  type NewExchangeContract,
} from '../db/exchange.js';

interface CreateExchangeContractBody {
  date: string;
  institution: string;
  operationType: string;
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate?: number | null;
  iofCents?: number;
  bankFeeCents?: number;
  sourcePdfRef?: string | null;
  notes?: string | null;
}

/** Optional non-negative integer: undefined passes; otherwise must be an int >= 0. */
function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0);
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function registerExchangeRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/exchange-contracts', { preHandler: requireAuth(db) }, async () =>
    listExchangeContracts(db),
  );

  app.post<{ Body: CreateExchangeContractBody }>(
    '/api/exchange-contracts',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;

      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }
      if (typeof body.institution !== 'string' || body.institution.trim() === '') {
        return reply.code(400).send({ error: 'institution is required' });
      }
      if (body.operationType !== 'compra' && body.operationType !== 'venda') {
        return reply.code(400).send({ error: "operationType must be 'compra' or 'venda'" });
      }
      if (!Number.isInteger(body.amountUsdCents) || body.amountUsdCents <= 0) {
        return reply.code(400).send({ error: 'amountUsdCents must be a positive integer' });
      }
      if (!isPositiveFinite(body.contractedRate)) {
        return reply.code(400).send({ error: 'contractedRate must be a positive number' });
      }
      if (
        body.ptaxRate !== undefined &&
        body.ptaxRate !== null &&
        !isPositiveFinite(body.ptaxRate)
      ) {
        return reply.code(400).send({ error: 'ptaxRate must be a positive number when provided' });
      }
      if (!isOptionalNonNegativeInteger(body.iofCents)) {
        return reply.code(400).send({ error: 'iofCents must be a non-negative integer' });
      }
      if (!isOptionalNonNegativeInteger(body.bankFeeCents)) {
        return reply.code(400).send({ error: 'bankFeeCents must be a non-negative integer' });
      }

      const input: NewExchangeContract = {
        date: body.date,
        institution: body.institution,
        operationType: body.operationType,
        amountUsdCents: body.amountUsdCents,
        contractedRate: body.contractedRate,
        ptaxRate: body.ptaxRate ?? null,
        iofCents: body.iofCents ?? 0,
        bankFeeCents: body.bankFeeCents ?? 0,
        sourcePdfRef: body.sourcePdfRef ?? null,
        notes: body.notes ?? null,
      };
      const id = createExchangeContract(db, input);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/exchange-contracts/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteExchangeContract(db, Number(request.params.id));
      return { ok: true };
    },
  );
}
