import { describe, expect, it } from 'vitest';
import { essentialAverage } from './essential-average.js';

describe('essentialAverage', () => {
  it('averages the most recent 3 months with essential spending, looking back up to 6', () => {
    const today = new Date(2026, 7, 15); // Aug 15, 2026 (month is 0-indexed)
    const expenses = [
      { date: '2026-08-01', amountCents: 100_000, type: 'essencial' },
      { date: '2026-07-01', amountCents: 200_000, type: 'essencial' },
      { date: '2026-06-01', amountCents: 300_000, type: 'essencial' },
      { date: '2026-05-01', amountCents: 999_999, type: 'nao-essencial' },
      { date: '2026-08-05', amountCents: 50_000, type: 'nao-essencial' },
    ];

    const result = essentialAverage(expenses, today);
    expect(result.averageCents).toBe(200_000);
    expect(result.monthsUsed).toBe(3);
  });

  it('skips months with zero essential spending inside the 6-month lookback', () => {
    const today = new Date(2026, 7, 15);
    const expenses = [
      { date: '2026-08-01', amountCents: 100_000, type: 'essencial' },
      { date: '2026-06-01', amountCents: 300_000, type: 'essencial' },
      { date: '2026-04-01', amountCents: 100_000, type: 'essencial' },
    ];

    const result = essentialAverage(expenses, today);
    expect(result.averageCents).toBeCloseTo(166_666.67, 1);
    expect(result.monthsUsed).toBe(3);
  });

  it('returns zero average and zero monthsUsed with no essential data', () => {
    const today = new Date(2026, 7, 15);
    expect(essentialAverage([], today)).toEqual({ averageCents: 0, monthsUsed: 0 });
  });
});
