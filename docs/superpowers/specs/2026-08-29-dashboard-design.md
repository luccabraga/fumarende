# fumarende — Dashboard module design

> Follow-up #7 (the last Phase 1 module) to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle.

## Context

Every other module is built: Receitas, Câmbio, Gastos + Parcelas +
Gastos Fixos, Reserva, Metas + Projetos Especiais, Análise, Histórico
Dólar, Backup & Dados. The Dashboard (`/` in the nav) is the home
screen — a **current-month overview** that aggregates the other modules,
surfaces deterministic advisory alerts, shows upcoming installment
commitment, and carries the soft monthly-close status.

Behaviour reference: the prototype's `stack-project/prototype/stacks.html`
`renderDashboard` — stat cards with month-over-month deltas, an alert
list, a category bar chart, a 6-month income/expense evolution line, the
5 most recent expenses, the top goals, and an "active installments"
card. Adapted to fumarende's server+SQLite model and to having no month
selector (the Dashboard is always the **current calendar month**).

The `DashboardPage` component already exists as a placeholder ("Dashboard
— em breve") and `App.tsx` routes `/` to it; this replaces its body.
`App.test.tsx` asserts that placeholder text in three router tests — it
is updated to assert the real heading and to mock the new endpoint.

## Goals

- A single `GET /api/dashboard` returning a fully-computed
  `DashboardSummary` for the current calendar month, so the page is one
  round-trip and one pure view.
- Stat cards: month income, month expenses (+ % of income), month
  balance, reserve balance — each with a delta vs. the previous month.
- A deterministic **advisory alert** set (no AI) — over-spend, unmet
  savings target, thin reserve, câmbio spread drift, installment spike,
  stale backup.
- Reused visuals: the `BarBreakdown` component for category spend; an
  inline-SVG dual line for the 6-month evolution.
- Recent expenses, top goals, an active-installments summary, and the
  current month's monthly-close status with a toggle.

## Non-goals (this pass)

- **No month selector.** The Dashboard is the current calendar month
  only; the one comparison is to the immediately previous month.
- **No AI.** Every alert is a threshold rule over stored data.
- **No configurable thresholds** — the alert cutoffs (90% of income,
  3× essential average, 20% installment share, 7-day backup) are
  constants.
- **No new charting library** — inline SVG, as in Análise / Histórico
  Dólar.
- **No writes from the Dashboard** except the monthly-close toggle,
  which reuses the existing `/api/monthly-close` routes.

## Architecture

A DB-heavy aggregation function in its own module, exposed by one route.
Unlike Análise (which recomputes client-side from list endpoints), the
Dashboard's inputs span two months of income/expenses, a 6-month
window, installment analysis, and backup-file recency — cheaper and
cleaner to compute once in SQL server-side. There is **no mirrored
frontend copy**: `DashboardPage` renders the response directly.

### Server

**`server/src/dashboard/summary.ts`** — one function, pure but for the
DB read.

```ts
interface StatWithDelta {
  currentCents: number;
  previousCents: number;
}
interface DashboardSummary {
  month: string;            // current YYYY-MM
  previousMonth: string;

  income: StatWithDelta;
  expenses: StatWithDelta & {
    essentialCents: number;         // current month
    nonEssentialCents: number;      // current month
    byCategory: { category: string; cents: number }[];   // current month, desc by cents
  };
  balanceCents: number;             // income.currentCents - expenses.currentCents
  reserveBalanceCents: number;      // all-time Σ emergency_fund_entries.amount_cents

  savingsTarget: {
    targetCents: number;            // current month's savings_monthly_targets.target_cents (+ rollover)
    savedThisMonthCents: number;    // Σ emergency_fund_entries.amount_cents for the current month
  } | null;                         // null when no target row exists for the month

  installments: {
    nextMonthCommitmentCents: number;  // Σ amount_cents of installment rows dated in the NEXT calendar month
    activeGroups: number;              // distinct installment_group_id with any row dated >= today
    earliestEndMonth: string | null;   // min over active groups of (that group's latest row's month)
  };

  recentExpenses: {
    date: string;
    description: string;
    category: string;
    amountCents: number;
  }[];                              // 5 most recent, all-time

  topGoals: {
    name: string;
    currentCents: number;
    targetCents: number;
    progressPct: number;           // min(current/target*100, 100); 0 when target is 0
  }[];                             // 3 most recently created goals

  evolution: {
    month: string;
    incomeCents: number;
    expensesCents: number;
  }[];                             // 6 months ending with the current one, ascending

  monthlyClose: {
    reviewed: boolean;
    reviewedAt: string | null;
  };                               // for the current month

  alerts: {
    level: 'info' | 'warning' | 'danger';
    message: string;
  }[];
}

function dashboardSummary(
  db: Database.Database,
  opts?: { now?: Date; dataPaths?: { dbPath: string; backupDir: string } },
): DashboardSummary;
```

`opts.now` defaults to `new Date()` (a parameter only for deterministic
tests). `opts.dataPaths`, when given, enables the stale-backup alert.

Computation notes:

- `month = YYYY-MM of now`; `previousMonth` = one calendar month before;
  `nextMonth` = one calendar month after; the six `evolution` months are
  `[month-5 … month]`.
- **income / expenses per month**: `SELECT COALESCE(SUM(amount_brl_cents),
  0) FROM income WHERE substr(date,1,7) = ? AND deleted_at IS NULL`
  (analogous for `expenses.amount_cents`). `essentialCents` filters
  `type = 'essencial'`.
- **byCategory**: group current-month non-deleted expenses by `category`,
  sum, sort `cents` desc then `category` asc.
- **reserveBalanceCents**: `COALESCE(SUM(amount_cents), 0)` over
  non-deleted `emergency_fund_entries` (all time).
- **savingsTarget**: read the `savings_monthly_targets` row for `month`;
  if present, `targetCents = target_cents + rollover_cents`;
  `savedThisMonthCents` = Σ `emergency_fund_entries.amount_cents` for
  `month`. `null` if no row — the Dashboard never creates one.
- **installments.nextMonthCommitmentCents**: `Σ amount_cents` of
  `expenses` where `installment_group_id IS NOT NULL` and
  `substr(date,1,7) = nextMonth` and `deleted_at IS NULL`.
- **installments.activeGroups**: `COUNT(DISTINCT installment_group_id)`
  where `installment_group_id IS NOT NULL` and the group has any row
  with `date >= <today YYYY-MM-DD>` and `deleted_at IS NULL`.
- **installments.earliestEndMonth**: over those active groups,
  `MIN(group's MAX(date))` → its `YYYY-MM`; `null` when no active
  groups.
- **recentExpenses**: `... ORDER BY date DESC, id DESC LIMIT 5`.
- **topGoals**: `SELECT name, current_cents, target_cents FROM goals
  WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 3`.
- **evolution**: one grouped query each for income and expenses over the
  six-month span, then zip into the ordered month list (missing months →
  `0`).
- **monthlyClose**: the `monthly_close` row for `month` →
  `{ reviewed: row != null, reviewedAt: row?.reviewed_at ?? null }`.

**Alerts** (evaluated in this order; each independent):

1. `income.currentCents === 0` → `info`, "Adicione suas receitas do mês
   para começar."
2. `income.currentCents > 0 && expenses.currentCents > income.currentCents
   * 0.9` → `danger`, "Gastos em {pct}% da renda este mês."
3. `savingsTarget && savingsTarget.savedThisMonthCents <
   savingsTarget.targetCents` → `warning`, "Meta de poupança: {saved} de
   {target} este mês."
4. `reserveBalanceCents <= 0` → `warning`, "Reserva de emergência
   zerada."
5. `essentialAvgCents > 0 && reserveBalanceCents < essentialAvgCents * 3`
   (where `essentialAvgCents` is `essentialAverage(<all expenses>,
   now).averageCents` — reuse `server/src/savings/essential-average.ts`)
   → `warning`, "Reserva abaixo de 3 meses de gastos essenciais."
6. **câmbio spread drift**: over non-deleted `exchange_contracts` that
   have a `ptax_rate`, compute each contract's spread % as `(ptaxRate −
   vetRate) / ptaxRate * 100` using `calcCambio`
   (`server/src/cambio/math.ts`); if there are ≥ 3 such contracts and
   the most recent one's spread % exceeds the mean of all of them by
   more than `0.5` percentage points → `warning`, "Último câmbio: spread
   de {latest}% (média {avg}%)."
7. `income.currentCents > 0 && installments.nextMonthCommitmentCents >
   income.currentCents * 0.2` → `warning`, "Parcelas comprometem {pct}%
   da renda no próximo mês."
8. **stale backup** (only when `dataPaths` given): read the newest
   `*.db` mtime in `dataPaths.backupDir`; if none → `info`, "Nenhum
   backup ainda — exporte em Backup & Dados."; if the newest is ≥ 7 days
   old → `warning`, "Último backup há {n} dias."

All money in the messages is formatted by the frontend; the summary
carries raw cents and the alert `message` is a **pre-formatted string**
built server-side with a small `formatBRL` helper local to the module
(so the alert text is testable without the frontend). Percentages are
rounded to whole numbers.

**`server/src/routes/dashboard.ts`** —
`registerDashboardRoutes(app, db, dataPaths?)`:

- `GET /api/dashboard`, `preHandler: requireAuth(db)` →
  `dashboardSummary(db, { dataPaths })`.

Registered in `server/src/app.ts` immediately after
`registerDataRoutes(app, db, dataPaths)`, passing the same `dataPaths`.

### Frontend

**`frontend/src/lib/api.ts`** — add the `DashboardSummary` interface
(mirroring the server shape) and:

```ts
export function getDashboard(): Promise<DashboardSummary> {
  return request('/api/dashboard');
}
```

**`frontend/src/pages/DashboardPage.tsx`** — replaces the placeholder
body. `useState<DashboardSummary | null>`, `useEffect` fetch on mount,
inline `.error-text` on failure. While loading: render just the `<h1>`.

Layout (each a `.card` unless noted):

1. **Header** — `<h1>Dashboard</h1>` and, muted, the month
   (`summary.month`).
2. **Stat row** — four stat blocks in a flex/grid: Receita do mês,
   Gastos do mês, Disponível, Reserva. Each shows
   `formatCentsBRL(currentCents)` and a delta line: `deltaPct =
   previous > 0 ? (current − previous) / previous * 100 : null`; render
   `↑/↓ {|pct|}% vs {previousMonth}` coloured green/red by whether the
   direction is good (up is good for income & balance, bad for
   expenses), `= igual` when `|pct| < 0.5`, `— sem mês anterior` when
   `previous === 0`. Gastos also shows `{pct}% da renda` when income
   > 0.
3. **Alertas** — one line per `summary.alerts` entry, tinted by `level`
   (`info` → `var(--text2)`, `warning` → `var(--gold)` fallback to
   `var(--text)`, `danger` → `var(--red)` fallback). Hidden when empty.
4. **Gastos por categoria** — `<BarBreakdown rows={expenses.byCategory
   .map(c => ({ label: c.category, cents: c.cents }))} emptyText="Nenhum
   gasto este mês." />`.
