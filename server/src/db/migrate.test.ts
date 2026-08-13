import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  it('creates every Phase 1 table and is idempotent', () => {
    const db = new Database(':memory:');

    runMigrations(db);
    runMigrations(db); // must not throw or duplicate on a second run

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const expected of [
      'app_settings',
      'sessions',
      'income',
      'exchange_contracts',
      'expenses',
      'fixed_expenses',
      'emergency_fund_entries',
      'savings_monthly_targets',
      'goals',
      'special_projects',
      'category_rules',
      'ptax_rate_cache',
      'monthly_close',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }

    const applied = db
      .prepare('SELECT id FROM schema_migrations')
      .all() as { id: string }[];
    expect(applied).toHaveLength(1);
    expect(applied[0].id).toBe('001_initial_schema');
  });
});
