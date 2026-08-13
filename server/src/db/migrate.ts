import type Database from 'better-sqlite3';
import { migration001 } from './migrations/001_initial_schema.js';

export interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [migration001];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const alreadyApplied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map(
      (row) => row.id,
    ),
  );

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );

  const applyMigration = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    insertMigration.run(migration.id, new Date().toISOString());
  });

  for (const migration of MIGRATIONS) {
    if (alreadyApplied.has(migration.id)) continue;
    applyMigration(migration);
  }
}
