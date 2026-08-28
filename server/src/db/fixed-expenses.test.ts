import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { listExpenses } from './expenses.js';
import {
  createFixedExpense,
  listFixedExpenses,
  softDeleteFixedExpense,
  applyFixedExpensesToMonth,
} from './fixed-expenses.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function sampleInput() {
  return {
    description: 'Aluguel',
    amountCents: 280_000,
    category: 'Moradia',
    type: 'essencial',
    paymentMethod: 'Pix',
  };
}

describe('fixed-expense data layer', () => {
  it('creates, lists, and soft-deletes a template', () => {
    const db = freshDb();
    const id = createFixedExpense(db, sampleInput());
    expect(listFixedExpenses(db)).toHaveLength(1);
    softDeleteFixedExpense(db, id);
    expect(listFixedExpenses(db)).toHaveLength(0);
  });

  it('rejects a blank description or bad type', () => {
    const db = freshDb();
    expect(() => createFixedExpense(db, { ...sampleInput(), description: ' ' })).toThrow();
    expect(() => createFixedExpense(db, { ...sampleInput(), type: 'x' })).toThrow();
  });

  it('applyFixedExpensesToMonth stamps one expense per template on the 1st', () => {
    const db = freshDb();
    createFixedExpense(db, sampleInput());
    const created = applyFixedExpensesToMonth(db, '2026-08');
    expect(created).toBe(1);

    const expenses = listExpenses(db);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      date: '2026-08-01',
      description: 'Aluguel',
      amountCents: 280_000,
      category: 'Moradia',
      type: 'essencial',
    });
  });

  it('applyFixedExpensesToMonth is idempotent for repeated calls', () => {
    const db = freshDb();
    createFixedExpense(db, sampleInput());
    applyFixedExpensesToMonth(db, '2026-08');
    const again = applyFixedExpensesToMonth(db, '2026-08');
    expect(again).toBe(0);
    expect(listExpenses(db)).toHaveLength(1);
  });

  it('rejects a malformed month string', () => {
    const db = freshDb();
    expect(() => applyFixedExpensesToMonth(db, '2026-8')).toThrow();
    expect(() => applyFixedExpensesToMonth(db, 'nope')).toThrow();
  });
});
