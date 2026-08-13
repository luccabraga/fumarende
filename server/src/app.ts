import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
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

export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
): Promise<FastifyInstance> {
  runMigrations(db);

  const app = Fastify({ logger: true });
  await app.register(cookie);

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db);
  registerIncomeRoutes(app, db);

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
