import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface DataExport {
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/**
 * A complete snapshot of every data table — soft-deleted rows included,
 * so a restore is byte-for-byte. Auth/session/schema tables are not
 * exported.
 */
export function exportData(db: Database.Database): DataExport {
  const tables: Record<string, unknown[]> = {};
  for (const table of DATA_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}
