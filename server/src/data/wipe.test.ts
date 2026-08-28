import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { wipeData } from './wipe.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('wipeData', () => {
  it('empties every data table and returns pre-delete counts, leaving auth + schema', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 1000)").run();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-02', 2000)").run();
    db.prepare("INSERT INTO goals (name, target_cents) VALUES ('PS5', 400000)").run();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('k', 'v')").run();

    const result = wipeData(db);

    expect(result.deleted.income).toBe(2);
    expect(result.deleted.goals).toBe(1);
    expect(result.deleted.expenses).toBe(0);

    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM goals').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM app_settings').get()).toEqual({ n: 1 });
    expect(
      (db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n,
    ).toBeGreaterThan(0);
  });
});
