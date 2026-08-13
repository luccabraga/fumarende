import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp(db, config.frontendDistDir);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
