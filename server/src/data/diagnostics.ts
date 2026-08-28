import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface Diagnostics {
  rowCounts: Record<string, number>;
  dbSizeBytes: number;
  migrations: string[];
  lastBackup: string | null;
  backupCount: number;
}

const TABLES_WITHOUT_DELETED_AT = new Set([
  'savings_monthly_targets',
  'monthly_close',
  'ptax_rate_cache',
]);

export function diagnostics(
  db: Database.Database,
  paths?: { dbPath: string; backupDir: string },
): Diagnostics {
  const rowCounts: Record<string, number> = {};
  for (const table of DATA_TABLES) {
    const where = TABLES_WITHOUT_DELETED_AT.has(table) ? '' : ' WHERE deleted_at IS NULL';
    const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get() as { n: number };
    rowCounts[table] = n;
  }

  const migrations = (
    db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[]
  ).map((r) => r.id);

  let dbSizeBytes = 0;
  let lastBackup: string | null = null;
  let backupCount = 0;

  if (paths) {
    try {
      dbSizeBytes = fs.statSync(paths.dbPath).size;
    } catch {
      dbSizeBytes = 0;
    }
    try {
      const files = fs
        .readdirSync(paths.backupDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => fs.statSync(path.join(paths.backupDir, f)));
      backupCount = files.length;
      if (files.length > 0) {
        lastBackup = new Date(Math.max(...files.map((s) => s.mtimeMs))).toISOString();
      }
    } catch {
      backupCount = 0;
      lastBackup = null;
    }
  }

  return { rowCounts, dbSizeBytes, migrations, lastBackup, backupCount };
}
