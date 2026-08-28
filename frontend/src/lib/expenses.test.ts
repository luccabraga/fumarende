import { describe, expect, it } from 'vitest';
import { groupInstallments } from './expenses.js';
import type { Expense } from './api.js';

function row(over: Partial<Expense>): Expense {
  return {
    id: 0,
    date: '2026-01-01',
    description: 'Tênis',
    amountCents: 10_000,
    category: 'Vestuário',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    notes: null,
    ...over,
  };
}

describe('groupInstallments', () => {
  it('summarises a group by paid count and remaining cents', () => {
    const expenses = [
      row({ id: 1, date: '2026-01-15', amountCents: 21_668, installmentNumber: 1, installmentTotal: 3, installmentGroupId: 'g1' }),
      row({ id: 2, date: '2026-02-15', amountCents: 21_666, installmentNumber: 2, installmentTotal: 3, installmentGroupId: 'g1' }),
      row({ id: 3, date: '2026-03-15', amountCents: 21_666, installmentNumber: 3, installmentTotal: 3, installmentGroupId: 'g1' }),
    ];
    const [group] = groupInstallments(expenses, '2026-02-20');
    expect(group).toMatchObject({
      groupId: 'g1',
      description: 'Tênis',
      installmentTotal: 3,
      paidCount: 2,
      remainingCents: 21_666,
      totalCents: 65_000,
    });
  });

  it('ignores expenses without a group id', () => {
    expect(groupInstallments([row({ id: 1 })], '2026-01-01')).toEqual([]);
  });

  it('returns one entry per distinct group id', () => {
    const expenses = [
      row({ id: 1, installmentGroupId: 'g1', installmentTotal: 2 }),
      row({ id: 2, installmentGroupId: 'g2', installmentTotal: 2 }),
    ];
    expect(groupInstallments(expenses, '2026-01-01')).toHaveLength(2);
  });
});
