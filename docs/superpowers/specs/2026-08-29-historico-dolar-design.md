# fumarende — Histórico Dólar module design

> Follow-up #5b to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle. Split from #5 (the
> Análise / Projeção / Cenários half shipped as #5a).

## Context

Modules shipped: Receitas, Câmbio, Gastos + Parcelas + Gastos Fixos,
Reserva, Metas + Projetos Especiais, Análise. This spec covers
**Histórico Dólar** — a self-reported monthly USD/BRL quote log with a
rate chart and, for someone paid in USD, a view of how the same
paycheck translates to BRL as the rate moves.

Behaviour reference: the prototype's
`stack-project/prototype/stacks.html` (`renderDolar`,
`saveCotacaoHistory`), which stored `{ mes, cotacao, salUSD }` per month,
upserting by month, and rendered a rate line chart plus a table (Mês /
Cotação / Salário USD / Salário BRL / vs Média).

This is the **first new migration since Foundation.** The
`ptax_rate_cache` table already in the schema is a different concept
(daily PTAX by date, for câmbio contracts) and is not reused here.

## Goals

- One quote per month: `{ month, rate, salaryUsdCents? }`. Registering a
  month that already exists **replaces** it (upsert by month).
- A rate line chart over time (inline SVG, no charting library).
- A table: Mês / Cotação / Salário (US$) / Salário (R$) / vs média —
  where Salário (R$) = `salaryUsdCents × rate` and "vs média" is the
  rate's percentage distance from the average of all recorded months.
- Per-row delete.

## Non-goals (this pass)

- **No auto-fetch** of the rate from any external API — manual entry
  only (Phase 1 rule).
- **No tie-in to Câmbio's PTAX** — this monthly quote is an independent
  self-reported reference.
- **No charting library.** The chart is a hand-built inline-SVG polyline
  (same technique as the Análise projection line).
- **No multiple readings per month** — `month` is the primary key.
- **No month selector in the shell.**

## Architecture

Follows the established module pattern: migration → data layer → pure
stats helper (server + mirrored frontend copy) → Fastify routes behind
`requireAuth` → register in `app.ts`; frontend api client → page → route
in `App.tsx`. Money is integer cents; the rate is a `REAL` / JS `number`
(matching `exchange_contracts.contracted_rate` / `ptax_rate`).

### Server

**`server/src/db/migrations/002_dollar_quotes.ts`**

```ts
import type { Migration } from '../migrate.js';

export const migration002: Migration = {
  id: '002_dollar_quotes',
  sql: `
    CREATE TABLE dollar_quotes (
      month TEXT PRIMARY KEY,        -- YYYY-MM
      rate REAL NOT NULL,           -- USD/BRL, e.g. 5.12
      salary_usd_cents INTEGER,     -- optional
      deleted_at TEXT
    );
  `,
};
```

`server/src/db/migrate.ts` — import `migration002` and append it to
`MIGRATIONS`:

```ts
const MIGRATIONS: Migration[] = [migration001, migration002];
```

The runner is idempotent and tracks applied ids in `schema_migrations`,
so this applies to the live DB on the next server boot with no manual
step.

**`server/src/db/dollar-quotes.ts`** — mirrors the other data layers.

```ts
interface DollarQuote {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}
interface NewDollarQuote {
  month: string;
  rate: number;
  salaryUsdCents?: number | null;
}
function upsertQuote(db: Database.Database, input: NewDollarQuote): DollarQuote;
function listQuotes(db: Database.Database): DollarQuote[];
function deleteQuote(db: Database.Database, month: string): void;
```

- `upsertQuote` — throws unless `month` matches `/^\d{4}-\d{2}$/`,
  `rate` is a finite number `> 0`, and `salaryUsdCents` is
  `undefined` / `null` or an integer `>= 0`. Runs
  `INSERT INTO dollar_quotes (month, rate, salary_usd_cents, deleted_at)
   VALUES (@month, @rate, @salaryUsdCents, NULL)
   ON CONFLICT(month) DO UPDATE SET
     rate = excluded.rate,
     salary_usd_cents = excluded.salary_usd_cents,
     deleted_at = NULL`
  (clearing `deleted_at` so re-registering — or re-adding after a
  delete — restores the row). Returns the stored row.
- `listQuotes` — `WHERE deleted_at IS NULL ORDER BY month ASC` (it is a
  time series).
- `deleteQuote` — `UPDATE dollar_quotes SET deleted_at = <ISO now>
  WHERE month = ?`.

**`server/src/dollar/stats.ts`** (pure, no DB)

```ts
interface QuoteRow {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
  salaryBrlCents: number | null;   // round(salaryUsdCents * rate), or null
  vsAveragePct: number;            // (rate - avg) / avg * 100; 0 when avg is 0
}
interface QuoteStats {
  averageRate: number;             // mean rate over all rows; 0 when empty
  rows: QuoteRow[];                // same order as the input (ASC by month)
}
function quoteStats(quotes: { month: string; rate: number; salaryUsdCents: number | null }[]): QuoteStats;
```

