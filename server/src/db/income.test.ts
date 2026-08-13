import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { createIncome, listIncome, softDeleteIncome } from './income.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('income data layer', () => {
  it('creates an entry and lists it back', () => {
    const db = freshDb();
    const id = createIncome(db, { date: '2026-08-01', amountBrlCents: 500000 });
    const entries = listIncome(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      date: '2026-08-01',
      amountBrlCents: 500000,
      amountUsdCents: null,
    });
  });

  it('stores an optional linked amountUsdCents and description', () => {
    const db = freshDb();
    createIncome(db, {
      date: '2026-08-05',
      amountBrlCents: 750000,
      amountUsdCents: 150000,
      description: 'Salário agosto',
    });
    const [entry] = listIncome(db);
    expect(entry.amountUsdCents).toBe(150000);
    expect(entry.description).toBe('Salário agosto');
  });

  it('excludes soft-deleted entries from listIncome', () => {
    const db = freshDb();
    const id = createIncome(db, { date: '2026-08-01', amountBrlCents: 100 });
    softDeleteIncome(db, id);
    expect(listIncome(db)).toHaveLength(0);
  });

  it('orders entries by date descending', () => {
    const db = freshDb();
    createIncome(db, { date: '2026-08-01', amountBrlCents: 100 });
    createIncome(db, { date: '2026-08-15', amountBrlCents: 200 });
    const entries = listIncome(db);
    expect(entries.map((e) => e.date)).toEqual(['2026-08-15', '2026-08-01']);
  });
});
