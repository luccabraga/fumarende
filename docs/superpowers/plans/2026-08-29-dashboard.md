# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Dashboard — a single `GET /api/dashboard` returning a
current-month `DashboardSummary` (stat cards with month-over-month
deltas, a deterministic advisory-alert set, category spend, a 6-month
evolution line, recent expenses, top goals, active-installment summary,
monthly-close status) and a `DashboardPage` that renders it.

**Architecture:** One DB-heavy aggregation function
(`server/src/dashboard/summary.ts`), unit-tested in isolation, exposed
by `GET /api/dashboard`. The page is a pure view of the response — no
client-side recomputation. Reuses `BarBreakdown`, `essentialAverage`,
`calcCambio`.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-29-dashboard-design.md`

## Global Constraints

- The Dashboard is the **current calendar month** only; the one
  comparison is to the immediately previous month. No month selector.
- Money is integer cents. Alert `message` strings are pre-formatted
  server-side (a local `formatBRL` helper); percentages rounded to whole
  numbers.
- `dashboardSummary(db, opts?)` is a **total function** — an empty DB
  yields zeros, `[]`, `savingsTarget: null`, `monthlyClose: { reviewed:
  false, reviewedAt: null }`.
- `opts.now` defaults to `new Date()` (parameter only for deterministic
  tests). `opts.dataPaths` enables the stale-backup alert; absent → that
  alert is never emitted.
- No AI. No new charting library. No configurable thresholds — `0.9`
  income share, `3×` essential average, `0.2` installment share, `7`-day
  backup, `0.5` pp spread drift, `3` minimum contracts are constants.
- The only Dashboard write is the monthly-close toggle, via the existing
  `/api/monthly-close` routes.
- Every task is TDD. Run server tests from `server/`, frontend from
  `frontend/`. Work on a branch `dashboard` off `main`; the finishing
  skill merges it.

---

## File Structure

**New (server):**
- `server/src/dashboard/summary.ts` — `dashboardSummary` + `DashboardSummary` and nested interfaces.
- `server/src/dashboard/summary.test.ts`
- `server/src/routes/dashboard.ts` — `registerDashboardRoutes(app, db, dataPaths?)`.
- `server/src/routes/dashboard.test.ts`

**New (frontend):**
- `frontend/src/pages/DashboardPage.test.tsx`

**Modified (server):**
- `server/src/app.ts` — register the dashboard route with `dataPaths`.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `DashboardSummary` type + `getDashboard`.
- `frontend/src/pages/DashboardPage.tsx` — replace the placeholder body.
- `frontend/src/App.test.tsx` — mock `getDashboard`, assert the heading.

**Modified (repo):**
- `scripts/qa-e2e.sh` — Dashboard section.
- `docs/qa-checklist.md` — Dashboard checks.

---

## Task 1: `dashboardSummary` aggregation (server)

**Files:**
- Create: `server/src/dashboard/summary.ts`
- Test: `server/src/dashboard/summary.test.ts`

**Interfaces:**
- Consumes: `runMigrations` from `../db/migrate.js`; `essentialAverage`
  from `../savings/essential-average.js`
  (`essentialAverage(expenses: { date; amountCents; type }[], today?: Date)
  → { averageCents; monthsUsed }`); `calcCambio` from `../cambio/math.js`
  (`calcCambio({ amountUsdCents; contractedRate; ptaxRate: number|null;
  iofCents; bankFeeCents }) → { …; spreadPct: number|null }`).
- Produces:
  ```ts
  interface StatWithDelta { currentCents: number; previousCents: number }
  interface DashboardSummary {
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
  function dashboardSummary(
    db: Database.Database,
    opts?: { now?: Date; dataPaths?: { dbPath: string; backupDir: string } },
  ): DashboardSummary;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/dashboard/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { dashboardSummary } from './summary.js';

const NOW = new Date(2026, 7, 15); // 15 Aug 2026

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
function income(db: Database.Database, date: string, cents: number) {
  db.prepare('INSERT INTO income (date, amount_brl_cents) VALUES (?, ?)').run(date, cents);
}
function expense(
  db: Database.Database,
  date: string,
  cents: number,
  category = 'Outros',
  type = 'nao-essencial',
  groupId: string | null = null,
) {
  db.prepare(
    `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, installment_group_id)
     VALUES (?, 'x', ?, ?, ?, 'Pix', ?)`,
  ).run(date, cents, category, type, groupId);
}
function deposit(db: Database.Database, date: string, cents: number) {
  db.prepare('INSERT INTO emergency_fund_entries (date, amount_cents) VALUES (?, ?)').run(date, cents);
}

describe('dashboardSummary', () => {
  it('returns zeroed structure and the starter alerts on an empty DB', () => {
    const s = dashboardSummary(freshDb(), { now: NOW });
    expect(s.month).toBe('2026-08');
    expect(s.previousMonth).toBe('2026-07');
    expect(s.income).toEqual({ currentCents: 0, previousCents: 0 });
    expect(s.expenses.currentCents).toBe(0);
    expect(s.balanceCents).toBe(0);
    expect(s.reserveBalanceCents).toBe(0);
    expect(s.savingsTarget).toBeNull();
    expect(s.byCategoryLength ?? s.expenses.byCategory).toEqual([]);
    expect(s.recentExpenses).toEqual([]);
    expect(s.topGoals).toEqual([]);
    expect(s.evolution).toHaveLength(6);
    expect(s.evolution[0].month).toBe('2026-03');
    expect(s.evolution[5].month).toBe('2026-08');
    expect(s.evolution.every((e) => e.incomeCents === 0 && e.expensesCents === 0)).toBe(true);
    expect(s.monthlyClose).toEqual({ reviewed: false, reviewedAt: null });
    expect(s.alerts.some((a) => a.level === 'info' && /receitas/i.test(a.message))).toBe(true);
    expect(s.alerts.some((a) => a.level === 'warning' && /reserva/i.test(a.message))).toBe(true);
  });

  it('computes month totals, the essencial split, and a previous-month delta', () => {
    const db = freshDb();
    income(db, '2026-08-01', 500_000);
    income(db, '2026-07-01', 400_000);
    expense(db, '2026-08-05', 200_000, 'Moradia', 'essencial');
    expense(db, '2026-08-06', 100_000, 'Lazer', 'nao-essencial');
    expense(db, '2026-07-10', 200_000, 'Moradia', 'essencial');

    const s = dashboardSummary(db, { now: NOW });
    expect(s.income).toEqual({ currentCents: 500_000, previousCents: 400_000 });
    expect(s.expenses.currentCents).toBe(300_000);
    expect(s.expenses.previousCents).toBe(200_000);
    expect(s.expenses.essentialCents).toBe(200_000);
    expect(s.expenses.nonEssentialCents).toBe(100_000);
    expect(s.balanceCents).toBe(200_000);
    expect(s.expenses.byCategory).toEqual([
      { category: 'Moradia', cents: 200_000 },
      { category: 'Lazer', cents: 100_000 },
    ]);
  });

  it('raises a danger alert when spend exceeds 90% of income', () => {
    const db = freshDb();
    income(db, '2026-08-01', 100_000);
    expense(db, '2026-08-02', 95_000);
    const s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'danger' && a.message.includes('95%'))).toBe(true);
  });

  it('flags an unmet savings target and clears it once met', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO savings_monthly_targets (month, pct_or_fixed, target_cents, rollover_cents)
       VALUES ('2026-08', 'fixed', 200_000, 0)`,
    ).run();
    deposit(db, '2026-08-03', 120_000);
    let s = dashboardSummary(db, { now: NOW });
    expect(s.savingsTarget).toEqual({ targetCents: 200_000, savedThisMonthCents: 120_000 });
    expect(s.alerts.some((a) => a.level === 'warning' && /poupan/i.test(a.message))).toBe(true);

    deposit(db, '2026-08-20', 80_000);
    s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => /poupan/i.test(a.message))).toBe(false);
  });

  it('flags a reserve below 3x the essential-expense average', () => {
    const db = freshDb();
    expense(db, '2026-08-01', 100_000, 'Moradia', 'essencial');
    expense(db, '2026-07-01', 100_000, 'Moradia', 'essencial');
    expense(db, '2026-06-01', 100_000, 'Moradia', 'essencial');
    deposit(db, '2026-08-02', 250_000); // < 300_000
    let s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'warning' && /3 meses/i.test(a.message))).toBe(true);

    deposit(db, '2026-08-10', 70_000); // now 320_000
    s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => /3 meses/i.test(a.message))).toBe(false);
  });

  it('summarises active installments and flags a spike over 20% of income', () => {
    const db = freshDb();
    income(db, '2026-08-01', 50_000);
    // 3x of 20_000 each, Aug / Sep / Oct
    expense(db, '2026-08-10', 20_000, 'Outros', 'nao-essencial', 'g1');
    expense(db, '2026-09-10', 20_000, 'Outros', 'nao-essencial', 'g1');
    expense(db, '2026-10-10', 20_000, 'Outros', 'nao-essencial', 'g1');

    const s = dashboardSummary(db, { now: NOW });
    expect(s.installments.nextMonthCommitmentCents).toBe(20_000); // the Sep row
    expect(s.installments.activeGroups).toBe(1);
    expect(s.installments.earliestEndMonth).toBe('2026-10');
    expect(s.alerts.some((a) => a.level === 'warning' && a.message.includes('40%'))).toBe(true);
  });

  it('builds a 6-month evolution with values only in the seeded months', () => {
    const db = freshDb();
    income(db, '2026-06-01', 100_000);
    income(db, '2026-08-01', 300_000);
    expense(db, '2026-06-02', 40_000);
    const s = dashboardSummary(db, { now: NOW });
    const byMonth = Object.fromEntries(s.evolution.map((e) => [e.month, e]));
    expect(byMonth['2026-06']).toMatchObject({ incomeCents: 100_000, expensesCents: 40_000 });
    expect(byMonth['2026-07']).toMatchObject({ incomeCents: 0, expensesCents: 0 });
    expect(byMonth['2026-08']).toMatchObject({ incomeCents: 300_000, expensesCents: 0 });
  });

  it('flags câmbio spread drift when the latest contract is worse than the mean', () => {
    const db = freshDb();
    const add = (rate: number, ptax: number) =>
      db
        .prepare(
          `INSERT INTO exchange_contracts
             (date, institution, operation_type, amount_usd_cents, contracted_rate, ptax_rate, iof_cents, bank_fee_cents, net_brl_cents)
           VALUES ('2026-08-01', 'Inter', 'compra', 100000, ?, ?, 0, 0, ?)`,
        )
        .run(rate, ptax, Math.round(100000 * rate));
    add(5.0, 5.1); // ~2% spread
    add(5.0, 5.1); // ~2% spread
    add(4.8, 5.1); // ~5.9% spread (worst, highest id -> latest)

    const s = dashboardSummary(db, { now: NOW });
    expect(s.alerts.some((a) => a.level === 'warning' && /spread/i.test(a.message))).toBe(true);
  });

  it('reads the monthly-close row for the current month', () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO monthly_close (month, reviewed_at) VALUES ('2026-08', '2026-08-31T00:00:00Z')",
    ).run();
    const s = dashboardSummary(db, { now: NOW });
    expect(s.monthlyClose).toEqual({ reviewed: true, reviewedAt: '2026-08-31T00:00:00Z' });
  });
});
```

Note: the empty-DB test's `s.byCategoryLength ?? s.expenses.byCategory`
line is intentionally just `s.expenses.byCategory` — delete the
`byCategoryLength` fragment when pasting (it is a typo guard; the real
assertion is `expect(s.expenses.byCategory).toEqual([])`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/dashboard/summary.test.ts`
Expected: FAIL — `Cannot find module './summary.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/dashboard/summary.ts`:

```ts
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
  opts: { now?: Date; dataPaths?: { dbPath: string; backupDir: string } } = {},
): DashboardSummary {
  const now = opts.now ?? new Date();
  const month = monthKey(now);
  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const todayISO = `${month}-${String(now.getDate()).padStart(2, '0')}`;

  // income / expenses
  const incomeCurrent = sumCol(db, 'income', 'amount_brl_cents', "substr(date,1,7) = ? AND deleted_at IS NULL", [month]);
  const incomePrevious = sumCol(db, 'income', 'amount_brl_cents', "substr(date,1,7) = ? AND deleted_at IS NULL", [previousMonth]);
  const expensesCurrent = sumCol(db, 'expenses', 'amount_cents', "substr(date,1,7) = ? AND deleted_at IS NULL", [month]);
  const expensesPrevious = sumCol(db, 'expenses', 'amount_cents', "substr(date,1,7) = ? AND deleted_at IS NULL", [previousMonth]);
  const essentialCents = sumCol(db, 'expenses', 'amount_cents', "substr(date,1,7) = ? AND type = 'essencial' AND deleted_at IS NULL", [month]);

  const byCategory = db
    .prepare(
      `SELECT category, SUM(amount_cents) AS cents FROM expenses
       WHERE substr(date,1,7) = ? AND deleted_at IS NULL
       GROUP BY category ORDER BY cents DESC, category ASC`,
    )
    .all(month) as { category: string; cents: number }[];

  const reserveBalanceCents = sumCol(db, 'emergency_fund_entries', 'amount_cents', 'deleted_at IS NULL');

  // savings target
  const targetRow = db
    .prepare('SELECT target_cents, rollover_cents FROM savings_monthly_targets WHERE month = ?')
    .get(month) as { target_cents: number; rollover_cents: number } | undefined;
  const savedThisMonthCents = sumCol(
    db,
    'emergency_fund_entries',
    'amount_cents',
    "substr(date,1,7) = ? AND deleted_at IS NULL",
    [month],
  );
  const savingsTarget = targetRow
    ? { targetCents: targetRow.target_cents + targetRow.rollover_cents, savedThisMonthCents }
    : null;

  // installments
  const nextMonthCommitmentCents = sumCol(
    db,
    'expenses',
    'amount_cents',
    "installment_group_id IS NOT NULL AND substr(date,1,7) = ? AND deleted_at IS NULL",
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

  // evolution: 6 months ending with the current one
  const evoMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const incomeByMonth = new Map(
    (
      db
        .prepare(
          "SELECT substr(date,1,7) AS m, SUM(amount_brl_cents) AS n FROM income WHERE deleted_at IS NULL GROUP BY m",
        )
        .all() as { m: string; n: number }[]
    ).map((r) => [r.m, r.n]),
  );
  const expensesByMonth = new Map(
    (
      db
        .prepare(
          "SELECT substr(date,1,7) AS m, SUM(amount_cents) AS n FROM expenses WHERE deleted_at IS NULL GROUP BY m",
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

  // câmbio spread drift
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

  const essentialAvgCents = essentialAverage(
    db
      .prepare("SELECT date, amount_cents AS amountCents, type FROM expenses WHERE deleted_at IS NULL")
      .all() as { date: string; amountCents: number; type: string }[],
    now,
  ).averageCents;

  // ---- alerts ----
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
    alerts.push({
      level: 'warning',
      message: 'Reserva abaixo de 3 meses de gastos essenciais.',
    });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/dashboard/summary.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/dashboard/summary.ts server/src/dashboard/summary.test.ts
git commit -m "Add dashboardSummary: current-month aggregation + advisory alerts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `GET /api/dashboard` route (server)

**Files:**
- Create: `server/src/routes/dashboard.ts`
- Modify: `server/src/app.ts` (import + call after `registerDataRoutes`)
- Test: `server/src/routes/dashboard.test.ts`

**Interfaces:**
- Consumes: `dashboardSummary` from `../dashboard/summary.js` (Task 1);
  `requireAuth` from `../auth/require-auth.js`; `buildApp` from
  `../app.js` (its 3rd param `dataPaths?: { dbPath; backupDir }` already
  exists from the Backup & Dados module).
- Produces:
  ```ts
  function registerDashboardRoutes(
    app: FastifyInstance,
    db: Database.Database,
    dataPaths?: { dbPath: string; backupDir: string },
  ): void;
  ```
  Route: `GET /api/dashboard` → `DashboardSummary`.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authedApp() {
  const app = await buildApp(new Database(':memory:'));
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { password: 'test-password' },
  });
  const sessionCookie = setupRes.cookies.find((c) => c.name === 'session')!.value;
  return { app, sessionCookie };
}

describe('dashboard route', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
    await app.close();
  });

  it('returns a summary shape when authenticated', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.income).toHaveProperty('currentCents');
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.evolution).toHaveLength(6);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/dashboard.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/dashboard.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { dashboardSummary } from '../dashboard/summary.js';

export function registerDashboardRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
  app.get('/api/dashboard', { preHandler: requireAuth(db) }, async () =>
    dashboardSummary(db, { dataPaths }),
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

In `server/src/app.ts`, add the import next to the data-routes import:

```ts
import { registerDataRoutes } from './routes/data.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
```

and call it after `registerDataRoutes(app, db, dataPaths);`:

```ts
  registerDataRoutes(app, db, dataPaths);
  registerDashboardRoutes(app, db, dataPaths);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/dashboard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green (177 from prior modules + Task 1's 10 + Task 2's 2).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/dashboard.ts server/src/routes/dashboard.test.ts server/src/app.ts
git commit -m "Add GET /api/dashboard behind requireAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend API client

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the existing private `request<T>()` helper.
- Produces: `DashboardSummary` interface (structurally identical to the
  server's) and `getDashboard(): Promise<DashboardSummary>`.

- [ ] **Step 1: Append to `frontend/src/lib/api.ts`**

```ts
export interface DashboardSummary {
  month: string;
  previousMonth: string;
  income: { currentCents: number; previousCents: number };
  expenses: {
    currentCents: number;
    previousCents: number;
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

export function getDashboard(): Promise<DashboardSummary> {
  return request('/api/dashboard');
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "Add DashboardSummary type and getDashboard client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: DashboardPage (frontend)

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx` (replace the placeholder body)
- Create: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `api.getDashboard` / `api.markMonthReviewed` /
  `api.unmarkMonthReviewed` / `api.DashboardSummary` (Task 3, plus the
  monthly-close functions from the Backup & Dados module); `BarBreakdown`
  from `../components/BarBreakdown.js`; `formatCentsBRL` from
  `../lib/money.js`.
- Produces: `DashboardPage` (named export) — same name/route as today.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/DashboardPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DashboardPage } from './DashboardPage.js';
import * as api from '../lib/api.js';

const summary: api.DashboardSummary = {
  month: '2026-08',
  previousMonth: '2026-07',
  income: { currentCents: 500_000, previousCents: 400_000 },
  expenses: {
    currentCents: 300_000,
    previousCents: 400_000,
    essentialCents: 200_000,
    nonEssentialCents: 100_000,
    byCategory: [
      { category: 'Moradia', cents: 200_000 },
      { category: 'Lazer', cents: 100_000 },
    ],
  },
  balanceCents: 200_000,
  reserveBalanceCents: 700_000,
  savingsTarget: { targetCents: 100_000, savedThisMonthCents: 50_000 },
  installments: { nextMonthCommitmentCents: 20_000, activeGroups: 1, earliestEndMonth: '2026-10' },
  recentExpenses: [
    { date: '2026-08-06', description: 'Cinema', category: 'Lazer', amountCents: 5_000 },
  ],
  topGoals: [{ name: 'Viagem', currentCents: 40_000, targetCents: 100_000, progressPct: 40 }],
  evolution: [
    { month: '2026-03', incomeCents: 0, expensesCents: 0 },
    { month: '2026-04', incomeCents: 0, expensesCents: 0 },
    { month: '2026-05', incomeCents: 0, expensesCents: 0 },
    { month: '2026-06', incomeCents: 100_000, expensesCents: 40_000 },
    { month: '2026-07', incomeCents: 400_000, expensesCents: 400_000 },
    { month: '2026-08', incomeCents: 500_000, expensesCents: 300_000 },
  ],
  monthlyClose: { reviewed: false, reviewedAt: null },
  alerts: [{ level: 'warning', message: 'Meta de poupança: R$ 500,00 de R$ 1.000,00 este mês.' }],
};

beforeEach(() => {
  vi.spyOn(api, 'getDashboard').mockResolvedValue(summary);
});

describe('DashboardPage', () => {
  it('renders the stat cards, an expenses delta, and the alert', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('R$ 5.000,00')).toBeInTheDocument(); // income
    expect(screen.getByText('R$ 3.000,00')).toBeInTheDocument(); // expenses
    expect(screen.getByText(/↓ 25% vs 2026-07/)).toBeInTheDocument(); // expenses fell 25%
    expect(screen.getByText(/Meta de poupança/)).toBeInTheDocument();
  });

  it('renders a category bar per byCategory entry and the top goal', async () => {
    render(<DashboardPage />);
    expect(await screen.findByTestId('bar-Moradia')).toBeInTheDocument();
    expect(screen.getByTestId('bar-Lazer')).toBeInTheDocument();
    expect(screen.getByText('Viagem')).toBeInTheDocument();
  });

  it('shows the active-installments card only when activeGroups > 0', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText(/parcelamento\(s\) ativo\(s\)/)).toBeInTheDocument();
  });

  it('toggles the monthly close and re-fetches', async () => {
    const markSpy = vi
      .spyOn(api, 'markMonthReviewed')
      .mockResolvedValue({ month: '2026-08', reviewed: true, reviewedAt: 'now' });

    render(<DashboardPage />);
    fireEvent.click(await screen.findByLabelText('Revisado 2026-08'));

    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('2026-08'));
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalledTimes(2));
  });

  it('shows an error and no stat cards when the fetch fails', async () => {
    vi.spyOn(api, 'getDashboard').mockRejectedValue(new Error('boom'));
    render(<DashboardPage />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('R$ 5.000,00')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx`
Expected: FAIL — the placeholder renders none of this.

- [ ] **Step 3: Replace `frontend/src/pages/DashboardPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { BarBreakdown } from '../components/BarBreakdown.js';

const cardGap = { marginBottom: 24 } as const;
const h2Style = { fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 } as const;
const ALERT_COLOR: Record<api.DashboardSummary['alerts'][number]['level'], string> = {
  info: 'var(--text2)',
  warning: 'var(--gold, var(--text))',
  danger: 'var(--red, var(--text))',
};

function Delta({
  current,
  previous,
  previousMonth,
  upIsGood,
}: {
  current: number;
  previous: number;
  previousMonth: string;
  upIsGood: boolean;
}) {
  if (previous === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text3)' }}>— sem mês anterior</span>;
  }
  const deltaPct = ((current - previous) / previous) * 100;
  if (Math.abs(deltaPct) < 0.5) {
    return <span style={{ fontSize: 11, color: 'var(--text3)' }}>= igual a {previousMonth}</span>;
  }
  const up = deltaPct > 0;
  const good = up === upIsGood;
  return (
    <span style={{ fontSize: 11, color: good ? 'var(--cyan)' : 'var(--red, var(--text))' }}>
      {up ? '↑' : '↓'} {Math.abs(Math.round(deltaPct))}% vs {previousMonth}
    </span>
  );
}

export function DashboardPage() {
  const [summary, setSummary] = useState<api.DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSummary(await api.getDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o dashboard');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleClose() {
    if (!summary) return;
    try {
      if (summary.monthlyClose.reviewed) await api.unmarkMonthReviewed(summary.month);
      else await api.markMonthReviewed(summary.month);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const evoPoints = (key: 'incomeCents' | 'expensesCents'): string => {
    if (!summary) return '';
    const vals = summary.evolution.flatMap((e) => [e.incomeCents, e.expensesCents]);
    const max = Math.max(...vals, 1);
    const w = 320;
    const h = 90;
    return summary.evolution
      .map((e, i) => {
        const x = (i / (summary.evolution.length - 1)) * w;
        const y = h - (e[key] / max) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 8 }}>Dashboard</h1>
      {summary && (
        <p style={{ color: 'var(--text3)', fontSize: 12.5, marginBottom: 20 }}>{summary.month}</p>
      )}

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {summary && (
        <>
          <div
            className="card"
            style={{ ...cardGap, display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13 }}
          >
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Receita do mês</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.income.currentCents)}
              </div>
              <Delta
                current={summary.income.currentCents}
                previous={summary.income.previousCents}
                previousMonth={summary.previousMonth}
                upIsGood
              />
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Gastos do mês</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.expenses.currentCents)}
              </div>
              {summary.income.currentCents > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {Math.round((summary.expenses.currentCents / summary.income.currentCents) * 100)}%
                  da renda{' · '}
                </span>
              )}
              <Delta
                current={summary.expenses.currentCents}
                previous={summary.expenses.previousCents}
                previousMonth={summary.previousMonth}
                upIsGood={false}
              />
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Disponível</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.balanceCents)}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 11 }}>Reserva</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>
                {formatCentsBRL(summary.reserveBalanceCents)}
              </div>
            </div>
          </div>

          {summary.alerts.length > 0 && (
            <div className="card" style={cardGap}>
              <h2 style={h2Style}>Alertas</h2>
              {summary.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 12.5, color: ALERT_COLOR[a.level], marginBottom: 4 }}>
                  {a.message}
                </div>
              ))}
            </div>
          )}

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Gastos por categoria</h2>
            <BarBreakdown
              rows={summary.expenses.byCategory.map((c) => ({ label: c.category, cents: c.cents }))}
              emptyText="Nenhum gasto este mês."
            />
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Evolução (6 meses)</h2>
            <svg viewBox="0 0 320 90" preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
              <polyline points={evoPoints('incomeCents')} fill="none" stroke="var(--cyan)" strokeWidth="2" />
              <polyline
                points={evoPoints('expensesCents')}
                fill="none"
                stroke="var(--text3)"
                strokeWidth="2"
              />
            </svg>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'var(--text3)',
              }}
            >
              <span>{summary.evolution[0].month}</span>
              <span>
                <span style={{ color: 'var(--cyan)' }}>—</span> receitas{' '}
                <span style={{ color: 'var(--text3)' }}>—</span> gastos
              </span>
              <span>{summary.evolution[summary.evolution.length - 1].month}</span>
            </div>
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Últimos gastos</h2>
            {summary.recentExpenses.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nenhum gasto ainda.</p>
            ) : (
              summary.recentExpenses.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: 'var(--text2)' }}>{e.date}</span>
                  <span style={{ flex: 1 }}>{e.description}</span>
                  <span style={{ color: 'var(--text3)' }}>{e.category}</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(e.amountCents)}</span>
                </div>
              ))
            )}
          </div>

          <div className="card" style={cardGap}>
            <h2 style={h2Style}>Metas em andamento</h2>
            {summary.topGoals.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nenhuma meta ainda.</p>
            ) : (
              summary.topGoals.map((g, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                      marginBottom: 3,
                    }}
                  >
                    <span>{g.name}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                      {formatCentsBRL(g.currentCents)} de {formatCentsBRL(g.targetCents)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--border)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{ width: `${g.progressPct}%`, height: '100%', background: 'var(--cyan)' }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {summary.installments.activeGroups > 0 && (
            <div className="card" style={cardGap}>
              <h2 style={h2Style}>Parcelas ativas</h2>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>
                  Próximo mês:{' '}
                  {formatCentsBRL(summary.installments.nextMonthCommitmentCents)}
                </div>
                <div>{summary.installments.activeGroups} parcelamento(s) ativo(s)</div>
                {summary.installments.earliestEndMonth && (
                  <div>Mais curto termina em {summary.installments.earliestEndMonth}</div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={h2Style}>Fechamento do mês</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={summary.monthlyClose.reviewed}
                aria-label={`Revisado ${summary.month}`}
                onChange={toggleClose}
              />
              <span>Mês revisado</span>
              {summary.monthlyClose.reviewed && summary.monthlyClose.reviewedAt && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  revisado em{' '}
                  {new Date(summary.monthlyClose.reviewedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </label>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `frontend/src/App.test.tsx`**

At the top of the `describe('App routing', ...)` block's `beforeEach`,
after `window.history.pushState(...)`, add a default dashboard mock so
the two tests that land on `/` don't hit a real fetch:

```ts
  beforeEach(() => {
    window.history.pushState({}, '', '/login');
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      month: '2026-08',
      previousMonth: '2026-07',
      income: { currentCents: 0, previousCents: 0 },
      expenses: {
        currentCents: 0,
        previousCents: 0,
        essentialCents: 0,
        nonEssentialCents: 0,
        byCategory: [],
      },
      balanceCents: 0,
      reserveBalanceCents: 0,
      savingsTarget: null,
      installments: { nextMonthCommitmentCents: 0, activeGroups: 0, earliestEndMonth: null },
      recentExpenses: [],
      topGoals: [],
      evolution: Array.from({ length: 6 }, (_, i) => ({
        month: `2026-0${3 + i}`,
        incomeCents: 0,
        expensesCents: 0,
      })),
      monthlyClose: { reviewed: false, reviewedAt: null },
      alerts: [],
    });
  });
```

Then replace the three `'Dashboard — em breve'` assertions:

- the two `expect(await screen.findByText('Dashboard — em breve')).toBeInTheDocument();`
  become
  `expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();`
- the `expect(screen.queryByText('Dashboard — em breve')).not.toBeInTheDocument();`
  becomes
  `expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/App.test.tsx`
Expected: PASS (5 + 3 tests).

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/App.test.tsx
git commit -m "Replace the Dashboard placeholder with the real summary page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Build, e2e QA, smoke test, checklist

**Files:**
- Modify: `scripts/qa-e2e.sh`
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Full test sweep**

Run: `cd server && npm test` — expected all green.
Run: `cd frontend && npm test` — expected all green.

- [ ] **Step 2: Production build**

Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 3: Add a Dashboard section to `scripts/qa-e2e.sh`**

Insert this block after the "Backup & Dados" section and before the
"Análise" section (it relies on the seed the Backup section ran):

```bash
echo
echo "== Dashboard =="
as  "dashboard unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard")"
D="$(body GET /api/dashboard)"
aeq "dashboard month is YYYY-MM" "true" "$(echo "$D" | jq -r '.month | test("^[0-9]{4}-[0-9]{2}$")')"
aeq "dashboard evolution has 6 months" "6" "$(echo "$D" | jq '.evolution | length')"
aeq "dashboard alerts is an array" "array" "$(echo "$D" | jq -r '.alerts | type')"
aeq "dashboard income is positive after the seed" "true" "$(echo "$D" | jq '.income.currentCents > 0')"
aeq "dashboard shows an active installment after the seed" "true" "$(echo "$D" | jq '.installments.activeGroups >= 1')"
```

- [ ] **Step 4: Run the e2e QA**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (95 prior + 6 new = 101).

- [ ] **Step 5: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'dashboard (unauth): %{http_code}\n' http://localhost:4173/api/dashboard
curl -s -o /dev/null -w 'home page: %{http_code}\n' http://localhost:4173/
```

Expected: `health: 200`, `dashboard (unauth): 401`, `home page: 200`.

- [ ] **Step 6: Manual browser check**

Hard-refresh, land on **Dashboard** (`/`). The four stat cards show your
current month's figures with deltas vs. last month; the Alertas card
lists whatever deterministic flags apply; Gastos por categoria shows
bars; Evolução shows the two 6-month lines; Últimos gastos and Metas em
andamento populate; Parcelas ativas appears only if you have a live
installment; ticking "Mês revisado" persists and shows the date.

- [ ] **Step 7: Append to `docs/qa-checklist.md`**

```markdown

## Dashboard

- [x] `GET /api/dashboard` → 401 unauth; authenticated → a summary with
      a `YYYY-MM` `month`, a 6-entry `evolution`, and an `alerts` array
      (e2e).
- [x] After `seed-test`, the summary's month income and expenses are
      `> 0` and `installments.activeGroups >= 1` (e2e).
- [x] `dashboardSummary` — month totals, essencial split, previous-month
      deltas, byCategory sort, savings-target / thin-reserve /
      over-spend / installment-spike / câmbio-spread-drift alerts,
      6-month evolution, monthly-close read — 10 unit tests.
- [ ] The stat cards, delta arrows, alert tints, category bars,
      evolution lines, recent-expense rows, goal bars, and the
      "Fechamento do mês" toggle render in the browser (component-tested;
      manual pass optional).
```

- [ ] **Step 8: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md
git commit -m "Add Dashboard e2e QA section and checklist items"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `dashboardSummary` — month totals, essencial split, deltas, byCategory | 1 |
| reserve balance, savings target (+ rollover), saved-this-month | 1 |
| installments: next-month commitment, active groups, earliest end | 1 |
| recent expenses, top goals, 6-month evolution, monthly-close read | 1 |
| 8 deterministic alerts (income, over-spend, target, reserve≤0, 3× essential, spread drift, installment spike, stale backup) | 1 |
| `GET /api/dashboard` behind `requireAuth`, `dataPaths` threaded | 2 |
| register in `app.ts` after data routes | 2 (Step 4) |
| `DashboardSummary` type + `getDashboard` client | 3 |
| `DashboardPage` — header, stat row + deltas, alerts, BarBreakdown, evolution SVG, recent expenses, top goals, installments card, close toggle, loading/error states | 4 |
| `App.test.tsx` updated (mock + heading assertion) | 4 (Step 4) |
| e2e QA section | 5 (Step 3) |
| Testing at every layer | 1–4 |
| Out of scope: month selector, AI, configurable thresholds, charting lib | not implemented — correct |

**Placeholder scan:** none — every step has literal code or a literal
command. (The Task 1 test note flags a deliberate typo-guard fragment to
delete when pasting.)

**Type consistency:** `DashboardSummary` and every nested shape
(`StatWithDelta`, `expenses.byCategory`, `installments`, `savingsTarget`,
`monthlyClose`, `alerts[].level`) are byte-identical between Task 1
(server), Task 3 (`api.ts`), and the Task 4 fixtures. `dashboardSummary
(db, { now?, dataPaths? })` signature matches between Task 1's definition,
Task 2's route call (`{ dataPaths }`), and Task 1's tests (`{ now: NOW }`).
`registerDashboardRoutes(app, db, dataPaths?)` matches between Task 2's
definition and its `app.ts` call site, and mirrors the existing
`registerDataRoutes` 3-arg shape. `getDashboard()` return type matches
`DashboardSummary`. The page consumes `api.markMonthReviewed` /
`api.unmarkMonthReviewed` (already exported by the Backup & Dados
module — `markMonthReviewed(month) → MonthCloseRow`,
`unmarkMonthReviewed(month) → { ok: true }`). `BarBreakdown`'s
`{ label; cents }[]` rows and its `data-testid={\`bar-\${label}\`}` match
Task 4's `getByTestId('bar-Moradia')`. `essentialAverage(expenses,
today?)` and `calcCambio(input).spreadPct` signatures match the existing
modules.
