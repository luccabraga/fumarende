# Gastos + Parcelas Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Gastos module (categorised expense entry with N-way
installment splitting), the Parcelas rollup, and Gastos Fixos
(recurring-expense templates with idempotent apply-to-month).

**Architecture:** Follows the Câmbio module pattern exactly — pure logic
module, data layer over `better-sqlite3`, Fastify routes behind
`requireAuth`, then React pages mirroring `CambioPage`. The `expenses`
and `fixed_expenses` tables already exist in the Foundation schema — no
migration. Installment maths (exact-sum split, day-clamped month
addition) is a pure server module; the frontend never re-derives it.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-27-gastos-parcelas-design.md`

## Global Constraints

- Money is stored and passed as **integer cents** — never floats, never
  decimal strings.
- Deletes are **soft**: set `deleted_at`, never `DELETE FROM`. Reads
  filter `WHERE deleted_at IS NULL`.
- **No AI, no category-rules UI, no auto-categorisation** in this plan.
- **No expense editing** — create / list / soft-delete only.
- **No month scoping** — lists and totals cover all rows, newest first.
  The fixed-expense "apply" action targets the current calendar month.
- `type` is exactly the string `'essencial'` or `'nao-essencial'`.
- Every task is TDD: write the failing test, run it red, implement the
  minimum, run it green, commit.
- Run server tests from `server/` with `npx vitest run <path>` (or
  `npm test` for the full suite); frontend tests from `frontend/` the
  same way.
- Work on a branch `gastos-parcelas` off `main`; the finishing skill
  merges it back.

---

## File Structure

**New (server):**
- `server/src/expenses/installments.ts` — pure `addMonths`, `splitInstallments`. No imports.
- `server/src/expenses/installments.test.ts`
- `server/src/db/expenses.ts` — `createExpense` (returns `number[]`) / `listExpenses` / `softDeleteExpense` / `softDeleteExpenseGroup`. Imports the installments module.
- `server/src/db/expenses.test.ts`
- `server/src/db/fixed-expenses.ts` — `createFixedExpense` / `listFixedExpenses` / `softDeleteFixedExpense` / `applyFixedExpensesToMonth`. Imports nothing from this module set.
- `server/src/db/fixed-expenses.test.ts`
- `server/src/routes/expenses.ts` — `registerExpenseRoutes(app, db)`.
- `server/src/routes/expenses.test.ts`
- `server/src/routes/fixed-expenses.ts` — `registerFixedExpenseRoutes(app, db)`.
- `server/src/routes/fixed-expenses.test.ts`

**New (frontend):**
- `frontend/src/lib/expenses.ts` — `CATEGORIES`, `PAYMENT_METHODS`, `groupInstallments`.
- `frontend/src/lib/expenses.test.ts`
- `frontend/src/pages/GastosPage.tsx` + `.test.tsx`
- `frontend/src/components/FixedExpensesSection.tsx` + `.test.tsx`
- `frontend/src/pages/ParcelasPage.tsx` + `.test.tsx`

**Modified (server):**
- `server/src/app.ts` — call `registerExpenseRoutes` and `registerFixedExpenseRoutes` after `registerExchangeRoutes`.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `Expense` + `FixedExpense` types and their client functions.
- `frontend/src/App.tsx` — mount `GastosPage` at `/gastos`, `ParcelasPage` at `/parcelas`.
- `docs/qa-checklist.md` — append Gastos / Parcelas checks.

---

## Task 1: Installment maths (server, pure)

**Files:**
- Create: `server/src/expenses/installments.ts`
- Test: `server/src/expenses/installments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  function addMonths(dateISO: string, months: number): string;
  function splitInstallments(amountCents: number, count: number): number[];
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/expenses/installments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addMonths, splitInstallments } from './installments.js';

