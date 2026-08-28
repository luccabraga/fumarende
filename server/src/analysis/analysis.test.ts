import { describe, expect, it } from 'vitest';
import { spendingBreakdown, projectSavings, scenarioCatalog, applyCuts } from './analysis.js';

describe('spendingBreakdown', () => {
  it('totals income, expenses, the essencial split, and a sorted category breakdown', () => {
    const income = [{ amountBrlCents: 300_000 }, { amountBrlCents: 200_000 }];
    const expenses = [
      { date: '2026-06-01', amountCents: 40_000, category: 'Alimentação', type: 'essencial' },
      { date: '2026-06-02', amountCents: 10_000, category: 'Lazer', type: 'nao-essencial' },
      { date: '2026-06-03', amountCents: 20_000, category: 'Alimentação', type: 'essencial' },
    ];
    const b = spendingBreakdown(income, expenses);
    expect(b).toMatchObject({
      totalIncomeCents: 500_000,
      totalExpensesCents: 70_000,
      essentialCents: 60_000,
      nonEssentialCents: 10_000,
      balanceCents: 430_000,
    });
    expect(b.byCategory).toEqual([
      { category: 'Alimentação', cents: 60_000, pct: (60_000 / 70_000) * 100 },
      { category: 'Lazer', cents: 10_000, pct: (10_000 / 70_000) * 100 },
    ]);
  });

  it('returns zeros for empty inputs', () => {
    expect(spendingBreakdown([], [])).toEqual({
      totalIncomeCents: 0,
      totalExpensesCents: 0,
      essentialCents: 0,
      nonEssentialCents: 0,
      balanceCents: 0,
      byCategory: [],
    });
  });
});

describe('projectSavings', () => {
  it('projects 12 linear months from reserve + goals + accumulating target', () => {
    const p = projectSavings({
      reserveBalanceCents: 700_000,
      monthlyTargetCents: 100_000,
      goalsSavedCents: 50_000,
    });
    expect(p.rows).toHaveLength(12);
    expect(p.rows[0]).toEqual({ monthOffset: 1, savingsAccumCents: 100_000, totalCents: 850_000 });
    expect(p.endSavingsCents).toBe(1_200_000);
    expect(p.endTotalCents).toBe(1_950_000);
  });

  it('keeps totals flat when the monthly target is zero', () => {
    const p = projectSavings({
      reserveBalanceCents: 700_000,
      monthlyTargetCents: 0,
      goalsSavedCents: 50_000,
    });
    expect(p.rows.every((r) => r.totalCents === 750_000)).toBe(true);
    expect(p.endSavingsCents).toBe(0);
  });
});

describe('scenarioCatalog', () => {
  it('averages non-essencial category totals over the number of distinct expense months', () => {
    const expenses = [
      { date: '2026-06-01', amountCents: 12_000, category: 'Lazer', type: 'nao-essencial' },
      { date: '2026-07-01', amountCents: 18_000, category: 'Lazer', type: 'nao-essencial' },
      { date: '2026-06-05', amountCents: 20_000, category: 'Delivery', type: 'nao-essencial' },
      { date: '2026-07-10', amountCents: 280_000, category: 'Aluguel', type: 'essencial' },
    ];
    expect(scenarioCatalog(expenses)).toEqual([
      { category: 'Lazer', monthlyAvgCents: 15_000 },
      { category: 'Delivery', monthlyAvgCents: 10_000 },
    ]);
  });

  it('returns an empty catalog with no expenses', () => {
    expect(scenarioCatalog([])).toEqual([]);
  });
});

describe('applyCuts', () => {
  it('sums the chosen percentage cuts and annualises', () => {
    const catalog = [
      { category: 'Lazer', monthlyAvgCents: 15_000 },
      { category: 'Delivery', monthlyAvgCents: 10_000 },
    ];
    expect(applyCuts(catalog, { Lazer: 50, Delivery: 100 })).toEqual({
      totalMonthlyCents: 17_500,
      annualCents: 210_000,
    });
  });

  it('is zero for an empty cuts map', () => {
    expect(applyCuts([{ category: 'Lazer', monthlyAvgCents: 15_000 }], {})).toEqual({
      totalMonthlyCents: 0,
      annualCents: 0,
    });
  });
});
