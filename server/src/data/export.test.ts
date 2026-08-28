import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { exportData } from './export.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('exportData', () => {
  it('captures rows from every data table, including soft-deleted ones', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 5000)").run();
    db.prepare("INSERT INTO goals (name, target_cents) VALUES ('PS5', 400000)").run();
    db.prepare(
      "INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, deleted_at) VALUES ('2026-06-01', 'gone', 100, 'C', 'essencial', 'Pix', '2026-06-02T00:00:00Z')",
    ).run();

    const out = exportData(db);

    expect(out.version).toBe(1);
    expect(Number.isNaN(Date.parse(out.exportedAt))).toBe(false);
    expect(out.tables.income).toHaveLength(1);
    expect(out.tables.goals[0]).toMatchObject({ name: 'PS5', target_cents: 400000 });
    expect(out.tables.expenses).toHaveLength(1); // the soft-deleted row is still exported
    expect(out.tables.fixed_expenses).toEqual([]);
  });
});
