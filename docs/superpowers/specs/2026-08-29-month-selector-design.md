# fumarende — nav-shell month selector design

> Cross-cutting Phase 1 finisher (deferred from Reserva, Gastos, and
> noted alongside the Dashboard). Its own brainstorm → spec → plan →
> implement cycle.

## Context

Phase 1's eight modules are all shipped. Three views are inherently
month-scoped and currently hard-code the **current calendar month**:
the Dashboard (its whole reason for being), Reserva's "Meta Mensal"
card, and Análise's savings-target / projection anchor. There is no way
to review a past month.

The list pages (Receitas, Câmbio, Gastos, Parcelas, Metas, Projetos,
Histórico Dólar) deliberately show **all** data newest-first — that
decision was made and re-approved for every one of those modules and is
**not** changed here.

This spec adds one selector in the nav shell and wires it into exactly
the three month-scoped views.

## Goals

- A `<select>` in `NavShell` whose value is a `YYYY-MM` month, shared
  via a `MonthProvider` context (`useMonth()`), persisted to
  `localStorage`, defaulting to the current calendar month.
- Options: the union of months that already have data (reuse
  `GET /api/monthly-close`, which already returns that union) plus the
  current month, sorted newest-first.
- **Dashboard**, **Reserva's Meta Mensal**, and **Análise's target /
  projection anchor** read `useMonth()` and re-fetch when it changes.
- The Dashboard endpoint accepts `?month=YYYY-MM`.

## Non-goals

- **No change to the list pages** — they stay "all data, newest first".
- **No change to `FixedExpensesSection`'s "Aplicar ao mês atual"** —
  applying fixed expenses always targets the real current calendar
  month, never the selected one (applying to a past month would be
  surprising).
- **No change to Histórico Dólar** — its form's month field default
  stays the current calendar month (it is a form default, not a view
  filter; the page already shows all quotes).
- No server-side month persistence; no per-user setting. `localStorage`
  only.
- No new tables, no new migration.

## Architecture

### Server

**`server/src/dashboard/summary.ts`** — `dashboardSummary`'s options gain
an explicit `month`:

```ts
function dashboardSummary(
  db: Database.Database,
  opts?: { now?: Date; month?: string; dataPaths?: { dbPath: string; backupDir: string } },
): DashboardSummary;
```

- The resolved month is `opts.month` when it matches `/^\d{4}-\d{2}$/`,
  otherwise `monthKey(opts.now ?? new Date())`.
- `previousMonth`, `nextMonth`, the six `evolution` months, the
  monthly-close read, the savings-target read, and every "current
  month" sum key off the **resolved month**.
- The essential-expense average anchors to the resolved month:
  `essentialAverage(<all expenses>, new Date(y, m - 1, 15))` where
  `y`/`m` come from the resolved month — so a past view sees the
  essential average as of then.
