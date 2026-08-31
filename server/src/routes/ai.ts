import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import type { AiConfig } from '../config.js';
import {
  runAnalysis,
  listAnalyses,
  aiStatus,
  ANALYSES,
  BudgetExceededError,
  type AnalysisKind,
} from '../ai/analysis.js';
import { ClaudeNotConfiguredError, ClaudeUpstreamError } from '../ai/client.js';
import { aiUsage } from '../ai/usage.js';

export function registerAiRoutes(
  app: FastifyInstance,
  db: Database.Database,
  cfg: AiConfig,
): void {
  app.get('/api/ai/status', { preHandler: requireAuth(db) }, async () => aiStatus(db, cfg));

  app.get('/api/ai/usage', { preHandler: requireAuth(db) }, async () => aiUsage(db, cfg));

  app.get<{ Querystring: { limit?: string } }>(
    '/api/ai/analyses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const raw = request.query.limit;
      if (raw !== undefined) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 100) {
          return reply.code(400).send({ error: 'limit must be an integer 1–100' });
        }
        return listAnalyses(db, n);
      }
      return listAnalyses(db);
    },
  );

  app.post<{ Body: { kind?: string; webSearch?: boolean } }>(
    '/api/ai/analyses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const kind = request.body?.kind;
      if (!kind || !(kind in ANALYSES)) {
        return reply.code(400).send({ error: 'unknown analysis kind' });
      }
      try {
        const row = await runAnalysis(db, cfg, kind as AnalysisKind, {
          webSearch: request.body?.webSearch === true,
        });
        return reply.code(201).send(row);
      } catch (err) {
        if (err instanceof ClaudeNotConfiguredError) {
          return reply.code(503).send({ error: 'IA não configurada' });
        }
        if (err instanceof BudgetExceededError) {
          return reply.code(429).send({
            error: 'Limite mensal de IA atingido',
            monthToDateUsdCents: err.monthToDateUsdCents,
            capUsdCents: err.capUsdCents,
          });
        }
        if (err instanceof ClaudeUpstreamError) {
          return reply.code(502).send({ error: 'Falha ao consultar a IA' });
        }
        throw err;
      }
    },
  );
}