describe('addMonths', () => {
  it('clamps the day to the last day of a shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('does not carry the clamp forward to a later month', () => {
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('rolls over into the next year', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('returns the same date for a zero offset', () => {
    expect(addMonths('2026-08-05', 0)).toBe('2026-08-05');
  });

  it('zero-pads month and day', () => {
    expect(addMonths('2026-08-05', 1)).toBe('2026-09-05');
  });
});

describe('splitInstallments', () => {
  it('splits with the remainder on the first installment', () => {
    const parts = splitInstallments(65_000, 3);
    expect(parts).toEqual([21_668, 21_666, 21_666]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(65_000);
  });

  it('returns a single element for a count of 1', () => {
    expect(splitInstallments(10_000, 1)).toEqual([10_000]);
  });

  it('always sums exactly to the amount', () => {
    const parts = splitInstallments(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/expenses/installments.test.ts`
Expected: FAIL — `Cannot find module './installments.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/expenses/installments.ts`:

```ts
/** Days in a given 1-based month of a given year. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Adds `months` calendar months to an ISO date (YYYY-MM-DD), clamping the
 * day to the last valid day of the target month. Ported from the validated
 * `stack-project` prototype's `add_months`.
 *
 *   addMonths('2026-01-31', 1) -> '2026-02-28'
 *   addMonths('2026-01-31', 2) -> '2026-03-31'
 *   addMonths('2026-12-15', 1) -> '2027-01-15'
 */
export function addMonths(dateISO: string, months: number): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const monthIndex0 = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex0 / 12);
  const targetMonth = ((monthIndex0 % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Splits `amountCents` into `count` positive integers that sum exactly to
 * `amountCents`. The first element absorbs the remainder.
 *
 *   splitInstallments(65_000, 3) -> [21_668, 21_666, 21_666]
 *   splitInstallments(10_000, 1) -> [10_000]
 */
export function splitInstallments(amountCents: number, count: number): number[] {
  if (count <= 1) return [amountCents];
  const base = Math.trunc(amountCents / count);
  const remainder = amountCents - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/expenses/installments.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/expenses/installments.ts server/src/expenses/installments.test.ts
git commit -m "Add installment maths: day-clamped addMonths and exact-sum split

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Expense data layer (server)

**Files:**
- Create: `server/src/db/expenses.ts`
- Test: `server/src/db/expenses.test.ts`

**Interfaces:**
- Consumes: `addMonths`, `splitInstallments` from `../expenses/installments.js` (Task 1); `runMigrations` from `./migrate.js` (existing).
- Produces:
  ```ts
  interface Expense {
    id: number;
    date: string;
    description: string;
    amountCents: number;
    category: string;
    type: string;
    paymentMethod: string;
    installmentNumber: number | null;
    installmentTotal: number | null;
    installmentGroupId: string | null;
    notes: string | null;
  }
  interface NewExpense {
    date: string;
    description: string;
    amountCents: number;
    category: string;
    type: string;
    paymentMethod: string;
    installmentTotal?: number | null;
    notes?: string | null;
  }
  function createExpense(db: Database.Database, input: NewExpense): number[];
  function listExpenses(db: Database.Database): Expense[];
  function softDeleteExpense(db: Database.Database, id: number): void;
  function softDeleteExpenseGroup(db: Database.Database, groupId: string): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/db/expenses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createExpense,
  listExpenses,
  softDeleteExpense,
  softDeleteExpenseGroup,
} from './expenses.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function sampleInput() {
  return {
    date: '2026-08-01',
    description: 'Mercado',
    amountCents: 10_000,
    category: 'Alimentação',
    type: 'essencial',
    paymentMethod: 'Débito',
  };
}

describe('expense data layer', () => {
  it('creates a single expense and lists it back', () => {
    const db = freshDb();
    const ids = createExpense(db, sampleInput());
    expect(ids).toHaveLength(1);

    const all = listExpenses(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      description: 'Mercado',
      amountCents: 10_000,
      type: 'essencial',
      installmentTotal: null,
      installmentGroupId: null,
    });
  });

  it('splits an installment purchase into dated rows that reconcile exactly', () => {
    const db = freshDb();
    const ids = createExpense(db, {
      ...sampleInput(),
      description: 'Tênis Nike',
      amountCents: 65_000,
      date: '2026-01-15',
      installmentTotal: 3,
    });
    expect(ids).toHaveLength(3);

    const rows = listExpenses(db).sort(
      (a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0),
    );
    expect(rows.map((r) => r.amountCents)).toEqual([21_668, 21_666, 21_666]);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(65_000);
    expect(rows.map((r) => r.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(rows.map((r) => r.installmentTotal)).toEqual([3, 3, 3]);
    expect(rows[0].installmentGroupId).not.toBeNull();
    expect(new Set(rows.map((r) => r.installmentGroupId)).size).toBe(1);
  });

  it('treats installmentTotal of 1 as a plain single row', () => {
    const db = freshDb();
    const ids = createExpense(db, { ...sampleInput(), installmentTotal: 1 });
    expect(ids).toHaveLength(1);
    expect(listExpenses(db)[0].installmentGroupId).toBeNull();
  });

  it('rejects a non-positive amount, blank description, or bad type', () => {
    const db = freshDb();
    expect(() => createExpense(db, { ...sampleInput(), amountCents: 0 })).toThrow();
    expect(() => createExpense(db, { ...sampleInput(), description: '  ' })).toThrow();
    expect(() => createExpense(db, { ...sampleInput(), type: 'x' })).toThrow();
  });

  it('softDeleteExpense removes just one row', () => {
    const db = freshDb();
    const [id] = createExpense(db, sampleInput());
    softDeleteExpense(db, id);
    expect(listExpenses(db)).toHaveLength(0);
  });

  it('softDeleteExpenseGroup removes every row in the group', () => {
    const db = freshDb();
    createExpense(db, { ...sampleInput(), amountCents: 30_000, installmentTotal: 3 });
    const groupId = listExpenses(db)[0].installmentGroupId!;
    softDeleteExpenseGroup(db, groupId);
    expect(listExpenses(db)).toHaveLength(0);
  });

  it('orders expenses by date descending', () => {
    const db = freshDb();
    createExpense(db, { ...sampleInput(), date: '2026-08-01' });
    createExpense(db, { ...sampleInput(), date: '2026-08-20' });
    expect(listExpenses(db).map((e) => e.date)).toEqual(['2026-08-20', '2026-08-01']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/expenses.test.ts`
Expected: FAIL — `Cannot find module './expenses.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/expenses.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { addMonths, splitInstallments } from '../expenses/installments.js';

export interface Expense {
  id: number;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  notes: string | null;
}

export interface NewExpense {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}

interface ExpenseRow {
  id: number;
  date: string;
  description: string;
  amount_cents: number;
  category: string;
  type: string;
  payment_method: string;
  installment_number: number | null;
  installment_total: number | null;
  installment_group_id: string | null;
  notes: string | null;
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    type: row.type,
    paymentMethod: row.payment_method,
    installmentNumber: row.installment_number,
    installmentTotal: row.installment_total,
    installmentGroupId: row.installment_group_id,
    notes: row.notes,
  };
}

function validate(input: NewExpense): void {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  if (input.description.trim() === '') {
    throw new Error('description is required');
  }
  if (input.type !== 'essencial' && input.type !== 'nao-essencial') {
    throw new Error("type must be 'essencial' or 'nao-essencial'");
  }
  if (input.category.trim() === '') {
    throw new Error('category is required');
  }
  if (input.paymentMethod.trim() === '') {
    throw new Error('paymentMethod is required');
  }
}

/**
 * Inserts one expense, or — when `installmentTotal >= 2` — a group of that
 * many dated rows sharing an `installment_group_id`, the amounts split so
 * they sum exactly to `amountCents`. Returns the new row id(s).
 */
export function createExpense(db: Database.Database, input: NewExpense): number[] {
  validate(input);
  const total = input.installmentTotal ?? 1;

  if (total <= 1) {
    const result = db
      .prepare(
        `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, notes)
         VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod, @notes)`,
      )
      .run({
        date: input.date,
        description: input.description,
        amountCents: input.amountCents,
        category: input.category,
        type: input.type,
        paymentMethod: input.paymentMethod,
        notes: input.notes ?? null,
      });
    return [Number(result.lastInsertRowid)];
  }

  const amounts = splitInstallments(input.amountCents, total);
  const groupId = randomBytes(8).toString('hex');
  const insert = db.prepare(
    `INSERT INTO expenses
       (date, description, amount_cents, category, type, payment_method,
        installment_number, installment_total, installment_group_id, notes)
     VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod,
             @installmentNumber, @installmentTotal, @installmentGroupId, @notes)`,
  );

  const insertAll = db.transaction((): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < total; i += 1) {
      const result = insert.run({
        date: addMonths(input.date, i),
        description: input.description,
        amountCents: amounts[i],
        category: input.category,
        type: input.type,
        paymentMethod: input.paymentMethod,
        installmentNumber: i + 1,
        installmentTotal: total,
        installmentGroupId: groupId,
        notes: input.notes ?? null,
      });
      ids.push(Number(result.lastInsertRowid));
    }
    return ids;
  });

  return insertAll();
}

export function listExpenses(db: Database.Database): Expense[] {
  const rows = db
    .prepare(
      `SELECT id, date, description, amount_cents, category, type, payment_method,
              installment_number, installment_total, installment_group_id, notes
       FROM expenses
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as ExpenseRow[];
  return rows.map(toExpense);
}

export function softDeleteExpense(db: Database.Database, id: number): void {
  db.prepare('UPDATE expenses SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

export function softDeleteExpenseGroup(db: Database.Database, groupId: string): void {
  db.prepare(
    'UPDATE expenses SET deleted_at = ? WHERE installment_group_id = ? AND deleted_at IS NULL',
  ).run(new Date().toISOString(), groupId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/expenses.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/expenses.ts server/src/db/expenses.test.ts
git commit -m "Add expense data layer with installment splitting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Fixed-expense data layer (server)

**Files:**
- Create: `server/src/db/fixed-expenses.ts`
- Test: `server/src/db/fixed-expenses.test.ts`

**Interfaces:**
- Consumes: `runMigrations` from `./migrate.js` (existing); `listExpenses` from `./expenses.js` (Task 2, for the test assertions only).
- Produces:
  ```ts
  interface FixedExpense {
    id: number;
    description: string;
    amountCents: number;
    category: string;
    type: string;
    paymentMethod: string;
  }
  interface NewFixedExpense {
    description: string;
    amountCents: number;
    category: string;
    type: string;
    paymentMethod: string;
  }
  function createFixedExpense(db: Database.Database, input: NewFixedExpense): number;
  function listFixedExpenses(db: Database.Database): FixedExpense[];
  function softDeleteFixedExpense(db: Database.Database, id: number): void;
  function applyFixedExpensesToMonth(db: Database.Database, month: string): number;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/db/fixed-expenses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { listExpenses } from './expenses.js';
import {
  createFixedExpense,
  listFixedExpenses,
  softDeleteFixedExpense,
  applyFixedExpensesToMonth,
} from './fixed-expenses.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function sampleInput() {
  return {
    description: 'Aluguel',
    amountCents: 280_000,
    category: 'Moradia',
    type: 'essencial',
    paymentMethod: 'Pix',
  };
}

describe('fixed-expense data layer', () => {
  it('creates, lists, and soft-deletes a template', () => {
    const db = freshDb();
    const id = createFixedExpense(db, sampleInput());
    expect(listFixedExpenses(db)).toHaveLength(1);
    softDeleteFixedExpense(db, id);
    expect(listFixedExpenses(db)).toHaveLength(0);
  });

  it('rejects a blank description or bad type', () => {
    const db = freshDb();
    expect(() => createFixedExpense(db, { ...sampleInput(), description: ' ' })).toThrow();
    expect(() => createFixedExpense(db, { ...sampleInput(), type: 'x' })).toThrow();
  });

  it('applyFixedExpensesToMonth stamps one expense per template on the 1st', () => {
    const db = freshDb();
    createFixedExpense(db, sampleInput());
    const created = applyFixedExpensesToMonth(db, '2026-08');
    expect(created).toBe(1);

    const expenses = listExpenses(db);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      date: '2026-08-01',
      description: 'Aluguel',
      amountCents: 280_000,
      category: 'Moradia',
      type: 'essencial',
    });
  });

  it('applyFixedExpensesToMonth is idempotent for repeated calls', () => {
    const db = freshDb();
    createFixedExpense(db, sampleInput());
    applyFixedExpensesToMonth(db, '2026-08');
    const again = applyFixedExpensesToMonth(db, '2026-08');
    expect(again).toBe(0);
    expect(listExpenses(db)).toHaveLength(1);
  });

  it('rejects a malformed month string', () => {
    const db = freshDb();
    expect(() => applyFixedExpensesToMonth(db, '2026-8')).toThrow();
    expect(() => applyFixedExpensesToMonth(db, 'nope')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/fixed-expenses.test.ts`
Expected: FAIL — `Cannot find module './fixed-expenses.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/db/fixed-expenses.ts`:

```ts
import type Database from 'better-sqlite3';

export interface FixedExpense {
  id: number;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

export interface NewFixedExpense {
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

interface FixedExpenseRow {
  id: number;
  description: string;
  amount_cents: number;
  category: string;
  type: string;
  payment_method: string;
}

function toFixedExpense(row: FixedExpenseRow): FixedExpense {
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    type: row.type,
    paymentMethod: row.payment_method,
  };
}

export function createFixedExpense(db: Database.Database, input: NewFixedExpense): number {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  if (input.description.trim() === '') {
    throw new Error('description is required');
  }
  if (input.type !== 'essencial' && input.type !== 'nao-essencial') {
    throw new Error("type must be 'essencial' or 'nao-essencial'");
  }
  if (input.category.trim() === '' || input.paymentMethod.trim() === '') {
    throw new Error('category and paymentMethod are required');
  }

  const result = db
    .prepare(
      `INSERT INTO fixed_expenses (description, amount_cents, category, type, payment_method)
       VALUES (@description, @amountCents, @category, @type, @paymentMethod)`,
    )
    .run({
      description: input.description,
      amountCents: input.amountCents,
      category: input.category,
      type: input.type,
      paymentMethod: input.paymentMethod,
    });
  return Number(result.lastInsertRowid);
}

export function listFixedExpenses(db: Database.Database): FixedExpense[] {
  const rows = db
    .prepare(
      `SELECT id, description, amount_cents, category, type, payment_method
       FROM fixed_expenses
       WHERE deleted_at IS NULL
       ORDER BY description`,
    )
    .all() as FixedExpenseRow[];
  return rows.map(toFixedExpense);
}

export function softDeleteFixedExpense(db: Database.Database, id: number): void {
  db.prepare('UPDATE fixed_expenses SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

/**
 * Stamps every active fixed-expense template into `expenses` for `month`
 * (YYYY-MM), dated the 1st, skipping any template that already has a
 * non-deleted expense that month. Returns the number of rows created.
 * Idempotent across repeated calls for the same month.
 */
export function applyFixedExpensesToMonth(db: Database.Database, month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('month must be in YYYY-MM format');
  }

  const templates = listFixedExpenses(db);
  const alreadyApplied = db.prepare(
    `SELECT count(*) AS n FROM expenses
     WHERE description = ? AND date LIKE ? AND deleted_at IS NULL`,
  );
  const insert = db.prepare(
    `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method)
     VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod)`,
  );

  const run = db.transaction((): number => {
    let created = 0;
    for (const t of templates) {
      const { n } = alreadyApplied.get(t.description, `${month}%`) as { n: number };
      if (n > 0) continue;
      insert.run({
        date: `${month}-01`,
        description: t.description,
        amountCents: t.amountCents,
        category: t.category,
        type: t.type,
        paymentMethod: t.paymentMethod,
      });
      created += 1;
    }
    return created;
  });

  return run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/fixed-expenses.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/fixed-expenses.ts server/src/db/fixed-expenses.test.ts
git commit -m "Add fixed-expense data layer with idempotent apply-to-month

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Expense API routes (server)

**Files:**
- Create: `server/src/routes/expenses.ts`
- Test: `server/src/routes/expenses.test.ts`

**Interfaces:**
- Consumes: `createExpense` / `listExpenses` / `softDeleteExpense` / `softDeleteExpenseGroup` / `NewExpense` from `../db/expenses.js` (Task 2); `requireAuth` from `../auth/require-auth.js` (existing); `buildApp` from `../app.js` (existing).
- Produces: `registerExpenseRoutes(app: FastifyInstance, db: Database.Database): void`, and:
  - `GET /api/expenses` → `Expense[]`
  - `POST /api/expenses` → `201 { ids: number[] }` | `400 { error }`
  - `DELETE /api/expenses/:id` → `{ ok: true }`
  - `DELETE /api/expenses/group/:groupId` → `{ ok: true }`

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/expenses.test.ts`:

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

const validBody = {
  date: '2026-08-01',
  description: 'Mercado',
  amountCents: 10_000,
  category: 'Alimentação',
  type: 'essencial',
  paymentMethod: 'Débito',
};

describe('expense routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/expenses' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates a one-off expense and lists it', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().ids).toHaveLength(1);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    await app.close();
  });

  it('creates an installment purchase as N rows', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, amountCents: 40_000, installmentTotal: 4 },
    });
    expect(createRes.json().ids).toHaveLength(4);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(4);
    await app.close();
  });

  it('rejects an invalid type', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, type: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('deletes a single expense by id', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    const [id] = createRes.json().ids;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/expenses/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);
    await app.close();
  });

  it('deletes a whole installment group', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, amountCents: 30_000, installmentTotal: 3 },
    });
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    const groupId = listBefore.json()[0].installmentGroupId;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/expenses/group/${groupId}`,
      cookies: { session: sessionCookie },
    });
    expect(delRes.statusCode).toBe(200);

    const listAfter = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listAfter.json()).toHaveLength(0);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/expenses.test.ts`
Expected: FAIL — routes 404 / `Cannot find module './expenses.js'` once wired.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/expenses.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createExpense,
  listExpenses,
  softDeleteExpense,
  softDeleteExpenseGroup,
  type NewExpense,
} from '../db/expenses.js';

interface CreateExpenseBody {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function registerExpenseRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/expenses', { preHandler: requireAuth(db) }, async () => listExpenses(db));

  app.post<{ Body: CreateExpenseBody }>(
    '/api/expenses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;

      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }
      if (!nonBlankString(body.description)) {
        return reply.code(400).send({ error: 'description is required' });
      }
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return reply.code(400).send({ error: 'amountCents must be a positive integer' });
      }
      if (body.type !== 'essencial' && body.type !== 'nao-essencial') {
        return reply.code(400).send({ error: "type must be 'essencial' or 'nao-essencial'" });
      }
      if (!nonBlankString(body.category)) {
        return reply.code(400).send({ error: 'category is required' });
      }
      if (!nonBlankString(body.paymentMethod)) {
        return reply.code(400).send({ error: 'paymentMethod is required' });
      }
      if (
        body.installmentTotal !== undefined &&
        body.installmentTotal !== null &&
        (!Number.isInteger(body.installmentTotal) || body.installmentTotal < 1)
      ) {
        return reply.code(400).send({ error: 'installmentTotal must be an integer >= 1' });
      }

      const input: NewExpense = {
        date: body.date,
        description: body.description,
        amountCents: body.amountCents,
        category: body.category,
        type: body.type,
        paymentMethod: body.paymentMethod,
        installmentTotal: body.installmentTotal ?? null,
        notes: body.notes ?? null,
      };
      const ids = createExpense(db, input);
      return reply.code(201).send({ ids });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/expenses/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteExpense(db, Number(request.params.id));
      return { ok: true };
    },
  );

  app.delete<{ Params: { groupId: string } }>(
    '/api/expenses/group/:groupId',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteExpenseGroup(db, request.params.groupId);
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

In `server/src/app.ts`, add the import beside the exchange-routes import:

```ts
import { registerExchangeRoutes } from './routes/exchange.js';
import { registerExpenseRoutes } from './routes/expenses.js';
```

and call it after `registerExchangeRoutes(app, db);`:

```ts
  registerExchangeRoutes(app, db);
  registerExpenseRoutes(app, db);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/expenses.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/expenses.ts server/src/routes/expenses.test.ts server/src/app.ts
git commit -m "Add expense API routes behind requireAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Fixed-expense API routes (server)

**Files:**
- Create: `server/src/routes/fixed-expenses.ts`
- Modify: `server/src/app.ts` (import + call after `registerExpenseRoutes`)
- Test: `server/src/routes/fixed-expenses.test.ts`

**Interfaces:**
- Consumes: `createFixedExpense` / `listFixedExpenses` / `softDeleteFixedExpense` / `applyFixedExpensesToMonth` / `NewFixedExpense` from `../db/fixed-expenses.js` (Task 3); `requireAuth`; `buildApp`.
- Produces: `registerFixedExpenseRoutes(app: FastifyInstance, db: Database.Database): void`, and:
  - `GET /api/fixed-expenses` → `FixedExpense[]`
  - `POST /api/fixed-expenses` → `201 { id }` | `400 { error }`
  - `DELETE /api/fixed-expenses/:id` → `{ ok: true }`
  - `POST /api/fixed-expenses/apply` → `{ created: number }` | `400 { error }`

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/fixed-expenses.test.ts`:

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

const validBody = {
  description: 'Aluguel',
  amountCents: 280_000,
  category: 'Moradia',
  type: 'essencial',
  paymentMethod: 'Pix',
};

describe('fixed-expense routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/fixed-expenses' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists templates', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    await app.close();
  });

  it('deletes a template', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    const { id } = createRes.json();
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/fixed-expenses/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);
    await app.close();
  });

  it('applies templates to a month, idempotently', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: '2026-08' },
    });
    expect(first.json()).toEqual({ created: 1 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: '2026-08' },
    });
    expect(second.json()).toEqual({ created: 0 });
    await app.close();
  });

  it('rejects a malformed month on apply', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: 'bad' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/fixed-expenses.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/fixed-expenses.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import {
  createFixedExpense,
  listFixedExpenses,
  softDeleteFixedExpense,
  applyFixedExpensesToMonth,
  type NewFixedExpense,
} from '../db/fixed-expenses.js';

interface CreateFixedExpenseBody {
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

interface ApplyBody {
  month: string;
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function registerFixedExpenseRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/fixed-expenses', { preHandler: requireAuth(db) }, async () =>
    listFixedExpenses(db),
  );

  app.post<{ Body: CreateFixedExpenseBody }>(
    '/api/fixed-expenses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;
      if (!nonBlankString(body.description)) {
        return reply.code(400).send({ error: 'description is required' });
      }
      if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
        return reply.code(400).send({ error: 'amountCents must be a positive integer' });
      }
      if (body.type !== 'essencial' && body.type !== 'nao-essencial') {
        return reply.code(400).send({ error: "type must be 'essencial' or 'nao-essencial'" });
      }
      if (!nonBlankString(body.category) || !nonBlankString(body.paymentMethod)) {
        return reply.code(400).send({ error: 'category and paymentMethod are required' });
      }

      const input: NewFixedExpense = {
        description: body.description,
        amountCents: body.amountCents,
        category: body.category,
        type: body.type,
        paymentMethod: body.paymentMethod,
      };
      const id = createFixedExpense(db, input);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/fixed-expenses/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteFixedExpense(db, Number(request.params.id));
      return { ok: true };
    },
  );

  app.post<{ Body: ApplyBody }>(
    '/api/fixed-expenses/apply',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const month = request.body?.month;
      if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      const created = applyFixedExpensesToMonth(db, month);
      return { created };
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import:

```ts
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerFixedExpenseRoutes } from './routes/fixed-expenses.js';
```

and the call after `registerExpenseRoutes(app, db);`:

```ts
  registerExpenseRoutes(app, db);
  registerFixedExpenseRoutes(app, db);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/fixed-expenses.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green (Foundation 41 + Câmbio 17 + Tasks 1–5: 8 + 7 + 5 + 6 + 5).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/fixed-expenses.ts server/src/routes/fixed-expenses.test.ts server/src/app.ts
git commit -m "Add fixed-expense API routes behind requireAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Frontend lib + API client

**Files:**
- Create: `frontend/src/lib/expenses.ts`
- Create: `frontend/src/lib/expenses.test.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the existing private `request<T>()` helper; the `Expense` type it will define.
- Produces:
  - `frontend/src/lib/expenses.ts`:
    ```ts
    const CATEGORIES: string[];
    const PAYMENT_METHODS: string[];
    interface InstallmentGroup {
      groupId: string;
      description: string;
      installmentTotal: number;
      paidCount: number;
      remainingCents: number;
      totalCents: number;
    }
    function groupInstallments(expenses: Expense[], todayISO: string): InstallmentGroup[];
    ```
  - `frontend/src/lib/api.ts`: `Expense`, `FixedExpense` interfaces and
    `listExpenses` / `createExpense` / `deleteExpense` /
    `deleteExpenseGroup` / `listFixedExpenses` / `createFixedExpense` /
    `deleteFixedExpense` / `applyFixedExpenses`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/expenses.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupInstallments } from './expenses.js';
