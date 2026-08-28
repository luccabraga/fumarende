# Metas + Projetos Especiais Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Metas (personal savings goals) and Projetos Especiais
(larger one-off efforts) — CRUD, a quick "add to current" action, a
derived progress/suggestion display — as two pages sharing one generic
server data layer, one route factory, and one React card component.

**Architecture:** Follows the Câmbio / Gastos / Reserva pattern. The
`goals` and `special_projects` tables are structurally identical
(`special_projects` adds `notes`), so one generic data-layer module
takes a `TargetTable` argument, and route registration is a factory
called twice. Completion and the suggested monthly contribution are
derived from the row fields by a pure function — never stored.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-28-metas-projetos-design.md`

## Global Constraints

- Money is stored and passed as **integer cents**.
- Deletes are **soft**: set `deleted_at`, never `DELETE FROM`. Reads
  filter `WHERE deleted_at IS NULL`.
- Table names passed to the data layer are validated against a fixed
  allowlist (`'goals'`, `'special_projects'`) — never interpolated blind.
- `notes` exists only on `special_projects`; for `goals` the data layer
  omits it from SQL and the view's `notes` is always `null`.
- Completion (`current >= target`) and the suggested monthly
  contribution are **derived**, never persisted. `status` stays at its
  `'active'` default.
- **No emoji, no manual status toggle, no per-contribution ledger, no
  month selector, no AI.**
- Every task is TDD: failing test → red → minimal impl → green → commit.
- Run server tests from `server/`, frontend tests from `frontend/`
  (`npx vitest run <path>`, or `npm test` for the whole workspace).
  Running vitest from the repo root mixes configs and is not valid.
- Work on a branch `metas-projetos` off `main`; the finishing skill
  merges it.

---

## File Structure

**New (server):**
- `server/src/targets/progress.ts` — pure `monthsUntil`, `targetProgress`. No imports.
- `server/src/targets/progress.test.ts`
- `server/src/db/targets.ts` — generic `createTarget` / `listTargets` / `updateTarget` / `addToTarget` / `softDeleteTarget` over a `TargetTable`.
- `server/src/db/targets.test.ts`
- `server/src/routes/targets.ts` — `registerTargetRoutes(app, db, { table, basePath })` factory.
- `server/src/routes/targets.test.ts`

**New (frontend):**
- `frontend/src/lib/targets.ts` — `monthsUntil` + `targetProgress` (copy).
- `frontend/src/lib/targets.test.ts`
- `frontend/src/components/TargetCard.tsx` + `.test.tsx`
- `frontend/src/components/TargetSection.tsx` + `.test.tsx`
- `frontend/src/pages/MetasPage.tsx` + `.test.tsx`
- `frontend/src/pages/ProjetosPage.tsx` + `.test.tsx`

**Modified (server):**
- `server/src/app.ts` — call `registerTargetRoutes` twice, after `registerSavingsRoutes`.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `Target` type, `targetsClient` factory, `goalsApi`, `projectsApi`.
- `frontend/src/App.tsx` — mount `MetasPage` at `/metas`, `ProjetosPage` at `/projetos`.
- `docs/qa-checklist.md` — append Metas / Projetos checks.

---

## Task 1: Progress maths (server, pure)

**Files:**
- Create: `server/src/targets/progress.ts`
- Test: `server/src/targets/progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  function monthsUntil(targetDate: string | null, today?: Date): number | null;
  interface TargetInput { targetCents: number; currentCents: number; targetDate: string | null }
  interface TargetProgress {
    remainingCents: number;
    progressPct: number;
    suggestedMonthlyCents: number | null;
    complete: boolean;
  }
  function targetProgress(input: TargetInput, today?: Date): TargetProgress;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/targets/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthsUntil, targetProgress } from './progress.js';

const AUG_15 = new Date(2026, 7, 15); // 15 Aug 2026

describe('monthsUntil', () => {
  it('counts whole months to a future date', () => {
    expect(monthsUntil('2026-11-01', AUG_15)).toBe(3);
    expect(monthsUntil('2026-09-30', AUG_15)).toBe(1);
  });

  it('returns null for an empty, same-month, or past date', () => {
    expect(monthsUntil(null, AUG_15)).toBeNull();
    expect(monthsUntil('2026-08-31', AUG_15)).toBeNull();
    expect(monthsUntil('2026-07-01', AUG_15)).toBeNull();
  });
});

