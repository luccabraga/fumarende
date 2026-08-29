# Nav-shell Month Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `YYYY-MM` month `<select>` to the nav shell, shared via a
`MonthProvider` context (persisted to `localStorage`), wired into the
three month-scoped views — Dashboard, Reserva's Meta Mensal, and
Análise's target/projection anchor — with `GET /api/dashboard` accepting
`?month=`.

**Architecture:** A React context mirroring `AuthContext`; the three
consumer pages gain `month` in a `useEffect` dep list. Server change is
minimal — one optional `month` opt on `dashboardSummary` and a
query-param check on its route.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-29-month-selector-design.md`

## Global Constraints

- The selected month is a `YYYY-MM` string. `localStorage` key
  `fumarende.month`; every read/write wrapped in `try/catch`.
- Default month = the current calendar month
  (`new Date().toISOString().slice(0, 7)`).
- **List pages are not touched** (Receitas, Câmbio, Gastos, Parcelas,
  Metas, Projetos, Histórico Dólar). `FixedExpensesSection`'s "Aplicar
  ao mês atual" is not touched (always the real current month).
- `useMonth()` throws outside a `MonthProvider` (same contract as
  `useAuth`).
- `MonthProvider` is resilient: a failed `listMonthlyClose()` leaves
  `months = [month]` and never throws.
- Every task is TDD. Server tests from `server/`, frontend from
  `frontend/`. Branch `month-selector` off `main`; the finishing skill
  merges it.

---

## File Structure

**New:**
- `frontend/src/context/MonthContext.tsx` + `.test.tsx`
- `frontend/src/components/NavShell.test.tsx`

**Modified (server):**
- `server/src/dashboard/summary.ts` — `month` opt.
- `server/src/dashboard/summary.test.ts` — explicit-month test.
- `server/src/routes/dashboard.ts` — `?month=` query param.
- `server/src/routes/dashboard.test.ts` — query-param tests.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `getDashboard(month?)`.
- `frontend/src/components/NavShell.tsx` — the `<select>`.
- `frontend/src/App.tsx` — `AppShell` wrapper mounting `MonthProvider`.
- `frontend/src/pages/DashboardPage.tsx` / `ReservaPage.tsx` / `AnalisePage.tsx` — consume `useMonth()`.
- `frontend/src/pages/DashboardPage.test.tsx` / `ReservaPage.test.tsx` / `AnalisePage.test.tsx` / `App.test.tsx` — provider wrap + `listMonthlyClose` mock.

**Modified (repo):**
- `scripts/qa-e2e.sh` — `?month=` assertions.
- `docs/qa-checklist.md` — month-selector checks.

---

## Task 1: `dashboardSummary` month option + route query param

**Files:**
- Modify: `server/src/dashboard/summary.ts`
- Modify: `server/src/dashboard/summary.test.ts`
- Modify: `server/src/routes/dashboard.ts`
- Modify: `server/src/routes/dashboard.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `dashboardSummary(db, opts?)` where `opts` gains
    `month?: string` — used as the resolved month when it matches
    `/^\d{4}-\d{2}$/`, else `monthKey(opts.now ?? new Date())`.
  - `GET /api/dashboard?month=YYYY-MM` — 400 on a malformed `month`.

- [ ] **Step 1: Add the failing tests**

In `server/src/dashboard/summary.test.ts`, add inside `describe('dashboardSummary', ...)`:

```ts
  it('honours an explicit month option', () => {
    const db = freshDb();
    income(db, '2026-06-01', 111_000);
    income(db, '2026-08-01', 999_000);
    expense(db, '2026-06-02', 22_000);

    const s = dashboardSummary(db, { month: '2026-06', now: NOW });
    expect(s.month).toBe('2026-06');
    expect(s.previousMonth).toBe('2026-05');
    expect(s.evolution[5].month).toBe('2026-06');
    expect(s.income.currentCents).toBe(111_000);
    expect(s.expenses.currentCents).toBe(22_000);
  });

  it('falls back to the now-derived month when month is malformed', () => {
    const s = dashboardSummary(freshDb(), { month: '2026-6', now: NOW });
    expect(s.month).toBe('2026-08');
  });
```

In `server/src/routes/dashboard.test.ts`, add inside `describe('dashboard route', ...)`:

