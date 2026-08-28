import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { getOrCreateMonthlyTarget, updateMonthlyTargetConfig } from './savings-target.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertIncome(db: Database.Database, date: string, amountBrlCents: number) {
  db.prepare('INSERT INTO income (date, amount_brl_cents) VALUES (?, ?)').run(date, amountBrlCents);
}

function insertReservaDeposit(db: Database.Database, date: string, amountCents: number) {
  db.prepare('INSERT INTO emergency_fund_entries (date, amount_cents) VALUES (?, ?)').run(
    date,
    amountCents,
  );
}

describe('savings-target data layer', () => {
  it('defaults to an unconfigured pct target with no prior data', () => {
    const db = freshDb();
    const t = getOrCreateMonthlyTarget(db, '2026-06');
    expect(t).toMatchObject({ pctOrFixed: 'pct', pctValue: 0, targetCents: 0, rolloverCents: 0 });
  });

  it('resolves a percentage against that month income', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    const t = updateMonthlyTargetConfig(db, '2026-06', 'pct', 20, null);
    expect(t.targetCents).toBe(200_000);
  });

  it('uses a fixed amount regardless of income', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    const t = updateMonthlyTargetConfig(db, '2026-06', 'fixed', null, 150_000);
    expect(t.targetCents).toBe(150_000);
  });

  it('rolls a deficit month over as a higher next-month target', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    updateMonthlyTargetConfig(db, '2026-06', 'pct', 20, null); // target 200_000
    insertReservaDeposit(db, '2026-06-10', 150_000); // saved 150_000 -> deficit 50_000

    const july = getOrCreateMonthlyTarget(db, '2026-07');
    expect(july.pctValue).toBe(20); // inherited
    expect(july.rolloverCents).toBe(50_000);
  });

  it('does not roll a surplus month over', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    updateMonthlyTargetConfig(db, '2026-06', 'pct', 20, null);
    insertReservaDeposit(db, '2026-06-10', 250_000); // surplus

    expect(getOrCreateMonthlyTarget(db, '2026-07').rolloverCents).toBe(0);
  });

  it('counts withdrawals against the monthly target', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    updateMonthlyTargetConfig(db, '2026-06', 'pct', 20, null); // target 200_000
    insertReservaDeposit(db, '2026-06-05', 250_000);
    insertReservaDeposit(db, '2026-06-20', -100_000); // net 150_000 -> deficit 50_000

    expect(getOrCreateMonthlyTarget(db, '2026-07').rolloverCents).toBe(50_000);
  });

  it('freezes the target after the first computation', () => {
    const db = freshDb();
    insertIncome(db, '2026-06-05', 1_000_000);
    expect(updateMonthlyTargetConfig(db, '2026-06', 'pct', 20, null).targetCents).toBe(200_000);

    insertIncome(db, '2026-06-20', 1_000_000);
    expect(getOrCreateMonthlyTarget(db, '2026-06').targetCents).toBe(200_000);
  });

  it('rejects a pctOrFixed other than pct/fixed', () => {
    const db = freshDb();
    expect(() => updateMonthlyTargetConfig(db, '2026-06', 'weekly', 10, null)).toThrow();
  });
});
