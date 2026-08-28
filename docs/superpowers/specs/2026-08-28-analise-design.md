# fumarende — Análise (Análise / Projeção / Cenários) module design

> Follow-up #5a to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle. Follows the pattern of the
> Câmbio, Gastos, Reserva, and Metas modules.

## Context

Modules shipped: Receitas, Câmbio, Gastos + Parcelas + Gastos Fixos,
Reserva, Metas + Projetos Especiais. This spec covers the **Análise**
page — deterministic, non-AI analysis over data already in the database:
a spending summary + per-category breakdown, a 12-month forward savings
projection, and a what-if "spending cut" scenario tool.

The Phase 1 design lists "Análise / Projeção / Cenários" and "Histórico
Dólar" together as one module. They are independent: this (5a) is
read-only computation over existing rows and needs no new storage;
Histórico Dólar (5b, a later cycle) adds a `dollar_quotes` table, CRUD,
and a rate chart. They are split.

fumarende's `NavShell` already collapses the prototype's three separate
nav entries (analise / projecao / cenarios) into one **Análise** entry,
so all three are sections of a single page.

Behaviour reference: the prototype's
`stack-project/prototype/stacks.html` (`renderAnalise` /
`renderProjecao` / `renderCenarios` / `calcCenario`), adapted to
fumarende's schema and to having no month selector.

## Goals

- A spending summary: total income, total expenses, balance, and the
  essencial / não-essencial split — over all data (no month selector).
- A per-category expense breakdown (amount + share), largest first.
- A 12-month forward projection of net savings built from the current
  reserve balance, the current month's savings target, and the amount
  already put toward goals/projects.
- A scenario tool: for each não-essencial category, a 0–100% cut slider;
  a live total of the monthly and annualised saving from the chosen
  cuts.
- All computation as pure, unit-tested functions in a server module
  (ready for a Phase 2 API to reuse), mirrored by a frontend copy the
  page runs client-side.

## Non-goals (this pass)

- **Histórico Dólar** — the entire USD/BRL monthly quote feature is 5b.
- **No charting library.** Visuals are hand-built inline SVG / CSS bars.
- **No new server routes or `app.ts` change.** The page computes from
  the existing list endpoints.
- **No month selector.** Summary and breakdown cover all data; the
  projection starts from "now".
- **No AI.** The Phase 2 Claude-powered analysis is separate.
- **No persistence of scenario slider positions** — they are transient
  page state.

## Architecture

Pure logic in a server module + a mirrored frontend copy (the pattern of
`server/src/cambio/math.ts` ↔ `frontend/src/lib/cambio.ts`). The page
fetches from existing endpoints and calls the frontend copy. Money is
integer cents throughout; percentages are plain numbers.

### Server — `server/src/analysis/analysis.ts` (pure, no DB, no routes)

```ts
interface IncomeLike { amountBrlCents: number }
interface ExpenseLike { date: string; amountCents: number; category: string; type: string }

interface SpendingBreakdown {
  totalIncomeCents: number;
  totalExpensesCents: number;
  essentialCents: number;
  nonEssentialCents: number;
  balanceCents: number;                 // income - expenses
  byCategory: { category: string; cents: number; pct: number }[]; // desc by cents; pct of total expenses
}
function spendingBreakdown(income: IncomeLike[], expenses: ExpenseLike[]): SpendingBreakdown;

interface ProjectionInput {
  reserveBalanceCents: number;
  monthlyTargetCents: number;
  goalsSavedCents: number;
}
interface SavingsProjection {
  rows: { monthOffset: number; savingsAccumCents: number; totalCents: number }[]; // monthOffset 1..months
  endSavingsCents: number;              // savingsAccum at the last month
  endTotalCents: number;                // total at the last month
}
function projectSavings(input: ProjectionInput, months?: number): SavingsProjection; // months default 12

interface ScenarioCategory { category: string; monthlyAvgCents: number }
/** Non-essencial categories only. monthlyAvgCents = category total / (# of distinct YYYY-MM
 *  months that have any expense row). Zero rows -> []. */
function scenarioCatalog(expenses: ExpenseLike[]): ScenarioCategory[];

interface ScenarioResult { totalMonthlyCents: number; annualCents: number }
/** cuts maps category -> percent (0..100). Missing/0 entries contribute nothing. */
function applyCuts(catalog: ScenarioCategory[], cuts: Record<string, number>): ScenarioResult;
```

Details:

- `spendingBreakdown`:
  - `totalIncomeCents = Σ income.amountBrlCents`
  - `totalExpensesCents = Σ expenses.amountCents`
  - `essentialCents = Σ amountCents where type === 'essencial'`
  - `nonEssentialCents = totalExpensesCents - essentialCents`
  - `balanceCents = totalIncomeCents - totalExpensesCents`
  - `byCategory`: group by `category`, sum `cents`; `pct = totalExpensesCents > 0
    ? cents / totalExpensesCents * 100 : 0`; sort by `cents` descending,
    then `category` ascending for a stable tie-break.
