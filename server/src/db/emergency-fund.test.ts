import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createDeposit,
  createWithdrawal,
  listEmergencyFundEntries,
  softDeleteEmergencyFundEntry,
} from './emergency-fund.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('emergency-fund data layer', () => {
  it('nets a deposit and a withdrawal to a plain sum, withdrawal stored negative', () => {
    const db = freshDb();
    createDeposit(db, { date: '2026-06-01', amountCents: 700_000, notes: 'Saldo inicial' });
    createWithdrawal(db, { date: '2026-06-15', amountCents: 200_000, notes: 'Conserto' });

    const all = listEmergencyFundEntries(db);
    expect(all).toHaveLength(2);
    expect(all.reduce((s, e) => s + e.amountCents, 0)).toBe(500_000);
    expect(all.find((e) => e.notes === 'Conserto')!.amountCents).toBe(-200_000);
  });

  it('createDeposit rejects zero or negative amounts', () => {
    const db = freshDb();
    expect(() => createDeposit(db, { date: '2026-06-01', amountCents: 0 })).toThrow();
    expect(() => createDeposit(db, { date: '2026-06-01', amountCents: -1 })).toThrow();
  });

  it('createWithdrawal rejects zero or negative magnitudes', () => {
    const db = freshDb();
    expect(() => createWithdrawal(db, { date: '2026-06-01', amountCents: 0 })).toThrow();
    expect(() => createWithdrawal(db, { date: '2026-06-01', amountCents: -1 })).toThrow();
  });

  it('excludes soft-deleted entries from the list', () => {
    const db = freshDb();
    const id = createDeposit(db, { date: '2026-06-01', amountCents: 100_000 });
    softDeleteEmergencyFundEntry(db, id);
    expect(listEmergencyFundEntries(db)).toHaveLength(0);
  });

  it('orders entries by date descending', () => {
    const db = freshDb();
    createDeposit(db, { date: '2026-06-01', amountCents: 100 });
    createDeposit(db, { date: '2026-06-20', amountCents: 200 });
    expect(listEmergencyFundEntries(db).map((e) => e.date)).toEqual(['2026-06-20', '2026-06-01']);
  });
});
