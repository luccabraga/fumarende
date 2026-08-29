import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { dashboardSummary } from '../dashboard/summary.js';

export function registerDashboardRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
  app.get<{ Querystring: { month?: string } }>(
    '/api/dashboard',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.query;
      if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      return dashboardSummary(db, { month, dataPaths });
    },
  );
}
