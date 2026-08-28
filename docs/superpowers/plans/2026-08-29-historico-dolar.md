# Histórico Dólar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Histórico Dólar — a self-reported monthly USD/BRL quote
log (one row per month, upsert), a rate line chart, and a
Mês / Cotação / Salário (US$) / Salário (R$) / vs média table.

**Architecture:** Follows the established module pattern. Adds the first
new migration since Foundation (`002_dollar_quotes`). A generic-free
data layer, a pure `quoteStats` helper mirrored server ↔ frontend, and
Fastify routes behind `requireAuth`. The chart is a hand-built inline
SVG polyline — no charting library.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-29-historico-dolar-design.md`

## Global Constraints

- Money is integer cents. The **rate** is a `REAL` / JS `number`
  (matching `exchange_contracts.contracted_rate`).
- `month` is the primary key: `YYYY-MM`. Re-registering a month
  **replaces** its row (upsert). `deleted_at` soft-deletes; upsert
  clears it.
- Reads filter `WHERE deleted_at IS NULL` and order by `month ASC` (time
  series).
- `averageRate`, `salaryBrlCents`, `vsAveragePct` are **derived** by
  `quoteStats`, never stored. The server module and frontend copy must
  stay byte-identical in their function bodies.
- **No external rate fetch, no PTAX tie-in, no charting library, no
  month selector.**
- Every task is TDD: failing test → red → minimal impl → green → commit.
- Run server tests from `server/`, frontend tests from `frontend/`
  (`npx vitest run <path>`, or `npm test` for the whole workspace).
- Work on a branch `historico-dolar` off `main`; the finishing skill
  merges it.

---

## File Structure

**New (server):**
- `server/src/db/migrations/002_dollar_quotes.ts` — the `migration002` export.
- `server/src/db/dollar-quotes.ts` — `upsertQuote` / `listQuotes` / `deleteQuote`.
- `server/src/db/dollar-quotes.test.ts`
- `server/src/dollar/stats.ts` — pure `quoteStats`.
- `server/src/dollar/stats.test.ts`
- `server/src/routes/dollar-quotes.ts` — `registerDollarQuoteRoutes(app, db)`.
- `server/src/routes/dollar-quotes.test.ts`

**New (frontend):**
- `frontend/src/lib/dollar.ts` — verbatim `quoteStats` copy.
- `frontend/src/lib/dollar.test.ts`
- `frontend/src/pages/HistoricoDolarPage.tsx` + `.test.tsx`

**Modified (server):**
- `server/src/db/migrate.ts` — register `migration002`.
- `server/src/db/migrate.test.ts` — assert `002` / `dollar_quotes`.
- `server/src/app.ts` — register the dollar-quote routes.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `DollarQuote` type + 3 client functions.
- `frontend/src/App.tsx` — mount `HistoricoDolarPage` at `/historico-dolar`.

**Modified (repo):**
- `scripts/qa-e2e.sh` — add a Histórico Dólar section.
- `docs/qa-checklist.md` — append Histórico Dólar checks.

---

## Task 1: Migration 002 + registration

**Files:**
- Create: `server/src/db/migrations/002_dollar_quotes.ts`
- Modify: `server/src/db/migrate.ts` (import + append to `MIGRATIONS`)
- Modify: `server/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `Migration` type from `../migrate.js` (existing).
- Produces: `export const migration002: Migration`.

- [ ] **Step 1: Update the failing test**

In `server/src/db/migrate.test.ts`, add `'dollar_quotes'` to the
`for (const expected of [...])` table list, and change the migration
assertions:

```ts
    const applied = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as { id: string }[];
    expect(applied.map((r) => r.id)).toEqual(['001_initial_schema', '002_dollar_quotes']);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/migrate.test.ts`
Expected: FAIL — `dollar_quotes` missing; only `001_initial_schema`
applied.

- [ ] **Step 3: Create the migration**

Create `server/src/db/migrations/002_dollar_quotes.ts`:

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

