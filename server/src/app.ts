import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { registerAuthRoutes } from './auth/routes.js';
import { registerIncomeRoutes } from './routes/income.js';
import { registerExchangeRoutes } from './routes/exchange.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerFixedExpenseRoutes } from './routes/fixed-expenses.js';
import { registerSavingsRoutes } from './routes/savings.js';
import { registerTargetRoutes } from './routes/targets.js';
import { registerDollarQuoteRoutes } from './routes/dollar-quotes.js';
import { registerDataRoutes } from './routes/data.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerAiRoutes } from './routes/ai.js';
import { NOT_CONFIGURED_AI, type AiConfig } from './config.js';
import { runMigrations } from './db/migrate.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Exposed only so the test suite can build a requireAuth() preHandler
    // against the same database instance without a second export.
    dbForTests: Database.Database;
  }
}

export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
  dataPaths?: { dbPath: string; backupDir: string },
  aiConfig: AiConfig = NOT_CONFIGURED_AI,
): Promise<FastifyInstance> {
  runMigrations(db);

  const app = Fastify({ logger: true });

  // Defense in depth: a bodyless request (logout, DELETE) may still arrive with
  // `Content-Type: application/json` set by a generic client wrapper. Fastify's
  // default JSON parser rejects that with FST_ERR_CTP_EMPTY_JSON_BODY before the
  // route runs, so treat an empty body as "no body" instead.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (text === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cookie);

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db);
  registerIncomeRoutes(app, db);
  registerExchangeRoutes(app, db);
  registerExpenseRoutes(app, db);
  registerFixedExpenseRoutes(app, db);
  registerSavingsRoutes(app, db);
  registerTargetRoutes(app, db, { table: 'goals', basePath: '/api/goals' });
  registerTargetRoutes(app, db, { table: 'special_projects', basePath: '/api/special-projects' });
  registerDollarQuoteRoutes(app, db);
  registerDataRoutes(app, db, dataPaths);
  registerDashboardRoutes(app, db, dataPaths);
  registerAiRoutes(app, db, aiConfig);

  if (frontendDistDir && fs.existsSync(path.join(frontendDistDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: frontendDistDir });

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      // Only serve index.html for GET requests
      if (request.method !== 'GET') {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  app.dbForTests = db;

  return app;
}
