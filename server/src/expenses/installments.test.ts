import { describe, expect, it } from 'vitest';
import { addMonths, splitInstallments } from './installments.js';

describe('addMonths', () => {
  it('clamps the day to the last day of a shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('does not carry the clamp forward to a later month', () => {
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('rolls over into the next year', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('returns the same date for a zero offset', () => {
    expect(addMonths('2026-08-05', 0)).toBe('2026-08-05');
  });

  it('zero-pads month and day', () => {
    expect(addMonths('2026-08-05', 1)).toBe('2026-09-05');
  });
});

describe('splitInstallments', () => {
  it('splits with the remainder on the first installment', () => {
    const parts = splitInstallments(65_000, 3);
    expect(parts).toEqual([21_668, 21_666, 21_666]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(65_000);
  });

  it('returns a single element for a count of 1', () => {
    expect(splitInstallments(10_000, 1)).toEqual([10_000]);
  });

  it('always sums exactly to the amount', () => {
    const parts = splitInstallments(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(100);
  });
});
