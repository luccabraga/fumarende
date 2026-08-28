import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { dashboardSummary } from '../dashboard/summary.js';

export function registerDashboardRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
  app.get('/api/dashboard', { preHandler: requireAuth(db) }, async () =>
    dashboardSummary(db, { dataPaths }),
  );
}
