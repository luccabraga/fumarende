import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { essentialAverage } from '../savings/essential-average.js';
import { calcCambio } from '../cambio/math.js';

export interface StatWithDelta {
  currentCents: number;
  previousCents: number;
}

export interface DashboardSummary {
  month: string;
  previousMonth: string;
  income: StatWithDelta;
  expenses: StatWithDelta & {
    essentialCents: number;
    nonEssentialCents: number;
    byCategory: { category: string; cents: number }[];
  };
  balanceCents: number;
  reserveBalanceCents: number;
  savingsTarget: { targetCents: number; savedThisMonthCents: number } | null;
  installments: {
    nextMonthCommitmentCents: number;
    activeGroups: number;
    earliestEndMonth: string | null;
  };
  recentExpenses: { date: string; description: string; category: string; amountCents: number }[];
  topGoals: { name: string; currentCents: number; targetCents: number; progressPct: number }[];
  evolution: { month: string; incomeCents: number; expensesCents: number }[];
  monthlyClose: { reviewed: boolean; reviewedAt: string | null };
  alerts: { level: 'info' | 'warning' | 'danger'; message: string }[];
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function pct(x: number): number {
  return Math.round(x);
}
function sumCol(
  db: Database.Database,
  table: string,
  col: string,
  where: string,
  params: unknown[] = [],
): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(${col}), 0) AS n FROM ${table} WHERE ${where}`)
    .get(...params) as { n: number };
  return row.n;
}

function latestBackupMs(backupDir: string): number | null {
  try {
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    if (files.length === 0) return null;
    return Math.max(...files.map((f) => fs.statSync(path.join(backupDir, f)).mtimeMs));
  } catch {
    return null;
  }
}

export function dashboardSummary(
  db: Database.Database,
  opts: { now?: Date; month?: string; dataPaths?: { dbPath: string; backupDir: string } } = {},
): DashboardSummary {
  const now = opts.now ?? new Date();
  const month =
    opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : monthKey(now);
  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const todayISO = `${month}-${String(now.getDate()).padStart(2, '0')}`;

  const incomeCurrent = sumCol(
    db,
    'income',
    'amount_brl_cents',
    'substr(date,1,7) = ? AND deleted_at IS NULL',
    [month],
  );
  const incomePrevious = sumCol(
    db,
    'income',
    'amount_brl_cents',
    'substr(date,1,7) = ? AND deleted_at IS NULL',
    [previousMonth],
  );
  const expensesCurrent = sumCol(
    db,
    'expenses',
    'amount_cents',
    'substr(date,1,7) = ? AND deleted_at IS NULL',
    [month],
  );
  const expensesPrevious = sumCol(
    db,
    'expenses',
    'amount_cents',
    'substr(date,1,7) = ? AND deleted_at IS NULL',
    [previousMonth],
  );
  const essentialCents = sumCol(
    db,
    'expenses',
    'amount_cents',
    "substr(date,1,7) = ? AND type = 'essencial' AND deleted_at IS NULL",
    [month],
  );

  const byCategory = db
    .prepare(
      `SELECT category, SUM(amount_cents) AS cents FROM expenses
       WHERE substr(date,1,7) = ? AND deleted_at IS NULL
       GROUP BY category ORDER BY cents DESC, category ASC`,
    )
    .all(month) as { category: string; cents: number }[];

  const reserveBalanceCents = sumCol(
    db,
    'emergency_fund_entries',
    'amount_cents',
    'deleted_at IS NULL',
  );

  const targetRow = db
    .prepare('SELECT target_cents, rollover_cents FROM savings_monthly_targets WHERE month = ?')
    .get(month) as { target_cents: number; rollover_cents: number } | undefined;
  const savedThisMonthCents = sumCol(
    db,
    'emergency_fund_entries',
    'amount_cents',
    'substr(date,1,7) = ? AND deleted_at IS NULL',
    [month],
  );
  const savingsTarget = targetRow
    ? { targetCents: targetRow.target_cents + targetRow.rollover_cents, savedThisMonthCents }
    : null;

  const nextMonthCommitmentCents = sumCol(
    db,
    'expenses',
    'amount_cents',
    'installment_group_id IS NOT NULL AND substr(date,1,7) = ? AND deleted_at IS NULL',
    [nextMonth],
  );
  const activeGroupRows = db
    .prepare(
      `SELECT installment_group_id AS g, MAX(date) AS lastDate FROM expenses
       WHERE installment_group_id IS NOT NULL AND deleted_at IS NULL
       GROUP BY installment_group_id HAVING MAX(date) >= ?`,
    )
    .all(todayISO) as { g: string; lastDate: string }[];
  const activeGroups = activeGroupRows.length;
  const earliestEndMonth =
    activeGroups > 0 ? activeGroupRows.map((r) => r.lastDate.slice(0, 7)).sort()[0] : null;

  const recentExpenses = db
    .prepare(
      `SELECT date, description, category, amount_cents AS amountCents FROM expenses
       WHERE deleted_at IS NULL ORDER BY date DESC, id DESC LIMIT 5`,
    )
    .all() as DashboardSummary['recentExpenses'];

  const topGoals = (
    db
      .prepare(
        `SELECT name, current_cents AS currentCents, target_cents AS targetCents FROM goals
         WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 3`,
      )
      .all() as { name: string; currentCents: number; targetCents: number }[]
  ).map((g) => ({
    ...g,
    progressPct: g.targetCents > 0 ? Math.min((g.currentCents / g.targetCents) * 100, 100) : 0,
  }));

  const evoMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const incomeByMonth = new Map(
    (
      db
        .prepare(
          'SELECT substr(date,1,7) AS m, SUM(amount_brl_cents) AS n FROM income WHERE deleted_at IS NULL GROUP BY m',
        )
        .all() as { m: string; n: number }[]
    ).map((r) => [r.m, r.n]),
  );
  const expensesByMonth = new Map(
    (
      db
        .prepare(
          'SELECT substr(date,1,7) AS m, SUM(amount_cents) AS n FROM expenses WHERE deleted_at IS NULL GROUP BY m',
        )
        .all() as { m: string; n: number }[]
    ).map((r) => [r.m, r.n]),
  );
  const evolution = evoMonths.map((m) => ({
    month: m,
    incomeCents: incomeByMonth.get(m) ?? 0,
    expensesCents: expensesByMonth.get(m) ?? 0,
  }));

  const mcRow = db.prepare('SELECT reviewed_at FROM monthly_close WHERE month = ?').get(month) as
    | { reviewed_at: string }
    | undefined;
  const monthlyClose = { reviewed: Boolean(mcRow), reviewedAt: mcRow?.reviewed_at ?? null };

  const contracts = db
    .prepare(
      `SELECT amount_usd_cents AS amountUsdCents, contracted_rate AS contractedRate,
              ptax_rate AS ptaxRate, iof_cents AS iofCents, bank_fee_cents AS bankFeeCents
       FROM exchange_contracts
       WHERE deleted_at IS NULL AND ptax_rate IS NOT NULL
       ORDER BY id ASC`,
    )
    .all() as {
    amountUsdCents: number;
    contractedRate: number;
    ptaxRate: number;
    iofCents: number;
    bankFeeCents: number;
  }[];
  const spreadPcts = contracts.map(
    (c) =>
      calcCambio({
        amountUsdCents: c.amountUsdCents,
        contractedRate: c.contractedRate,
        ptaxRate: c.ptaxRate,
        iofCents: c.iofCents,
        bankFeeCents: c.bankFeeCents,
      }).spreadPct ?? 0,
  );

  const [anchorY, anchorM] = month.split('-').map(Number);
  const monthAnchor = new Date(anchorY, anchorM - 1, 15);
  const essentialAvgCents = essentialAverage(
    db
      .prepare(
        'SELECT date, amount_cents AS amountCents, type FROM expenses WHERE deleted_at IS NULL',
      )
      .all() as { date: string; amountCents: number; type: string }[],
    monthAnchor,
  ).averageCents;

  const alerts: DashboardSummary['alerts'] = [];

  if (incomeCurrent === 0) {
    alerts.push({ level: 'info', message: 'Adicione suas receitas do mês para começar.' });
  }
  if (incomeCurrent > 0 && expensesCurrent > incomeCurrent * 0.9) {
    alerts.push({
      level: 'danger',
      message: `Gastos em ${pct((expensesCurrent / incomeCurrent) * 100)}% da renda este mês.`,
    });
  }
  if (savingsTarget && savingsTarget.savedThisMonthCents < savingsTarget.targetCents) {
    alerts.push({
      level: 'warning',
      message: `Meta de poupança: ${formatBRL(savingsTarget.savedThisMonthCents)} de ${formatBRL(
        savingsTarget.targetCents,
      )} este mês.`,
    });
  }
  if (reserveBalanceCents <= 0) {
    alerts.push({ level: 'warning', message: 'Reserva de emergência zerada.' });
  }
  if (essentialAvgCents > 0 && reserveBalanceCents < essentialAvgCents * 3) {
    alerts.push({ level: 'warning', message: 'Reserva abaixo de 3 meses de gastos essenciais.' });
  }
  if (spreadPcts.length >= 3) {
    const avg = spreadPcts.reduce((s, v) => s + v, 0) / spreadPcts.length;
    const latest = spreadPcts[spreadPcts.length - 1];
    if (latest - avg > 0.5) {
      alerts.push({
        level: 'warning',
        message: `Último câmbio: spread de ${latest.toFixed(1)}% (média ${avg.toFixed(1)}%).`,
      });
    }
  }
  if (incomeCurrent > 0 && nextMonthCommitmentCents > incomeCurrent * 0.2) {
    alerts.push({
      level: 'warning',
      message: `Parcelas comprometem ${pct(
        (nextMonthCommitmentCents / incomeCurrent) * 100,
      )}% da renda no próximo mês.`,
    });
  }
  if (opts.dataPaths) {
    const ms = latestBackupMs(opts.dataPaths.backupDir);
    if (ms === null) {
      alerts.push({ level: 'info', message: 'Nenhum backup ainda — exporte em Backup & Dados.' });
    } else {
      const daysSince = Math.floor((now.getTime() - ms) / 86_400_000);
      if (daysSince >= 7) {
        alerts.push({ level: 'warning', message: `Último backup há ${daysSince} dias.` });
      }
    }
  }

  return {
    month,
    previousMonth,
    income: { currentCents: incomeCurrent, previousCents: incomePrevious },
    expenses: {
      currentCents: expensesCurrent,
      previousCents: expensesPrevious,
      essentialCents,
      nonEssentialCents: expensesCurrent - essentialCents,
      byCategory,
    },
    balanceCents: incomeCurrent - expensesCurrent,
    reserveBalanceCents,
    savingsTarget,
    installments: { nextMonthCommitmentCents, activeGroups, earliestEndMonth },
    recentExpenses,
    topGoals,
    evolution,
    monthlyClose,
    alerts,
  };
}