```ts
  it('accepts a ?month= query and rejects a malformed one', async () => {
    const { app, sessionCookie } = await authedApp();

    const ok = await app.inject({
      method: 'GET',
      url: '/api/dashboard?month=2026-06',
      cookies: { session: sessionCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().month).toBe('2026-06');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/dashboard?month=2026-6',
      cookies: { session: sessionCookie },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/dashboard/summary.test.ts src/routes/dashboard.test.ts`
Expected: FAIL — `month` opt ignored; `?month=` unhandled.

- [ ] **Step 3: Add the `month` option to `summary.ts`**

In `server/src/dashboard/summary.ts`, change the `dashboardSummary`
signature and the month resolution:

```ts
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
```

(everything downstream already keys off `month` / `previousMonth` /
`nextMonth` / `evoMonths`, which is derived from `month`.)

Then change the essential-average anchor from `now` to a date inside
the resolved month. Replace:

```ts
  const essentialAvgCents = essentialAverage(
    db
      .prepare(
        'SELECT date, amount_cents AS amountCents, type FROM expenses WHERE deleted_at IS NULL',
      )
      .all() as { date: string; amountCents: number; type: string }[],
    now,
  ).averageCents;
```

with:

```ts
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
```

(The stale-backup alert still uses `now.getTime()` — leave that line
unchanged.)

- [ ] **Step 4: Handle `?month=` in the route**

Replace `server/src/routes/dashboard.ts`'s route registration:

```ts
export function registerDashboardRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
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
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/dashboard/summary.test.ts src/routes/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/dashboard/summary.ts server/src/dashboard/summary.test.ts server/src/routes/dashboard.ts server/src/routes/dashboard.test.ts
git commit -m "Dashboard: honour an explicit month (opt + ?month= query)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `MonthContext`

**Files:**
- Create: `frontend/src/context/MonthContext.tsx`
- Create: `frontend/src/context/MonthContext.test.tsx`

**Interfaces:**
- Consumes: `api.listMonthlyClose` (`() => Promise<{ month: string;
  reviewed: boolean; reviewedAt: string | null }[]>`, already exported).
- Produces:
  ```ts
  interface MonthContextValue {
    month: string;
    setMonth: (m: string) => void;
    months: string[];
  }
  function MonthProvider({ children }: { children: ReactNode }): JSX.Element;
  function useMonth(): MonthContextValue;
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/context/MonthContext.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonthProvider, useMonth } from './MonthContext.js';
import * as api from '../lib/api.js';

const THIS_MONTH = new Date().toISOString().slice(0, 7);

