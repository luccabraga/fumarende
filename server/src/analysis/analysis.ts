export interface IncomeLike {
  amountBrlCents: number;
}
export interface ExpenseLike {
  date: string;
  amountCents: number;
  category: string;
  type: string;
}

export interface SpendingBreakdown {
  totalIncomeCents: number;
  totalExpensesCents: number;
  essentialCents: number;
  nonEssentialCents: number;
  balanceCents: number;
  byCategory: { category: string; cents: number; pct: number }[];
}

export function spendingBreakdown(
  income: IncomeLike[],
  expenses: ExpenseLike[],
): SpendingBreakdown {
  const totalIncomeCents = income.reduce((s, r) => s + r.amountBrlCents, 0);
  const totalExpensesCents = expenses.reduce((s, e) => s + e.amountCents, 0);
  const essentialCents = expenses
    .filter((e) => e.type === 'essencial')
    .reduce((s, e) => s + e.amountCents, 0);

  const catTotals = new Map<string, number>();
  for (const e of expenses) {
    catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amountCents);
  }
  const byCategory = [...catTotals.entries()]
    .map(([category, cents]) => ({
      category,
      cents,
      pct: totalExpensesCents > 0 ? (cents / totalExpensesCents) * 100 : 0,
    }))
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));

  return {
    totalIncomeCents,
    totalExpensesCents,
    essentialCents,
    nonEssentialCents: totalExpensesCents - essentialCents,
    balanceCents: totalIncomeCents - totalExpensesCents,
    byCategory,
  };
}

export interface ProjectionInput {
  reserveBalanceCents: number;
  monthlyTargetCents: number;
  goalsSavedCents: number;
}
export interface SavingsProjection {
  rows: { monthOffset: number; savingsAccumCents: number; totalCents: number }[];
  endSavingsCents: number;
  endTotalCents: number;
}

export function projectSavings(input: ProjectionInput, months = 12): SavingsProjection {
  const base = input.reserveBalanceCents + input.goalsSavedCents;
  const rows = [];
  for (let i = 1; i <= months; i += 1) {
    const savingsAccumCents = input.monthlyTargetCents * i;
    rows.push({ monthOffset: i, savingsAccumCents, totalCents: base + savingsAccumCents });
  }
  const last = rows[rows.length - 1];
  return {
    rows,
    endSavingsCents: last ? last.savingsAccumCents : 0,
    endTotalCents: last ? last.totalCents : base,
  };
}

export interface ScenarioCategory {
  category: string;
  monthlyAvgCents: number;
}

export function scenarioCatalog(expenses: ExpenseLike[]): ScenarioCategory[] {
  const distinctMonths = new Set(expenses.map((e) => e.date.slice(0, 7))).size;
  if (distinctMonths === 0) return [];

  const catTotals = new Map<string, number>();
  for (const e of expenses) {
    if (e.type === 'essencial') continue;
    catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amountCents);
  }
  return [...catTotals.entries()]
    .map(([category, total]) => ({
      category,
      monthlyAvgCents: Math.round(total / distinctMonths),
    }))
    .sort((a, b) => b.monthlyAvgCents - a.monthlyAvgCents || a.category.localeCompare(b.category));
}

export interface ScenarioResult {
  totalMonthlyCents: number;
  annualCents: number;
}

export function applyCuts(
  catalog: ScenarioCategory[],
  cuts: Record<string, number>,
): ScenarioResult {
  const totalMonthlyCents = catalog.reduce(
    (s, c) => s + Math.round((c.monthlyAvgCents * (cuts[c.category] ?? 0)) / 100),
    0,
  );
  return { totalMonthlyCents, annualCents: totalMonthlyCents * 12 };
}
