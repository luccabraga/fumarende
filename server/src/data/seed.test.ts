import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from './seed.js';
import { listIncome } from '../db/income.js';
import { listExpenses } from '../db/expenses.js';
import { listExchangeContracts } from '../db/exchange.js';
import { listEmergencyFundEntries } from '../db/emergency-fund.js';
import { listTargets } from '../db/targets.js';
import { listQuotes } from '../db/dollar-quotes.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const NOW = new Date(2026, 7, 15); // Aug 2026

describe('seedTestData', () => {
  it('populates every data-bearing table across three months', () => {
    const db = freshDb();
    seedTestData(db, NOW);

    expect(listIncome(db).length).toBeGreaterThan(0);
    expect(listExpenses(db).length).toBeGreaterThan(0);
    expect(listExchangeContracts(db).length).toBeGreaterThan(0);
    expect(listEmergencyFundEntries(db).length).toBeGreaterThan(0);
    expect(listTargets(db, 'goals').length).toBeGreaterThan(0);
    expect(listTargets(db, 'special_projects').length).toBeGreaterThan(0);
    expect(listQuotes(db).length).toBe(3);

    // the five one-off / recurring expenses span the three seeded months;
    // the 3x installment starting in the current month extends into the
    // two following months
    const months = new Set(listExpenses(db).map((e) => e.date.slice(0, 7)));
    expect([...months].sort()).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);

    expect(listTargets(db, 'goals').some((g) => g.currentCents >= g.targetCents)).toBe(true);
  });

  it('wipes first, so two runs leave the same counts', () => {
    const db = freshDb();
    seedTestData(db, NOW);
    const first = listIncome(db).length;
    seedTestData(db, NOW);
    expect(listIncome(db).length).toBe(first);
  });
});
