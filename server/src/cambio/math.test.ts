import { describe, expect, it } from 'vitest';
import { calcCambio } from './math.js';

describe('calcCambio', () => {
  it('computes gross, fees, net, VET and spread for a real Banco Inter contract', () => {
    const result = calcCambio({
      amountUsdCents: 500_000, // US$5,000.00
      contractedRate: 5.0994,
      ptaxRate: 5.12,
      iofCents: 65_318, // R$653.18
      bankFeeCents: 3_000, // R$30.00
    });

    expect(result.grossBrlCents).toBe(2_549_700);
    expect(result.totalFeesCents).toBe(68_318);
    expect(result.netBrlCents).toBe(2_481_382);
    expect(result.vetRate).toBeCloseTo(4.962764, 5);
    expect(result.spreadBrlCents).toBe(Math.round((5.12 - result.vetRate) * 500_000));
    expect(result.spreadPct).toBeCloseTo(3.07, 2);
  });

  it('returns null spread when no PTAX rate is given', () => {
    const result = calcCambio({
      amountUsdCents: 100_000,
      contractedRate: 5.0,
      ptaxRate: null,
      iofCents: 0,
      bankFeeCents: 0,
    });

    expect(result.netBrlCents).toBe(500_000);
    expect(result.spreadBrlCents).toBeNull();
    expect(result.spreadPct).toBeNull();
  });

  it('returns zero VET when amountUsdCents is zero', () => {
    const result = calcCambio({
      amountUsdCents: 0,
      contractedRate: 5.0,
      ptaxRate: 5.1,
      iofCents: 0,
      bankFeeCents: 0,
    });

    expect(result.vetRate).toBe(0);
  });
});
