import { describe, expect, it } from 'vitest';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput } from './money.js';

describe('money.ts', () => {
  describe('parseCentsFromInput', () => {
    it('parses a plain amount like "1000" to 100000 cents', () => {
      expect(parseCentsFromInput('1000')).toBe(100000);
    });

    it('parses a decimal amount like "1000,50" to 100050 cents', () => {
      expect(parseCentsFromInput('1000,50')).toBe(100050);
    });

    it('parses a thousands-separated amount like "1.500,00" to 150000 cents (the regression test)', () => {
      // This is the bug case: before the fix, "1.500,00" would parse to 150 cents instead of 150000
      expect(parseCentsFromInput('1.500,00')).toBe(150000);
    });

    it('parses a larger thousands-separated amount like "12.345,67" to 1234567 cents', () => {
      expect(parseCentsFromInput('12.345,67')).toBe(1234567);
    });

    it('returns NaN for invalid input', () => {
      expect(Number.isNaN(parseCentsFromInput('invalid'))).toBe(true);
    });
  });

  describe('formatCentsBRL', () => {
    it('formats cents to BRL currency string', () => {
      const result = formatCentsBRL(100000);
      // Should contain the currency code and the formatted amount
      expect(result).toContain('R$');
      expect(result).toContain('1');
      expect(result).toContain('000');
    });
  });

  describe('formatCentsUSD', () => {
    it('formats cents to USD currency string', () => {
      const result = formatCentsUSD(100000);
      // Should contain the currency symbol and the formatted amount
      expect(result).toContain('$');
      expect(result).toContain('1');
      expect(result).toContain('000');
    });
  });
});
