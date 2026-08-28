/** Days in a given 1-based month of a given year. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Adds `months` calendar months to an ISO date (YYYY-MM-DD), clamping the
 * day to the last valid day of the target month. Ported from the validated
 * `stack-project` prototype's `add_months`.
 *
 *   addMonths('2026-01-31', 1) -> '2026-02-28'
 *   addMonths('2026-01-31', 2) -> '2026-03-31'
 *   addMonths('2026-12-15', 1) -> '2027-01-15'
 */
export function addMonths(dateISO: string, months: number): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const monthIndex0 = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex0 / 12);
  const targetMonth = (((monthIndex0 % 12) + 12) % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Splits `amountCents` into `count` positive integers that sum exactly to
 * `amountCents`. The first element absorbs the remainder.
 *
 *   splitInstallments(65_000, 3) -> [21_668, 21_666, 21_666]
 *   splitInstallments(10_000, 1) -> [10_000]
 */
export function splitInstallments(amountCents: number, count: number): number[] {
  if (count <= 1) return [amountCents];
  const base = Math.trunc(amountCents / count);
  const remainder = amountCents - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}