- `averageRate = rows.length ? Σ rate / rows.length : 0`.
- per row: `salaryBrlCents = salaryUsdCents !== null
  ? Math.round(salaryUsdCents * rate) : null`;
  `vsAveragePct = averageRate > 0 ? (rate - averageRate) / averageRate * 100 : 0`.

**`server/src/routes/dollar-quotes.ts`** — `registerDollarQuoteRoutes(app, db)`,
every route `preHandler: requireAuth(db)`:

- `GET /api/dollar-quotes` → `listQuotes(db)`
- `PUT /api/dollar-quotes/:month` — body `{ rate: number; salaryUsdCents?: number | null }`.
  400 unless `params.month` matches `/^\d{4}-\d{2}$/`, `rate` is a
  finite number `> 0`, and `salaryUsdCents` is absent/null or an
  integer `>= 0`. Else `upsertQuote(db, { month, rate, salaryUsdCents })`,
  returns the row.
- `DELETE /api/dollar-quotes/:month` → `deleteQuote(db, params.month)`,
  `{ ok: true }`.

Registered in `server/src/app.ts` immediately after the two
`registerTargetRoutes(...)` calls.

### Frontend

**`frontend/src/lib/dollar.ts`** — a verbatim copy of `quoteStats` +
the `QuoteRow` / `QuoteStats` interfaces. Header comment:
`// Mirrors server/src/dollar/stats.ts exactly — keep the two in sync.`

**`frontend/src/lib/api.ts`** — add:

