import { describe, expect, it } from 'vitest';
import { essentialAverage, reserveTiers } from './reserva.js';
import type { Expense } from './api.js';

function ex(over: Partial<Expense>): Expense {
  return {
    id: 0,
    date: '2026-01-01',
    description: 'x',
    amountCents: 0,
    category: 'Moradia',
    type: 'essencial',
    paymentMethod: 'Pix',
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    notes: null,
    ...over,
  };
}

describe('essentialAverage', () => {
  it('averages the 3 most recent months with essential spending', () => {
    const today = new Date(2026, 7, 15);
    const expenses = [
      ex({ date: '2026-08-01', amountCents: 100_000, type: 'essencial' }),
      ex({ date: '2026-07-01', amountCents: 200_000, type: 'essencial' }),
      ex({ date: '2026-06-01', amountCents: 300_000, type: 'essencial' }),
      ex({ date: '2026-08-05', amountCents: 50_000, type: 'nao-essencial' }),
    ];
    expect(essentialAverage(expenses, today)).toEqual({ averageCents: 200_000, monthsUsed: 3 });
  });

  it('returns zeros with no essential data', () => {
    expect(essentialAverage([], new Date(2026, 7, 15))).toEqual({ averageCents: 0, monthsUsed: 0 });
  });
});

describe('reserveTiers', () => {
  it('reports no-data when there is no essential average', () => {
    expect(reserveTiers(0, 0)).toMatchObject({ tier: 'no-data', progressPct: 0 });
  });

  it('reports below-3 under the 3-month target', () => {
    expect(reserveTiers(100_000, 100_000)).toMatchObject({
      target3Cents: 300_000,
      target6Cents: 600_000,
      tier: 'below-3',
    });
  });

  it('reports below-6 between the 3- and 6-month targets', () => {
    const t = reserveTiers(400_000, 100_000);
    expect(t.tier).toBe('below-6');
    expect(t.progressPct).toBeCloseTo(66.67, 1);
  });

  it('reports complete at or above the 6-month target, capping progress at 100', () => {
    expect(reserveTiers(600_000, 100_000)).toMatchObject({ tier: 'complete', progressPct: 100 });
  });
});
