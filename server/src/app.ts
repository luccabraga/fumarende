import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type Database from 'better-sqlite3';
import { registerAuthRoutes } from './auth/routes.js';
import { registerIncomeRoutes } from './routes/income.js';
import { runMigrations } from './db/migrate.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Exposed only so the test suite can build a requireAuth() preHandler
    // against the same database instance without a second export.
    dbForTests: Database.Database;
  }
}

export async function buildApp(db: Database.Database): Promise<FastifyInstance> {
  runMigrations(db);

  const app = Fastify({ logger: true });
  await app.register(cookie);

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db);
  registerIncomeRoutes(app, db);

  app.dbForTests = db;

  return app;
}
