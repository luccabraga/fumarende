import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createExpense,
  listExpenses,
  softDeleteExpense,
  softDeleteExpenseGroup,
} from './expenses.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function sampleInput() {
  return {
    date: '2026-08-01',
    description: 'Mercado',
    amountCents: 10_000,
    category: 'Alimentação',
    type: 'essencial',
    paymentMethod: 'Débito',
  };
}

describe('expense data layer', () => {
  it('creates a single expense and lists it back', () => {
    const db = freshDb();
    const ids = createExpense(db, sampleInput());
    expect(ids).toHaveLength(1);

    const all = listExpenses(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      description: 'Mercado',
      amountCents: 10_000,
      type: 'essencial',
      installmentTotal: null,
      installmentGroupId: null,
    });
  });

  it('splits an installment purchase into dated rows that reconcile exactly', () => {
    const db = freshDb();
    const ids = createExpense(db, {
      ...sampleInput(),
      description: 'Tênis Nike',
      amountCents: 65_000,
      date: '2026-01-15',
      installmentTotal: 3,
    });
    expect(ids).toHaveLength(3);

    const rows = listExpenses(db).sort(
      (a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0),
    );
    expect(rows.map((r) => r.amountCents)).toEqual([21_668, 21_666, 21_666]);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(65_000);
    expect(rows.map((r) => r.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(rows.map((r) => r.installmentTotal)).toEqual([3, 3, 3]);
    expect(rows[0].installmentGroupId).not.toBeNull();
    expect(new Set(rows.map((r) => r.installmentGroupId)).size).toBe(1);
  });

  it('treats installmentTotal of 1 as a plain single row', () => {
    const db = freshDb();
    const ids = createExpense(db, { ...sampleInput(), installmentTotal: 1 });
    expect(ids).toHaveLength(1);
    expect(listExpenses(db)[0].installmentGroupId).toBeNull();
  });

  it('rejects a non-positive amount, blank description, or bad type', () => {
    const db = freshDb();
    expect(() => createExpense(db, { ...sampleInput(), amountCents: 0 })).toThrow();
    expect(() => createExpense(db, { ...sampleInput(), description: '  ' })).toThrow();
    expect(() => createExpense(db, { ...sampleInput(), type: 'x' })).toThrow();
  });

  it('softDeleteExpense removes just one row', () => {
    const db = freshDb();
    const [id] = createExpense(db, sampleInput());
    softDeleteExpense(db, id);
    expect(listExpenses(db)).toHaveLength(0);
  });

  it('softDeleteExpenseGroup removes every row in the group', () => {
    const db = freshDb();
    createExpense(db, { ...sampleInput(), amountCents: 30_000, installmentTotal: 3 });
    const groupId = listExpenses(db)[0].installmentGroupId!;
    softDeleteExpenseGroup(db, groupId);
    expect(listExpenses(db)).toHaveLength(0);
  });

  it('orders expenses by date descending', () => {
    const db = freshDb();
    createExpense(db, { ...sampleInput(), date: '2026-08-01' });
    createExpense(db, { ...sampleInput(), date: '2026-08-20' });
    expect(listExpenses(db).map((e) => e.date)).toEqual(['2026-08-20', '2026-08-01']);
  });
});