- `projectSavings(input, months = 12)`:
  - for `i` in `1..months`: `savingsAccumCents = input.monthlyTargetCents * i`,
    `totalCents = input.reserveBalanceCents + input.goalsSavedCents + savingsAccumCents`.
  - `endSavingsCents` / `endTotalCents` are the last row's values (or
    `0` / `reserve + goalsSaved` if `months <= 0`).
- `scenarioCatalog(expenses)`:
  - `distinctMonths` = size of the set of `e.date.slice(0, 7)` over **all**
    expense rows (essencial included — it is the denominator for an
    average "per month of activity"). If `0`, return `[]`.
  - group não-essencial rows by category, sum, then
    `monthlyAvgCents = Math.round(sum / distinctMonths)`.
  - sort desc by `monthlyAvgCents`, then category asc.
- `applyCuts(catalog, cuts)`:
  - `totalMonthlyCents = Σ Math.round(c.monthlyAvgCents * (cuts[c.category] ?? 0) / 100)`
  - `annualCents = totalMonthlyCents * 12`

### Frontend

**`frontend/src/lib/analysis.ts`** — a verbatim copy of the four
functions + the interfaces (identical bodies). Header comment:
`// Mirrors server/src/analysis/analysis.ts exactly — keep in sync.`

**`frontend/src/components/BarBreakdown.tsx`** — a labelled
horizontal-bar list.

```ts
interface BarBreakdownProps {
  rows: { label: string; cents: number }[];
  emptyText: string;
}
function BarBreakdown(props: BarBreakdownProps): JSX.Element;
```

Renders, per row: the label, `formatCentsBRL(cents)`, and a bar whose
width is `cents / max(cents over rows) * 100`% (max `0` → all bars 0).
`emptyText` (muted) when `rows` is empty.

**`frontend/src/pages/AnalisePage.tsx`** — replaces
`<PlaceholderPage title="Análise" />`. Local `useState`, `refresh()` on
mount runs:

```ts
const [income, expenses, fund, target, goals, projects] = await Promise.all([
  api.listIncome(),
  api.listExpenses(),
  api.listEmergencyFund(),
  api.getMonthlyTarget(new Date().toISOString().slice(0, 7)),
  api.goalsApi.list(),
  api.projectsApi.list(),
]);
```

Derived (via the frontend `analysis` copy):

- `breakdown = spendingBreakdown(income, expenses)`
- `reserveBalanceCents = fund.reduce((s, e) => s + e.amountCents, 0)`
- `goalsSavedCents = [...goals, ...projects].reduce((s, t) => s + t.currentCents, 0)`
- `projection = projectSavings({ reserveBalanceCents, monthlyTargetCents:
  target.targetCents, goalsSavedCents })`
- `catalog = scenarioCatalog(expenses)`
- `cuts` — a `Record<string, number>` in `useState`, updated by the
  sliders; `scenario = applyCuts(catalog, cuts)`

Sections:

1. **Resumo** (card): Receitas `formatCentsBRL(breakdown.totalIncomeCents)`,
   Gastos, Saldo (`breakdown.balanceCents`; render negative in a muted
   colour), Essencial `breakdown.essentialCents`, Não-essencial.
2. **Gastos por categoria** (heading + `<BarBreakdown rows={breakdown.byCategory.map(c => ({ label: c.category, cents: c.cents }))} emptyText="Nenhum gasto registrado." />`).
3. **Projeção 12 meses** (card): headline "Em 12 meses:
   `formatCentsBRL(projection.endTotalCents)`" and "Poupança acumulada:
   `formatCentsBRL(projection.endSavingsCents)`"; below, an inline
   `<svg>` polyline over `projection.rows.map(r => r.totalCents)` — a
   fixed viewBox (e.g. `0 0 320 80`), points spaced evenly on x, y
   scaled so the max total maps to the top with a small margin;
   first/last month labels under the ends. If `target.targetCents === 0`,
   show a note: "Configure sua meta mensal em Reserva para projetar."
4. **Cenários** (card): if `catalog` is empty, "Registre gastos
   não-essenciais para simular cortes." Otherwise one row per category:
   the label, `formatCentsBRL(c.monthlyAvgCents)/mês`, and an
   `<input type="range" min="0" max="100">` bound to `cuts[c.category]`
   (default `0`), with the current `%` shown. Below the rows: "Corte
   total: `formatCentsBRL(scenario.totalMonthlyCents)`/mês ·
   `formatCentsBRL(scenario.annualCents)` em 12 meses".

**`frontend/src/App.tsx`** — replace the Análise placeholder route with
`<AnalisePage />`; add the import.

