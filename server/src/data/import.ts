import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface ImportResult {
  imported: Record<string, number>;
}

interface DataExportShape {
  version: number;
  tables: Record<string, unknown[]>;
}

function assertShape(payload: unknown): asserts payload is DataExportShape {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { version?: unknown }).version !== 1
  ) {
    throw new Error('unsupported export version');
  }
  const tables = (payload as { tables?: unknown }).tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    throw new Error('tables must be an object');
  }
  const allowed = new Set<string>(DATA_TABLES);
  for (const [key, value] of Object.entries(tables)) {
    if (!allowed.has(key)) throw new Error(`unknown table in export: ${key}`);
    if (!Array.isArray(value)) throw new Error(`tables.${key} must be an array`);
  }
}

/**
 * Full-replace import: wipes every data table then reloads it from the
 * payload, in one transaction. Rolls back entirely on any error.
 */
export function importData(db: Database.Database, payload: unknown): ImportResult {
  assertShape(payload);
  const tables = payload.tables;

  const run = db.transaction((): Record<string, number> => {
    const imported: Record<string, number> = {};
    for (const table of DATA_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
      const rows = (tables[table] ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const keys = Object.keys(row);
        const cols = keys.join(', ');
        const placeholders = keys.map((k) => `@${k}`).join(', ');
        db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(row);
      }
      imported[table] = rows.length;
    }
    return imported;
  });

  return { imported: run() };
}
