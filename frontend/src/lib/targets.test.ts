import { describe, expect, it } from 'vitest';
import { monthsUntil, targetProgress } from './targets.js';

const AUG_15 = new Date(2026, 7, 15);

describe('monthsUntil', () => {
  it('counts whole months to a future date', () => {
    expect(monthsUntil('2026-11-01', AUG_15)).toBe(3);
  });
  it('returns null for empty / same-month / past', () => {
    expect(monthsUntil(null, AUG_15)).toBeNull();
    expect(monthsUntil('2026-08-20', AUG_15)).toBeNull();
    expect(monthsUntil('2026-01-01', AUG_15)).toBeNull();
  });
});

describe('targetProgress', () => {
  it('computes an in-progress target', () => {
    expect(
      targetProgress(
        { targetCents: 100_000, currentCents: 25_000, targetDate: '2026-11-01' },
        AUG_15,
      ),
    ).toEqual({
      remainingCents: 75_000,
      progressPct: 25,
      suggestedMonthlyCents: 25_000,
      complete: false,
    });
  });
  it('marks a met target complete with no suggestion', () => {
    expect(
      targetProgress({ targetCents: 100_000, currentCents: 100_000, targetDate: null }, AUG_15),
    ).toMatchObject({ complete: true, remainingCents: 0, suggestedMonthlyCents: null });
  });
});