## Data flow

1. Mount → six parallel GETs to existing endpoints.
2. All figures are computed client-side by the `analysis` copy from those
   responses — nothing is written, no analysis endpoint is called.
3. Moving a scenario slider updates `cuts` state → `applyCuts` re-runs →
   the total line re-renders. No network.
4. There is no refresh trigger other than mount; the page is a
   read-only view.

## Error handling

- Any of the six GETs failing → the page catches and renders a single
  `.error-text` line; sections that have no data render their empty
  text. `getMonthlyTarget` creating-and-freezing the current month's row
  on first ever visit is expected and harmless (see the Reserva spec).
- `spendingBreakdown` / `projectSavings` / `scenarioCatalog` /
  `applyCuts` are total functions — they never throw; empty inputs yield
  zeros / empty arrays.

## Testing

TDD — one failing test at a time.

**Server** — `server/src/analysis/analysis.test.ts`:

- `spendingBreakdown`:
  - income `[{300_000}, {200_000}]`, expenses `[{Alimentação, 40_000,
    essencial}, {Lazer, 10_000, nao-essencial}, {Alimentação, 20_000,
    essencial}]` →
    `totalIncomeCents 500_000`, `totalExpensesCents 70_000`,
    `essentialCents 60_000`, `nonEssentialCents 10_000`,
    `balanceCents 430_000`,
    `byCategory` = `[{ Alimentação, 60_000, ~85.71 }, { Lazer, 10_000, ~14.29 }]`.
  - empty income + empty expenses → all zeros, `byCategory []`.
- `projectSavings`:
  - `{ reserveBalanceCents: 700_000, monthlyTargetCents: 100_000,
    goalsSavedCents: 50_000 }` → `rows` length 12; `rows[0]` =
    `{ monthOffset: 1, savingsAccumCents: 100_000, totalCents: 850_000 }`;
    `endSavingsCents 1_200_000`; `endTotalCents 1_950_000`.
  - `monthlyTargetCents: 0` → every `totalCents` equals `reserve +
    goalsSaved`; `endSavingsCents 0`.
- `scenarioCatalog`:
  - expenses across `2026-06` and `2026-07` (2 distinct months): Lazer
    `nao-essencial` `12_000` + `18_000` (30_000 total), Delivery
    `nao-essencial` `20_000`, Aluguel `essencial` `280_000` → catalog
    `[{ Lazer, 15_000 }, { Delivery, 10_000 }]` (30_000/2 and 20_000/2,
    sorted desc); Aluguel excluded (essencial).
  - no expenses → `[]`.
- `applyCuts`:
  - catalog `[{ Lazer, 15_000 }, { Delivery, 10_000 }]`,
    `cuts { Lazer: 50, Delivery: 100 }` →
    `totalMonthlyCents 17_500` (7_500 + 10_000), `annualCents 210_000`.
  - `cuts {}` → `{ totalMonthlyCents: 0, annualCents: 0 }`.

**Frontend**

- `frontend/src/lib/analysis.test.ts` — the same vectors as the server
  test.
- `frontend/src/components/BarBreakdown.test.tsx`:
  - three rows render their labels and formatted amounts; the largest
    row's bar has a wider inline `width` style than a smaller row's.
  - empty `rows` renders `emptyText`.
- `frontend/src/pages/AnalisePage.test.tsx` (mocks `../lib/api`,
  including `api.goalsApi.list` / `api.projectsApi.list`):
  - renders the four section headings (`Resumo`, `Gastos por
    categoria`, `Projeção 12 meses`, `Cenários`) after the mocked data
    resolves.
  - the Resumo card shows the formatted total-income value from the
    mocked `listIncome`.
  - with a mocked expense in a não-essencial category, a scenario slider
    row appears; firing a `change` to `100` on it updates the "Corte
    total" line to that category's full monthly average.
  - with `getMonthlyTarget` resolving `targetCents: 0`, the projection
    section shows the "Configure sua meta mensal" note.

## Files

New:

- `server/src/analysis/analysis.ts` + `.test.ts`
- `frontend/src/lib/analysis.ts` + `.test.ts`
- `frontend/src/components/BarBreakdown.tsx` + `.test.tsx`
- `frontend/src/pages/AnalisePage.tsx` + `.test.tsx`

Modified:

- `frontend/src/lib/api.ts` — no new functions needed; the page uses
  existing `listIncome` / `listExpenses` / `listEmergencyFund` /
  `getMonthlyTarget` / `goalsApi` / `projectsApi`. (No change unless a
  helper is genuinely missing — none is.)
- `frontend/src/App.tsx` — mount `AnalisePage`
- `docs/qa-checklist.md` — append Análise checks

No server files other than the new pure module; **`server/src/app.ts` is
not touched.**
