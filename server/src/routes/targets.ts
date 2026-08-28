import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createTarget,
  listTargets,
  updateTarget,
  addToTarget,
  softDeleteTarget,
  type TargetTable,
  type TargetPatch,
} from '../db/targets.js';

interface CreateBody {
  name: string;
  targetCents: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}
interface AddBody {
  deltaCents: number;
}

function nonBlankString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}
function isPositiveInt(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) > 0;
}
function isNonNegInt(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 0;
}

export function registerTargetRoutes(
  app: FastifyInstance,
  db: Database.Database,
  opts: { table: TargetTable; basePath: string },
): void {
  const { table, basePath } = opts;

  app.get(basePath, { preHandler: requireAuth(db) }, async () => listTargets(db, table));

  app.post<{ Body: CreateBody }>(basePath, { preHandler: requireAuth(db) }, async (request, reply) => {
    const b = request.body;
    if (!nonBlankString(b.name)) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!isPositiveInt(b.targetCents)) {
      return reply.code(400).send({ error: 'targetCents must be a positive integer' });
    }
    if (b.currentCents !== undefined && !isNonNegInt(b.currentCents)) {
      return reply.code(400).send({ error: 'currentCents must be a non-negative integer' });
    }
    const id = createTarget(db, table, {
      name: b.name,
      targetCents: b.targetCents,
      currentCents: b.currentCents,
      targetDate: b.targetDate ?? null,
      notes: b.notes ?? null,
    });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: TargetPatch }>(
    `${basePath}/:id`,
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const b = request.body ?? {};
      if (b.name !== undefined && !nonBlankString(b.name)) {
        return reply.code(400).send({ error: 'name must be a non-blank string' });
      }
      if (b.targetCents !== undefined && !isPositiveInt(b.targetCents)) {
        return reply.code(400).send({ error: 'targetCents must be a positive integer' });
      }
      if (b.currentCents !== undefined && !isNonNegInt(b.currentCents)) {
        return reply.code(400).send({ error: 'currentCents must be a non-negative integer' });
      }
      updateTarget(db, table, Number(request.params.id), b);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: AddBody }>(
    `${basePath}/:id/add`,
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (!isPositiveInt(request.body?.deltaCents)) {
        return reply.code(400).send({ error: 'deltaCents must be a positive integer' });
      }
      addToTarget(db, table, Number(request.params.id), request.body.deltaCents);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${basePath}/:id`,
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteTarget(db, table, Number(request.params.id));
      return { ok: true };
    },
  );
}
