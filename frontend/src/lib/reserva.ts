import type { Expense } from './api.js';

export interface EssentialAverage {
  averageCents: number;
  monthsUsed: number;
}

/**
 * Mean of the most recent 3 months (of the last 6 from `today`) with any
 * `essencial` spending. Mirrors `server/src/savings/essential-average.ts`
 * exactly — keep the two in sync.
 */
export function essentialAverage(expenses: Expense[], today: Date = new Date()): EssentialAverage {
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

export interface ReserveTiers {
  target3Cents: number;
  target6Cents: number;
  progressPct: number;
  tier: 'no-data' | 'below-3' | 'below-6' | 'complete';
}

/** 3x / 6x essential-average targets, a capped progress %, and an alert tier. */
export function reserveTiers(balanceCents: number, averageCents: number): ReserveTiers {
  const target3Cents = Math.round(averageCents * 3);
  const target6Cents = Math.round(averageCents * 6);
  const progressPct = target6Cents > 0 ? Math.min((balanceCents / target6Cents) * 100, 100) : 0;

  let tier: ReserveTiers['tier'];
  if (averageCents === 0) tier = 'no-data';
  else if (balanceCents < target3Cents) tier = 'below-3';
  else if (balanceCents < target6Cents) tier = 'below-6';
  else tier = 'complete';

  return { target3Cents, target6Cents, progressPct, tier };
}
