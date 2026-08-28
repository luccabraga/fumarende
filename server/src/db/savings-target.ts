import type Database from 'better-sqlite3';

export interface MonthlyTarget {
  month: string;
  pctOrFixed: string;
  pctValue: number | null;
  fixedValueCents: number | null;
  targetCents: number;
  rolloverCents: number;
}

interface MonthlyTargetRow {
  month: string;
  pct_or_fixed: string;
  pct_value: number | null;
  fixed_value_cents: number | null;
  target_cents: number;
  rollover_cents: number;
}

function toTarget(row: MonthlyTargetRow): MonthlyTarget {
  return {
    month: row.month,
    pctOrFixed: row.pct_or_fixed,
    pctValue: row.pct_value,
    fixedValueCents: row.fixed_value_cents,
    targetCents: row.target_cents,
    rolloverCents: row.rollover_cents,
  };
}

function findTarget(db: Database.Database, month: string): MonthlyTarget | undefined {
  const row = db
    .prepare(
      `SELECT month, pct_or_fixed, pct_value, fixed_value_cents, target_cents, rollover_cents
       FROM savings_monthly_targets WHERE month = ?`,
    )
    .get(month) as MonthlyTargetRow | undefined;
  return row ? toTarget(row) : undefined;
}

function monthIncomeCents(db: Database.Database, month: string): number {
  const { n } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_brl_cents), 0) AS n FROM income
       WHERE date LIKE ? AND deleted_at IS NULL`,
    )
    .get(`${month}%`) as { n: number };
  return n;
}

function monthNetSavedCents(db: Database.Database, month: string): number {
  const { n } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM emergency_fund_entries
       WHERE date LIKE ? AND deleted_at IS NULL`,
    )
    .get(`${month}%`) as { n: number };
  return n;
}

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  if (m === 1) return `${year - 1}-12`;
  return `${year}-${String(m - 1).padStart(2, '0')}`;
}

function resolveTargetCents(
  db: Database.Database,
  month: string,
  pctOrFixed: string,
  pctValue: number | null,
  fixedValueCents: number | null,
): number {
  if (pctOrFixed === 'fixed') return fixedValueCents ?? 0;
  return Math.trunc((monthIncomeCents(db, month) * (pctValue ?? 0)) / 100);
}

function computeRolloverCents(db: Database.Database, month: string): number {
  const prev = previousMonth(month);
  const prevTarget = findTarget(db, prev);
  if (!prevTarget) return 0;
  const deficit =
    prevTarget.targetCents + prevTarget.rolloverCents - monthNetSavedCents(db, prev);
  return deficit > 0 ? deficit : 0;
}

/**
 * Returns the frozen target for `month` if one exists. Otherwise inherits
 * the most recent prior month's %/fixed setting (default pct/0), resolves
 * it against this month's income, computes rollover from the previous
 * month's deficit, persists, and returns. Never recomputed once stored.
 */
export function getOrCreateMonthlyTarget(db: Database.Database, month: string): MonthlyTarget {
  const existing = findTarget(db, month);
  if (existing) return existing;

  const create = db.transaction((): void => {
    const prior = db
      .prepare(
        `SELECT pct_or_fixed, pct_value, fixed_value_cents FROM savings_monthly_targets
         WHERE month < ? ORDER BY month DESC LIMIT 1`,
      )
      .get(month) as
      | { pct_or_fixed: string; pct_value: number | null; fixed_value_cents: number | null }
      | undefined;

    const pctOrFixed = prior?.pct_or_fixed ?? 'pct';
    const pctValue = prior ? prior.pct_value : 0;
    const fixedValueCents = prior ? prior.fixed_value_cents : null;

    const targetCents = resolveTargetCents(db, month, pctOrFixed, pctValue, fixedValueCents);
    const rolloverCents = computeRolloverCents(db, month);

    db.prepare(
      `INSERT INTO savings_monthly_targets
         (month, pct_or_fixed, pct_value, fixed_value_cents, target_cents, rollover_cents)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(month, pctOrFixed, pctValue, fixedValueCents, targetCents, rolloverCents);
  });

  create();
  return findTarget(db, month)!;
}

/**
 * Sets `month`'s %/fixed config, recomputing `target_cents` against this
 * month's income. On a brand-new row the rollover is computed the same
 * way as getOrCreateMonthlyTarget; an existing row's rollover is left
 * untouched (rollover depends on the previous month, not this config).
 */
export function updateMonthlyTargetConfig(
  db: Database.Database,
  month: string,
  pctOrFixed: string,
  pctValue: number | null,
  fixedValueCents: number | null,
): MonthlyTarget {
  if (pctOrFixed !== 'pct' && pctOrFixed !== 'fixed') {
    throw new Error("pctOrFixed must be 'pct' or 'fixed'");
  }

  const save = db.transaction((): void => {
    const targetCents = resolveTargetCents(db, month, pctOrFixed, pctValue, fixedValueCents);
    const rolloverCents = computeRolloverCents(db, month);
    db.prepare(
      `INSERT INTO savings_monthly_targets
         (month, pct_or_fixed, pct_value, fixed_value_cents, target_cents, rollover_cents)
       VALUES (@month, @pctOrFixed, @pctValue, @fixedValueCents, @targetCents, @rolloverCents)
       ON CONFLICT(month) DO UPDATE SET
         pct_or_fixed = excluded.pct_or_fixed,
         pct_value = excluded.pct_value,
         fixed_value_cents = excluded.fixed_value_cents,
         target_cents = excluded.target_cents`,
    ).run({ month, pctOrFixed, pctValue, fixedValueCents, targetCents, rolloverCents });
  });

  save();
  return findTarget(db, month)!;
}
