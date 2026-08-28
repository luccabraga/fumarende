export interface MinimalExpense {
  date: string;
  amountCents: number;
  type: string;
}

export interface EssentialAverage {
  averageCents: number;
  monthsUsed: number;
}

/**
 * Mean of the most recent 3 months (looking back up to 6 from `today`)
 * that had any `essencial` spending. Ported unchanged from the validated
 * `stack-project` prototype (`app/src/lib/emergency-fund-math.ts`).
 * `averageCents` is a real number — callers format it. `{ 0, 0 }` when
 * nothing qualifies. `today` is a parameter only so tests are
 * deterministic.
 */
export function essentialAverage(
  expenses: MinimalExpense[],
  today: Date = new Date(),
): EssentialAverage {
  const totals: number[] = [];
  for (let i = 0; i < 6 && totals.length < 3; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const total = expenses
      .filter((e) => e.date.startsWith(key) && e.type === 'essencial')
      .reduce((s, e) => s + e.amountCents, 0);
    if (total > 0) totals.push(total);
  }
  if (totals.length === 0) return { averageCents: 0, monthsUsed: 0 };
  return {
    averageCents: totals.reduce((s, v) => s + v, 0) / totals.length,
    monthsUsed: totals.length,
  };
}
