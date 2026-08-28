import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { upsertQuote, listQuotes, deleteQuote } from './dollar-quotes.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('dollar-quote data layer', () => {
  it('creates a quote and lists it back', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    expect(listQuotes(db)).toEqual([{ month: '2026-06', rate: 5.1, salaryUsdCents: null }]);
  });

  it('replaces an existing month on a second upsert', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    upsertQuote(db, { month: '2026-06', rate: 5.3, salaryUsdCents: 600_000 });
    expect(listQuotes(db)).toEqual([{ month: '2026-06', rate: 5.3, salaryUsdCents: 600_000 }]);
  });

  it('lists quotes in ascending month order', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-07', rate: 5.2 });
    upsertQuote(db, { month: '2026-05', rate: 5.0 });
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    expect(listQuotes(db).map((q) => q.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('soft-deletes and lets a later upsert restore the month', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    deleteQuote(db, '2026-06');
    expect(listQuotes(db)).toHaveLength(0);
    upsertQuote(db, { month: '2026-06', rate: 5.0 });
    expect(listQuotes(db)).toEqual([{ month: '2026-06', rate: 5.0, salaryUsdCents: null }]);
  });

  it('rejects a malformed month, a non-positive rate, or a bad salary', () => {
    const db = freshDb();
    expect(() => upsertQuote(db, { month: '2026-6', rate: 5 })).toThrow();
    expect(() => upsertQuote(db, { month: 'nope', rate: 5 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 0 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: -1 })).toThrow();
    // @ts-expect-error deliberate bad input
    expect(() => upsertQuote(db, { month: '2026-06', rate: 'abc' })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 5, salaryUsdCents: -1 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 5, salaryUsdCents: 12.5 })).toThrow();
  });
});
