import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { dashboardSummary } from './summary.js';

const NOW = new Date(2026, 7, 15); // 15 Aug 2026

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
function income(db: Database.Database, date: string, cents: number) {
  db.prepare('INSERT INTO income (date, amount_brl_cents) VALUES (?, ?)').run(date, cents);
}
function expense(
  db: Database.Database,
  date: string,
  cents: number,
  category = 'Outros',
  type = 'nao-essencial',
  groupId: string | null = null,
) {
  db.prepare(
    `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, installment_group_id)
     VALUES (?, 'x', ?, ?, ?, 'Pix', ?)`,
  ).run(date, cents, category, type, groupId);
}
function deposit(db: Database.Database, date: string, cents: number) {
  db.prepare('INSERT INTO emergency_fund_entries (date, amount_cents) VALUES (?, ?)').run(date, cents);
}

describe('dashboardSummary', () => {
  it('returns zeroed structure and the starter alerts on an empty DB', () => {
    const s = dashboardSummary(freshDb(), { now: NOW });
    expect(s.month).toBe('2026-08');
    expect(s.previousMonth).toBe('2026-07');
    expect(s.income).toEqual({ currentCents: 0, previousCents: 0 });
    expect(s.expenses.currentCents).toBe(0);
    expect(s.balanceCents).toBe(0);
    expect(s.reserveBalanceCents).toBe(0);
    expect(s.savingsTarget).toBeNull();
    expect(s.expenses.byCategory).toEqual([]);
    expect(s.recentExpenses).toEqual([]);
    expect(s.topGoals).toEqual([]);
    expect(s.evolution).toHaveLength(6);
    expect(s.evolution[0].month).toBe('2026-03');
    expect(s.evolution[5].month).toBe('2026-08');
    expect(s.evolution.every((e) => e.incomeCents === 0 && e.expensesCents === 0)).toBe(true);
    expect(s.monthlyClose).toEqual({ reviewed: false, reviewedAt: null });
    expect(s.alerts.some((a) => a.level === 'info' && /receitas/i.test(a.message))).toBe(true);
    expect(s.alerts.some((a) => a.level === 'warning' && /reserva/i.test(a.message))).toBe(true);
  });

  it('computes month totals, the essencial split, and a previous-month delta', () => {
    const db = freshDb();
    income(db, '2026-08-01', 500_000);
    income(db, '2026-07-01', 400_000);
    expense(db, '2026-08-05', 200_000, 'Moradia', 'essencial');
    expense(db, '2026-08-06', 100_000, 'Lazer', 'nao-essencial');
    expense(db, '2026-07-10', 200_000, 'Moradia', 'essencial');

    const s = dashboardSummary(db, { now: NOW });
    expect(s.income).toEqual({ currentCents: 500_000, previousCents: 400_000 });
    expect(s.expenses.currentCents).toBe(300_000);
    expect(s.expenses.previousCents).toBe(200_000);
    expect(s.expenses.essentialCents).toBe(200_000);
    expect(s.expenses.nonEssentialCents).toBe(100_000);
    expect(s.balanceCents).toBe(200_000);
    expect(s.expenses.byCategory).toEqual([
      { category: 'Moradia', cents: 200_000 },
      { category: 'Lazer', cents: 100_000 },
    ]);
  });

  it('raises a danger alert when spend exceeds 90% of income', () => {
    const db = freshDb();
    income(db, '2026-08-01', 100_000);
    expense(db, '2026-08-02', 95_000);
    const s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'danger' && a.message.includes('95%'))).toBe(true);
  });

  it('flags an unmet savings target and clears it once met', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO savings_monthly_targets (month, pct_or_fixed, target_cents, rollover_cents)
       VALUES ('2026-08', 'fixed', 200000, 0)`,
    ).run();
    deposit(db, '2026-08-03', 120_000);
    let s = dashboardSummary(db, { now: NOW });
    expect(s.savingsTarget).toEqual({ targetCents: 200_000, savedThisMonthCents: 120_000 });
    expect(s.alerts.some((a) => a.level === 'warning' && /poupan/i.test(a.message))).toBe(true);

    deposit(db, '2026-08-20', 80_000);
    s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => /poupan/i.test(a.message))).toBe(false);
  });

  it('flags a reserve below 3x the essential-expense average', () => {
    const db = freshDb();
    expense(db, '2026-08-01', 100_000, 'Moradia', 'essencial');
    expense(db, '2026-07-01', 100_000, 'Moradia', 'essencial');
    expense(db, '2026-06-01', 100_000, 'Moradia', 'essencial');
    deposit(db, '2026-08-02', 250_000); // < 300_000
    let s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'warning' && /3 meses/i.test(a.message))).toBe(true);

    deposit(db, '2026-08-10', 70_000); // now 320_000
    s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => /3 meses/i.test(a.message))).toBe(false);
  });

  it('summarises active installments and flags a spike over 20% of income', () => {
    const db = freshDb();
    income(db, '2026-08-01', 50_000);
    expense(db, '2026-08-10', 20_000, 'Outros', 'nao-essencial', 'g1');
    expense(db, '2026-09-10', 20_000, 'Outros', 'nao-essencial', 'g1');
    expense(db, '2026-10-10', 20_000, 'Outros', 'nao-essencial', 'g1');

    const s = dashboardSummary(db, { now: NOW });
    expect(s.installments.nextMonthCommitmentCents).toBe(20_000); // the Sep row
    expect(s.installments.activeGroups).toBe(1);
    expect(s.installments.earliestEndMonth).toBe('2026-10');
    expect(s.alerts.some((a) => a.level === 'warning' && a.message.includes('40%'))).toBe(true);
  });

  it('builds a 6-month evolution with values only in the seeded months', () => {
    const db = freshDb();
    income(db, '2026-06-01', 100_000);
    income(db, '2026-08-01', 300_000);
    expense(db, '2026-06-02', 40_000);
    const s = dashboardSummary(db, { now: NOW });
    const byMonth = Object.fromEntries(s.evolution.map((e) => [e.month, e]));
    expect(byMonth['2026-06']).toMatchObject({ incomeCents: 100_000, expensesCents: 40_000 });
    expect(byMonth['2026-07']).toMatchObject({ incomeCents: 0, expensesCents: 0 });
    expect(byMonth['2026-08']).toMatchObject({ incomeCents: 300_000, expensesCents: 0 });
  });

  it('flags câmbio spread drift when the latest contract is worse than the mean', () => {
    const db = freshDb();
    const add = (rate: number, ptax: number) =>
      db
        .prepare(
          `INSERT INTO exchange_contracts
             (date, institution, operation_type, amount_usd_cents, contracted_rate, ptax_rate, iof_cents, bank_fee_cents, net_brl_cents)
           VALUES ('2026-08-01', 'Inter', 'compra', 100000, ?, ?, 0, 0, ?)`,
        )
        .run(rate, ptax, Math.round(100000 * rate));
    add(5.0, 5.1); // ~2% spread
    add(5.0, 5.1); // ~2% spread
    add(4.8, 5.1); // ~5.9% spread (worst, highest id -> latest)

    const s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'warning' && /spread/i.test(a.message))).toBe(true);
  });

  it('honours an explicit month option', () => {
    const db = freshDb();
    income(db, '2026-06-01', 111_000);
    income(db, '2026-08-01', 999_000);
    expense(db, '2026-06-02', 22_000);

    const s = dashboardSummary(db, { month: '2026-06', now: NOW });
    expect(s.month).toBe('2026-06');
    expect(s.previousMonth).toBe('2026-05');
    expect(s.evolution[5].month).toBe('2026-06');
    expect(s.income.currentCents).toBe(111_000);
    expect(s.expenses.currentCents).toBe(22_000);
  });

  it('falls back to the now-derived month when month is malformed', () => {
    const s = dashboardSummary(freshDb(), { month: '2026-6', now: NOW });
    expect(s.month).toBe('2026-08');
  });

  it('reads the monthly-close row for the current month', () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO monthly_close (month, reviewed_at) VALUES ('2026-08', '2026-08-31T00:00:00Z')",
    ).run();
    const s = dashboardSummary(db, { now: NOW });
    expect(s.monthlyClose).toEqual({ reviewed: true, reviewedAt: '2026-08-31T00:00:00Z' });
  });
});
