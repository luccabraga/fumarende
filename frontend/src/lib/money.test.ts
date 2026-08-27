import { describe, expect, it } from 'vitest';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput, parseRate } from './money.js';

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

    it('parses thousands dots with no decimal part like "1.500" to 150000 cents', () => {
      expect(parseCentsFromInput('1.500')).toBe(150000);
    });

    it('pads a single decimal digit, so "10,5" is 1050 cents', () => {
      expect(parseCentsFromInput('10,5')).toBe(1050);
    });

    it('ignores surrounding whitespace', () => {
      expect(parseCentsFromInput('  1.500,00  ')).toBe(150000);
    });

    it('rejects ambiguous dot-decimal input like "10.50" instead of silently misreading it', () => {
      // Regression: the "strip every dot" implementation turned "10.50" into
      // "1050" -> 105000 cents (R$ 1.050,00), a silent 100x corruption.
      // It is ambiguous in pt-BR input, so it must surface as invalid.
      expect(Number.isNaN(parseCentsFromInput('10.50'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('10.5'))).toBe(true);
    });

    it('returns NaN for invalid input', () => {
      expect(Number.isNaN(parseCentsFromInput('invalid'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput(''))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('   '))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('1,5,0'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('1.500,000'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('12.34,56'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('1000,'))).toBe(true);
      expect(Number.isNaN(parseCentsFromInput('R$ 10,00'))).toBe(true);
    });
  });

  describe('parseRate', () => {
    it('parses a dot decimal like "5.0994"', () => {
      expect(parseRate('5.0994')).toBe(5.0994);
    });

    it('parses a comma decimal like "5,0994"', () => {
      expect(parseRate('5,0994')).toBe(5.0994);
    });

    it('parses a plain integer like "5"', () => {
      expect(parseRate('5')).toBe(5);
    });

    it('returns NaN for non-numeric or empty input', () => {
      expect(parseRate('abc')).toBeNaN();
      expect(parseRate('')).toBeNaN();
      expect(parseRate('5.0.9')).toBeNaN();
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