5. **Evolução (6 meses)** — an inline `<svg viewBox="0 0 320 90">` with
   two `<polyline>`s over `evolution` — one for `incomeCents`
   (`var(--cyan)`), one for `expensesCents` (`var(--text3)`) — scaled to
   the max of both series; first/last month labels beneath; a tiny
   legend. Skipped when fewer than two evolution points have any
   non-zero value.
6. **Últimos gastos** — `recentExpenses` rows: `date` ·
   `description` · `category` · `formatCentsBRL(amountCents)`. Empty
   state "Nenhum gasto ainda.".
7. **Metas em andamento** — `topGoals` rows: name, a progress bar sized
   to `progressPct`, `formatCentsBRL(currentCents)` de
   `formatCentsBRL(targetCents)`. Empty state "Nenhuma meta ainda.".
8. **Parcelas ativas** — shown only when `installments.activeGroups >
   0`: "Próximo mês: {formatCentsBRL(nextMonthCommitmentCents)}",
   "{activeGroups} parcelamento(s) ativo(s)", "Mais curto termina em
   {earliestEndMonth}".
9. **Fechamento do mês** — a checkbox (`checked =
   monthlyClose.reviewed`, `aria-label="Revisado {month}"`) that on
   change calls `api.markMonthReviewed(summary.month)` /
   `api.unmarkMonthReviewed(summary.month)` then re-fetches the summary;
   when reviewed, "revisado em {date}".

