import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface WipeResult {
  deleted: Record<string, number>;
}

/**
 * Deletes every row from every data table in one transaction. Returns
 * the row count each table held before it was cleared. Leaves
 * app_settings, sessions, schema_migrations, and the schema untouched.
 */
export function wipeData(db: Database.Database): WipeResult {
  const run = db.transaction((): Record<string, number> => {
    const deleted: Record<string, number> = {};
    for (const table of DATA_TABLES) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      deleted[table] = n;
      db.prepare(`DELETE FROM ${table}`).run();
    }
    return deleted;
  });
  return { deleted: run() };
}
