import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { backupDatabase } from '../db/backup.js';
import { exportData } from '../data/export.js';
import { importData } from '../data/import.js';
import { wipeData } from '../data/wipe.js';
import { seedTestData } from '../data/seed.js';
import { diagnostics } from '../data/diagnostics.js';

const CONFIRM_PHRASE = 'APAGAR TUDO';
const MONTH_RE = /^\d{4}-\d{2}$/;

interface ConfirmBody {
  confirm?: string;
}

export function registerDataRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
  const backup = (): string | null =>
    dataPaths ? backupDatabase(dataPaths.dbPath, dataPaths.backupDir) : null;

  app.get('/api/data/diagnostics', { preHandler: requireAuth(db) }, async () =>
    diagnostics(db, dataPaths),
  );

  app.get('/api/data/export', { preHandler: requireAuth(db) }, async (_request, reply) => {
    const date = new Date().toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="fumarende-${date}.json"`);
    return exportData(db);
  });

  app.post<{ Body: unknown }>(
    '/api/data/import',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body as { version?: unknown; tables?: unknown } | null;
      if (
        typeof body !== 'object' ||
        body === null ||
        body.version !== 1 ||
        typeof body.tables !== 'object' ||
        body.tables === null ||
        Array.isArray(body.tables)
      ) {
        return reply.code(400).send({ error: 'invalid export payload' });
      }
      const backupPath = backup();
      try {
        const { imported } = importData(db, body);
        return { backupPath, imported };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'import failed' });
      }
    },
  );

  app.post<{ Body: ConfirmBody }>(
    '/api/data/wipe',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (request.body?.confirm !== CONFIRM_PHRASE) {
        return reply.code(400).send({ error: `confirm must be "${CONFIRM_PHRASE}"` });
      }
      const backupPath = backup();
      return { backupPath, deleted: wipeData(db).deleted };
    },
  );

  app.post<{ Body: ConfirmBody }>(
    '/api/data/seed-test',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (request.body?.confirm !== CONFIRM_PHRASE) {
        return reply.code(400).send({ error: `confirm must be "${CONFIRM_PHRASE}"` });
      }
      const backupPath = backup();
      seedTestData(db);
      return { backupPath, seeded: true as const };
    },
  );

  app.get('/api/monthly-close', { preHandler: requireAuth(db) }, async () => {
    const rows = db
      .prepare(
        `WITH data_months AS (
           SELECT DISTINCT substr(date, 1, 7) AS month FROM income WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM expenses WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM exchange_contracts WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM emergency_fund_entries WHERE deleted_at IS NULL
           UNION SELECT month FROM savings_monthly_targets
           UNION SELECT month FROM dollar_quotes WHERE deleted_at IS NULL
           UNION SELECT month FROM monthly_close
         )
         SELECT dm.month AS month, mc.reviewed_at AS reviewedAt
         FROM data_months dm
         LEFT JOIN monthly_close mc ON mc.month = dm.month
         WHERE dm.month IS NOT NULL
         ORDER BY dm.month DESC`,
      )
      .all() as { month: string; reviewedAt: string | null }[];
    return rows.map((r) => ({
      month: r.month,
      reviewed: r.reviewedAt !== null,
      reviewedAt: r.reviewedAt,
    }));
  });

  app.put<{ Params: { month: string } }>(
    '/api/monthly-close/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      const reviewedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO monthly_close (month, reviewed_at) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET reviewed_at = excluded.reviewed_at`,
      ).run(month, reviewedAt);
      return { month, reviewed: true, reviewedAt };
    },
  );

  app.delete<{ Params: { month: string } }>(
    '/api/monthly-close/:month',
    { preHandler: requireAuth(db) },
    async (request) => {
      db.prepare('DELETE FROM monthly_close WHERE month = ?').run(request.params.month);
      return { ok: true };
    },
  );
}