- [ ] **Step 4: Register it in `migrate.ts`**

In `server/src/db/migrate.ts`:

```ts
import { migration001 } from './migrations/001_initial_schema.js';
import { migration002 } from './migrations/002_dollar_quotes.js';
```

```ts
const MIGRATIONS: Migration[] = [migration001, migration002];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/002_dollar_quotes.ts server/src/db/migrate.ts server/src/db/migrate.test.ts
git commit -m "Add migration 002: dollar_quotes table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Dollar-quote data layer (server)

**Files:**
- Create: `server/src/db/dollar-quotes.ts`
- Test: `server/src/db/dollar-quotes.test.ts`

**Interfaces:**
- Consumes: `runMigrations` from `./migrate.js` (existing).
- Produces:
  ```ts
  interface DollarQuote { month: string; rate: number; salaryUsdCents: number | null }
  interface NewDollarQuote { month: string; rate: number; salaryUsdCents?: number | null }
  function upsertQuote(db: Database.Database, input: NewDollarQuote): DollarQuote;
  function listQuotes(db: Database.Database): DollarQuote[];
  function deleteQuote(db: Database.Database, month: string): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/db/dollar-quotes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { upsertQuote, listQuotes, deleteQuote } from './dollar-quotes.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('dollar-quote data layer', () => {
  it('creates a quote and lists it back', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    expect(listQuotes(db)).toEqual([
      { month: '2026-06', rate: 5.1, salaryUsdCents: null },
    ]);
  });

  it('replaces an existing month on a second upsert', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    upsertQuote(db, { month: '2026-06', rate: 5.3, salaryUsdCents: 600_000 });
    expect(listQuotes(db)).toEqual([
      { month: '2026-06', rate: 5.3, salaryUsdCents: 600_000 },
    ]);
  });

  it('lists quotes in ascending month order', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-07', rate: 5.2 });
    upsertQuote(db, { month: '2026-05', rate: 5.0 });
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    expect(listQuotes(db).map((q) => q.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('soft-deletes and lets a later upsert restore the month', () => {
    const db = freshDb();
    upsertQuote(db, { month: '2026-06', rate: 5.1 });
    deleteQuote(db, '2026-06');
    expect(listQuotes(db)).toHaveLength(0);
    upsertQuote(db, { month: '2026-06', rate: 5.0 });
    expect(listQuotes(db)).toEqual([{ month: '2026-06', rate: 5.0, salaryUsdCents: null }]);
  });

  it('rejects a malformed month, a non-positive rate, or a bad salary', () => {
    const db = freshDb();
    expect(() => upsertQuote(db, { month: '2026-6', rate: 5 })).toThrow();
    expect(() => upsertQuote(db, { month: 'nope', rate: 5 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 0 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: -1 })).toThrow();
    // @ts-expect-error deliberate bad input
    expect(() => upsertQuote(db, { month: '2026-06', rate: 'abc' })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 5, salaryUsdCents: -1 })).toThrow();
    expect(() => upsertQuote(db, { month: '2026-06', rate: 5, salaryUsdCents: 12.5 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/dollar-quotes.test.ts`
Expected: FAIL — `Cannot find module './dollar-quotes.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/dollar-quotes.ts`:

```ts
import type Database from 'better-sqlite3';

export interface DollarQuote {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export interface NewDollarQuote {
  month: string;
  rate: number;
  salaryUsdCents?: number | null;
}

interface DollarQuoteRow {
  month: string;
  rate: number;
  salary_usd_cents: number | null;
}

function validate(input: NewDollarQuote): void {
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    throw new Error('month must be in YYYY-MM format');
  }
  if (typeof input.rate !== 'number' || !Number.isFinite(input.rate) || input.rate <= 0) {
    throw new Error('rate must be a positive number');
  }
  const s = input.salaryUsdCents;
  if (s !== undefined && s !== null && (!Number.isInteger(s) || s < 0)) {
    throw new Error('salaryUsdCents must be a non-negative integer');
  }
}

export function upsertQuote(db: Database.Database, input: NewDollarQuote): DollarQuote {
  validate(input);
  db.prepare(
    `INSERT INTO dollar_quotes (month, rate, salary_usd_cents, deleted_at)
     VALUES (@month, @rate, @salaryUsdCents, NULL)
     ON CONFLICT(month) DO UPDATE SET
       rate = excluded.rate,
       salary_usd_cents = excluded.salary_usd_cents,
       deleted_at = NULL`,
  ).run({
    month: input.month,
    rate: input.rate,
    salaryUsdCents: input.salaryUsdCents ?? null,
  });

  const row = db
    .prepare('SELECT month, rate, salary_usd_cents FROM dollar_quotes WHERE month = ?')
    .get(input.month) as DollarQuoteRow;
  return { month: row.month, rate: row.rate, salaryUsdCents: row.salary_usd_cents };
}

export function listQuotes(db: Database.Database): DollarQuote[] {
  const rows = db
    .prepare(
      `SELECT month, rate, salary_usd_cents
       FROM dollar_quotes
       WHERE deleted_at IS NULL
       ORDER BY month ASC`,
    )
    .all() as DollarQuoteRow[];
  return rows.map((r) => ({ month: r.month, rate: r.rate, salaryUsdCents: r.salary_usd_cents }));
}

export function deleteQuote(db: Database.Database, month: string): void {
  db.prepare('UPDATE dollar_quotes SET deleted_at = ? WHERE month = ?').run(
    new Date().toISOString(),
    month,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/dollar-quotes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/dollar-quotes.ts server/src/db/dollar-quotes.test.ts
git commit -m "Add dollar-quote data layer (upsert by month, soft delete)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: quoteStats helper (server, pure)

**Files:**
- Create: `server/src/dollar/stats.ts`
- Test: `server/src/dollar/stats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  interface QuoteRow {
    month: string;
    rate: number;
    salaryUsdCents: number | null;
    salaryBrlCents: number | null;
    vsAveragePct: number;
  }
  interface QuoteStats { averageRate: number; rows: QuoteRow[] }
  function quoteStats(
    quotes: { month: string; rate: number; salaryUsdCents: number | null }[],
  ): QuoteStats;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/dollar/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quoteStats } from './stats.js';

describe('quoteStats', () => {
  it('computes the average rate, per-row salary-in-BRL, and vs-average %', () => {
    const stats = quoteStats([
      { month: '2026-05', rate: 5.0, salaryUsdCents: 500_000 },
      { month: '2026-06', rate: 5.2, salaryUsdCents: null },
      { month: '2026-07', rate: 5.6, salaryUsdCents: null },
    ]);

    expect(stats.averageRate).toBeCloseTo((5.0 + 5.2 + 5.6) / 3, 10);
    expect(stats.rows[0].salaryBrlCents).toBe(Math.round(500_000 * 5.0));
    expect(stats.rows[1].salaryBrlCents).toBeNull();
    expect(stats.rows[0].vsAveragePct).toBeCloseTo(
      ((5.0 - stats.averageRate) / stats.averageRate) * 100,
      10,
    );
    expect(stats.rows.map((r) => r.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('returns zeros for an empty input', () => {
    expect(quoteStats([])).toEqual({ averageRate: 0, rows: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/dollar/stats.test.ts`
Expected: FAIL — `Cannot find module './stats.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/dollar/stats.ts`:

```ts
export interface QuoteInput {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export interface QuoteRow extends QuoteInput {
  salaryBrlCents: number | null;
  vsAveragePct: number;
}

export interface QuoteStats {
  averageRate: number;
  rows: QuoteRow[];
}

/**
 * Derives the average rate, each month's USD salary converted to BRL at
 * that month's rate, and each rate's percentage distance from the
 * average. Rows keep the input order (callers pass them ascending by
 * month).
 */
export function quoteStats(quotes: QuoteInput[]): QuoteStats {
  if (quotes.length === 0) return { averageRate: 0, rows: [] };

  const averageRate = quotes.reduce((s, q) => s + q.rate, 0) / quotes.length;

  const rows = quotes.map((q) => ({
    ...q,
    salaryBrlCents: q.salaryUsdCents !== null ? Math.round(q.salaryUsdCents * q.rate) : null,
    vsAveragePct: averageRate > 0 ? ((q.rate - averageRate) / averageRate) * 100 : 0,
  }));

  return { averageRate, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/dollar/stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/dollar/stats.ts server/src/dollar/stats.test.ts
git commit -m "Add quoteStats: average rate, salary-in-BRL, vs-average %

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Dollar-quote API routes (server)

**Files:**
- Create: `server/src/routes/dollar-quotes.ts`
- Modify: `server/src/app.ts` (import + call after the target routes)
- Test: `server/src/routes/dollar-quotes.test.ts`

**Interfaces:**
- Consumes: `upsertQuote` / `listQuotes` / `deleteQuote` from `../db/dollar-quotes.js` (Task 2); `requireAuth`; `buildApp`.
- Produces: `registerDollarQuoteRoutes(app: FastifyInstance, db: Database.Database): void`, and:
  - `GET /api/dollar-quotes` → `DollarQuote[]`
  - `PUT /api/dollar-quotes/:month` → `DollarQuote` | `400 { error }`
  - `DELETE /api/dollar-quotes/:month` → `{ ok: true }`

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/dollar-quotes.test.ts`:

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

describe('dollar-quote routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/dollar-quotes' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('upserts a month and lists it, then replaces it', async () => {
    const { app, sessionCookie } = await authedApp();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.1, salaryUsdCents: 500_000 },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ month: '2026-06', rate: 5.1, salaryUsdCents: 500_000 });

    await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.35 },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/dollar-quotes',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toEqual([{ month: '2026-06', rate: 5.35, salaryUsdCents: null }]);
    await app.close();
  });

  it('rejects a malformed month or a non-positive rate', async () => {
    const { app, sessionCookie } = await authedApp();
    const badMonth = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-6',
      cookies: { session: sessionCookie },
      payload: { rate: 5 },
    });
    expect(badMonth.statusCode).toBe(400);

    const badRate = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-07',
      cookies: { session: sessionCookie },
      payload: { rate: 0 },
    });
    expect(badRate.statusCode).toBe(400);
    await app.close();
  });

  it('deletes a month, tolerating an empty JSON body', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.1 },
    });

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/dollar-quotes',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/dollar-quotes.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/dollar-quotes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { upsertQuote, listQuotes, deleteQuote } from '../db/dollar-quotes.js';

interface PutBody {
  rate: number;
  salaryUsdCents?: number | null;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function registerDollarQuoteRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/dollar-quotes', { preHandler: requireAuth(db) }, async () => listQuotes(db));

  app.put<{ Params: { month: string }; Body: PutBody }>(
    '/api/dollar-quotes/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      const body = request.body;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate <= 0) {
        return reply.code(400).send({ error: 'rate must be a positive number' });
      }
      const s = body.salaryUsdCents;
      if (s !== undefined && s !== null && (!Number.isInteger(s) || s < 0)) {
        return reply.code(400).send({ error: 'salaryUsdCents must be a non-negative integer' });
      }
      return upsertQuote(db, { month, rate: body.rate, salaryUsdCents: s ?? null });
    },
  );

  app.delete<{ Params: { month: string } }>(
    '/api/dollar-quotes/:month',
    { preHandler: requireAuth(db) },
    async (request) => {
      deleteQuote(db, request.params.month);
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import beside the target-routes import:

```ts
import { registerTargetRoutes } from './routes/targets.js';
import { registerDollarQuoteRoutes } from './routes/dollar-quotes.js';
```

and call it after the two `registerTargetRoutes(...)` lines:

```ts
  registerTargetRoutes(app, db, { table: 'goals', basePath: '/api/goals' });
  registerTargetRoutes(app, db, { table: 'special_projects', basePath: '/api/special-projects' });
  registerDollarQuoteRoutes(app, db);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/dollar-quotes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green (150 from prior modules + Tasks 1–4: migrate test
grows, + 5 + 2 + 4).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/dollar-quotes.ts server/src/routes/dollar-quotes.test.ts server/src/app.ts
git commit -m "Add dollar-quote API routes behind requireAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend lib + API client

**Files:**
- Create: `frontend/src/lib/dollar.ts`
- Create: `frontend/src/lib/dollar.test.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the existing private `request<T>()` helper.
- Produces:
  - `frontend/src/lib/dollar.ts` — `quoteStats` + `QuoteRow` /
    `QuoteStats` (identical to Task 3).
  - `frontend/src/lib/api.ts` — `DollarQuote` interface;
    `listDollarQuotes` / `upsertDollarQuote` / `deleteDollarQuote`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/dollar.test.ts` — a copy of Task 3's
`stats.test.ts` with the import `./dollar.js`. Same two `it` blocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/dollar.test.ts`
Expected: FAIL — `Cannot find module './dollar.js'`.

- [ ] **Step 3: Create `frontend/src/lib/dollar.ts`**

Copy Task 3's `server/src/dollar/stats.ts` **verbatim** (identical
interfaces and body). Header comment:

```ts
// Mirrors server/src/dollar/stats.ts exactly — keep the two in sync.
```

- [ ] **Step 4: Extend `frontend/src/lib/api.ts`**

Append:

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

- [ ] **Step 5: Run test + type-check**

Run: `cd frontend && npx vitest run src/lib/dollar.test.ts`
Expected: PASS (2 tests).
Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/dollar.ts frontend/src/lib/dollar.test.ts frontend/src/lib/api.ts
git commit -m "Add dollar frontend lib (quoteStats) and API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: HistoricoDolarPage + route wiring (frontend)

**Files:**
- Create: `frontend/src/pages/HistoricoDolarPage.tsx`
- Create: `frontend/src/pages/HistoricoDolarPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.listDollarQuotes` / `api.upsertDollarQuote` / `api.deleteDollarQuote` / `api.DollarQuote` (Task 5); `quoteStats` from `../lib/dollar.js` (Task 5); `formatCentsBRL` / `formatCentsUSD` / `parseCentsFromInput` / `parseRate` from `../lib/money.js`.
- Produces: `HistoricoDolarPage` React component (named export), mounted at `/historico-dolar`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/HistoricoDolarPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HistoricoDolarPage } from './HistoricoDolarPage.js';
import * as api from '../lib/api.js';

describe('HistoricoDolarPage', () => {
  it('lists existing quotes with the rate and salary-in-BRL', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([
      { month: '2026-06', rate: 5.12, salaryUsdCents: 500_000 },
    ]);

    render(<HistoricoDolarPage />);

    expect(await screen.findByText('5.1200')).toBeInTheDocument();
    // salary in BRL = round(500_000 * 5.12) = 2_560_000 -> R$ 25.600,00
    expect(screen.getByText('R$ 25.600,00')).toBeInTheDocument();
  });

  it('shows the empty state when there are no quotes', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([]);
    render(<HistoricoDolarPage />);
    expect(await screen.findByText('Nenhuma cotação registrada.')).toBeInTheDocument();
  });

  it('submits a quote with the parsed rate and salary', async () => {
    const listSpy = vi
      .spyOn(api, 'listDollarQuotes')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ month: '2026-08', rate: 5.25, salaryUsdCents: 400_000 }]);
    const putSpy = vi.spyOn(api, 'upsertDollarQuote').mockResolvedValue({
      month: '2026-08',
      rate: 5.25,
      salaryUsdCents: 400_000,
    });

    render(<HistoricoDolarPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('Cotação'), { target: { value: '5,25' } });
    fireEvent.change(screen.getByLabelText('Salário no mês (US$)'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cotação' }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('2026-08', { rate: 5.25, salaryUsdCents: 400_000 }),
    );
  });

  it('sends salaryUsdCents null when the salary field is blank', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([]);
    const putSpy = vi
      .spyOn(api, 'upsertDollarQuote')
      .mockResolvedValue({ month: '2026-08', rate: 5.25, salaryUsdCents: null });

    render(<HistoricoDolarPage />);
    await waitFor(() => expect(api.listDollarQuotes).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('Cotação'), { target: { value: '5.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cotação' }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('2026-08', { rate: 5.25, salaryUsdCents: null }),
    );
  });

  it('deletes a row', async () => {
    vi.spyOn(api, 'listDollarQuotes')
      .mockResolvedValueOnce([{ month: '2026-06', rate: 5.1, salaryUsdCents: null }])
      .mockResolvedValueOnce([]);
    const delSpy = vi.spyOn(api, 'deleteDollarQuote').mockResolvedValue({ ok: true });

    render(<HistoricoDolarPage />);
    expect(
      await screen.findByRole('button', { name: 'Excluir cotação de 2026-06' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir cotação de 2026-06' }));
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('2026-06'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/HistoricoDolarPage.test.tsx`
Expected: FAIL — `Cannot find module './HistoricoDolarPage.js'`.

- [ ] **Step 3: Create `frontend/src/pages/HistoricoDolarPage.tsx`**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput, parseRate } from '../lib/money.js';
import { quoteStats } from '../lib/dollar.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;
const currentMonth = () => new Date().toISOString().slice(0, 7);

export function HistoricoDolarPage() {
  const [quotes, setQuotes] = useState<api.DollarQuote[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [rateInput, setRateInput] = useState('');
  const [salaryInput, setSalaryInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setQuotes(await api.listDollarQuotes());
  }

  useEffect(() => {
    refresh();
  }, []);

  const stats = useMemo(() => quoteStats(quotes), [quotes]);

  const chartPoints = useMemo(() => {
    if (stats.rows.length < 2) return '';
    const rates = stats.rows.map((r) => r.rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const span = max - min || 1;
    const w = 320;
    const h = 80;
    return stats.rows
      .map((r, i) => {
        const x = (i / (stats.rows.length - 1)) * w;
        const y = h - ((r.rate - min) / span) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [stats]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!month) {
      setError('Informe o mês');
      return;
    }
    const rate = parseRate(rateInput);
    if (Number.isNaN(rate) || rate <= 0) {
      setError('Cotação inválida');
      return;
    }
    let salaryUsdCents: number | null = null;
    if (salaryInput.trim() !== '') {
      const parsed = parseCentsFromInput(salaryInput);
      if (Number.isNaN(parsed) || parsed < 0) {
        setError('Salário inválido');
        return;
      }
      salaryUsdCents = parsed;
    }

    try {
      await api.upsertDollarQuote(month, { rate, salaryUsdCents });
      setRateInput('');
      setSalaryInput('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(m: string) {
    setError(null);
    try {
      await api.deleteDollarQuote(m);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 8 }}>Histórico Dólar</h1>
      <p style={{ color: 'var(--text3)', fontSize: 12.5, marginBottom: 20 }}>
        Como a cotação afeta seu salário em reais.
      </p>

      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="dol-month" style={fieldStyle}>Mês</label>
          <input id="dol-month" type="month" className="field-input" value={month}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dol-rate" style={fieldStyle}>Cotação</label>
          <input id="dol-rate" type="text" className="field-input" value={rateInput}
            placeholder="5,12" onChange={(e) => setRateInput(e.target.value)} />
        </div>
        <div>
          <label htmlFor="dol-salary" style={fieldStyle}>Salário no mês (US$)</label>
          <input id="dol-salary" type="text" className="field-input" value={salaryInput}
            onChange={(e) => setSalaryInput(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">Registrar cotação</button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {stats.rows.length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <svg
            viewBox="0 0 320 80"
            preserveAspectRatio="none"
            style={{ width: '100%', height: 80 }}
          >
            <polyline points={chartPoints} fill="none" stroke="var(--cyan)" strokeWidth="2" />
          </svg>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text3)',
            }}
          >
            <span>{stats.rows[0].month}</span>
            <span>{stats.rows[stats.rows.length - 1].month}</span>
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {quotes.length === 0 ? (
          <p style={{ color: 'var(--text3)' }}>Nenhuma cotação registrada.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                <th style={{ padding: '6px 8px' }}>Mês</th>
                <th style={{ padding: '6px 8px' }}>Cotação</th>
                <th style={{ padding: '6px 8px' }}>Salário (US$)</th>
                <th style={{ padding: '6px 8px' }}>Salário (R$)</th>
                <th style={{ padding: '6px 8px' }}>vs média</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.month} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{r.month}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.rate.toFixed(4)}
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.salaryUsdCents !== null ? formatCentsUSD(r.salaryUsdCents) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)' }}>
                    {r.salaryBrlCents !== null ? formatCentsBRL(r.salaryBrlCents) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '6px 8px',
                      fontFamily: 'var(--mono)',
                      color: 'var(--text2)',
                    }}
                  >
                    {r.vsAveragePct >= 0 ? '+' : ''}
                    {r.vsAveragePct.toFixed(2)}%
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.month)}
                      aria-label={`Excluir cotação de ${r.month}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: 12.5,
                        color: 'var(--text3)',
                        cursor: 'pointer',
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/HistoricoDolarPage.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the route in `frontend/src/App.tsx`**

Add the import:

```ts
import { HistoricoDolarPage } from './pages/HistoricoDolarPage.js';
```

Replace:

```tsx
            <Route path="/historico-dolar" element={<PlaceholderPage title="Histórico Dólar" />} />
```

with:

```tsx
            <Route path="/historico-dolar" element={<HistoricoDolarPage />} />
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/HistoricoDolarPage.tsx frontend/src/pages/HistoricoDolarPage.test.tsx frontend/src/App.tsx
git commit -m "Add HistoricoDolarPage: quote form, rate chart, salary table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Build, e2e QA, smoke test, checklist

**Files:**
- Modify: `scripts/qa-e2e.sh`
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Full test sweep**

Run: `cd server && npm test` — expected all green.
Run: `cd frontend && npm test` — expected all green.

- [ ] **Step 2: Production build**

Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 3: Add a Histórico Dólar section to `scripts/qa-e2e.sh`**

Insert this block after the "Metas + Projetos" section and before the
"Análise" section:

```bash
echo
echo "== Histórico Dólar =="
as  "upsert 2026-06 rate 5.1 -> 200" 200 "$(code PUT /api/dollar-quotes/2026-06 '{"rate":5.1,"salaryUsdCents":500000}')"
aeq "quote list has 1 row" "1" "$(body GET /api/dollar-quotes | jq 'length')"
body PUT /api/dollar-quotes/2026-06 '{"rate":5.35}' >/dev/null
DQ="$(body GET /api/dollar-quotes)"
aeq "second upsert replaces the month (still 1 row)" "1" "$(echo "$DQ" | jq 'length')"
aeq "replaced row has the new rate" "5.35" "$(echo "$DQ" | jq -r '.[0].rate')"
aeq "replaced row salary cleared to null" "null" "$(echo "$DQ" | jq -r '.[0].salaryUsdCents')"
as  "reject bad month in URL -> 400" 400 "$(code PUT /api/dollar-quotes/2026-6 '{"rate":5}')"
as  "reject rate 0 -> 400" 400 "$(code PUT /api/dollar-quotes/2026-07 '{"rate":0}')"
as  "delete 2026-06 -> 200" 200 "$(code DELETE /api/dollar-quotes/2026-06)"
aeq "quote list now empty" "0" "$(body GET /api/dollar-quotes | jq 'length')"
```

Also add `/api/dollar-quotes` to the Análise section's endpoint loop is
**not** needed (Análise does not read it) — leave that loop as is.

- [ ] **Step 4: Run the e2e QA**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (74 prior + 9 new = 83).

- [ ] **Step 5: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'dollar-quotes (unauth): %{http_code}\n' http://localhost:4173/api/dollar-quotes
curl -s -o /dev/null -w 'historico page: %{http_code}\n' http://localhost:4173/historico-dolar
```

Expected: `health: 200`, `dollar-quotes (unauth): 401`,
`historico page: 200`. (Migration 002 applies automatically on this
restart — the live DB gains the `dollar_quotes` table.)

- [ ] **Step 6: Manual browser check**

Hard-refresh, open **Histórico Dólar**. Register a month (e.g.
`2026-06`, cotação `5,12`, salário `4000`) — a table row appears with
Cotação `5.1200`, Salário (US$) `$4,000.00`, Salário (R$) `R$ 20.480,00`,
vs média `+0.00%`. Register a second month with a different rate — the
line chart appears and "vs média" on both rows shifts. Re-register the
first month with a new rate — its row updates in place. Delete a row.

- [ ] **Step 7: Append to `docs/qa-checklist.md`**

```markdown

## Histórico Dólar

- [ ] Histórico Dólar page loads from the nav (no longer "em breve").
- [ ] Registering a month adds a table row with Cotação, Salário (US$),
      Salário (R$) = salário × cotação, and vs média.
- [ ] Re-registering the same month replaces its row in place (one row
      per month).
- [ ] A second month makes the rate line chart appear and shifts the
      "vs média" column.
- [ ] Leaving the salary field blank stores no salary; the table shows
      "—" for that month's Salário columns.
- [ ] An invalid entry (blank month, non-numeric cotação) shows an
      inline error and saves nothing.
- [ ] "Excluir" removes the row.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md
git commit -m "Add Histórico Dólar e2e QA section and checklist items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Migration `002_dollar_quotes` + registration | 1 |
| `migrate.test` asserts `002` / `dollar_quotes` | 1 (Step 1) |
| `upsertQuote` (validate, ON CONFLICT clears deleted_at), `listQuotes` (ASC), `deleteQuote` | 2 |
| delete-then-upsert restores the row | 2 (test + impl) |
| `quoteStats` (average, salary-in-BRL, vs-average %) | 3 (server), 5 (frontend copy) |
| `GET/PUT/DELETE /api/dollar-quotes` behind auth; month + rate + salary guards | 4 |
| Register routes in `app.ts` | 4 (Step 4) |
| `DollarQuote` type + `listDollarQuotes` / `upsertDollarQuote` / `deleteDollarQuote` | 5 |
| `HistoricoDolarPage` — form, SVG rate chart, Mês/Cotação/Salário/vs-média table, delete, empty state | 6 |
| Mount at `/historico-dolar` | 6 (Step 5) |
| e2e QA section | 7 (Step 3) |
| Testing at every layer | 1–6 |
| Out of scope: external fetch, PTAX tie-in, charting lib, month selector | not implemented — correct |

**Placeholder scan:** none — every step has literal code or a literal command.

**Type consistency:** `DollarQuote` / `NewDollarQuote` fields match
across Task 2 (server), Task 4 (route body/return), Task 5 (`api.ts`),
and Task 6's mocks. `QuoteInput` / `QuoteRow` / `QuoteStats` are
identical between Task 3 and Task 5. `quoteStats(quotes)` signature
matches between the modules and Task 6's `useMemo`. Route paths
(`/api/dollar-quotes`, `/api/dollar-quotes/:month`) match between Task 4
and Task 5's client. `upsertDollarQuote(month, { rate, salaryUsdCents? })`
is called with exactly that shape in Task 6's tests. Test label /
aria-label strings (`'Mês'`, `'Cotação'`, `'Salário no mês (US$)'`,
`'Registrar cotação'`, `'Excluir cotação de <month>'`,
`'Nenhuma cotação registrada.'`, `'5.1200'`, `'5.25'`) match between
Task 6's component and its test. The `rate.toFixed(4)` in the table
matches the test's `getByText('5.1200')`.