describe('targetProgress', () => {
  it('computes remaining, pct, suggestion and complete for an in-progress target', () => {
    const p = targetProgress(
      { targetCents: 100_000, currentCents: 25_000, targetDate: '2026-11-01' },
      AUG_15,
    );
    expect(p).toEqual({
      remainingCents: 75_000,
      progressPct: 25,
      suggestedMonthlyCents: 25_000,
      complete: false,
    });
  });

  it('caps pct at 100, zeroes remaining, and drops the suggestion when complete', () => {
    const p = targetProgress(
      { targetCents: 100_000, currentCents: 120_000, targetDate: null },
      AUG_15,
    );
    expect(p).toEqual({
      remainingCents: 0,
      progressPct: 100,
      suggestedMonthlyCents: null,
      complete: true,
    });
  });

  it('treats a zero target as complete with 0% progress', () => {
    const p = targetProgress({ targetCents: 0, currentCents: 0, targetDate: null }, AUG_15);
    expect(p).toMatchObject({ progressPct: 0, complete: true, suggestedMonthlyCents: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/targets/progress.test.ts`
Expected: FAIL — `Cannot find module './progress.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/targets/progress.ts`:

```ts
/**
 * Whole months from `today` to `targetDate` (YYYY-MM-DD), on year/month
 * only. Returns null when the date is empty/null or not strictly after
 * today's month. `today` is a parameter only for deterministic tests.
 */
export function monthsUntil(targetDate: string | null, today: Date = new Date()): number | null {
  if (!targetDate) return null;
  const [ty, tm] = targetDate.split('-').map(Number);
  const months = (ty - today.getFullYear()) * 12 + (tm - (today.getMonth() + 1));
  return months > 0 ? months : null;
}

export interface TargetInput {
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
}

export interface TargetProgress {
  remainingCents: number;
  progressPct: number;
  suggestedMonthlyCents: number | null;
  complete: boolean;
}

export function targetProgress(input: TargetInput, today: Date = new Date()): TargetProgress {
  const remainingCents = Math.max(0, input.targetCents - input.currentCents);
  const progressPct =
    input.targetCents > 0
      ? Math.min((input.currentCents / input.targetCents) * 100, 100)
      : 0;
  const complete = input.currentCents >= input.targetCents;

  const months = monthsUntil(input.targetDate, today);
  const suggestedMonthlyCents =
    months !== null && remainingCents > 0 ? Math.round(remainingCents / months) : null;

  return { remainingCents, progressPct, suggestedMonthlyCents, complete };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/targets/progress.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/targets/progress.ts server/src/targets/progress.test.ts
git commit -m "Add target progress maths (months-until, remaining, suggestion)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Generic target data layer (server)

**Files:**
- Create: `server/src/db/targets.ts`
- Test: `server/src/db/targets.test.ts`

**Interfaces:**
- Consumes: `runMigrations` from `./migrate.js` (existing).
- Produces:
  ```ts
  type TargetTable = 'goals' | 'special_projects';
  interface Target {
    id: number;
    name: string;
    targetCents: number;
    currentCents: number;
    targetDate: string | null;
    notes: string | null;
    status: string;
  }
  interface NewTarget {
    name: string;
    targetCents: number;
    currentCents?: number;
    targetDate?: string | null;
    notes?: string | null;
  }
  interface TargetPatch {
    name?: string;
    targetCents?: number;
    currentCents?: number;
    targetDate?: string | null;
    notes?: string | null;
  }
  function createTarget(db: Database.Database, table: TargetTable, input: NewTarget): number;
  function listTargets(db: Database.Database, table: TargetTable): Target[];
  function updateTarget(db: Database.Database, table: TargetTable, id: number, patch: TargetPatch): void;
  function addToTarget(db: Database.Database, table: TargetTable, id: number, deltaCents: number): void;
  function softDeleteTarget(db: Database.Database, table: TargetTable, id: number): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/db/targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createTarget,
  listTargets,
  updateTarget,
  addToTarget,
  softDeleteTarget,
  type TargetTable,
} from './targets.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const TABLES: TargetTable[] = ['goals', 'special_projects'];

describe.each(TABLES)('target data layer (%s)', (table) => {
  it('creates then lists a row with the right fields', () => {
    const db = freshDb();
    const id = createTarget(db, table, {
      name: 'PS5',
      targetCents: 400_000,
      currentCents: 50_000,
      targetDate: '2026-12-01',
    });
    const [row] = listTargets(db, table);
    expect(row).toMatchObject({
      id,
      name: 'PS5',
      targetCents: 400_000,
      currentCents: 50_000,
      targetDate: '2026-12-01',
      status: 'active',
    });
  });

  it('rejects a blank name, non-positive target, or negative current', () => {
    const db = freshDb();
    expect(() => createTarget(db, table, { name: '  ', targetCents: 1000 })).toThrow();
    expect(() => createTarget(db, table, { name: 'x', targetCents: 0 })).toThrow();
    expect(() =>
      createTarget(db, table, { name: 'x', targetCents: 1000, currentCents: -1 }),
    ).toThrow();
  });

  it('lists newest first', () => {
    const db = freshDb();
    createTarget(db, table, { name: 'A', targetCents: 100 });
    createTarget(db, table, { name: 'B', targetCents: 100 });
    expect(listTargets(db, table).map((t) => t.name)).toEqual(['B', 'A']);
  });

  it('updates provided keys and no-ops on an empty patch', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Trip', targetCents: 100_000 });
    updateTarget(db, table, id, { currentCents: 5_000, name: 'Big Trip' });
    updateTarget(db, table, id, {});
    expect(listTargets(db, table)[0]).toMatchObject({ name: 'Big Trip', currentCents: 5_000 });
  });

  it('addToTarget increments current; a non-positive delta throws', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Bike', targetCents: 100_000, currentCents: 1_000 });
    addToTarget(db, table, id, 2_000);
    expect(listTargets(db, table)[0].currentCents).toBe(3_000);
    expect(() => addToTarget(db, table, id, 0)).toThrow();
    expect(() => addToTarget(db, table, id, -1)).toThrow();
  });

  it('excludes soft-deleted rows', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Gone', targetCents: 100 });
    softDeleteTarget(db, table, id);
    expect(listTargets(db, table)).toHaveLength(0);
  });
});

describe('notes handling differs by table', () => {
  it('goals always reports notes as null', () => {
    const db = freshDb();
    createTarget(db, 'goals', { name: 'x', targetCents: 100, notes: 'ignored' });
    expect(listTargets(db, 'goals')[0].notes).toBeNull();
  });

  it('special_projects round-trips notes', () => {
    const db = freshDb();
    createTarget(db, 'special_projects', {
      name: 'Apto',
      targetCents: 100,
      notes: 'liberdade',
    });
    expect(listTargets(db, 'special_projects')[0].notes).toBe('liberdade');
  });
});

it('rejects an unknown table name', () => {
  const db = freshDb();
  // @ts-expect-error deliberate bad input
  expect(() => listTargets(db, 'drop_table')).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/targets.test.ts`
Expected: FAIL — `Cannot find module './targets.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/targets.ts`:

```ts
import type Database from 'better-sqlite3';

export type TargetTable = 'goals' | 'special_projects';

const TABLES: Record<TargetTable, true> = { goals: true, special_projects: true };

function assertTable(table: string): asserts table is TargetTable {
  if (!(table in TABLES)) throw new Error(`unknown target table: ${table}`);
}

export interface Target {
  id: number;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  notes: string | null;
  status: string;
}

export interface NewTarget {
  name: string;
  targetCents: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}

export interface TargetPatch {
  name?: string;
  targetCents?: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}

interface TargetRow {
  id: number;
  name: string;
  target_cents: number;
  current_cents: number;
  target_date: string | null;
  notes: string | null;
  status: string;
}

function validateName(name: unknown): void {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required');
}
function validateTarget(cents: unknown): void {
  if (!Number.isInteger(cents) || (cents as number) <= 0) {
    throw new Error('targetCents must be a positive integer');
  }
}
function validateCurrent(cents: unknown): void {
  if (!Number.isInteger(cents) || (cents as number) < 0) {
    throw new Error('currentCents must be a non-negative integer');
  }
}

export function createTarget(db: Database.Database, table: TargetTable, input: NewTarget): number {
  assertTable(table);
  validateName(input.name);
  validateTarget(input.targetCents);
  const currentCents = input.currentCents ?? 0;
  validateCurrent(currentCents);

  const hasNotes = table === 'special_projects';
  const cols = ['name', 'target_cents', 'current_cents', 'target_date'];
  const vals: unknown[] = [
    input.name,
    input.targetCents,
    currentCents,
    input.targetDate ?? null,
  ];
  if (hasNotes) {
    cols.push('notes');
    vals.push(input.notes ?? null);
  }
  const placeholders = cols.map(() => '?').join(', ');
  const result = db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...vals);
  return Number(result.lastInsertRowid);
}

export function listTargets(db: Database.Database, table: TargetTable): Target[] {
  assertTable(table);
  const hasNotes = table === 'special_projects';
  const notesSelect = hasNotes ? 'notes' : 'NULL AS notes';
  const rows = db
    .prepare(
      `SELECT id, name, target_cents, current_cents, target_date, ${notesSelect}, status
       FROM ${table}
       WHERE deleted_at IS NULL
       ORDER BY id DESC`,
    )
    .all() as TargetRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    currentCents: r.current_cents,
    targetDate: r.target_date,
    notes: r.notes,
    status: r.status,
  }));
}

export function updateTarget(
  db: Database.Database,
  table: TargetTable,
  id: number,
  patch: TargetPatch,
): void {
  assertTable(table);
  const hasNotes = table === 'special_projects';
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    validateName(patch.name);
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.targetCents !== undefined) {
    validateTarget(patch.targetCents);
    sets.push('target_cents = ?');
    vals.push(patch.targetCents);
  }
  if (patch.currentCents !== undefined) {
    validateCurrent(patch.currentCents);
    sets.push('current_cents = ?');
    vals.push(patch.currentCents);
  }
  if (patch.targetDate !== undefined) {
    sets.push('target_date = ?');
    vals.push(patch.targetDate);
  }
  if (hasNotes && patch.notes !== undefined) {
    sets.push('notes = ?');
    vals.push(patch.notes);
  }

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(
    ...vals,
  );
}

export function addToTarget(
  db: Database.Database,
  table: TargetTable,
  id: number,
  deltaCents: number,
): void {
  assertTable(table);
  if (!Number.isInteger(deltaCents) || deltaCents <= 0) {
    throw new Error('deltaCents must be a positive integer');
  }
  db.prepare(
    `UPDATE ${table} SET current_cents = current_cents + ? WHERE id = ? AND deleted_at IS NULL`,
  ).run(deltaCents, id);
}

export function softDeleteTarget(db: Database.Database, table: TargetTable, id: number): void {
  assertTable(table);
  db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/targets.test.ts`
Expected: PASS (6 `it.each` × 2 tables + 2 notes + 1 unknown-table = 15 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/targets.ts server/src/db/targets.test.ts
git commit -m "Add generic target data layer over goals/special_projects

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Target route factory (server)

**Files:**
- Create: `server/src/routes/targets.ts`
- Modify: `server/src/app.ts` (import + two calls after `registerSavingsRoutes`)
- Test: `server/src/routes/targets.test.ts`

**Interfaces:**
- Consumes: `createTarget` / `listTargets` / `updateTarget` / `addToTarget` / `softDeleteTarget` / `TargetTable` / `TargetPatch` from `../db/targets.js` (Task 2); `requireAuth`; `buildApp`.
- Produces:
  ```ts
  function registerTargetRoutes(
    app: FastifyInstance,
    db: Database.Database,
    opts: { table: TargetTable; basePath: string },
  ): void;
  ```
  and, for each `basePath` B: `GET B`, `POST B` → `201 { id }`,
  `PATCH B/:id` → `{ ok: true }`, `POST B/:id/add` → `{ ok: true }`,
  `DELETE B/:id` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/targets.test.ts`:

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

const BASE_PATHS = ['/api/goals', '/api/special-projects'];

describe.each(BASE_PATHS)('target routes (%s)', (base) => {
  it('rejects unauthenticated GET', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: base });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists a target', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: 'PS5', targetCents: 400_000, targetDate: '2026-12-01' },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: base,
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0]).toMatchObject({ name: 'PS5', targetCents: 400_000 });
    await app.close();
  });

  it('rejects a blank name or non-positive target', async () => {
    const { app, sessionCookie } = await authedApp();
    const a = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: '  ', targetCents: 1000 },
    });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: 'x', targetCents: 0 },
    });
    expect(b.statusCode).toBe(400);
    await app.close();
  });

  it('patches current via PATCH and via /add', async () => {
    const { app, sessionCookie } = await authedApp();
    const { id } = (
      await app.inject({
        method: 'POST',
        url: base,
        cookies: { session: sessionCookie },
        payload: { name: 'Trip', targetCents: 100_000, currentCents: 1_000 },
      })
    ).json();

    await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      cookies: { session: sessionCookie },
      payload: { currentCents: 9_000 },
    });
    let list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].currentCents).toBe(9_000);

    await app.inject({
      method: 'POST',
      url: `${base}/${id}/add`,
      cookies: { session: sessionCookie },
      payload: { deltaCents: 1_000 },
    });
    list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].currentCents).toBe(10_000);

    const bad = await app.inject({
      method: 'POST',
      url: `${base}/${id}/add`,
      cookies: { session: sessionCookie },
      payload: { deltaCents: 0 },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('soft-deletes, tolerating an empty JSON body', async () => {
    const { app, sessionCookie } = await authedApp();
    const { id } = (
      await app.inject({
        method: 'POST',
        url: base,
        cookies: { session: sessionCookie },
        payload: { name: 'Gone', targetCents: 100 },
      })
    ).json();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `${base}/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);
    const list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list).toHaveLength(0);
    await app.close();
  });
});