**`frontend/src/App.tsx`** — no change (already routes `/` to
`DashboardPage`).

**`frontend/src/App.test.tsx`** — the two tests that land on the
dashboard gain `vi.spyOn(api, 'getDashboard').mockResolvedValue(<minimal
summary>)` and assert `screen.findByRole('heading', { name: 'Dashboard'
})` instead of the "em breve" text; the "keeps showing login" test
asserts that heading is absent.

## Data flow

1. Mount → `GET /api/dashboard` → one `DashboardSummary`.
2. The page renders it directly — no client-side recomputation.
3. The only interaction is the monthly-close checkbox → `PUT` / `DELETE
   /api/monthly-close/:month` → re-fetch `/api/dashboard`.

## Error handling

- `dashboardSummary` is a total function over whatever rows exist —
  empty DB yields zeros, empty arrays, `savingsTarget: null`,
  `monthlyClose: { reviewed: false, reviewedAt: null }`, and (typically)
  the "add income" + "reserve zeroed" + "no backup" alerts.
- The route has no user input to validate; unexpected DB errors bubble
  to Fastify's 500.
- The frontend `request()` helper throws `Error(body.error)` on non-2xx;
  the page catches and renders `.error-text`, and renders nothing else
  below the header.

## Testing

TDD — one failing test at a time.

**Server** — `server/src/dashboard/summary.test.ts`, all with a fixed
`now = new Date(2026, 7, 15)` (Aug 2026) against an in-memory migrated
DB:

- **empty DB**: `month === '2026-08'`, `previousMonth === '2026-07'`,
  every `*Cents` is `0`, `byCategory`/`recentExpenses`/`topGoals` are
  `[]`, `evolution` has 6 entries all-zero ascending from `'2026-03'`
  to `'2026-08'`, `savingsTarget` is `null`, `monthlyClose.reviewed` is
  `false`, and `alerts` contains an `info` "adicione suas receitas" and
  a `warning` "reserva … zerada".
- **income & expenses with a previous month**: seed Aug income
  `500_000` and Jul income `400_000`; Aug expenses `300_000` (mix of
  types) and Jul `200_000` → `income` `{ current: 500_000, previous:
  400_000 }`, `expenses.currentCents 300_000`, `balanceCents 200_000`,
  the `essentialCents`/`nonEssentialCents` split, and
  `byCategory` sorted.
- **over-spend alert**: Aug income `100_000`, Aug expenses `95_000` →
  a `danger` alert whose message contains `95%`.
- **savings target alert**: a `savings_monthly_targets` row for
  `2026-08` with `target_cents 200_000`, `rollover_cents 0`; one Aug
  reserve deposit of `120_000` → `savingsTarget` present, a `warning`
  alert; a second deposit taking it to `200_000` → no such alert.
- **thin-reserve alert**: Aug + Jul + Jun essential expenses averaging
  `100_000`; a reserve balance of `250_000` (< `300_000`) → a `warning`
  "abaixo de 3 meses"; raise the balance to `320_000` → gone.
- **installments**: a 3× installment (`60_000` total → `20_000`/mo)
  starting `2026-08-10` → `nextMonthCommitmentCents 20_000` (the Sep
  row), `activeGroups 1`, `earliestEndMonth '2026-10'`; with Aug income
  `50_000` (`20_000 > 10_000`) → a `warning` "comprometem 40%".
- **evolution**: income/expenses seeded in `2026-06` and `2026-08` →
  `evolution` has non-zero `incomeCents` in those two months and `0`
  elsewhere, months ascending.
- **câmbio spread drift**: three `exchange_contracts` with `ptax_rate`
  set, two with ~2% spread and the newest (highest `id`) with ~4% →
  a `warning` whose message contains the latest and average percentages;
  with only two contracts → no such alert.
- **monthly close**: insert a `monthly_close` row for `2026-08` →
  `monthlyClose` `{ reviewed: true, reviewedAt: <iso> }`.

**Server** — `server/src/routes/dashboard.test.ts` (the `authedApp()`
helper): 401 unauthenticated; authenticated → 200 with a body that has
`month`, `income`, `alerts` (array), `evolution` (length 6).

**Frontend** — `frontend/src/pages/DashboardPage.test.tsx` (mocks
`../lib/api`):

- renders the four stat-card values from a mocked summary and a
  `↓ 25% vs 2026-07` delta on expenses.
- renders each alert message with the level styling present (assert the
  text is in the document).
- renders a `BarBreakdown` bar per `byCategory` entry.
- renders the recent-expense rows and the top-goal names.
- shows the "Parcelas ativas" card only when `activeGroups > 0`.
- the monthly-close checkbox reflecting `reviewed: false` calls
  `api.markMonthReviewed('2026-08')` and then re-fetches
  (`getDashboard` called twice); one at `reviewed: true` calls
  `api.unmarkMonthReviewed`.
- an error from `getDashboard` renders `.error-text` and no stat cards.

**Frontend** — `frontend/src/App.test.tsx` updated as described (mock
`getDashboard`, assert the heading).

**End-to-end** — a "Dashboard" section in `scripts/qa-e2e.sh`:
`GET /api/dashboard` unauthenticated → 401; authenticated → 200 with
`.month` a `YYYY-MM` string, `.evolution | length` `== 6`, `.alerts |
type` `== "array"`; after `POST /api/data/seed-test` the summary's
`.income.currentCents` and `.expenses.currentCents` are `> 0` and
`.installments.activeGroups` is `>= 1`.

## Files

New:

- `server/src/dashboard/summary.ts` + `.test.ts`
- `server/src/routes/dashboard.ts` + `.test.ts`
- `frontend/src/pages/DashboardPage.test.tsx`

Modified:

- `server/src/app.ts` — register the dashboard route (with `dataPaths`)
- `frontend/src/lib/api.ts` — `DashboardSummary` type + `getDashboard`
- `frontend/src/pages/DashboardPage.tsx` — replace the placeholder body
- `frontend/src/App.test.tsx` — mock `getDashboard`, assert the heading
- `scripts/qa-e2e.sh` — add a Dashboard section
- `docs/qa-checklist.md` — append Dashboard checks