```ts
export interface DollarQuote {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export function listDollarQuotes(): Promise<DollarQuote[]> {
  return request('/api/dollar-quotes');
}

export function upsertDollarQuote(
  month: string,
  input: { rate: number; salaryUsdCents?: number | null },
): Promise<DollarQuote> {
  return request(`/api/dollar-quotes/${month}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteDollarQuote(month: string): Promise<{ ok: true }> {
  return request(`/api/dollar-quotes/${month}`, { method: 'DELETE' });
}
```

**`frontend/src/pages/HistoricoDolarPage.tsx`** — replaces
`<PlaceholderPage title="Histórico Dólar" />`. Local `useState`,
`refresh()` on mount → `listDollarQuotes()`.

- **Form**: `month` (`<input type="month">`, default the current
  `YYYY-MM`), `rate` (text — `parseRate` from `../lib/money.js`,
  placeholder `5,12`), `salaryUsd` (text, optional — `parseCentsFromInput`,
  label "Salário no mês (US$)"). Submit validates `month` present,
  `rate` a positive number (inline error otherwise), and — if
  `salaryUsd` is non-blank — a valid non-negative amount; calls
  `api.upsertDollarQuote(month, { rate, salaryUsdCents })`; `refresh()`.
- **Chart**: derive `stats = quoteStats(quotes)`. If `stats.rows.length
  >= 2`, an inline `<svg viewBox="0 0 320 80">` with a `<polyline>` over
  `stats.rows.map(r => r.rate)` (x spaced evenly, y scaled so the max
  rate maps near the top); first/last month labels beneath. Fewer than
  2 rows: skip the chart.
- **Table** (`<table>` inside an `overflow-x:auto` wrapper), one row per
  `stats.rows` entry:
  Mês (`r.month`) · Cotação (`r.rate.toFixed(4)`) · Salário (US$)
  (`r.salaryUsdCents !== null ? formatCentsUSD(r.salaryUsdCents) : '—'`)
  · Salário (R$) (`r.salaryBrlCents !== null ? formatCentsBRL(r.salaryBrlCents) : '—'`)
  · vs média (`${r.vsAveragePct >= 0 ? '+' : ''}${r.vsAveragePct.toFixed(2)}%`)
  · an **Excluir** button → `api.deleteDollarQuote(r.month)` → `refresh()`,
  `aria-label` = `Excluir cotação de ${r.month}`.
- **Empty state**: "Nenhuma cotação registrada." when `quotes` is empty.

**`frontend/src/App.tsx`** — replace the Histórico Dólar placeholder
route with `<HistoricoDolarPage />`; add the import.

## Data flow

1. Mount → `GET /api/dollar-quotes` → store, derive `quoteStats`.
2. Form submit → `PUT /api/dollar-quotes/:month` with the parsed rate
   (and salary cents when given). The server upserts by month and
   returns the row. → `refresh()`.
3. Excluir → `DELETE /api/dollar-quotes/:month` → `refresh()`.
4. `averageRate`, `salaryBrlCents`, `vsAveragePct` are all derived
   client-side by `quoteStats` from the row list — never stored.

## Error handling

- Server validation failures → `400 { error }`; the data layer's
  `throw`s are duplicated by the route guards so bad input is a clean
  400. Unexpected DB errors bubble to Fastify's default 500.
- The frontend `request()` helper throws `Error(body.error)` on non-2xx;
  the form catches and renders `.error-text`.

## Testing

TDD — one failing test at a time.

**Server**

- `server/src/db/migrate.test.ts` — extend the existing test:
  `dollar_quotes` is in the table list; `schema_migrations` now has
  **2** rows and contains `'002_dollar_quotes'`.
- `server/src/db/dollar-quotes.test.ts`:
  - `upsertQuote({ month: '2026-06', rate: 5.1 })` then `listQuotes` →
    one row `{ month: '2026-06', rate: 5.1, salaryUsdCents: null }`.
  - a second `upsertQuote({ month: '2026-06', rate: 5.3,
    salaryUsdCents: 600_000 })` → still one row, now
    `{ rate: 5.3, salaryUsdCents: 600_000 }` (replace).
  - `listQuotes` orders by month ascending across `'2026-07'`,
    `'2026-05'`, `'2026-06'` → `['2026-05', '2026-06', '2026-07']`.
  - `deleteQuote('2026-06')` → gone from `listQuotes`; a following
    `upsertQuote({ month: '2026-06', rate: 5.0 })` brings it back
    (deleted_at cleared).
  - rejects `month` `'2026-6'` / `'nope'`, `rate` `0` / `-1` /
    `'abc'` (non-number), `salaryUsdCents` `-1` / `12.5`.
- `server/src/dollar/stats.test.ts`:
  - three quotes rates `5.0`, `5.2`, `5.6` (one with
    `salaryUsdCents: 500_000`) → `averageRate` `5.2666…`;
    the salaried row's `salaryBrlCents = round(500_000 * its rate)`;
    each row's `vsAveragePct` = `(rate - avg) / avg * 100`.
  - a quote with `salaryUsdCents: null` → its `salaryBrlCents` is
    `null`.
  - `quoteStats([])` → `{ averageRate: 0, rows: [] }`.
- `server/src/routes/dollar-quotes.test.ts` (mirrors the `authedApp()`
  helper): 401 unauthenticated on `GET`; `PUT /api/dollar-quotes/2026-06`
  `{ rate: 5.1 }` → 200 and the row, then `GET` lists it; a second
  `PUT` for the same month with a new rate → `GET` shows the new rate
  (one row); `DELETE /api/dollar-quotes/2026-06` → gone; `PUT` with
  `month` `2026-6` in the URL → 400; `PUT` with `rate: 0` → 400; a
  `DELETE` carrying `content-type: application/json` and an empty body
  still succeeds (regression guard).

**Frontend**

- `frontend/src/lib/dollar.test.ts` — the same vectors as the server
  `stats` test.
- `frontend/src/pages/HistoricoDolarPage.test.tsx` (mocks `../lib/api`):
  - lists existing quotes in a table (assert a `toFixed(4)` rate and a
    formatted Salário (R$) value from a mocked quote with a salary).
  - the form: entering a month, `5,25` as the rate, and `4000` as the
    salary, submitting → `api.upsertDollarQuote` called with the month
    and `{ rate: 5.25, salaryUsdCents: 400_000 }`.
  - submitting with a blank salary → `salaryUsdCents` is `null` in the
    call.
  - an Excluir click → `api.deleteDollarQuote` with that row's month.
  - empty `listDollarQuotes` → "Nenhuma cotação registrada." shows.

**End-to-end** — extend `scripts/qa-e2e.sh` with a "Histórico Dólar"
section: `PUT /api/dollar-quotes/2026-06 {rate:5.1}` → 200;
`GET /api/dollar-quotes` lists it; a second `PUT` for `2026-06` with
`rate:5.3` → `GET` still one row with rate `5.3`; `PUT .../2026-6`
(bad month) → 400; `PUT .../2026-07 {rate:0}` → 400;
`DELETE .../2026-06` → 200, gone.

## Files

New:

- `server/src/db/migrations/002_dollar_quotes.ts`
- `server/src/db/dollar-quotes.ts` + `.test.ts`
- `server/src/dollar/stats.ts` + `.test.ts`
- `server/src/routes/dollar-quotes.ts` + `.test.ts`
- `frontend/src/lib/dollar.ts` + `.test.ts`
- `frontend/src/pages/HistoricoDolarPage.tsx` + `.test.tsx`

Modified:

- `server/src/db/migrate.ts` — register `migration002`
- `server/src/db/migrate.test.ts` — assert `002` / `dollar_quotes`
- `server/src/app.ts` — register the dollar-quote routes
- `frontend/src/lib/api.ts` — `DollarQuote` type + 3 client functions
- `frontend/src/App.tsx` — mount `HistoricoDolarPage`
- `scripts/qa-e2e.sh` — add a Histórico Dólar section
- `docs/qa-checklist.md` — append Histórico Dólar checks