import type { Expense } from './api.js';

function row(over: Partial<Expense>): Expense {
  return {
    id: 0,
    date: '2026-01-01',
    description: 'Tênis',
    amountCents: 10_000,
    category: 'Vestuário',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    notes: null,
    ...over,
  };
}

describe('groupInstallments', () => {
  it('summarises a group by paid count and remaining cents', () => {
    const expenses = [
      row({ id: 1, date: '2026-01-15', amountCents: 21_668, installmentNumber: 1, installmentTotal: 3, installmentGroupId: 'g1' }),
      row({ id: 2, date: '2026-02-15', amountCents: 21_666, installmentNumber: 2, installmentTotal: 3, installmentGroupId: 'g1' }),
      row({ id: 3, date: '2026-03-15', amountCents: 21_666, installmentNumber: 3, installmentTotal: 3, installmentGroupId: 'g1' }),
    ];
    const [group] = groupInstallments(expenses, '2026-02-20');
    expect(group).toMatchObject({
      groupId: 'g1',
      description: 'Tênis',
      installmentTotal: 3,
      paidCount: 2,
      remainingCents: 21_666,
      totalCents: 65_000,
    });
  });

  it('ignores expenses without a group id', () => {
    expect(groupInstallments([row({ id: 1 })], '2026-01-01')).toEqual([]);
  });

  it('returns one entry per distinct group id', () => {
    const expenses = [
      row({ id: 1, installmentGroupId: 'g1', installmentTotal: 2 }),
      row({ id: 2, installmentGroupId: 'g2', installmentTotal: 2 }),
    ];
    expect(groupInstallments(expenses, '2026-01-01')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/expenses.test.ts`
Expected: FAIL — `Cannot find module './expenses.js'`.

- [ ] **Step 3: Create `frontend/src/lib/expenses.ts`**

```ts
import type { Expense } from './api.js';

export const CATEGORIES = [
  'Moradia',
  'Alimentação',
  'Delivery',
  'Transporte',
  'Saúde',
  'Educação',
  'Lazer',
  'Viagem',
  'Assinaturas',
  'Vestuário',
  'Outros',
];

export const PAYMENT_METHODS = ['Crédito', 'Débito', 'Pix', 'Dinheiro', 'Transferência'];

export interface InstallmentGroup {
  groupId: string;
  description: string;
  installmentTotal: number;
  paidCount: number;
  remainingCents: number;
  totalCents: number;
}

/**
 * Collapses installment rows (those with an `installmentGroupId`) into one
 * entry per purchase. `paidCount` counts rows dated on or before
 * `todayISO`; `remainingCents` sums rows dated after it. Groups are
 * ordered by their earliest row's date, newest first. Rows without a
 * group id are ignored.
 */
export function groupInstallments(expenses: Expense[], todayISO: string): InstallmentGroup[] {
  const byGroup = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (!e.installmentGroupId) continue;
    const rows = byGroup.get(e.installmentGroupId) ?? [];
    rows.push(e);
    byGroup.set(e.installmentGroupId, rows);
  }

  const groups: InstallmentGroup[] = [];
  for (const [groupId, rows] of byGroup) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    groups.push({
      groupId,
      description: first.description,
      installmentTotal: first.installmentTotal ?? sorted.length,
      paidCount: sorted.filter((r) => r.date <= todayISO).length,
      remainingCents: sorted
        .filter((r) => r.date > todayISO)
        .reduce((s, r) => s + r.amountCents, 0),
      totalCents: sorted.reduce((s, r) => s + r.amountCents, 0),
    });
  }

  return groups.sort((a, b) => {
    const aFirst = byGroup.get(a.groupId)![0].date;
    const bFirst = byGroup.get(b.groupId)![0].date;
    return bFirst.localeCompare(aFirst);
  });
}
```

- [ ] **Step 4: Extend `frontend/src/lib/api.ts`**

Append:

```ts
export interface Expense {
  id: number;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  notes: string | null;
}

export function listExpenses(): Promise<Expense[]> {
  return request('/api/expenses');
}

export function createExpense(input: {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: 'essencial' | 'nao-essencial';
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}): Promise<{ ids: number[] }> {
  return request('/api/expenses', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteExpense(id: number): Promise<{ ok: true }> {
  return request(`/api/expenses/${id}`, { method: 'DELETE' });
}

export function deleteExpenseGroup(groupId: string): Promise<{ ok: true }> {
  return request(`/api/expenses/group/${groupId}`, { method: 'DELETE' });
}

export interface FixedExpense {
  id: number;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

export function listFixedExpenses(): Promise<FixedExpense[]> {
  return request('/api/fixed-expenses');
}

export function createFixedExpense(input: {
  description: string;
  amountCents: number;
  category: string;
  type: 'essencial' | 'nao-essencial';
  paymentMethod: string;
}): Promise<{ id: number }> {
  return request('/api/fixed-expenses', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteFixedExpense(id: number): Promise<{ ok: true }> {
  return request(`/api/fixed-expenses/${id}`, { method: 'DELETE' });
}

export function applyFixedExpenses(month: string): Promise<{ created: number }> {
  return request('/api/fixed-expenses/apply', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}
```

- [ ] **Step 5: Run test + type-check**

Run: `cd frontend && npx vitest run src/lib/expenses.test.ts`
Expected: PASS (3 tests).
Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/expenses.ts frontend/src/lib/expenses.test.ts frontend/src/lib/api.ts
git commit -m "Add expense frontend lib and API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: GastosPage (frontend)

**Files:**
- Create: `frontend/src/pages/GastosPage.tsx`
- Create: `frontend/src/pages/GastosPage.test.tsx`

**Interfaces:**
- Consumes: `api.listExpenses` / `api.createExpense` / `api.deleteExpense` / `api.deleteExpenseGroup` / `api.Expense` (Task 6); `formatCentsBRL` / `parseCentsFromInput` from `../lib/money.js` (existing); `CATEGORIES` / `PAYMENT_METHODS` from `../lib/expenses.js` (Task 6); `FixedExpensesSection` from `../components/FixedExpensesSection.js` (Task 8 — imported now, created in Task 8; GastosPage's own test does not exercise it because Task 7 runs before Task 8, so **Task 7 Step 1 creates a minimal stub** `FixedExpensesSection.tsx` that Task 8 replaces).
- Produces: `GastosPage` React component (named export).

- [ ] **Step 1: Create a stub for the not-yet-built section**

So `GastosPage` compiles before Task 8, create
`frontend/src/components/FixedExpensesSection.tsx` with a placeholder
that Task 8 fully replaces:

```tsx
export function FixedExpensesSection(_props: { onApplied?: () => void }) {
  return null;
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/GastosPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GastosPage } from './GastosPage.js';
import * as api from '../lib/api.js';

function expense(over: Partial<api.Expense>): api.Expense {
  return {
    id: 1,
    date: '2026-08-01',
    description: 'Mercado',
    amountCents: 10_000,
    category: 'Alimentação',
    type: 'essencial',
    paymentMethod: 'Débito',
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    notes: null,
    ...over,
  };
}

describe('GastosPage', () => {
  it('lists expenses and shows essencial / não-essencial totals', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([
      expense({ id: 1, amountCents: 10_000, type: 'essencial' }),
      expense({ id: 2, description: 'Cinema', amountCents: 4_000, type: 'nao-essencial' }),
    ]);

    render(<GastosPage />);

    expect(await screen.findByText(/Mercado/)).toBeInTheDocument();
    expect(screen.getByText('Total: R$ 140,00')).toBeInTheDocument();
    expect(screen.getByText('Essencial: R$ 100,00')).toBeInTheDocument();
    expect(screen.getByText('Não-essencial: R$ 40,00')).toBeInTheDocument();
  });

  it('submits a new expense with parsed cents and no installments', async () => {
    const listSpy = vi
      .spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([expense({ id: 5, description: 'Livro', amountCents: 6_000 })]);
    const createSpy = vi.spyOn(api, 'createExpense').mockResolvedValue({ ids: [5] });

    render(<GastosPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Livro' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Educação' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'nao-essencial' } });
    fireEvent.change(screen.getByLabelText('Forma de pagamento'), { target: { value: 'Pix' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar gasto' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-10',
        description: 'Livro',
        amountCents: 6_000,
        category: 'Educação',
        type: 'nao-essencial',
        paymentMethod: 'Pix',
        installmentTotal: null,
        notes: null,
      }),
    );
  });

  it('sends installmentTotal when the parcelas field is set', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createExpense').mockResolvedValue({ ids: [1, 2, 3] });

    render(<GastosPage />);
    await waitFor(() => expect(api.listExpenses).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Tênis' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '650' } });
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar gasto' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ installmentTotal: 3 })),
    );
  });

  it('deletes a one-off row via deleteExpense', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([expense({ id: 9 })])
      .mockResolvedValueOnce([]);
    const deleteSpy = vi.spyOn(api, 'deleteExpense').mockResolvedValue({ ok: true });

    render(<GastosPage />);
    expect(await screen.findByText(/Mercado/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir gasto de 2026-08-01' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(9));
  });

  it('deletes an installment row via deleteExpenseGroup', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([
        expense({
          id: 3,
          description: 'Tênis',
          installmentNumber: 1,
          installmentTotal: 3,
          installmentGroupId: 'grp',
        }),
      ])
      .mockResolvedValueOnce([]);
    const groupSpy = vi.spyOn(api, 'deleteExpenseGroup').mockResolvedValue({ ok: true });

    render(<GastosPage />);
    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir gasto de 2026-08-01' }));
    await waitFor(() => expect(groupSpy).toHaveBeenCalledWith('grp'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/GastosPage.test.tsx`
Expected: FAIL — `Cannot find module './GastosPage.js'`.

- [ ] **Step 4: Create `frontend/src/pages/GastosPage.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/expenses.js';
import { FixedExpensesSection } from '../components/FixedExpensesSection.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function GastosPage() {
  const [expenses, setExpenses] = useState<api.Expense[]>([]);
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [type, setType] = useState<'essencial' | 'nao-essencial'>('essencial');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [installments, setInstallments] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setExpenses(await api.listExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError('Valor inválido');
      return;
    }

    let installmentTotal: number | null = null;
    if (installments.trim() !== '') {
      const parsed = Number(installments);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError('Número de parcelas inválido');
        return;
      }
      installmentTotal = parsed;
    }

    try {
      await api.createExpense({
        date,
        description,
        amountCents,
        category,
        type,
        paymentMethod,
        installmentTotal,
        notes: null,
      });
      setDate('');
      setDescription('');
      setAmount('');
      setInstallments('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(entry: api.Expense) {
    setError(null);
    try {
      if (entry.installmentGroupId) {
        await api.deleteExpenseGroup(entry.installmentGroupId);
      } else {
        await api.deleteExpense(entry.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const total = expenses.reduce((s, e) => s + e.amountCents, 0);
  const essencial = expenses
    .filter((e) => e.type === 'essencial')
    .reduce((s, e) => s + e.amountCents, 0);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Gastos</h1>

      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="gasto-date" style={fieldStyle}>Data</label>
          <input id="gasto-date" type="date" className="field-input" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-description" style={fieldStyle}>Descrição</label>
          <input id="gasto-description" type="text" className="field-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-amount" style={fieldStyle}>Valor (R$)</label>
          <input id="gasto-amount" type="text" className="field-input" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gasto-category" style={fieldStyle}>Categoria</label>
          <select id="gasto-category" className="field-input" value={category}
            onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gasto-type" style={fieldStyle}>Tipo</label>
          <select id="gasto-type" className="field-input" value={type}
            onChange={(e) => setType(e.target.value as 'essencial' | 'nao-essencial')}>
            <option value="essencial">Essencial</option>
            <option value="nao-essencial">Não-essencial</option>
          </select>
        </div>
        <div>
          <label htmlFor="gasto-payment" style={fieldStyle}>Forma de pagamento</label>
          <select id="gasto-payment" className="field-input" value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gasto-installments" style={fieldStyle}>Parcelas</label>
          <input id="gasto-installments" type="number" min="1" className="field-input"
            value={installments} onChange={(e) => setInstallments(e.target.value)} />
        </div>
        <button type="submit" className="button-primary">+ Adicionar gasto</button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      {expenses.length > 0 && (
        <div className="card" style={{ marginBottom: 20, fontSize: 13 }}>
          <div>Total: {formatCentsBRL(total)}</div>
          <div>Essencial: {formatCentsBRL(essencial)}</div>
          <div>Não-essencial: {formatCentsBRL(total - essencial)}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 32 }}>
        {expenses.length === 0 && <p style={{ color: 'var(--text3)' }}>Nenhum gasto ainda.</p>}
        {expenses.map((e) => (
          <div
            key={e.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ color: 'var(--text2)' }}>{e.date}</span>
            <span style={{ flex: 1 }}>
              {e.description}
              {e.installmentTotal !== null && ` (${e.installmentNumber}/${e.installmentTotal})`}
            </span>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>{e.category}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(e.amountCents)}</span>
            <button
              type="button"
              onClick={() => handleDelete(e)}
              aria-label={`Excluir gasto de ${e.date}`}
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
          </div>
        ))}
      </div>

      <FixedExpensesSection onApplied={refresh} />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/GastosPage.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/GastosPage.tsx frontend/src/pages/GastosPage.test.tsx frontend/src/components/FixedExpensesSection.tsx
git commit -m "Add GastosPage with expense form, totals, and installment-aware delete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: FixedExpensesSection (frontend)

**Files:**
- Modify: `frontend/src/components/FixedExpensesSection.tsx` (replace the Task 7 stub)
- Create: `frontend/src/components/FixedExpensesSection.test.tsx`

**Interfaces:**
- Consumes: `api.listFixedExpenses` / `api.createFixedExpense` / `api.deleteFixedExpense` / `api.applyFixedExpenses` / `api.FixedExpense` (Task 6); `formatCentsBRL` / `parseCentsFromInput` from `../lib/money.js`; `CATEGORIES` / `PAYMENT_METHODS` from `../lib/expenses.js`.
- Produces: `FixedExpensesSection({ onApplied?: () => void })` — replaces the stub with the same signature.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/FixedExpensesSection.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FixedExpensesSection } from './FixedExpensesSection.js';
import * as api from '../lib/api.js';

const aluguel: api.FixedExpense = {
  id: 1,
  description: 'Aluguel',
  amountCents: 280_000,
  category: 'Moradia',
  type: 'essencial',
  paymentMethod: 'Pix',
};

describe('FixedExpensesSection', () => {
  it('lists existing templates', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([aluguel]);
    render(<FixedExpensesSection />);
    expect(await screen.findByText(/Aluguel/)).toBeInTheDocument();
  });

  it('adds a template via createFixedExpense', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createFixedExpense').mockResolvedValue({ id: 2 });

    render(<FixedExpensesSection />);
    await waitFor(() => expect(api.listFixedExpenses).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Descrição do gasto fixo'), {
      target: { value: 'Internet' },
    });
    fireEvent.change(screen.getByLabelText('Valor do gasto fixo (R$)'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar fixo' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Internet', amountCents: 12_000 }),
      ),
    );
  });

  it('applies templates to the current month and calls onApplied', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([aluguel]);
    const applySpy = vi.spyOn(api, 'applyFixedExpenses').mockResolvedValue({ created: 2 });
    const onApplied = vi.fn();

    render(<FixedExpensesSection onApplied={onApplied} />);
    await waitFor(() => expect(api.listFixedExpenses).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar ao mês atual' }));

    await waitFor(() => expect(applySpy).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/)));
    expect(await screen.findByText(/2 gasto\(s\) aplicado\(s\)/)).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/FixedExpensesSection.test.tsx`
Expected: FAIL — the stub renders `null`, so the queries find nothing.

- [ ] **Step 3: Replace the stub with the real component**

Overwrite `frontend/src/components/FixedExpensesSection.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/expenses.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function FixedExpensesSection({ onApplied }: { onApplied?: () => void }) {
  const [templates, setTemplates] = useState<api.FixedExpense[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [type, setType] = useState<'essencial' | 'nao-essencial'>('essencial');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setTemplates(await api.listFixedExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setError('Valor inválido');
      return;
    }

    try {
      await api.createFixedExpense({ description, amountCents, category, type, paymentMethod });
      setDescription('');
      setAmount('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteFixedExpense(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleApply() {
    setError(null);
    setStatus(null);
    const month = new Date().toISOString().slice(0, 7);
    try {
      const { created } = await api.applyFixedExpenses(month);
      setStatus(`${created} gasto(s) aplicado(s) a ${month}.`);
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, marginBottom: 12 }}>Gastos fixos</h2>

      <div className="card" style={{ marginBottom: 12 }}>
        {templates.length === 0 && (
          <p style={{ color: 'var(--text3)' }}>Nenhum gasto fixo cadastrado.</p>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ flex: 1 }}>{t.description}</span>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>{t.category}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(t.amountCents)}</span>
            <button
              type="button"
              onClick={() => handleDelete(t.id)}
              aria-label={`Excluir gasto fixo ${t.description}`}
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
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="card"
        style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="fixed-description" style={fieldStyle}>Descrição do gasto fixo</label>
          <input id="fixed-description" type="text" className="field-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fixed-amount" style={fieldStyle}>Valor do gasto fixo (R$)</label>
          <input id="fixed-amount" type="text" className="field-input" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fixed-category" style={fieldStyle}>Categoria</label>
          <select id="fixed-category" className="field-input" value={category}
            onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fixed-type" style={fieldStyle}>Tipo</label>
          <select id="fixed-type" className="field-input" value={type}
            onChange={(e) => setType(e.target.value as 'essencial' | 'nao-essencial')}>
            <option value="essencial">Essencial</option>
            <option value="nao-essencial">Não-essencial</option>
          </select>
        </div>
        <div>
          <label htmlFor="fixed-payment" style={fieldStyle}>Forma de pagamento</label>
          <select id="fixed-payment" className="field-input" value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button type="submit" className="button-primary">+ Adicionar fixo</button>
      </form>

      <button type="button" className="button-primary" onClick={handleApply}>
        Aplicar ao mês atual
      </button>
      {status && <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)' }}>{status}</p>}
      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/FixedExpensesSection.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FixedExpensesSection.tsx frontend/src/components/FixedExpensesSection.test.tsx
git commit -m "Add FixedExpensesSection: template CRUD and apply-to-month

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: ParcelasPage + route wiring (frontend)

**Files:**
- Create: `frontend/src/pages/ParcelasPage.tsx`
- Create: `frontend/src/pages/ParcelasPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.listExpenses` / `api.deleteExpenseGroup` / `api.Expense` (Task 6); `groupInstallments` from `../lib/expenses.js` (Task 6); `formatCentsBRL` from `../lib/money.js`.
- Produces: `ParcelasPage` React component (named export), mounted at `/parcelas`; `GastosPage` mounted at `/gastos`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/ParcelasPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParcelasPage } from './ParcelasPage.js';
import * as api from '../lib/api.js';

function row(over: Partial<api.Expense>): api.Expense {
  return {
    id: 0,
    date: '2026-01-15',
    description: 'Tênis',
    amountCents: 21_666,
    category: 'Vestuário',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentNumber: 1,
    installmentTotal: 3,
    installmentGroupId: 'g1',
    notes: null,
    ...over,
  };
}

describe('ParcelasPage', () => {
  it('renders one grouped row with paid / remaining text', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([
      row({ id: 1, date: '2020-01-15', installmentNumber: 1, amountCents: 21_668 }),
      row({ id: 2, date: '2020-02-15', installmentNumber: 2 }),
      row({ id: 3, date: '2999-03-15', installmentNumber: 3 }),
    ]);

    render(<ParcelasPage />);

    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();
    expect(screen.getByText(/parcela 2\/3/)).toBeInTheDocument();
    expect(screen.getByText(/restante R\$ 216,66/)).toBeInTheDocument();
  });

  it('deletes the whole group on Excluir', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([row({ id: 1 }), row({ id: 2, installmentNumber: 2 })])
      .mockResolvedValueOnce([]);
    const groupSpy = vi.spyOn(api, 'deleteExpenseGroup').mockResolvedValue({ ok: true });

    render(<ParcelasPage />);
    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir parcelamento Tênis' }));
    await waitFor(() => expect(groupSpy).toHaveBeenCalledWith('g1'));
  });

  it('shows an empty state when there are no installment purchases', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
    render(<ParcelasPage />);
    expect(await screen.findByText('Nenhuma compra parcelada.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/ParcelasPage.test.tsx`
Expected: FAIL — `Cannot find module './ParcelasPage.js'`.

- [ ] **Step 3: Create `frontend/src/pages/ParcelasPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL } from '../lib/money.js';
import { groupInstallments } from '../lib/expenses.js';

export function ParcelasPage() {
  const [expenses, setExpenses] = useState<api.Expense[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setExpenses(await api.listExpenses());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(groupId: string) {
    setError(null);
    try {
      await api.deleteExpenseGroup(groupId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  const groups = groupInstallments(expenses, new Date().toISOString().slice(0, 10));

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Parcelas</h1>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card">
        {groups.length === 0 && (
          <p style={{ color: 'var(--text3)' }}>Nenhuma compra parcelada.</p>
        )}
        {groups.map((g) => (
          <div
            key={g.groupId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ flex: 1 }}>{g.description}</span>
            <span style={{ color: 'var(--text2)', fontSize: 12.5 }}>
              parcela {g.paidCount}/{g.installmentTotal}
            </span>
            <span style={{ fontFamily: 'var(--mono)' }}>
              restante {formatCentsBRL(g.remainingCents)}
            </span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
              total {formatCentsBRL(g.totalCents)}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(g.groupId)}
              aria-label={`Excluir parcelamento ${g.description}`}
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
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/ParcelasPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire both routes in `frontend/src/App.tsx`**

Add imports beside the other page imports:

```ts
import { GastosPage } from './pages/GastosPage.js';
import { ParcelasPage } from './pages/ParcelasPage.js';
```

Replace:

```tsx
            <Route path="/gastos" element={<PlaceholderPage title="Gastos" />} />
            <Route path="/parcelas" element={<PlaceholderPage title="Parcelas" />} />
```

with:

```tsx
            <Route path="/gastos" element={<GastosPage />} />
            <Route path="/parcelas" element={<ParcelasPage />} />
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ParcelasPage.tsx frontend/src/pages/ParcelasPage.test.tsx frontend/src/App.tsx
git commit -m "Add ParcelasPage and mount Gastos + Parcelas routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Build, smoke test, QA checklist

**Files:**
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Full test sweep**

Run: `cd server && npm test` — expected all green.
Run: `cd frontend && npm test` — expected all green.

- [ ] **Step 2: Production build**

Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0 (frontend `tsc` compiles the
test files too, so a type error fails here).

- [ ] **Step 3: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'expenses (unauth): %{http_code}\n' http://localhost:4173/api/expenses
curl -s -o /dev/null -w 'fixed (unauth): %{http_code}\n' http://localhost:4173/api/fixed-expenses
curl -s -o /dev/null -w 'gastos page: %{http_code}\n' http://localhost:4173/gastos
```

Expected: `health: 200`, both API routes `401`, `gastos page: 200`.

- [ ] **Step 4: Manual browser check**

Hard-refresh, open **Gastos**: add a one-off expense (e.g. "Mercado" R$
150, Alimentação, Essencial, Débito) — it appears with the totals card
updating. Add an installment purchase ("Tênis" R$ 650, 3 parcelas) —
three rows appear dated one month apart, `(1/3)` `(2/3)` `(3/3)`. Open
**Parcelas** — one group row: `Tênis — parcela X/3 — restante … — total
R$ 650,00`. Delete it there — all three rows vanish from Gastos too.
Back in **Gastos**, under "Gastos fixos": add "Aluguel" R$ 2.800, click
**Aplicar ao mês atual** — status shows "1 gasto(s) aplicado(s)"; an
Aluguel expense dated the 1st appears. Click apply again — "0 gasto(s)".

- [ ] **Step 5: Append to `docs/qa-checklist.md`**

```markdown

## Gastos + Parcelas

- [ ] Gastos page loads from the nav (no longer "em breve").
- [ ] A one-off expense appears in the list immediately; the
      Total / Essencial / Não-essencial card updates without a refresh.
- [ ] An expense with N parcelas creates N rows dated one month apart,
      each labelled (i/N), summing exactly to the purchase amount.
- [ ] Deleting a non-installment expense removes just that row.
- [ ] Deleting an installment expense (from Gastos or Parcelas) removes
      the whole group.
- [ ] Parcelas page shows one row per installment purchase with the
      paid count and the remaining BRL.
- [ ] Adding a fixed expense and clicking "Aplicar ao mês atual" creates
      one expense dated the 1st; clicking again creates none.
- [ ] An invalid expense (blank description, non-numeric amount) shows an
      inline error and saves nothing.
```

- [ ] **Step 6: Commit**

```bash
git add docs/qa-checklist.md
git commit -m "Add Gastos + Parcelas QA checklist items"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `addMonths` (day-clamped), `splitInstallments` (exact sum) | 1 |
| Expense data layer: single + N-way split, validation, both deletes, ordering | 2 |
| Fixed-expense data layer: CRUD + idempotent `applyFixedExpensesToMonth` + month-format guard | 3 |
| `POST/GET /api/expenses`, `DELETE /api/expenses/:id`, `DELETE /api/expenses/group/:groupId` behind auth | 4 |
| `GET/POST /api/fixed-expenses`, `DELETE /api/fixed-expenses/:id`, `POST /api/fixed-expenses/apply` behind auth | 5 |
| Register all routes in `app.ts` | 4 (Step 4), 5 (Step 4) |
| `CATEGORIES` / `PAYMENT_METHODS` / `groupInstallments` | 6 |
| API client (expenses + fixed-expenses, 8 functions) | 6 |
| `GastosPage` — form, totals card, list with `(i/N)`, installment-aware delete | 7 |
| `FixedExpensesSection` — template list + delete, add form, apply button, `onApplied` | 8 |
| `ParcelasPage` — grouped rows, whole-group delete, empty state | 9 |
| Mount `GastosPage` at `/gastos`, `ParcelasPage` at `/parcelas` | 9 (Step 5) |
| Testing at every layer | 1–9 |
| Out of scope: category rules, auto-categorisation, editing, month scoping | not implemented — correct |

**Placeholder scan:** none — every step has literal code or a literal command.

**Type consistency:** `Expense` / `NewExpense` fields match across Task 2
(server), Task 6 (`api.ts`), and the test `expense()`/`row()` builders in
Tasks 7 and 9. `FixedExpense` / `NewFixedExpense` match across Tasks 3, 5,
6, 8. `createExpense` returns `{ ids: number[] }` in Task 4's route and
Task 6's client and is consumed as `.ids` in Task 7's test.
`applyFixedExpenses` returns `{ created: number }` in Task 5's route,
Task 6's client, and Task 8's test. Route paths (`/api/expenses`,
`/api/expenses/group/:groupId`, `/api/fixed-expenses`,
`/api/fixed-expenses/apply`) match between the route files and the client.
`groupInstallments(expenses, todayISO)` signature matches between Task 6's
definition/test and Task 9's page. The Task 7 stub and Task 8
replacement of `FixedExpensesSection` share the exact prop signature
`{ onApplied?: () => void }`. Test label strings (`'Data'`, `'Descrição'`,
`'Valor (R$)'`, `'Categoria'`, `'Tipo'`, `'Forma de pagamento'`,
`'Parcelas'`, `'+ Adicionar gasto'`, `'Excluir gasto de <date>'`,
`'Descrição do gasto fixo'`, `'Valor do gasto fixo (R$)'`,
`'+ Adicionar fixo'`, `'Aplicar ao mês atual'`,
`'Excluir gasto fixo <desc>'`, `'Excluir parcelamento <desc>'`) match
between each component and its test.
