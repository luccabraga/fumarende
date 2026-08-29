import path from 'node:path';
import { loadDotEnv } from './load-env.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';

loadDotEnv(path.join(process.cwd(), '.env'));
const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp(
  db,
  config.frontendDistDir,
  { dbPath: config.dbPath, backupDir: config.backupDir },
  config.ai,
);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
