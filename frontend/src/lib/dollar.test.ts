import { describe, expect, it } from 'vitest';
import { quoteStats } from './dollar.js';

describe('quoteStats', () => {
  it('computes the average rate, per-row salary-in-BRL, and vs-average %', () => {
    const stats = quoteStats([
      { month: '2026-05', rate: 5.0, salaryUsdCents: 500_000 },
      { month: '2026-06', rate: 5.2, salaryUsdCents: null },
      { month: '2026-07', rate: 5.6, salaryUsdCents: null },
    ]);

    expect(stats.averageRate).toBeCloseTo((5.0 + 5.2 + 5.6) / 3, 10);
    expect(stats.rows[0].salaryBrlCents).toBe(Math.round(500_000 * 5.0));
    expect(stats.rows[1].salaryBrlCents).toBeNull();
    expect(stats.rows[0].vsAveragePct).toBeCloseTo(
      ((5.0 - stats.averageRate) / stats.averageRate) * 100,
      10,
    );
    expect(stats.rows.map((r) => r.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('returns zeros for an empty input', () => {
    expect(quoteStats([])).toEqual({ averageRate: 0, rows: [] });
  });
});