it('round-trips notes on /api/special-projects only', async () => {
  const { app, sessionCookie } = await authedApp();
  await app.inject({
    method: 'POST',
    url: '/api/special-projects',
    cookies: { session: sessionCookie },
    payload: { name: 'Apto', targetCents: 100, notes: 'liberdade' },
  });
  const list = (
    await app.inject({
      method: 'GET',
      url: '/api/special-projects',
      cookies: { session: sessionCookie },
    })
  ).json();
  expect(list[0].notes).toBe('liberdade');
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/targets.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/targets.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createTarget,
  listTargets,
  updateTarget,
  addToTarget,
  softDeleteTarget,
  type TargetTable,
  type TargetPatch,
} from '../db/targets.js';

interface CreateBody {
  name: string;
  targetCents: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}
interface AddBody {
  deltaCents: number;
}

function nonBlankString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}
function isPositiveInt(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) > 0;
}
function isNonNegInt(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 0;
}

export function registerTargetRoutes(
  app: FastifyInstance,
  db: Database.Database,
  opts: { table: TargetTable; basePath: string },
): void {
  const { table, basePath } = opts;

  app.get(basePath, { preHandler: requireAuth(db) }, async () => listTargets(db, table));

  app.post<{ Body: CreateBody }>(
    basePath,
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const b = request.body;
      if (!nonBlankString(b.name)) {
        return reply.code(400).send({ error: 'name is required' });
      }
      if (!isPositiveInt(b.targetCents)) {
        return reply.code(400).send({ error: 'targetCents must be a positive integer' });
      }
      if (b.currentCents !== undefined && !isNonNegInt(b.currentCents)) {
        return reply.code(400).send({ error: 'currentCents must be a non-negative integer' });
      }
      const id = createTarget(db, table, {
        name: b.name,
        targetCents: b.targetCents,
        currentCents: b.currentCents,
        targetDate: b.targetDate ?? null,
        notes: b.notes ?? null,
      });
      return reply.code(201).send({ id });
    },
  );

  app.patch<{ Params: { id: string }; Body: TargetPatch }>(
    `${basePath}/:id`,
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const b = request.body ?? {};
      if (b.name !== undefined && !nonBlankString(b.name)) {
        return reply.code(400).send({ error: 'name must be a non-blank string' });
      }
      if (b.targetCents !== undefined && !isPositiveInt(b.targetCents)) {
        return reply.code(400).send({ error: 'targetCents must be a positive integer' });
      }
      if (b.currentCents !== undefined && !isNonNegInt(b.currentCents)) {
        return reply.code(400).send({ error: 'currentCents must be a non-negative integer' });
      }
      updateTarget(db, table, Number(request.params.id), b);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: AddBody }>(
    `${basePath}/:id/add`,
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (!isPositiveInt(request.body?.deltaCents)) {
        return reply.code(400).send({ error: 'deltaCents must be a positive integer' });
      }
      addToTarget(db, table, Number(request.params.id), request.body.deltaCents);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${basePath}/:id`,
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteTarget(db, table, Number(request.params.id));
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import beside the savings-routes import:

```ts
import { registerSavingsRoutes } from './routes/savings.js';
import { registerTargetRoutes } from './routes/targets.js';
```

and call it twice after `registerSavingsRoutes(app, db);`:

```ts
  registerSavingsRoutes(app, db);
  registerTargetRoutes(app, db, { table: 'goals', basePath: '/api/goals' });
  registerTargetRoutes(app, db, { table: 'special_projects', basePath: '/api/special-projects' });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/targets.test.ts`
Expected: PASS (5 `it.each` × 2 + 1 notes = 11 tests).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green (111 from prior modules + Tasks 1–3: 5 + 15 + 11).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/targets.ts server/src/routes/targets.test.ts server/src/app.ts
git commit -m "Add target route factory, mounted for goals and special-projects

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend lib + API client

**Files:**
- Create: `frontend/src/lib/targets.ts`
- Create: `frontend/src/lib/targets.test.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the existing private `request<T>()` helper.
- Produces:
  - `frontend/src/lib/targets.ts`: `monthsUntil`, `targetProgress`
    (identical to Task 1).
  - `frontend/src/lib/api.ts`: `Target`, `TargetsClient` interfaces;
    `targetsClient(basePath)` factory; `goalsApi`, `projectsApi`
    instances.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthsUntil, targetProgress } from './targets.js';