function Probe() {
  const { month, setMonth, months } = useMonth();
  return (
    <div>
      <span data-testid="month">{month}</span>
      <span data-testid="months">{months.join(',')}</span>
      <button onClick={() => setMonth('2026-05')}>set</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-07', reviewed: false, reviewedAt: null },
    { month: '2026-06', reviewed: true, reviewedAt: 'x' },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('MonthContext', () => {
  it('defaults to the current calendar month with no stored value', () => {
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    expect(screen.getByTestId('month').textContent).toBe(THIS_MONTH);
  });

  it('uses a valid stored month over the default', () => {
    localStorage.setItem('fumarende.month', '2026-04');
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    expect(screen.getByTestId('month').textContent).toBe('2026-04');
  });

  it('setMonth updates the value and persists it', () => {
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('month').textContent).toBe('2026-05');
    expect(localStorage.getItem('fumarende.month')).toBe('2026-05');
  });

  it('builds months desc, always including this month and the active one', async () => {
    localStorage.setItem('fumarende.month', '2026-04');
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    await waitFor(() => expect(api.listMonthlyClose).toHaveBeenCalled());
    const months = screen.getByTestId('months').textContent!.split(',');
    expect(months).toContain(THIS_MONTH);
    expect(months).toContain('2026-04');
    expect(months).toContain('2026-06');
    expect([...months]).toEqual([...months].sort().reverse()); // desc
  });

  it('falls back to [month] when listMonthlyClose rejects', async () => {
    vi.spyOn(api, 'listMonthlyClose').mockRejectedValue(new Error('boom'));
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('months').textContent).toBe(THIS_MONTH),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/context/MonthContext.test.tsx`
Expected: FAIL — `Cannot find module './MonthContext.js'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/context/MonthContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../lib/api.js';

const STORAGE_KEY = 'fumarende.month';
const MONTH_RE = /^\d{4}-\d{2}$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && MONTH_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

interface MonthContextValue {
  month: string;
  setMonth: (m: string) => void;
  months: string[];
}

const MonthContext = createContext<MonthContextValue | undefined>(undefined);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonthState] = useState<string>(() => readStored() ?? currentMonth());
  const [dataMonths, setDataMonths] = useState<string[]>([]);

  const setMonth = useCallback((m: string) => {
    setMonthState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage unavailable — the in-memory value still updates */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listMonthlyClose()
      .then((rows) => {
        if (!cancelled) setDataMonths(rows.map((r) => r.month));
      })
      .catch(() => {
        if (!cancelled) setDataMonths([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const months = useMemo(() => {
    const set = new Set<string>([currentMonth(), month, ...dataMonths]);
    return [...set].filter((m) => MONTH_RE.test(m)).sort().reverse();
  }, [month, dataMonths]);

  const value = useMemo(() => ({ month, setMonth, months }), [month, setMonth, months]);

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
}

export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error('useMonth must be used within a MonthProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/context/MonthContext.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/MonthContext.tsx frontend/src/context/MonthContext.test.tsx
git commit -m "Add MonthContext: localStorage-backed selected-month state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: NavShell selector + AppShell wrapper

**Files:**
- Modify: `frontend/src/components/NavShell.tsx`
- Create: `frontend/src/components/NavShell.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useMonth` from `../context/MonthContext.js` (Task 2).
- Produces: `NavShell` now renders a `<select aria-label="Mês">`;
  `App.tsx` exposes an internal `AppShell` (not exported) that wraps
  `<NavShell />` in `<MonthProvider>` and is the route `element`.

- [ ] **Step 1: Write the failing NavShell test**

Create `frontend/src/components/NavShell.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NavShell } from './NavShell.js';
import { MonthProvider } from '../context/MonthContext.js';
import { AuthProvider } from '../context/AuthContext.js';
import * as api from '../lib/api.js';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({ passwordSet: true, authenticated: true });
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-07', reviewed: false, reviewedAt: null },
    { month: '2026-06', reviewed: false, reviewedAt: null },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderShell() {
  return render(
    <AuthProvider>
      <MonthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<NavShell />}>
              <Route path="/" element={<div>home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MonthProvider>
    </AuthProvider>,
  );
}

describe('NavShell month selector', () => {
  it('renders the Mês select with the fetched months and persists a change', async () => {
    renderShell();
    const select = (await screen.findByLabelText('Mês')) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole('option', { name: '2026-06' })).toBeInTheDocument());

    fireEvent.change(select, { target: { value: '2026-06' } });
    expect(select.value).toBe('2026-06');
    expect(localStorage.getItem('fumarende.month')).toBe('2026-06');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx`
Expected: FAIL — no `Mês` labelled control.

- [ ] **Step 3: Add the selector to `NavShell.tsx`**

In `frontend/src/components/NavShell.tsx`, add the import:

```ts
import { useMonth } from '../context/MonthContext.js';
```

Inside `NavShell()`, add `const { month, setMonth, months } = useMonth();`
next to `const { logout } = useAuth();`. Then, immediately after the
`fumarende` wordmark `<div>` and before the `NAV_ITEMS.map(...)`, insert:

```tsx
        <label
          style={{ display: 'block', padding: '0 22px 14px', fontSize: 11, color: 'var(--text3)' }}
        >
          Mês
          <select
            aria-label="Mês"
            className="field-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 4: Add the `AppShell` wrapper in `App.tsx`**

In `frontend/src/App.tsx`, add the import:

```ts
import { MonthProvider } from './context/MonthContext.js';
```

Add this component above `Router`:

```tsx
function AppShell() {
  return (
    <MonthProvider>
      <NavShell />
    </MonthProvider>
  );
}
```

and change the shell route element from `<NavShell />` to `<AppShell />`:

```tsx
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
```

- [ ] **Step 5: Update `App.test.tsx`**

In its `beforeEach`, after the existing `vi.spyOn(api, 'getDashboard')...`
block, add:

```ts
    vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);
```

In the first test ("leaves /login for the app shell once login
succeeds"), after the existing
`expect(screen.getByRole('link', { name: 'Receitas' })).toBeInTheDocument();`
line, add:

```ts
    expect(screen.getByLabelText('Mês')).toBeInTheDocument();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx src/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/NavShell.tsx frontend/src/components/NavShell.test.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "Add the Mês selector to NavShell; mount MonthProvider in the shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Wire the three month-scoped pages

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/DashboardPage.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/ReservaPage.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/AnalisePage.tsx` + `.test.tsx`

**Interfaces:**
- Consumes: `useMonth` from `../context/MonthContext.js` (Task 2).
- Produces: `getDashboard(month?: string)`; the three pages re-fetch on
  month change.

- [ ] **Step 1: `getDashboard(month?)` in `api.ts`**

Replace the existing `getDashboard` in `frontend/src/lib/api.ts`:

```ts
export function getDashboard(month?: string): Promise<DashboardSummary> {
  return request(`/api/dashboard${month ? `?month=${month}` : ''}`);
}
```

- [ ] **Step 2: Update `DashboardPage.test.tsx`**

Add the imports and wrap. At the top, import the provider:

```ts
import { MonthProvider } from '../context/MonthContext.js';
```

In `beforeEach`, add `vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);`
alongside the `getDashboard` mock, and `beforeEach(() => localStorage.clear());`
if not already clearing. Change every `render(<DashboardPage />)` to:

```ts
render(
  <MonthProvider>
    <DashboardPage />
  </MonthProvider>,
);
```

Add a test:

```ts
  it('requests the dashboard for the stored month', async () => {
    localStorage.setItem('fumarende.month', '2026-06');
    render(
      <MonthProvider>
        <DashboardPage />
      </MonthProvider>,
    );
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalledWith('2026-06'));
  });
```

(Because the default-month tests still pass the current month string to
`getDashboard`, update the "toggles the monthly close and re-fetches"
assertion if it checked `getDashboard` args — it only checks call
count, so no change.)

- [ ] **Step 3: Update `DashboardPage.tsx`**

Add the import:

```ts
import { useMonth } from '../context/MonthContext.js';
```

Inside `DashboardPage()`, add `const { month } = useMonth();`. Change
`load()` to `setSummary(await api.getDashboard(month));`. Change the
mount effect to depend on `month`:

```ts
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
```

(`load` is stable enough for this app's pattern; the existing pages use
the same bare-effect style.)

- [ ] **Step 4: Update `ReservaPage.tsx`**

Add the import `import { useMonth } from '../context/MonthContext.js';`.
Delete the module-level `const currentMonth = () => new
Date().toISOString().slice(0, 7);`. Inside `ReservaPage()`, add
`const { month } = useMonth();`. Replace `api.getMonthlyTarget(currentMonth())`
with `api.getMonthlyTarget(month)`. Replace the local
`const month = currentMonth();` line (used for `addedThisMonth` and the
Meta card) — it now shadows the hook value, so **delete that line**
(the hook's `month` is already in scope). Add `month` to the mount
effect's dep array:

```ts
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
```

- [ ] **Step 5: Update `ReservaPage.test.tsx`**

Import the provider and wrap every `render(<ReservaPage />)` in
`<MonthProvider>...</MonthProvider>`; add
`vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);` and
`localStorage.clear();` to `beforeEach`. Existing assertions use the
current month (the default) and keep passing.

- [ ] **Step 6: Update `AnalisePage.tsx`**

Add the import `import { useMonth } from '../context/MonthContext.js';`.
Inside `AnalisePage()`, add `const { month } = useMonth();`. In the
mount effect, replace `const month = new
Date().toISOString().slice(0, 7);` with nothing (use the hook value),
and add `month` to the effect's dep array. Where `essentialAverage` /
the projection anchor is computed, pass a date inside the selected
month: if the code calls `essentialAverage(expenses)` with no second
arg, change it to
`essentialAverage(expenses, new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15))`.

- [ ] **Step 7: Update `AnalisePage.test.tsx`**

Import the provider; wrap every `render(<AnalisePage />)` in
`<MonthProvider>`; add
`vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);` and
`localStorage.clear();` to `beforeEach`. Existing assertions default to
the current month and keep passing.

- [ ] **Step 8: Run the frontend suites**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/pages/ReservaPage.test.tsx src/pages/AnalisePage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test`
Expected: all pass.
Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/pages/ReservaPage.tsx frontend/src/pages/ReservaPage.test.tsx frontend/src/pages/AnalisePage.tsx frontend/src/pages/AnalisePage.test.tsx
git commit -m "Wire Dashboard / Reserva-meta / Análise to the selected month

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

- [ ] **Step 3: Extend the Dashboard section of `scripts/qa-e2e.sh`**

In the `== Dashboard ==` block, after the existing assertions, add:

```bash
aeq "dashboard honours ?month=2026-06" "2026-06" "$(body GET '/api/dashboard?month=2026-06' | jq -r '.month')"
as  "dashboard rejects a malformed ?month= -> 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/dashboard?month=nope")"
```

- [ ] **Step 4: Run the e2e QA**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (101 prior + 2 new = 103).

- [ ] **Step 5: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'dashboard bad month (unauth): %{http_code}\n' 'http://localhost:4173/api/dashboard?month=nope'
curl -s -o /dev/null -w 'home page: %{http_code}\n' http://localhost:4173/
```

Expected: `health: 200`, `dashboard bad month (unauth): 401` (auth
check runs before the query check), `home page: 200`.

- [ ] **Step 6: Manual browser check**

Hard-refresh. The nav now has a **Mês** dropdown under the wordmark.
Its options are the months that have data plus the current one. Pick a
past month → the Dashboard's figures, the Reserva "Meta Mensal" card,
and Análise's target/projection reflect that month; the list pages are
unchanged. Reload the page — the selection sticks.

- [ ] **Step 7: Append to `docs/qa-checklist.md`**

```markdown

## Month selector (nav shell)

- [x] `GET /api/dashboard?month=2026-06` returns a summary whose `month`
      is `2026-06`; `?month=nope` → 400 (e2e).
- [x] `dashboardSummary({ month })` computes for that month (prev month,
      evolution end, sums) and falls back to the current month on a
      malformed value (unit).
- [x] `MonthContext` — defaults to the current month, honours a valid
      stored value, `setMonth` persists to `localStorage`, `months` is
      the sorted-desc union incl. the current + active month, and a
      failed `listMonthlyClose` degrades to `[month]` (5 unit tests).
- [x] `NavShell` renders the `Mês` select and persists a change (unit).
- [ ] Changing the Mês dropdown updates the Dashboard, Reserva "Meta
      Mensal", and Análise views; the list pages are unaffected; the
      choice survives a reload (browser).
```

- [ ] **Step 8: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md
git commit -m "Add month-selector e2e QA assertions and checklist items"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `dashboardSummary` `month` opt (resolved-month keys everything; essential-avg anchored to it; backup alert stays real-now) | 1 |
| `GET /api/dashboard?month=` (400 on malformed) | 1 |
| `MonthContext` — default, stored value, persist, `months` union desc, resilient | 2 |
| `useMonth()` throws outside provider | 2 |
| `NavShell` `<select aria-label="Mês">` | 3 |
| `AppShell` mounts `MonthProvider` inside `ProtectedRoute` | 3 |
| `App.test` mocks `listMonthlyClose`, asserts the select | 3 |
| `getDashboard(month?)` | 4 (Step 1) |
| Dashboard / Reserva-meta / Análise consume `useMonth()` + re-fetch on change | 4 |
| Their tests wrap in `MonthProvider` + mock `listMonthlyClose` | 4 |
| List pages / FixedExpensesSection / Histórico Dólar untouched | not modified — correct |
| e2e `?month=` assertions | 5 (Step 3) |

**Placeholder scan:** none — every step is literal code or a literal
command.

**Type consistency:** `MonthContextValue` (`month: string`, `setMonth:
(m: string) => void`, `months: string[]`) is identical between Task 2's
definition and every consumer in Tasks 3–4. `useMonth()` returns it
unchanged. `getDashboard(month?: string)` in Task 4 Step 1 matches the
Task 4 Step 3 call `api.getDashboard(month)` and the Task 1 route's
`?month=` contract. `dashboardSummary(db, { now?, month?, dataPaths? })`
matches between Task 1's signature, Task 1's tests (`{ month: '2026-06',
now: NOW }`), and Task 1's route call (`{ month, dataPaths }`). The
`STORAGE_KEY` string `'fumarende.month'` is identical in Task 2's impl
and every test that inspects `localStorage`. `listMonthlyClose()`'s
return shape (`{ month; reviewed; reviewedAt }[]`) matches its existing
export and every mock.
