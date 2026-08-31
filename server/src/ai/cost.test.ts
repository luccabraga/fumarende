import { describe, expect, it } from 'vitest';
import { estimateCostUsdCents } from './cost.js';

describe('estimateCostUsdCents', () => {
  it('prices a known model at $3/$15 per Mtok, rounded half-up', () => {
    // 1,000,000 in + 100,000 out = 300c + 150c = 450c
    expect(estimateCostUsdCents('claude-sonnet-5', 1_000_000, 100_000)).toBe(450);
    // 1500 in + 700 out = 0.45c + 1.05c = 1.5c -> 2
    expect(estimateCostUsdCents('claude-sonnet-5', 1500, 700)).toBe(2);
  });

  it('prices Haiku at $1/$5 per Mtok', () => {
    // 1,000,000 in + 100,000 out = 100c + 50c = 150c
    expect(estimateCostUsdCents('claude-haiku-4-5', 1_000_000, 100_000)).toBe(150);
  });

  it('throws for an unknown model', () => {
    expect(() => estimateCostUsdCents('mystery', 10, 10)).toThrow(/unknown model/i);
  });
});