- The **stale-backup** alert still uses the real `now` (it is about the
  backup file's age today, independent of which month is being viewed).

**`server/src/routes/dashboard.ts`** — the route reads
`request.query.month`:

```ts
app.get<{ Querystring: { month?: string } }>(
  '/api/dashboard',
  { preHandler: requireAuth(db) },
  async (request, reply) => {
    const { month } = request.query;
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
    }
    return dashboardSummary(db, { month, dataPaths });
  },
);
```

No other server changes.

### Frontend

**`frontend/src/context/MonthContext.tsx`** — mirrors `AuthContext`.

```ts
interface MonthContextValue {
  month: string;                 // YYYY-MM
  setMonth: (m: string) => void;
  months: string[];              // options, newest-first, always includes `month` and the current calendar month
}
function MonthProvider({ children }: { children: ReactNode }): JSX.Element;
function useMonth(): MonthContextValue;   // throws outside a provider, like useAuth
```

- `STORAGE_KEY = 'fumarende.month'`. Initial `month`: a valid
  `YYYY-MM` from `localStorage`, else the current calendar month.
  `setMonth` writes through to `localStorage` (wrapped in try/catch).
- On mount, `api.listMonthlyClose()` → `months` = the sorted-desc
  distinct union of `[currentCalendarMonth, month, ...rows.map(r =>
  r.month)]`. On fetch failure, `months = [month]` (resilient — the
  provider also mounts briefly during auth transitions).
- `localStorage` reads/writes are `try/catch`-guarded (private windows,
  disabled storage).

**`frontend/src/lib/api.ts`** — `getDashboard` gains an optional month:

```ts
export function getDashboard(month?: string): Promise<DashboardSummary> {
  return request(`/api/dashboard${month ? `?month=${month}` : ''}`);
}
```

**`frontend/src/components/NavShell.tsx`** — under the "fumarende"
wordmark, before the nav links, a `<label>`-wrapped `<select>`
(`aria-label="Mês"`) bound to `useMonth()`; options from `months`,
each shown as the raw `YYYY-MM`.

**`frontend/src/App.tsx`** — a small `AppShell` component
(`<MonthProvider><NavShell /></MonthProvider>`) becomes the route
`element` for the shell layout, so `MonthProvider` mounts only inside
`ProtectedRoute` (authenticated) and every shell page is under it.

**`frontend/src/pages/DashboardPage.tsx`** — `const { month } =
useMonth();`; `load()` calls `api.getDashboard(month)`; the mount
`useEffect` depends on `month` (re-fetch on change). The monthly-close
toggle already keys off `summary.month`.

**`frontend/src/pages/ReservaPage.tsx`** — delete the local
`currentMonth()` helper; `const { month } = useMonth();`. `refresh()`
calls `api.getMonthlyTarget(month)`; the `addedThisMonth` filter and
the label use `month`. `refresh` runs on mount and whenever `month`
changes. The balance / history / 3×–6× sections stay month-agnostic
(unchanged).

**`frontend/src/pages/AnalisePage.tsx`** — replace `const month = new
Date().toISOString().slice(0, 7)` with `useMonth().month`; the mount
effect depends on it. `projectSavings` already uses the fetched
target; `essentialAverage(expenses)` gains an explicit anchor `new
Date(y, m - 1, 15)` from the selected month. The spending breakdown and
scenario catalog stay all-time (unchanged).

## Data flow

1. `MonthProvider` mounts (inside `ProtectedRoute`) → reads
   `localStorage` for the initial month, fetches `listMonthlyClose()`
   for the options.
2. The `<select>` in `NavShell` calls `setMonth` → context updates,
   `localStorage` is written.
3. Dashboard / Reserva-meta / Análise each have `month` in a
   `useEffect` dep list → they re-fetch for the new month.
4. Nothing else re-renders meaningfully; the list pages ignore `month`.

## Error handling

- `GET /api/dashboard?month=bad` → `400 { error }`.
- `MonthProvider`: `listMonthlyClose()` failure → `months` falls back to
  `[month]`, no throw. `localStorage` access is try/catch-guarded on
  both read and write.
- `useMonth()` outside a provider throws (same contract as `useAuth`).

## Testing

**Server**

- `server/src/dashboard/summary.test.ts` — add: `dashboardSummary(db, {
  month: '2026-06', now: new Date(2026, 7, 15) })` →
  `month === '2026-06'`, `previousMonth === '2026-05'`,
  `evolution[5].month === '2026-06'`, and the June income/expense sums
  are used (seed June + Aug rows, assert June is `current`).
- `server/src/routes/dashboard.test.ts` — add: `GET
  /api/dashboard?month=2026-06` → 200 with `body.month === '2026-06'`;
  `GET /api/dashboard?month=2026-6` → 400.

**Frontend**

- `frontend/src/context/MonthContext.test.tsx` (new):
  - default `month` is the current `YYYY-MM` when `localStorage` is
    empty; a stored valid month is used instead.
  - `setMonth('2026-05')` updates the value and writes
    `localStorage['fumarende.month']`.
  - `months` from a mocked `listMonthlyClose` is sorted desc and always
    contains the current calendar month and the active `month`.
  - a rejected `listMonthlyClose` leaves `months` as `[month]` and does
    not throw.
  - (render a tiny probe component that calls `useMonth()`; wrap in
    `<MonthProvider>`.)
- `frontend/src/pages/DashboardPage.test.tsx` — wrap renders in
  `<MonthProvider>`, mock `api.listMonthlyClose` in `beforeEach`; add a
  test: with a `MonthProvider` whose stored month is `2026-06`,
  `getDashboard` is called with `'2026-06'`.
- `frontend/src/pages/ReservaPage.test.tsx` and
  `frontend/src/pages/AnalisePage.test.tsx` — wrap renders in
  `<MonthProvider>`, mock `api.listMonthlyClose`; existing assertions
  (which use the current month) keep working because that is the
  default.
- `frontend/src/App.test.tsx` — its `beforeEach` also mocks
  `api.listMonthlyClose` (the `AppShell` now mounts `MonthProvider`);
  add an assertion that the `Mês` select is present once on the shell.
- `frontend/src/components/NavShell.test.tsx` (new): rendered inside
  `<MonthProvider>` + a `<MemoryRouter>`, the `Mês` select shows the
  months and calls `setMonth` on change (probe via a stored value).

**End-to-end** — `scripts/qa-e2e.sh` Dashboard section gains:
`GET /api/dashboard?month=2026-06` → 200 with `.month == "2026-06"`;
`GET /api/dashboard?month=nope` → 400.

## Files

New:

- `frontend/src/context/MonthContext.tsx` + `.test.tsx`
- `frontend/src/components/NavShell.test.tsx`

Modified:

- `server/src/dashboard/summary.ts` — `month` option
- `server/src/dashboard/summary.test.ts` — explicit-month test
- `server/src/routes/dashboard.ts` — `?month=` query param
- `server/src/routes/dashboard.test.ts` — query-param tests
- `frontend/src/lib/api.ts` — `getDashboard(month?)`
- `frontend/src/components/NavShell.tsx` — the selector
- `frontend/src/App.tsx` — `AppShell` wrapper mounting `MonthProvider`
- `frontend/src/pages/DashboardPage.tsx` / `ReservaPage.tsx` / `AnalisePage.tsx` — consume `useMonth()`
- `frontend/src/pages/DashboardPage.test.tsx` / `ReservaPage.test.tsx` / `AnalisePage.test.tsx` / `App.test.tsx` — provider wrap + `listMonthlyClose` mock
- `scripts/qa-e2e.sh` — `?month=` assertions
- `docs/qa-checklist.md` — month-selector checks
