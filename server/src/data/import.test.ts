import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { exportData } from './export.js';
import { wipeData } from './wipe.js';
import { importData } from './import.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('importData', () => {
  it('round-trips a full export through wipe + import', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 5000)").run();
    db.prepare(
      "INSERT INTO goals (name, target_cents, current_cents) VALUES ('PS5', 400000, 100)",
    ).run();

    const snapshot = exportData(db);
    wipeData(db);
    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 0 });

    const result = importData(db, snapshot);

    expect(result.imported.income).toBe(1);
    expect(result.imported.goals).toBe(1);
    expect(db.prepare('SELECT * FROM income').all()).toHaveLength(1);
    expect(db.prepare('SELECT name, current_cents FROM goals').get()).toEqual({
      name: 'PS5',
      current_cents: 100,
    });
  });

  it('rejects a bad version, a non-object tables, or an unknown table', () => {
    const db = freshDb();
    expect(() => importData(db, { version: 2, tables: {} })).toThrow();
    expect(() => importData(db, { version: 1, tables: [] })).toThrow();
    expect(() => importData(db, { version: 1, tables: { not_a_table: [] } })).toThrow();
    expect(() => importData(db, { version: 1, tables: { income: 'nope' } })).toThrow();
  });

  it('treats a missing table key as empty and still imports the rest', () => {
    const db = freshDb();
    importData(db, {
      version: 1,
      tables: { income: [{ id: 1, date: '2026-06-01', amount_brl_cents: 900 }] },
    });
    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM goals').get()).toEqual({ n: 0 });
  });
});
