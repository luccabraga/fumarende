import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { listRules, addRule, deleteRule } from '../categorize/rules.js';

export function registerCategoryRuleRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/category-rules', { preHandler: requireAuth(db) }, async () => listRules(db));

  app.post<{ Body: { keyword?: string; category?: string } }>(
    '/api/category-rules',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { keyword, category } = request.body ?? {};
      try {
        return reply.code(201).send(addRule(db, String(keyword ?? ''), String(category ?? '')));
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid rule' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/category-rules/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      deleteRule(db, Number(request.params.id));
      return { ok: true };
    },
  );
}