const AUG_15 = new Date(2026, 7, 15);

describe('monthsUntil', () => {
  it('counts whole months to a future date', () => {
    expect(monthsUntil('2026-11-01', AUG_15)).toBe(3);
  });
  it('returns null for empty / same-month / past', () => {
    expect(monthsUntil(null, AUG_15)).toBeNull();
    expect(monthsUntil('2026-08-20', AUG_15)).toBeNull();
    expect(monthsUntil('2026-01-01', AUG_15)).toBeNull();
  });
});

describe('targetProgress', () => {
  it('computes an in-progress target', () => {
    expect(
      targetProgress({ targetCents: 100_000, currentCents: 25_000, targetDate: '2026-11-01' }, AUG_15),
    ).toEqual({
      remainingCents: 75_000,
      progressPct: 25,
      suggestedMonthlyCents: 25_000,
      complete: false,
    });
  });
  it('marks a met target complete with no suggestion', () => {
    expect(
      targetProgress({ targetCents: 100_000, currentCents: 100_000, targetDate: null }, AUG_15),
    ).toMatchObject({ complete: true, remainingCents: 0, suggestedMonthlyCents: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/targets.test.ts`
Expected: FAIL — `Cannot find module './targets.js'`.

- [ ] **Step 3: Create `frontend/src/lib/targets.ts`**

Copy Task 1's `monthsUntil` / `targetProgress` / interfaces verbatim
(the bodies are identical). Header comment:

```ts
// Mirrors server/src/targets/progress.ts exactly — keep the two in sync.
```

- [ ] **Step 4: Extend `frontend/src/lib/api.ts`**

Append:

```ts
export interface Target {
  id: number;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  notes: string | null;
  status: string;
}

export interface TargetsClient {
  list(): Promise<Target[]>;
  create(input: {
    name: string;
    targetCents: number;
    currentCents?: number;
    targetDate?: string | null;
    notes?: string | null;
  }): Promise<{ id: number }>;
  update(
    id: number,
    patch: {
      name?: string;
      targetCents?: number;
      currentCents?: number;
      targetDate?: string | null;
      notes?: string | null;
    },
  ): Promise<{ ok: true }>;
  addTo(id: number, deltaCents: number): Promise<{ ok: true }>;
  remove(id: number): Promise<{ ok: true }>;
}

export function targetsClient(basePath: string): TargetsClient {
  return {
    list: () => request(basePath),
    create: (input) => request(basePath, { method: 'POST', body: JSON.stringify(input) }),
    update: (id, patch) =>
      request(`${basePath}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    addTo: (id, deltaCents) =>
      request(`${basePath}/${id}/add`, { method: 'POST', body: JSON.stringify({ deltaCents }) }),
    remove: (id) => request(`${basePath}/${id}`, { method: 'DELETE' }),
  };
}

export const goalsApi = targetsClient('/api/goals');
export const projectsApi = targetsClient('/api/special-projects');
```

- [ ] **Step 5: Run test + type-check**

Run: `cd frontend && npx vitest run src/lib/targets.test.ts`
Expected: PASS (4 tests).
Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/targets.ts frontend/src/lib/targets.test.ts frontend/src/lib/api.ts
git commit -m "Add targets frontend lib and targetsClient factory

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: TargetCard component (frontend)

**Files:**
- Create: `frontend/src/components/TargetCard.tsx`
- Create: `frontend/src/components/TargetCard.test.tsx`

**Interfaces:**
- Consumes: `api.Target` (Task 4); `targetProgress` from `../lib/targets.js` (Task 4); `formatCentsBRL` / `parseCentsFromInput` from `../lib/money.js`.
- Produces:
  ```ts
  interface TargetCardProps {
    target: Target;
    showNotes: boolean;
    onAdd: (id: number, deltaCents: number) => void;
    onUpdate: (id: number, patch: Partial<Target>) => void;
    onDelete: (id: number) => void;
  }
  function TargetCard(props: TargetCardProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TargetCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetCard } from './TargetCard.js';
import type { Target } from '../lib/api.js';

function target(over: Partial<Target>): Target {
  return {
    id: 1,
    name: 'PS5',
    targetCents: 400_000,
    currentCents: 100_000,
    targetDate: null,
    notes: null,
    status: 'active',
    ...over,
  };
}

const noop = () => {};

describe('TargetCard', () => {
  it('shows current/target and a remaining line for an in-progress target', () => {
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={noop} onUpdate={noop} onDelete={noop} />,
    );
    expect(screen.getByText('R$ 1.000,00 de R$ 4.000,00')).toBeInTheDocument();
    expect(screen.getByText(/Faltam R\$ 3\.000,00/)).toBeInTheDocument();
  });

  it('shows the Concluída badge and no remaining line when met', () => {
    render(
      <TargetCard
        target={target({ currentCents: 400_000 })}
        showNotes={false}
        onAdd={noop}
        onUpdate={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
  });

  it('adds a contribution via the Adicionar control', async () => {
    const onAdd = vi.fn();
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={onAdd} onUpdate={noop} onDelete={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à meta PS5' }));
    fireEvent.change(screen.getByLabelText('Valor a adicionar em PS5'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar adição em PS5' }));
    expect(onAdd).toHaveBeenCalledWith(1, 5_000);
  });

  it('deletes via the Excluir control', () => {
    const onDelete = vi.fn();
    render(
      <TargetCard target={target({})} showNotes={false} onAdd={noop} onUpdate={noop} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Excluir PS5' }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('hides the motivation text when showNotes is false', () => {
    render(
      <TargetCard
        target={target({ notes: 'liberdade' })}
        showNotes={false}
        onAdd={noop}
        onUpdate={noop}
        onDelete={noop}
      />,
    );
    expect(screen.queryByText(/liberdade/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TargetCard.test.tsx`
Expected: FAIL — `Cannot find module './TargetCard.js'`.

- [ ] **Step 3: Create `frontend/src/components/TargetCard.tsx`**

```tsx
import { useState } from 'react';
import type { Target } from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { targetProgress } from '../lib/targets.js';

interface TargetCardProps {
  target: Target;
  showNotes: boolean;
  onAdd: (id: number, deltaCents: number) => void;
  onUpdate: (id: number, patch: Partial<Target>) => void;
  onDelete: (id: number) => void;
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function TargetCard({ target, showNotes, onAdd, onUpdate, onDelete }: TargetCardProps) {
  const p = targetProgress(target);
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(target.name);
  const [targetValue, setTargetValue] = useState((target.targetCents / 100).toFixed(2));
  const [currentValue, setCurrentValue] = useState((target.currentCents / 100).toFixed(2));
  const [dateValue, setDateValue] = useState(target.targetDate ?? '');
  const [notesValue, setNotesValue] = useState(target.notes ?? '');

  function confirmAdd() {
    const cents = parseCentsFromInput(addValue);
    if (Number.isNaN(cents) || cents <= 0) return;
    onAdd(target.id, cents);
    setAddValue('');
    setAdding(false);
  }

  function confirmEdit() {
    const patch: Partial<Target> = { name };
    const t = parseCentsFromInput(targetValue);
    const c = parseCentsFromInput(currentValue);
    if (!Number.isNaN(t)) patch.targetCents = t;
    if (!Number.isNaN(c)) patch.currentCents = c;
    patch.targetDate = dateValue || null;
    if (showNotes) patch.notes = notesValue || null;
    onUpdate(target.id, patch);
    setEditing(false);
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{target.name}</strong>
        {p.complete && (
          <span style={{ fontSize: 12, color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>
            Concluída
          </span>
        )}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, margin: '6px 0' }}>
        {formatCentsBRL(target.currentCents)} de {formatCentsBRL(target.targetCents)}
      </div>

      <div
        style={{
          height: 6,
          background: 'var(--border)',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div style={{ width: `${p.progressPct}%`, height: '100%', background: 'var(--cyan)' }} />
      </div>

      {!p.complete && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          Faltam {formatCentsBRL(p.remainingCents)}
          {p.suggestedMonthlyCents !== null &&
            ` — sugestão ${formatCentsBRL(p.suggestedMonthlyCents)}/mês`}
        </div>
      )}

      {showNotes && target.notes && (
        <p style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', margin: '6px 0 0' }}>
          “{target.notes}”
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label={`Adicionar à meta ${target.name}`}
          style={ghostBtn}
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-label={`Editar ${target.name}`}
          style={ghostBtn}
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onDelete(target.id)}
          aria-label={`Excluir ${target.name}`}
          style={ghostBtn}
        >
          Excluir
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor={`add-${target.id}`} style={fieldStyle}>
              Valor a adicionar em {target.name}
            </label>
            <input
              id={`add-${target.id}`}
              type="text"
              className="field-input"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="button-primary"
            onClick={confirmAdd}
            aria-label={`Confirmar adição em ${target.name}`}
          >
            OK
          </button>
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor={`edit-name-${target.id}`} style={fieldStyle}>Nome</label>
            <input id={`edit-name-${target.id}`} type="text" className="field-input"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-target-${target.id}`} style={fieldStyle}>Valor (R$)</label>
            <input id={`edit-target-${target.id}`} type="text" className="field-input"
              value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-current-${target.id}`} style={fieldStyle}>Valor atual (R$)</label>
            <input id={`edit-current-${target.id}`} type="text" className="field-input"
              value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`edit-date-${target.id}`} style={fieldStyle}>Data alvo</label>
            <input id={`edit-date-${target.id}`} type="date" className="field-input"
              value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
          </div>
          {showNotes && (
            <div>
              <label htmlFor={`edit-notes-${target.id}`} style={fieldStyle}>Motivação</label>
              <input id={`edit-notes-${target.id}`} type="text" className="field-input"
                value={notesValue} onChange={(e) => setNotesValue(e.target.value)} />
            </div>
          )}
          <button type="button" className="button-primary" onClick={confirmEdit}>
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}

const ghostBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12.5,
  color: 'var(--text3)',
  cursor: 'pointer',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/TargetCard.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TargetCard.tsx frontend/src/components/TargetCard.test.tsx
git commit -m "Add TargetCard: progress, contribution, edit, delete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: TargetSection + both pages (frontend)

**Files:**
- Create: `frontend/src/components/TargetSection.tsx` + `.test.tsx`
- Create: `frontend/src/pages/MetasPage.tsx` + `.test.tsx`
- Create: `frontend/src/pages/ProjetosPage.tsx` + `.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.TargetsClient` / `api.Target` / `api.goalsApi` / `api.projectsApi` (Task 4); `TargetCard` (Task 5); `parseCentsFromInput` from `../lib/money.js`.
- Produces:
  - `TargetSection({ api, showNotes, heading, emptyText })` component.
  - `MetasPage` / `ProjetosPage` (named exports), mounted at `/metas` and `/projetos`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/TargetSection.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TargetSection } from './TargetSection.js';
import type { TargetsClient, Target } from '../lib/api.js';

function fakeClient(items: Target[]): TargetsClient {
  return {
    list: vi.fn().mockResolvedValue(items),
    create: vi.fn().mockResolvedValue({ id: 99 }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    addTo: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const sample: Target = {
  id: 1,
  name: 'PS5',
  targetCents: 400_000,
  currentCents: 100_000,
  targetDate: null,
  notes: null,
  status: 'active',
};

describe('TargetSection', () => {
  it('lists items from api.list', async () => {
    render(
      <TargetSection api={fakeClient([sample])} showNotes={false} heading="H" emptyText="none" />,
    );
    expect(await screen.findByText('PS5')).toBeInTheDocument();
  });

  it('shows the empty text when there are none', async () => {
    render(<TargetSection api={fakeClient([])} showNotes={false} heading="H" emptyText="none yet" />);
    expect(await screen.findByText('none yet')).toBeInTheDocument();
  });

  it('creates with parsed cents, including currentCents when filled', async () => {
    const client = fakeClient([]);
    render(<TargetSection api={client} showNotes={false} heading="H" emptyText="x" />);
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Viagem' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Valor já guardado (R$)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Viagem', targetCents: 500_000, currentCents: 100_000 }),
      ),
    );
  });

  it('renders the motivação field only when showNotes is true', async () => {
    const { rerender } = render(
      <TargetSection api={fakeClient([])} showNotes={false} heading="H" emptyText="x" />,
    );
    await waitFor(() => {});
    expect(screen.queryByLabelText('Motivação')).not.toBeInTheDocument();

    rerender(<TargetSection api={fakeClient([])} showNotes heading="H" emptyText="x" />);
    expect(await screen.findByLabelText('Motivação')).toBeInTheDocument();
  });
});
```

Create `frontend/src/pages/MetasPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MetasPage } from './MetasPage.js';
import * as api from '../lib/api.js';

describe('MetasPage', () => {
  it('renders the heading and lists goals', async () => {
    const listSpy = vi.spyOn(api.goalsApi, 'list').mockResolvedValue([]);
    render(<MetasPage />);
    expect(screen.getByRole('heading', { name: 'Metas' })).toBeInTheDocument();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
  });
});
```

Create `frontend/src/pages/ProjetosPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjetosPage } from './ProjetosPage.js';
import * as api from '../lib/api.js';

describe('ProjetosPage', () => {
  it('renders the heading and lists projects', async () => {
    const listSpy = vi.spyOn(api.projectsApi, 'list').mockResolvedValue([]);
    render(<ProjetosPage />);
    expect(screen.getByRole('heading', { name: 'Projetos Especiais' })).toBeInTheDocument();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/TargetSection.test.tsx src/pages/MetasPage.test.tsx src/pages/ProjetosPage.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Create `frontend/src/components/TargetSection.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import type { TargetsClient, Target } from '../lib/api.js';
import { parseCentsFromInput } from '../lib/money.js';
import { TargetCard } from './TargetCard.js';

interface TargetSectionProps {
  api: TargetsClient;
  showNotes: boolean;
  heading: string;
  emptyText: string;
}

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function TargetSection({ api, showNotes, heading, emptyText }: TargetSectionProps) {
  const [items, setItems] = useState<Target[]>([]);
  const [name, setName] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [notesValue, setNotesValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setItems(await api.list());
  }

  useEffect(() => {
    refresh();
  }, [api]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const targetCents = parseCentsFromInput(targetValue);
    if (name.trim() === '' || Number.isNaN(targetCents) || targetCents <= 0) {
      setError('Informe um nome e um valor válido');
      return;
    }
    const currentCents = currentValue.trim() === '' ? undefined : parseCentsFromInput(currentValue);
    if (currentCents !== undefined && (Number.isNaN(currentCents) || currentCents < 0)) {
      setError('Valor já guardado inválido');
      return;
    }
    try {
      await api.create({
        name,
        targetCents,
        currentCents,
        targetDate: dateValue || null,
        notes: showNotes ? notesValue || null : null,
      });
      setName('');
      setTargetValue('');
      setDateValue('');
      setCurrentValue('');
      setNotesValue('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const wrap =
    <T,>(fn: (...a: T[]) => Promise<unknown>) =>
    (...a: T[]) => {
      fn(...a)
        .then(refresh)
        .catch((err) =>
          setError(err instanceof Error ? err.message : 'Erro desconhecido'),
        );
    };

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 12 }}>{heading}</h2>

      <form
        onSubmit={handleCreate}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="tgt-name" style={fieldStyle}>Nome</label>
          <input id="tgt-name" type="text" className="field-input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-value" style={fieldStyle}>Valor (R$)</label>
          <input id="tgt-value" type="text" className="field-input" value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-date" style={fieldStyle}>Data alvo</label>
          <input id="tgt-date" type="date" className="field-input" value={dateValue}
            onChange={(e) => setDateValue(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tgt-current" style={fieldStyle}>Valor já guardado (R$)</label>
          <input id="tgt-current" type="text" className="field-input" value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)} />
        </div>
        {showNotes && (
          <div>
            <label htmlFor="tgt-notes" style={fieldStyle}>Motivação</label>
            <input id="tgt-notes" type="text" className="field-input" value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)} />
          </div>
        )}
        <button type="submit" className="button-primary">Criar</button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {items.length === 0 ? (
        <p style={{ color: 'var(--text3)' }}>{emptyText}</p>
      ) : (
        items.map((t) => (
          <TargetCard
            key={t.id}
            target={t}
            showNotes={showNotes}
            onAdd={wrap(api.addTo)}
            onUpdate={wrap(api.update)}
            onDelete={wrap(api.remove)}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the two pages**

`frontend/src/pages/MetasPage.tsx`:

```tsx
import { goalsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function MetasPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Metas</h1>
      <TargetSection
        api={goalsApi}
        showNotes={false}
        heading="Suas metas"
        emptyText="Nenhuma meta ainda. Crie a primeira."
      />
    </div>
  );
}
```

`frontend/src/pages/ProjetosPage.tsx`:

```tsx
import { projectsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function ProjetosPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>
        Projetos Especiais
      </h1>
      <TargetSection
        api={projectsApi}
        showNotes
        heading="Seus projetos especiais"
        emptyText="Seus grandes sonhos ficam aqui. Crie o primeiro."
      />
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/TargetSection.test.tsx src/pages/MetasPage.test.tsx src/pages/ProjetosPage.test.tsx`
Expected: PASS (4 + 1 + 1 tests).

- [ ] **Step 6: Wire the routes in `frontend/src/App.tsx`**

Add imports beside the other page imports:

```ts
import { MetasPage } from './pages/MetasPage.js';
import { ProjetosPage } from './pages/ProjetosPage.js';
```

Replace:

```tsx
            <Route path="/metas" element={<PlaceholderPage title="Metas" />} />
            <Route path="/projetos" element={<PlaceholderPage title="Projetos Especiais" />} />
```

with:

```tsx
            <Route path="/metas" element={<MetasPage />} />
            <Route path="/projetos" element={<ProjetosPage />} />
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/TargetSection.tsx frontend/src/components/TargetSection.test.tsx frontend/src/pages/MetasPage.tsx frontend/src/pages/MetasPage.test.tsx frontend/src/pages/ProjetosPage.tsx frontend/src/pages/ProjetosPage.test.tsx frontend/src/App.tsx
git commit -m "Add TargetSection and mount Metas + Projetos pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Build, smoke test, QA checklist

**Files:**
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Full test sweep**

Run: `cd server && npm test` — expected all green.
Run: `cd frontend && npm test` — expected all green.

- [ ] **Step 2: Production build**

Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 3: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'goals (unauth): %{http_code}\n' http://localhost:4173/api/goals
curl -s -o /dev/null -w 'special-projects (unauth): %{http_code}\n' http://localhost:4173/api/special-projects
curl -s -o /dev/null -w 'metas page: %{http_code}\n' http://localhost:4173/metas
curl -s -o /dev/null -w 'projetos page: %{http_code}\n' http://localhost:4173/projetos
```

Expected: `health: 200`, both API routes `401`, both pages `200`.

- [ ] **Step 4: Manual browser check**

Hard-refresh. Open **Metas**: create "PS5" valor R$ 4.000, data alvo a
few months out, valor já guardado R$ 1.000 — a card appears showing
"R$ 1.000,00 de R$ 4.000,00", a 25% bar, "Faltam R$ 3.000,00 — sugestão
R$ …/mês". Click **Adicionar**, enter 500, confirm — current jumps to
R$ 1.500,00. Click **Editar**, bump valor atual to R$ 4.000, save — the
**Concluída** badge appears and the suggestion line disappears. Delete
it. Open **Projetos Especiais**: the create form has an extra
**Motivação** field; create one with a motivation and confirm the
italic quote shows on the card.

- [ ] **Step 5: Append to `docs/qa-checklist.md`**

```markdown

## Metas + Projetos Especiais

- [ ] Both pages load from the nav (no longer "em breve").
- [ ] Creating a goal shows a card with the current/target amounts, a
      progress bar, and a "Faltam …" line.
- [ ] With a future "data alvo", the card shows a "sugestão R$ X/mês".
- [ ] "Adicionar" raises the current amount without a manual refresh.
- [ ] "Editar" can change the name, target, current amount and date.
- [ ] When current reaches the target the card shows "Concluída" and
      drops the suggestion line.
- [ ] "Excluir" removes the card.
- [ ] Projetos Especiais has a "Motivação" field that shows as an italic
      quote on the card; Metas does not.
```

- [ ] **Step 6: Commit**

```bash
git add docs/qa-checklist.md
git commit -m "Add Metas + Projetos QA checklist items"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `monthsUntil`, `targetProgress` (remaining, capped pct, suggestion, complete) | 1 (server), 4 (frontend copy) |
| Generic data layer over both tables; validation; `notes` only on special_projects; unknown-table guard | 2 |
| `addToTarget` positive-delta guard | 2 |
| Route factory: GET/POST/PATCH/`:id/add`/DELETE behind auth; validation | 3 |
| Mount factory twice in `app.ts` (`/api/goals`, `/api/special-projects`) | 3 (Step 4) |
| `Target` type, `targetsClient` factory, `goalsApi` / `projectsApi` | 4 |
| `TargetCard` — progress bar, remaining/suggestion, Concluída badge, Adicionar/Editar/Excluir, notes gated by `showNotes` | 5 |
| `TargetSection` — list, create form (with `currentCents` + `notes` gated), renders cards | 6 |
| `MetasPage` (goalsApi, no notes), `ProjetosPage` (projectsApi, notes) | 6 |
| Mount both pages | 6 (Step 6) |
| Testing at every layer | 1–6 |
| Out of scope: emoji, status toggle, contribution ledger, month selector | not implemented — correct |

**Placeholder scan:** none — every step has literal code or a literal command.

**Type consistency:** `Target` / `NewTarget` / `TargetPatch` fields match
across Task 2 (server), Task 4 (`api.ts`), and the test fixtures in Tasks
5–6. `TargetsClient` has the same five methods in Task 4's definition and
Task 6's `fakeClient`. `targetProgress` returns
`{ remainingCents, progressPct, suggestedMonthlyCents, complete }` in both
Task 1 and Task 4, consumed field-by-field in Task 5. Route paths
(`/api/goals`, `/api/special-projects`, `…/:id`, `…/:id/add`) match
between Task 3's factory (`${basePath}` interpolation) and Task 4's
`targetsClient`. `registerTargetRoutes` signature matches between Task 3's
definition and Task 3 Step 4's two call sites. Test label / aria-label
strings (`'Nome'`, `'Valor (R$)'`, `'Data alvo'`, `'Valor já guardado
(R$)'`, `'Motivação'`, `'Criar'`, `'Adicionar à meta <name>'`,
`'Valor a adicionar em <name>'`, `'Confirmar adição em <name>'`,
`'Editar <name>'`, `'Excluir <name>'`, `'Concluída'`) match between each
component and its test.
