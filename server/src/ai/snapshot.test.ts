import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from '../data/seed.js';
import { buildSnapshot } from './snapshot.js';

const NOW = new Date(2026, 7, 15); // seed spans Jun/Jul/Aug 2026

function seeded() {
  const db = new Database(':memory:');
  runMigrations(db);
  seedTestData(db, NOW);
  return db;
}

describe('buildSnapshot', () => {
  it('produces a compact, serialisable snapshot from seeded data', () => {
    const s = buildSnapshot(seeded(), NOW);

    expect(s.month).toBe('2026-08');
    expect(s.income).toHaveLength(3);
    expect(s.income.map((r) => r.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(s.expenses.byCategory[0].cents).toBeGreaterThanOrEqual(
      s.expenses.byCategory[s.expenses.byCategory.length - 1].cents,
    );
    expect(s.reserve.balanceCents).toBe(750_000); // 700k + 150k - 100k
    expect(Array.isArray(s.goals)).toBe(true);

    const json = JSON.stringify(s);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json.length).toBeLessThan(8192);
  });

  it('handles an empty DB without throwing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const s = buildSnapshot(db, NOW);
    expect(s.income).toEqual([]);
    expect(s.savingsTarget).toBeNull();
    expect(s.cambio.meanSpreadPct).toBeNull();
    expect(s.dollarQuotes.averageRate).toBeNull();
  });
});
