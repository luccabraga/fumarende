export function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatCentsUSD(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Digits only, e.g. "1000". */
const PLAIN_DIGITS = /^\d+$/;
/** pt-BR thousands grouping, e.g. "1.500" or "12.345.678". */
const DOT_GROUPED = /^\d{1,3}(?:\.\d{3})+$/;

/** Parses the whole-units part of an input, allowing pt-BR thousands dots. */
function parseWholeUnits(part: string): number {
  if (PLAIN_DIGITS.test(part)) return Number(part);
  if (DOT_GROUPED.test(part)) return Number(part.replace(/\./g, ''));
  return NaN;
}

/**
 * Parses a pt-BR money input into integer cents.
 *
 * Accepted shapes:
 *   "1000"      -> 100000  (plain whole units)
 *   "1000,50"   -> 100050  (comma decimal)
 *   "1.500,00"  -> 150000  (thousands dots + comma decimal)
 *   "1.500"     -> 150000  (thousands dots, no decimal)
 *
 * Anything else returns NaN. In particular a dot-decimal like "10,50"
 * written as "10.50" is ambiguous in this locale (ten-and-a-half vs. ten
 * thousand five hundred), so it is rejected rather than guessed at.
 */
export function parseCentsFromInput(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return NaN;

  const commaCount = (trimmed.match(/,/g) ?? []).length;
  if (commaCount > 1) return NaN;

  if (commaCount === 0) {
    const whole = parseWholeUnits(trimmed);
    return Number.isNaN(whole) ? NaN : whole * 100;
  }

  const [wholePart, fractionPart] = trimmed.split(',');
  if (!/^\d{1,2}$/.test(fractionPart)) return NaN;

  const whole = parseWholeUnits(wholePart);
  if (Number.isNaN(whole)) return NaN;

  const cents = fractionPart.length === 1 ? Number(fractionPart) * 10 : Number(fractionPart);
  return whole * 100 + cents;
}

/**
 * Parses a plain exchange rate: "5.0994" or "5,0994" -> 5.0994.
 * Rates have no thousands grouping (they are < 100). NaN on anything else.
 */
export function parseRate(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return NaN;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}
