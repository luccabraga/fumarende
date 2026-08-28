import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { DATA_TABLES } from './tables.js';

describe('DATA_TABLES', () => {
  it('is exactly the migrated tables minus auth/session/schema', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const all = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    const nonData = new Set([
      'app_settings',
      'sessions',
      'schema_migrations',
      'sqlite_sequence',
    ]);
    const expected = all.filter((n) => !nonData.has(n)).sort();

    expect([...DATA_TABLES].sort()).toEqual(expected);
  });
});
