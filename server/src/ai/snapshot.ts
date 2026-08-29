import type Database from 'better-sqlite3';
import { essentialAverage } from '../savings/essential-average.js';
import { projectSavings } from '../analysis/analysis.js';
import { calcCambio } from '../cambio/math.js';

export interface AnalysisSnapshot {
  month: string;
  generatedAt: string;
  income: { month: string; brlCents: number; usdCents: number }[]; // last 3 months, ascending
  expenses: {
    currentMonthCents: number;
    previousMonthCents: number;
    essentialCents: number;
    nonEssentialCents: number;
    byCategory: { category: string; cents: number }[]; // 3-month sum, desc
  };
  reserve: {
    balanceCents: number;
    essentialAvgCents: number;
    target3Cents: number;
    target6Cents: number;
  };
  savingsTarget: {
    targetCents: number;
    savedThisMonthCents: number;
    rolloverCents: number;
  } | null;
  projection: { endTotalCents: number; endSavingsCents: number };
  goals: { name: string; currentCents: number; targetCents: number; targetDate: string | null }[];
  specialProjects: {
    name: string;
    currentCents: number;
    targetCents: number;
    targetDate: string | null;
  }[];
  cambio: {
    recent: {
      date: string;
      amountUsdCents: number;
      contractedRate: number;
      spreadPct: number;
      netBrlCents: number;
    }[];
    meanSpreadPct: number | null;
  };
  dollarQuotes: {
    recent: { month: string; rate: number; salaryUsdCents: number | null }[];
    averageRate: number | null;
  };
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function sumOne(db: Database.Database, sql: string, params: unknown[] = []): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function targetRows(
  db: Database.Database,
  table: 'goals' | 'special_projects',
): AnalysisSnapshot['goals'] {
  return db
    .prepare(
      `SELECT name, current_cents AS currentCents, target_cents AS targetCents,
              target_date AS targetDate
       FROM ${table}
       WHERE deleted_at IS NULL AND status = 'active'
       ORDER BY id`,
    )
    .all() as AnalysisSnapshot['goals'];
}

export function buildSnapshot(db: Database.Database, now: Date = new Date()): AnalysisSnapshot {
  const month = monthKey(now);
  const previousMonth = shiftMonth(month, -1);
  const threeMonthFloor = `${shiftMonth(month, -2)}-01`;

  const income = (
    db
      .prepare(
        `SELECT substr(date,1,7) AS month, SUM(amount_brl_cents) AS brlCents,
                COALESCE(SUM(amount_usd_cents),0) AS usdCents
         FROM income WHERE deleted_at IS NULL
         GROUP BY month ORDER BY month DESC LIMIT 3`,
      )
      .all() as AnalysisSnapshot['income']
  ).reverse();

  const currentMonthCents = sumOne(
    db,
    'SELECT COALESCE(SUM(amount_cents),0) AS n FROM expenses WHERE deleted_at IS NULL AND substr(date,1,7) = ?',
    [month],
  );
  const previousMonthCents = sumOne(
    db,
    'SELECT COALESCE(SUM(amount_cents),0) AS n FROM expenses WHERE deleted_at IS NULL AND substr(date,1,7) = ?',
    [previousMonth],
  );
  const essentialCents = sumOne(
    db,
    "SELECT COALESCE(SUM(amount_cents),0) AS n FROM expenses WHERE deleted_at IS NULL AND substr(date,1,7) = ? AND type = 'essencial'",
    [month],
  );
  const byCategory = db
    .prepare(
      `SELECT category, SUM(amount_cents) AS cents FROM expenses
       WHERE deleted_at IS NULL AND date >= ?
       GROUP BY category ORDER BY cents DESC, category ASC`,
    )
    .all(threeMonthFloor) as { category: string; cents: number }[];

  const reserveBalanceCents = sumOne(
    db,
    'SELECT COALESCE(SUM(amount_cents),0) AS n FROM emergency_fund_entries WHERE deleted_at IS NULL',
  );
  const allExpenses = db
    .prepare(
      'SELECT date, amount_cents AS amountCents, type FROM expenses WHERE deleted_at IS NULL',
    )
    .all() as { date: string; amountCents: number; type: string }[];
  const [y, m] = month.split('-').map(Number);
  const essentialAvgCents = essentialAverage(allExpenses, new Date(y, m - 1, 15)).averageCents;

  const targetRow = db
    .prepare(
      'SELECT target_cents AS targetCents, rollover_cents AS rolloverCents FROM savings_monthly_targets WHERE month = ?',
    )
    .get(month) as { targetCents: number; rolloverCents: number } | undefined;
  const savedThisMonthCents = sumOne(
    db,
    'SELECT COALESCE(SUM(amount_cents),0) AS n FROM emergency_fund_entries WHERE deleted_at IS NULL AND substr(date,1,7) = ?',
    [month],
  );
  const savingsTarget = targetRow
    ? {
        targetCents: targetRow.targetCents,
        savedThisMonthCents,
        rolloverCents: targetRow.rolloverCents,
      }
    : null;

  const goals = targetRows(db, 'goals');
  const specialProjects = targetRows(db, 'special_projects');
  const goalsSavedCents = [...goals, ...specialProjects].reduce((s, t) => s + t.currentCents, 0);
  const proj = projectSavings({
    reserveBalanceCents,
    monthlyTargetCents: targetRow?.targetCents ?? 0,
    goalsSavedCents,
  });

  const cambioRows = (
    db
      .prepare(
        `SELECT date, amount_usd_cents AS amountUsdCents, contracted_rate AS contractedRate,
                ptax_rate AS ptaxRate, iof_cents AS iofCents, bank_fee_cents AS bankFeeCents,
                net_brl_cents AS netBrlCents
         FROM exchange_contracts WHERE deleted_at IS NULL
         ORDER BY id DESC LIMIT 6`,
      )
      .all() as {
      date: string;
      amountUsdCents: number;
      contractedRate: number;
      ptaxRate: number | null;
      iofCents: number;
      bankFeeCents: number;
      netBrlCents: number;
    }[]
  ).reverse();
  const cambioRecent = cambioRows.map((c) => ({
    date: c.date,
    amountUsdCents: c.amountUsdCents,
    contractedRate: c.contractedRate,
    netBrlCents: c.netBrlCents,
    spreadPct:
      calcCambio({
        amountUsdCents: c.amountUsdCents,
        contractedRate: c.contractedRate,
        ptaxRate: c.ptaxRate,
        iofCents: c.iofCents,
        bankFeeCents: c.bankFeeCents,
      }).spreadPct ?? 0,
  }));
  const meanSpreadPct =
    cambioRecent.length > 0
      ? cambioRecent.reduce((s, c) => s + c.spreadPct, 0) / cambioRecent.length
      : null;

  const quoteRows = (
    db
      .prepare(
        `SELECT month, rate, salary_usd_cents AS salaryUsdCents FROM dollar_quotes
         WHERE deleted_at IS NULL ORDER BY month DESC LIMIT 6`,
      )
      .all() as { month: string; rate: number; salaryUsdCents: number | null }[]
  ).reverse();
  const averageRate =
    quoteRows.length > 0 ? quoteRows.reduce((s, q) => s + q.rate, 0) / quoteRows.length : null;

  return {
    month,
    generatedAt: now.toISOString(),
    income,
    expenses: {
      currentMonthCents,
      previousMonthCents,
      essentialCents,
      nonEssentialCents: currentMonthCents - essentialCents,
      byCategory,
    },
    reserve: {
      balanceCents: reserveBalanceCents,
      essentialAvgCents,
      target3Cents: essentialAvgCents * 3,
      target6Cents: essentialAvgCents * 6,
    },
    savingsTarget,
    projection: { endTotalCents: proj.endTotalCents, endSavingsCents: proj.endSavingsCents },
    goals,
    specialProjects,
    cambio: { recent: cambioRecent, meanSpreadPct },
    dollarQuotes: { recent: quoteRows, averageRate },
  };
}
