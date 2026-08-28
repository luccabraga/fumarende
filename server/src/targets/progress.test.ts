import { describe, expect, it } from 'vitest';
import { monthsUntil, targetProgress } from './progress.js';

const AUG_15 = new Date(2026, 7, 15); // 15 Aug 2026

describe('monthsUntil', () => {
  it('counts whole months to a future date', () => {
    expect(monthsUntil('2026-11-01', AUG_15)).toBe(3);
    expect(monthsUntil('2026-09-30', AUG_15)).toBe(1);
  });

  it('returns null for an empty, same-month, or past date', () => {
    expect(monthsUntil(null, AUG_15)).toBeNull();
    expect(monthsUntil('2026-08-31', AUG_15)).toBeNull();
    expect(monthsUntil('2026-07-01', AUG_15)).toBeNull();
  });
});

describe('targetProgress', () => {
  it('computes remaining, pct, suggestion and complete for an in-progress target', () => {
    const p = targetProgress(
      { targetCents: 100_000, currentCents: 25_000, targetDate: '2026-11-01' },
      AUG_15,
    );
    expect(p).toEqual({
      remainingCents: 75_000,
      progressPct: 25,
      suggestedMonthlyCents: 25_000,
      complete: false,
    });
  });

  it('caps pct at 100, zeroes remaining, and drops the suggestion when complete', () => {
    const p = targetProgress(
      { targetCents: 100_000, currentCents: 120_000, targetDate: null },
      AUG_15,
    );
    expect(p).toEqual({
      remainingCents: 0,
      progressPct: 100,
      suggestedMonthlyCents: null,
      complete: true,
    });
  });

  it('treats a zero target as complete with 0% progress', () => {
    const p = targetProgress({ targetCents: 0, currentCents: 0, targetDate: null }, AUG_15);
    expect(p).toMatchObject({ progressPct: 0, complete: true, suggestedMonthlyCents: null });
  });
});
