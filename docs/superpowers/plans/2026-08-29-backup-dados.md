# Backup & Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backup & Dados page — diagnostics, a full-dataset
JSON export/import (full-replace, backup first), a typed-phrase danger
zone (wipe / seed test data), and the soft monthly-close review.

**Architecture:** Small unit-tested `server/src/data/` modules
(`tables` / `wipe` / `export` / `import` / `seed` / `diagnostics`), a
`routes/data.ts` that wires them behind `requireAuth` and calls the
existing `backupDatabase` before every destructive op. `buildApp` gains
an optional third arg `dataPaths` so the routes can reach the DB path +
backup dir; absent in tests → `backupPath: null`.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, better-sqlite3, React 18,
React Router 6, Vite 6, Vitest (+ `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-08-29-backup-dados-design.md`

## Global Constraints

- `DATA_TABLES` in `server/src/data/tables.ts` is the single source of
  truth for which tables export/import/wipe/diagnostics touch. Auth,
  session, and schema tables are excluded.
- Every destructive route (`import`, `wipe`, `seed-test`) calls
  `backupDatabase(dbPath, backupDir)` **first** — but only when
  `dataPaths` was passed to `buildApp` (skipped in tests, `backupPath`
  is `null`).
- `wipe` and `seed-test` require the body `{ confirm: "APAGAR TUDO" }`
  exactly; a wrong phrase → `400` before any backup or mutation.
- `import` does a cheap shape check (`version === 1`, `tables` is an
  object) → `400` before backup; the full per-table validation is in
  `importData`, inside the transaction (rolls back on throw).
- Money is integer cents; `deleted_at` soft-deletes stay soft
  everywhere. Export **includes** soft-deleted rows (a backup is
  complete). Import and wipe use plain `DELETE FROM` (they are
  replacing the whole table).
- Monthly close is informational only — it never blocks editing.
- Every task is TDD: failing test → red → minimal impl → green → commit.
- Run server tests from `server/`, frontend tests from `frontend/`.
- Work on a branch `backup-dados` off `main`; the finishing skill merges.

---

## File Structure

**New (server):**
- `server/src/data/tables.ts` + `.test.ts` — `DATA_TABLES`, `DataTable`.
- `server/src/data/wipe.ts` + `.test.ts` — `wipeData`.
- `server/src/data/export.ts` + `.test.ts` — `exportData`.
- `server/src/data/import.ts` + `.test.ts` — `importData`.
- `server/src/data/seed.ts` + `.test.ts` — `seedTestData`.
- `server/src/data/diagnostics.ts` + `.test.ts` — `diagnostics`.
- `server/src/routes/data.ts` + `.test.ts` — `registerDataRoutes`.

**New (frontend):**
- `frontend/src/pages/BackupDadosPage.tsx` + `.test.tsx`

**Modified (server):**
- `server/src/app.ts` — `buildApp` third arg `dataPaths`; register data routes.
- `server/src/index.ts` — pass `{ dbPath, backupDir }`.

**Modified (frontend):**
- `frontend/src/lib/api.ts` — `Diagnostics` / `MonthCloseRow` types, `EXPORT_URL`, 7 client functions.
- `frontend/src/App.tsx` — mount `BackupDadosPage`.

**Modified (repo):**
- `scripts/qa-e2e.sh` — Backup & Dados section.
- `docs/qa-checklist.md` — Backup & Dados checks.

---

## Task 1: DATA_TABLES list

**Files:**
- Create: `server/src/data/tables.ts`
- Test: `server/src/data/tables.test.ts`

**Interfaces:**
- Produces: `export const DATA_TABLES` (readonly tuple); `export type DataTable`.

- [ ] **Step 1: Write the failing test**

Create `server/src/data/tables.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { DATA_TABLES } from './tables.js';

describe('DATA_TABLES', () => {
  it('is exactly the migrated tables minus auth/session/schema', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const all = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    const nonData = new Set(['app_settings', 'sessions', 'schema_migrations']);
    const expected = all.filter((n) => !nonData.has(n)).sort();

    expect([...DATA_TABLES].sort()).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/tables.test.ts`
Expected: FAIL — `Cannot find module './tables.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/tables.ts`:

```ts
/**
 * Every table that holds user data. Auth (`app_settings`, `sessions`)
 * and schema (`schema_migrations`) tables are deliberately excluded from
 * export / import / wipe / diagnostics.
 */
export const DATA_TABLES = [
  'income',
  'exchange_contracts',
  'expenses',
  'fixed_expenses',
  'emergency_fund_entries',
  'savings_monthly_targets',
  'goals',
  'special_projects',
  'category_rules',
  'dollar_quotes',
  'monthly_close',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/tables.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/data/tables.ts server/src/data/tables.test.ts
git commit -m "Add DATA_TABLES: the tables export/import/wipe operate on

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: wipeData

**Files:**
- Create: `server/src/data/wipe.ts`
- Test: `server/src/data/wipe.test.ts`

**Interfaces:**
- Consumes: `DATA_TABLES` from `./tables.js` (Task 1); `runMigrations` (existing).
- Produces:
  ```ts
  interface WipeResult { deleted: Record<string, number> }
  function wipeData(db: Database.Database): WipeResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/data/wipe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { wipeData } from './wipe.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('wipeData', () => {
  it('empties every data table and returns pre-delete counts, leaving auth + schema', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 1000)").run();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-02', 2000)").run();
    db.prepare("INSERT INTO goals (name, target_cents) VALUES ('PS5', 400000)").run();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('k', 'v')").run();

    const result = wipeData(db);

    expect(result.deleted.income).toBe(2);
    expect(result.deleted.goals).toBe(1);
    expect(result.deleted.expenses).toBe(0);

    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM goals').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM app_settings').get()).toEqual({ n: 1 });
    expect(
      (db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n,
    ).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/wipe.test.ts`
Expected: FAIL — `Cannot find module './wipe.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/wipe.ts`:

```ts
import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface WipeResult {
  deleted: Record<string, number>;
}

/**
 * Deletes every row from every data table in one transaction. Returns
 * the row count each table held before it was cleared. Leaves
 * app_settings, sessions, schema_migrations, and the schema untouched.
 */
export function wipeData(db: Database.Database): WipeResult {
  const run = db.transaction((): Record<string, number> => {
    const deleted: Record<string, number> = {};
    for (const table of DATA_TABLES) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      deleted[table] = n;
      db.prepare(`DELETE FROM ${table}`).run();
    }
    return deleted;
  });
  return { deleted: run() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/wipe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/data/wipe.ts server/src/data/wipe.test.ts
git commit -m "Add wipeData: clear every data table, keep auth + schema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: exportData

**Files:**
- Create: `server/src/data/export.ts`
- Test: `server/src/data/export.test.ts`

**Interfaces:**
- Consumes: `DATA_TABLES` (Task 1).
- Produces:
  ```ts
  interface DataExport {
    version: 1;
    exportedAt: string;
    tables: Record<string, unknown[]>;
  }
  function exportData(db: Database.Database): DataExport;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/data/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { exportData } from './export.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('exportData', () => {
  it('captures rows from every data table, including soft-deleted ones', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 5000)").run();
    db.prepare("INSERT INTO goals (name, target_cents) VALUES ('PS5', 400000)").run();
    db.prepare(
      "INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, deleted_at) VALUES ('2026-06-01', 'gone', 100, 'C', 'essencial', 'Pix', '2026-06-02T00:00:00Z')",
    ).run();

    const out = exportData(db);

    expect(out.version).toBe(1);
    expect(Number.isNaN(Date.parse(out.exportedAt))).toBe(false);
    expect(out.tables.income).toHaveLength(1);
    expect(out.tables.goals[0]).toMatchObject({ name: 'PS5', target_cents: 400000 });
    expect(out.tables.expenses).toHaveLength(1); // the soft-deleted row is still exported
    expect(out.tables.fixed_expenses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/export.test.ts`
Expected: FAIL — `Cannot find module './export.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/export.ts`:

```ts
import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface DataExport {
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/**
 * A complete snapshot of every data table — soft-deleted rows included,
 * so a restore is byte-for-byte. Auth/session/schema tables are not
 * exported.
 */
export function exportData(db: Database.Database): DataExport {
  const tables: Record<string, unknown[]> = {};
  for (const table of DATA_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/data/export.ts server/src/data/export.test.ts
git commit -m "Add exportData: full snapshot of every data table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: importData

**Files:**
- Create: `server/src/data/import.ts`
- Test: `server/src/data/import.test.ts`

**Interfaces:**
- Consumes: `DATA_TABLES` (Task 1); `exportData` (Task 3) and `wipeData` (Task 2) in the round-trip test.
- Produces:
  ```ts
  interface ImportResult { imported: Record<string, number> }
  function importData(db: Database.Database, payload: unknown): ImportResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/data/import.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { exportData } from './export.js';
import { wipeData } from './wipe.js';
import { importData } from './import.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('importData', () => {
  it('round-trips a full export through wipe + import', () => {
    const db = freshDb();
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 5000)").run();
    db.prepare("INSERT INTO goals (name, target_cents, current_cents) VALUES ('PS5', 400000, 100)").run();

    const snapshot = exportData(db);
    wipeData(db);
    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 0 });

    const result = importData(db, snapshot);

    expect(result.imported.income).toBe(1);
    expect(result.imported.goals).toBe(1);
    expect(db.prepare('SELECT * FROM income').all()).toHaveLength(1);
    expect(db.prepare('SELECT name, current_cents FROM goals').get()).toEqual({
      name: 'PS5',
      current_cents: 100,
    });
  });

  it('rejects a bad version, a non-object tables, or an unknown table', () => {
    const db = freshDb();
    expect(() => importData(db, { version: 2, tables: {} })).toThrow();
    expect(() => importData(db, { version: 1, tables: [] })).toThrow();
    expect(() => importData(db, { version: 1, tables: { not_a_table: [] } })).toThrow();
    expect(() => importData(db, { version: 1, tables: { income: 'nope' } })).toThrow();
  });

  it('treats a missing table key as empty and still imports the rest', () => {
    const db = freshDb();
    importData(db, {
      version: 1,
      tables: { income: [{ id: 1, date: '2026-06-01', amount_brl_cents: 900 }] },
    });
    expect(db.prepare('SELECT count(*) AS n FROM income').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM goals').get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/import.test.ts`
Expected: FAIL — `Cannot find module './import.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/import.ts`:

```ts
import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface ImportResult {
  imported: Record<string, number>;
}

interface DataExportShape {
  version: number;
  tables: Record<string, unknown[]>;
}

function assertShape(payload: unknown): asserts payload is DataExportShape {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { version?: unknown }).version !== 1
  ) {
    throw new Error('unsupported export version');
  }
  const tables = (payload as { tables?: unknown }).tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    throw new Error('tables must be an object');
  }
  const allowed = new Set<string>(DATA_TABLES);
  for (const [key, value] of Object.entries(tables)) {
    if (!allowed.has(key)) throw new Error(`unknown table in export: ${key}`);
    if (!Array.isArray(value)) throw new Error(`tables.${key} must be an array`);
  }
}

/**
 * Full-replace import: wipes every data table then reloads it from the
 * payload, in one transaction. Rolls back entirely on any error.
 */
export function importData(db: Database.Database, payload: unknown): ImportResult {
  assertShape(payload);
  const tables = payload.tables;

  const run = db.transaction((): Record<string, number> => {
    const imported: Record<string, number> = {};
    for (const table of DATA_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
      const rows = (tables[table] ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const keys = Object.keys(row);
        const cols = keys.join(', ');
        const placeholders = keys.map((k) => `@${k}`).join(', ');
        db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(row);
      }
      imported[table] = rows.length;
    }
    return imported;
  });

  return { imported: run() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/import.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/data/import.ts server/src/data/import.test.ts
git commit -m "Add importData: transactional full-replace from an export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: seedTestData

**Files:**
- Create: `server/src/data/seed.ts`
- Test: `server/src/data/seed.test.ts`

**Interfaces:**
- Consumes: `wipeData` (Task 2); the existing data-layer creators — `createIncome` (`../db/income.js`), `createExpense` (`../db/expenses.js`), `createExchangeContract` (`../db/exchange.js`), `createDeposit` / `createWithdrawal` (`../db/emergency-fund.js`), `updateMonthlyTargetConfig` (`../db/savings-target.js`), `createTarget` (`../db/targets.js`), `upsertQuote` (`../db/dollar-quotes.js`).
- Produces:
  ```ts
  interface SeedResult { seeded: true }
  function seedTestData(db: Database.Database, now?: Date): SeedResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/data/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from './seed.js';
import { listIncome } from '../db/income.js';
import { listExpenses } from '../db/expenses.js';
import { listExchangeContracts } from '../db/exchange.js';
import { listEmergencyFundEntries } from '../db/emergency-fund.js';
import { listTargets } from '../db/targets.js';
import { listQuotes } from '../db/dollar-quotes.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const NOW = new Date(2026, 7, 15); // Aug 2026

describe('seedTestData', () => {
  it('populates every data-bearing table across three months', () => {
    const db = freshDb();
    seedTestData(db, NOW);

    expect(listIncome(db).length).toBeGreaterThan(0);
    expect(listExpenses(db).length).toBeGreaterThan(0);
    expect(listExchangeContracts(db).length).toBeGreaterThan(0);
    expect(listEmergencyFundEntries(db).length).toBeGreaterThan(0);
    expect(listTargets(db, 'goals').length).toBeGreaterThan(0);
    expect(listTargets(db, 'special_projects').length).toBeGreaterThan(0);
    expect(listQuotes(db).length).toBe(3);

    const months = new Set(listExpenses(db).map((e) => e.date.slice(0, 7)));
    expect([...months].sort()).toEqual(['2026-06', '2026-07', '2026-08']);

    expect(listTargets(db, 'goals').some((g) => g.currentCents >= g.targetCents)).toBe(true);
  });

  it('wipes first, so two runs leave the same counts', () => {
    const db = freshDb();
    seedTestData(db, NOW);
    const first = listIncome(db).length;
    seedTestData(db, NOW);
    expect(listIncome(db).length).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/seed.test.ts`
Expected: FAIL — `Cannot find module './seed.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/seed.ts`:

```ts
import type Database from 'better-sqlite3';
import { wipeData } from './wipe.js';
import { createIncome } from '../db/income.js';
import { createExpense } from '../db/expenses.js';
import { createExchangeContract } from '../db/exchange.js';
import { createDeposit, createWithdrawal } from '../db/emergency-fund.js';
import { updateMonthlyTargetConfig } from '../db/savings-target.js';
import { createTarget } from '../db/targets.js';
import { upsertQuote } from '../db/dollar-quotes.js';

export interface SeedResult {
  seeded: true;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function dayIn(d: Date, day: number): string {
  return `${monthKey(d)}-${String(day).padStart(2, '0')}`;
}

/**
 * Wipes all data, then inserts a small deterministic fixture spanning
 * `now`'s month and the two before it. `now` is a parameter only so
 * tests are deterministic.
 */
export function seedTestData(db: Database.Database, now: Date = new Date()): SeedResult {
  wipeData(db);

  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const months = [m2, m1, m0];
  const rates = [5.05, 5.12, 5.2];

  months.forEach((m, i) => {
    createIncome(db, {
      date: dayIn(m, 5),
      amountBrlCents: 1_800_000 + i * 20_000,
      amountUsdCents: 350_000,
      source: 'Salário',
    });

    createExpense(db, { date: dayIn(m, 6), description: 'Aluguel', amountCents: 280_000, category: 'Moradia', type: 'essencial', paymentMethod: 'Pix' });
    createExpense(db, { date: dayIn(m, 10), description: 'Mercado', amountCents: 120_000, category: 'Alimentação', type: 'essencial', paymentMethod: 'Débito' });
    createExpense(db, { date: dayIn(m, 12), description: 'Transporte', amountCents: 40_000, category: 'Transporte', type: 'essencial', paymentMethod: 'Débito' });
    createExpense(db, { date: dayIn(m, 15), description: 'iFood', amountCents: 35_000, category: 'Delivery', type: 'nao-essencial', paymentMethod: 'Crédito' });
    createExpense(db, { date: dayIn(m, 20), description: 'Cinema', amountCents: 50_000, category: 'Lazer', type: 'nao-essencial', paymentMethod: 'Crédito' });

    createExchangeContract(db, {
      date: dayIn(m, 7),
      institution: 'Banco Inter',
      operationType: 'compra',
      amountUsdCents: 350_000,
      contractedRate: rates[i],
      ptaxRate: rates[i] + 0.05,
      iofCents: 45_000,
      bankFeeCents: 3_000,
    });

    upsertQuote(db, { month: monthKey(m), rate: rates[i], salaryUsdCents: 350_000 });
  });

  // one 3x installment starting in the earliest month
  createExpense(db, {
    date: dayIn(m2, 8),
    description: 'Notebook',
    amountCents: 600_000,
    category: 'Outros',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentTotal: 3,
  });

  createDeposit(db, { date: dayIn(m2, 3), amountCents: 700_000, notes: 'Saldo inicial' });
  createDeposit(db, { date: dayIn(m1, 10), amountCents: 150_000, notes: 'Aporte' });
  createWithdrawal(db, { date: dayIn(m0, 18), amountCents: 100_000, notes: 'Emergência' });

  updateMonthlyTargetConfig(db, monthKey(m0), 'pct', 20, null);

  const targetDate = `${new Date(now.getFullYear(), now.getMonth() + 8, 15)
    .toISOString()
    .slice(0, 10)}`;
  createTarget(db, 'goals', { name: 'Viagem Japão', targetCents: 1_500_000, currentCents: 400_000, targetDate });
  createTarget(db, 'goals', { name: 'Notebook novo', targetCents: 800_000, currentCents: 800_000 });
  createTarget(db, 'special_projects', {
    name: 'Entrada apartamento',
    targetCents: 8_000_000,
    currentCents: 1_200_000,
    notes: 'Liberdade e patrimônio',
  });

  return { seeded: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/seed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/data/seed.ts server/src/data/seed.test.ts
git commit -m "Add seedTestData: a deterministic three-month fixture

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: diagnostics

**Files:**
- Create: `server/src/data/diagnostics.ts`
- Test: `server/src/data/diagnostics.test.ts`

**Interfaces:**
- Consumes: `DATA_TABLES` (Task 1).
- Produces:
  ```ts
  interface Diagnostics {
    rowCounts: Record<string, number>;
    dbSizeBytes: number;
    migrations: string[];
    lastBackup: string | null;
    backupCount: number;
  }
  function diagnostics(
    db: Database.Database,
    paths?: { dbPath: string; backupDir: string },
  ): Diagnostics;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/data/diagnostics.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { diagnostics } from './diagnostics.js';

describe('diagnostics', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-diag-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('counts non-deleted rows, lists migrations, and has no fs data without paths', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 100)").run();
    db.prepare(
      "INSERT INTO income (date, amount_brl_cents, deleted_at) VALUES ('2026-06-02', 200, 'x')",
    ).run();

    const d = diagnostics(db);
    expect(d.rowCounts.income).toBe(1); // the soft-deleted row is not counted
    expect(d.migrations).toEqual(['001_initial_schema', '002_dollar_quotes']);
    expect(d.dbSizeBytes).toBe(0);
    expect(d.lastBackup).toBeNull();
    expect(d.backupCount).toBe(0);
  });

  it('reports db size and backup count when given real paths', () => {
    const dbPath = path.join(tmp, 'fumarende.db');
    const db = new Database(dbPath);
    runMigrations(db);
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(backupDir, 'fumarende-2026-06-01.db'), 'x');

    const d = diagnostics(db, { dbPath, backupDir });
    expect(d.dbSizeBytes).toBeGreaterThan(0);
    expect(d.backupCount).toBe(1);
    expect(d.lastBackup).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/data/diagnostics.test.ts`
Expected: FAIL — `Cannot find module './diagnostics.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/data/diagnostics.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DATA_TABLES } from './tables.js';

export interface Diagnostics {
  rowCounts: Record<string, number>;
  dbSizeBytes: number;
  migrations: string[];
  lastBackup: string | null;
  backupCount: number;
}

const TABLES_WITHOUT_DELETED_AT = new Set(['savings_monthly_targets', 'monthly_close']);

export function diagnostics(
  db: Database.Database,
  paths?: { dbPath: string; backupDir: string },
): Diagnostics {
  const rowCounts: Record<string, number> = {};
  for (const table of DATA_TABLES) {
    const where = TABLES_WITHOUT_DELETED_AT.has(table) ? '' : ' WHERE deleted_at IS NULL';
    const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get() as { n: number };
    rowCounts[table] = n;
  }

  const migrations = (
    db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[]
  ).map((r) => r.id);

  let dbSizeBytes = 0;
  let lastBackup: string | null = null;
  let backupCount = 0;

  if (paths) {
    try {
      dbSizeBytes = fs.statSync(paths.dbPath).size;
    } catch {
      dbSizeBytes = 0;
    }
    try {
      const files = fs
        .readdirSync(paths.backupDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => fs.statSync(path.join(paths.backupDir, f)));
      backupCount = files.length;
      if (files.length > 0) {
        lastBackup = new Date(
          Math.max(...files.map((s) => s.mtimeMs)),
        ).toISOString();
      }
    } catch {
      backupCount = 0;
      lastBackup = null;
    }
  }

  return { rowCounts, dbSizeBytes, migrations, lastBackup, backupCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/data/diagnostics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/data/diagnostics.ts server/src/data/diagnostics.test.ts
git commit -m "Add diagnostics: row counts, db size, migrations, backups

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Data + monthly-close routes; buildApp arg

**Files:**
- Create: `server/src/routes/data.ts`
- Modify: `server/src/app.ts` (third `buildApp` arg; import + register)
- Modify: `server/src/index.ts` (pass `{ dbPath, backupDir }`)
- Test: `server/src/routes/data.test.ts`

**Interfaces:**
- Consumes: `exportData` / `importData` / `wipeData` / `seedTestData` / `diagnostics` from `../data/*.js` (Tasks 2–6); `backupDatabase` from `../db/backup.js` (existing); `requireAuth`; `buildApp`.
- Produces:
  ```ts
  function registerDataRoutes(
    app: FastifyInstance,
    db: Database.Database,
    dataPaths?: { dbPath: string; backupDir: string },
  ): void;
  ```
  Routes: `GET /api/data/diagnostics`, `GET /api/data/export`,
  `POST /api/data/import`, `POST /api/data/wipe`,
  `POST /api/data/seed-test`, `GET /api/monthly-close`,
  `PUT /api/monthly-close/:month`, `DELETE /api/monthly-close/:month`.
- `buildApp` signature becomes
  `buildApp(db, frontendDistDir?, dataPaths?)`.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/data.test.ts`:

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

const addIncome = (app: Awaited<ReturnType<typeof authedApp>>['app'], cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: { session: cookie },
    payload: { date: '2026-06-01', amountBrlCents: 500000 },
  });

describe('data routes', () => {
  it('rejects unauthenticated diagnostics', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/data/diagnostics' })).statusCode).toBe(401);
    await app.close();
  });

  it('exports with an attachment header and a tables object', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/data/export',
      cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment; filename="fumarende-');
    expect(res.json().tables).toBeTypeOf('object');
    await app.close();
  });

  it('round-trips export -> wipe -> import over HTTP', async () => {
    const { app, sessionCookie } = await authedApp();
    await addIncome(app, sessionCookie);

    const snapshot = (
      await app.inject({ method: 'GET', url: '/api/data/export', cookies: { session: sessionCookie } })
    ).json();

    await app.inject({
      method: 'POST',
      url: '/api/data/wipe',
      cookies: { session: sessionCookie },
      payload: { confirm: 'APAGAR TUDO' },
    });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json(),
    ).toHaveLength(0);

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/data/import',
      cookies: { session: sessionCookie },
      payload: snapshot,
    });
    expect(importRes.json()).toMatchObject({ backupPath: null, imported: { income: 1 } });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json(),
    ).toHaveLength(1);
    await app.close();
  });

  it('rejects a wrong confirmation phrase and a bad import payload', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/wipe',
          cookies: { session: sessionCookie },
          payload: { confirm: 'nope' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/import',
          cookies: { session: sessionCookie },
          payload: { version: 1, tables: { nope: [] } },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('seeds test data behind the phrase gate', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/seed-test',
          cookies: { session: sessionCookie },
          payload: { confirm: 'wrong' },
        })
      ).statusCode,
    ).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/data/seed-test',
      cookies: { session: sessionCookie },
      payload: { confirm: 'APAGAR TUDO' },
    });
    expect(ok.json()).toMatchObject({ seeded: true });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json().length,
    ).toBeGreaterThan(0);
    await app.close();
  });

  it('marks and unmarks a month reviewed', async () => {
    const { app, sessionCookie } = await authedApp();
    await addIncome(app, sessionCookie);

    let list = (
      await app.inject({ method: 'GET', url: '/api/monthly-close', cookies: { session: sessionCookie } })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06')).toMatchObject({
      reviewed: false,
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/monthly-close/2026-06',
      cookies: { session: sessionCookie },
    });
    expect(put.json()).toMatchObject({ month: '2026-06', reviewed: true });

    list = (
      await app.inject({ method: 'GET', url: '/api/monthly-close', cookies: { session: sessionCookie } })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06').reviewed).toBe(true);

    await app.inject({
      method: 'DELETE',
      url: '/api/monthly-close/2026-06',
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    list = (
      await app.inject({ method: 'GET', url: '/api/monthly-close', cookies: { session: sessionCookie } })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06').reviewed).toBe(false);

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/monthly-close/2026-6',
          cookies: { session: sessionCookie },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/routes/data.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Create the routes file**

Create `server/src/routes/data.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { backupDatabase } from '../db/backup.js';
import { exportData } from '../data/export.js';
import { importData } from '../data/import.js';
import { wipeData } from '../data/wipe.js';
import { seedTestData } from '../data/seed.js';
import { diagnostics } from '../data/diagnostics.js';

const CONFIRM_PHRASE = 'APAGAR TUDO';
const MONTH_RE = /^\d{4}-\d{2}$/;

interface ConfirmBody {
  confirm?: string;
}

export function registerDataRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataPaths?: { dbPath: string; backupDir: string },
): void {
  const backup = (): string | null =>
    dataPaths ? backupDatabase(dataPaths.dbPath, dataPaths.backupDir) : null;

  app.get('/api/data/diagnostics', { preHandler: requireAuth(db) }, async () =>
    diagnostics(db, dataPaths),
  );

  app.get('/api/data/export', { preHandler: requireAuth(db) }, async (_request, reply) => {
    const date = new Date().toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="fumarende-${date}.json"`);
    return exportData(db);
  });

  app.post<{ Body: unknown }>(
    '/api/data/import',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body as { version?: unknown; tables?: unknown } | null;
      if (
        typeof body !== 'object' ||
        body === null ||
        body.version !== 1 ||
        typeof body.tables !== 'object' ||
        body.tables === null ||
        Array.isArray(body.tables)
      ) {
        return reply.code(400).send({ error: 'invalid export payload' });
      }
      const backupPath = backup();
      try {
        const { imported } = importData(db, body);
        return { backupPath, imported };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'import failed' });
      }
    },
  );

  app.post<{ Body: ConfirmBody }>(
    '/api/data/wipe',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (request.body?.confirm !== CONFIRM_PHRASE) {
        return reply.code(400).send({ error: `confirm must be "${CONFIRM_PHRASE}"` });
      }
      const backupPath = backup();
      return { backupPath, deleted: wipeData(db).deleted };
    },
  );

  app.post<{ Body: ConfirmBody }>(
    '/api/data/seed-test',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      if (request.body?.confirm !== CONFIRM_PHRASE) {
        return reply.code(400).send({ error: `confirm must be "${CONFIRM_PHRASE}"` });
      }
      const backupPath = backup();
      seedTestData(db);
      return { backupPath, seeded: true as const };
    },
  );

  app.get('/api/monthly-close', { preHandler: requireAuth(db) }, async () => {
    const rows = db
      .prepare(
        `WITH data_months AS (
           SELECT DISTINCT substr(date, 1, 7) AS month FROM income WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM expenses WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM exchange_contracts WHERE deleted_at IS NULL
           UNION SELECT DISTINCT substr(date, 1, 7) FROM emergency_fund_entries WHERE deleted_at IS NULL
           UNION SELECT month FROM savings_monthly_targets
           UNION SELECT month FROM dollar_quotes WHERE deleted_at IS NULL
           UNION SELECT month FROM monthly_close
         )
         SELECT dm.month AS month, mc.reviewed_at AS reviewedAt
         FROM data_months dm
         LEFT JOIN monthly_close mc ON mc.month = dm.month
         WHERE dm.month IS NOT NULL
         ORDER BY dm.month DESC`,
      )
      .all() as { month: string; reviewedAt: string | null }[];
    return rows.map((r) => ({
      month: r.month,
      reviewed: r.reviewedAt !== null,
      reviewedAt: r.reviewedAt,
    }));
  });

  app.put<{ Params: { month: string } }>(
    '/api/monthly-close/:month',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { month } = request.params;
      if (!MONTH_RE.test(month)) {
        return reply.code(400).send({ error: 'month must be in YYYY-MM format' });
      }
      const reviewedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO monthly_close (month, reviewed_at) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET reviewed_at = excluded.reviewed_at`,
      ).run(month, reviewedAt);
      return { month, reviewed: true, reviewedAt };
    },
  );

  app.delete<{ Params: { month: string } }>(
    '/api/monthly-close/:month',
    { preHandler: requireAuth(db) },
    async (request) => {
      db.prepare('DELETE FROM monthly_close WHERE month = ?').run(request.params.month);
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Thread `dataPaths` through `buildApp` and register**

In `server/src/app.ts`:

```ts
import { registerDollarQuoteRoutes } from './routes/dollar-quotes.js';
import { registerDataRoutes } from './routes/data.js';
```

Change the signature:

```ts
export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
  dataPaths?: { dbPath: string; backupDir: string },
): Promise<FastifyInstance> {
```

and after `registerDollarQuoteRoutes(app, db);`:

```ts
  registerDollarQuoteRoutes(app, db);
  registerDataRoutes(app, db, dataPaths);
```

In `server/src/index.ts`:

```ts
const app = await buildApp(db, config.frontendDistDir, {
  dbPath: config.dbPath,
  backupDir: config.backupDir,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/routes/data.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/data.ts server/src/routes/data.test.ts server/src/app.ts server/src/index.ts
git commit -m "Add data + monthly-close routes; buildApp dataPaths arg

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend API client

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: the existing private `request<T>()` helper.
- Produces: `Diagnostics`, `MonthCloseRow` interfaces; `EXPORT_URL`
  constant; `getDiagnostics` / `importData` / `wipeData` / `seedTestData`
  / `listMonthlyClose` / `markMonthReviewed` / `unmarkMonthReviewed`.

- [ ] **Step 1: Append to `frontend/src/lib/api.ts`**

```ts
export interface Diagnostics {
  rowCounts: Record<string, number>;
  dbSizeBytes: number;
  migrations: string[];
  lastBackup: string | null;
  backupCount: number;
}

export interface MonthCloseRow {
  month: string;
  reviewed: boolean;
  reviewedAt: string | null;
}

export const EXPORT_URL = '/api/data/export';

export function getDiagnostics(): Promise<Diagnostics> {
  return request('/api/data/diagnostics');
}

export function importData(
  payload: unknown,
): Promise<{ backupPath: string | null; imported: Record<string, number> }> {
  return request('/api/data/import', { method: 'POST', body: JSON.stringify(payload) });
}

export function wipeData(
  confirm: string,
): Promise<{ backupPath: string | null; deleted: Record<string, number> }> {
  return request('/api/data/wipe', { method: 'POST', body: JSON.stringify({ confirm }) });
}

export function seedTestData(
  confirm: string,
): Promise<{ backupPath: string | null; seeded: true }> {
  return request('/api/data/seed-test', { method: 'POST', body: JSON.stringify({ confirm }) });
}

export function listMonthlyClose(): Promise<MonthCloseRow[]> {
  return request('/api/monthly-close');
}

export function markMonthReviewed(month: string): Promise<MonthCloseRow> {
  return request(`/api/monthly-close/${month}`, { method: 'PUT' });
}

export function unmarkMonthReviewed(month: string): Promise<{ ok: true }> {
  return request(`/api/monthly-close/${month}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "Add Backup & Dados API client functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: BackupDadosPage + route wiring

**Files:**
- Create: `frontend/src/pages/BackupDadosPage.tsx`
- Create: `frontend/src/pages/BackupDadosPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.getDiagnostics` / `api.importData` / `api.wipeData` / `api.seedTestData` / `api.listMonthlyClose` / `api.markMonthReviewed` / `api.unmarkMonthReviewed` / `api.EXPORT_URL` / `api.Diagnostics` / `api.MonthCloseRow` (Task 8).
- Produces: `BackupDadosPage` React component (named export), mounted at `/backup`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/BackupDadosPage.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackupDadosPage } from './BackupDadosPage.js';
import * as api from '../lib/api.js';

const diag: api.Diagnostics = {
  rowCounts: { income: 3, expenses: 12, goals: 2 },
  dbSizeBytes: 40960,
  migrations: ['001_initial_schema', '002_dollar_quotes'],
  lastBackup: null,
  backupCount: 0,
};

beforeEach(() => {
  vi.spyOn(api, 'getDiagnostics').mockResolvedValue(diag);
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-08', reviewed: false, reviewedAt: null },
    { month: '2026-07', reviewed: true, reviewedAt: '2026-08-01T12:00:00Z' },
  ]);
});

describe('BackupDadosPage', () => {
  it('renders diagnostics', async () => {
    render(<BackupDadosPage />);
    expect(await screen.findByText(/income: 3/)).toBeInTheDocument();
    expect(screen.getByText(/001_initial_schema, 002_dollar_quotes/)).toBeInTheDocument();
  });

  it('gates the danger-zone buttons behind the confirmation phrase', async () => {
    const wipeSpy = vi.spyOn(api, 'wipeData').mockResolvedValue({ backupPath: null, deleted: {} });
    const seedSpy = vi
      .spyOn(api, 'seedTestData')
      .mockResolvedValue({ backupPath: null, seeded: true });

    render(<BackupDadosPage />);
    await waitFor(() => expect(api.getDiagnostics).toHaveBeenCalled());

    const wipeBtn = screen.getByRole('button', { name: 'Apagar todos os dados' });
    const seedBtn = screen.getByRole('button', { name: 'Carregar dados de teste' });
    expect(wipeBtn).toBeDisabled();
    expect(seedBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Frase de confirmação'), {
      target: { value: 'APAGAR TUDO' },
    });
    expect(wipeBtn).toBeEnabled();

    fireEvent.click(wipeBtn);
    await waitFor(() => expect(wipeSpy).toHaveBeenCalledWith('APAGAR TUDO'));

    fireEvent.change(screen.getByLabelText('Frase de confirmação'), {
      target: { value: 'APAGAR TUDO' },
    });
    fireEvent.click(seedBtn);
    await waitFor(() => expect(seedSpy).toHaveBeenCalledWith('APAGAR TUDO'));
  });

  it('imports a parsed file only after the checkbox is ticked', async () => {
    const importSpy = vi
      .spyOn(api, 'importData')
      .mockResolvedValue({ backupPath: null, imported: {} });

    render(<BackupDadosPage />);
    await waitFor(() => expect(api.getDiagnostics).toHaveBeenCalled());

    const importBtn = screen.getByRole('button', { name: 'Importar' });
    expect(importBtn).toBeDisabled();

    const file = new File(['{"version":1,"tables":{}}'], 'snap.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('Arquivo de importação'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByLabelText(/substitui todos os dados/));
    await waitFor(() => expect(importBtn).toBeEnabled());

    fireEvent.click(importBtn);
    await waitFor(() =>
      expect(importSpy).toHaveBeenCalledWith({ version: 1, tables: {} }),
    );
  });

  it('toggles a month reviewed', async () => {
    const markSpy = vi
      .spyOn(api, 'markMonthReviewed')
      .mockResolvedValue({ month: '2026-08', reviewed: true, reviewedAt: 'now' });
    const unmarkSpy = vi.spyOn(api, 'unmarkMonthReviewed').mockResolvedValue({ ok: true });

    render(<BackupDadosPage />);

    fireEvent.click(await screen.findByLabelText('Revisado 2026-08'));
    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('2026-08'));

    fireEvent.click(screen.getByLabelText('Revisado 2026-07'));
    await waitFor(() => expect(unmarkSpy).toHaveBeenCalledWith('2026-07'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/BackupDadosPage.test.tsx`
Expected: FAIL — `Cannot find module './BackupDadosPage.js'`.

- [ ] **Step 3: Create `frontend/src/pages/BackupDadosPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';

const CONFIRM_PHRASE = 'APAGAR TUDO';
const cardGap = { marginBottom: 24 } as const;
const h2Style = { fontFamily: 'var(--mono)', fontSize: 15, marginBottom: 10 } as const;

export function BackupDadosPage() {
  const [diag, setDiag] = useState<api.Diagnostics | null>(null);
  const [months, setMonths] = useState<api.MonthCloseRow[]>([]);
  const [phrase, setPhrase] = useState('');
  const [importAck, setImportAck] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);

  async function load() {
    const [d, m] = await Promise.all([api.getDiagnostics(), api.listMonthlyClose()]);
    setDiag(d);
    setMonths(m);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : 'Erro ao carregar'),
    );
  }, []);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;

  async function run(fn: () => Promise<{ backupPath: string | null }>, done: string) {
    setError(null);
    setStatus(null);
    try {
      const { backupPath } = await fn();
      setStatus(`${done}${backupPath ? ` Backup em ${backupPath}.` : ''}`);
      setPhrase('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleImport() {
    setError(null);
    setStatus(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError('Arquivo não é um JSON válido');
      return;
    }
    try {
      const { backupPath, imported } = await api.importData(parsed);
      const total = Object.values(imported).reduce((s, n) => s + n, 0);
      setStatus(`Importado (${total} linhas).${backupPath ? ` Backup em ${backupPath}.` : ''}`);
      setImportAck(false);
      setHasFile(false);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na importação');
    }
  }

  async function toggleMonth(row: api.MonthCloseRow) {
    setError(null);
    try {
      if (row.reviewed) await api.unmarkMonthReviewed(row.month);
      else await api.markMonthReviewed(row.month);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Backup &amp; Dados</h1>

      {status && <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 12 }}>{status}</p>}
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Diagnóstico</h2>
        {diag && (
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            {Object.entries(diag.rowCounts).map(([t, n]) => (
              <div key={t}>Linhas — {t}: {n}</div>
            ))}
            <div>Tamanho do banco: {(diag.dbSizeBytes / 1024).toFixed(1)} KB</div>
            <div>Migrações: {diag.migrations.join(', ')}</div>
            <div>
              Último backup:{' '}
              {diag.lastBackup
                ? new Date(diag.lastBackup).toLocaleString('pt-BR')
                : '—'}{' '}
              ({diag.backupCount} arquivos)
            </div>
          </div>
        )}
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Exportar</h2>
        <a
          href={api.EXPORT_URL}
          download
          className="button-primary"
          style={{ display: 'inline-block', textDecoration: 'none' }}
        >
          Baixar snapshot (.json)
        </a>
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Importar</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>
          Substitui todos os dados atuais. Um backup do banco é feito antes.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Arquivo de importação"
          onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
          style={{ display: 'block', marginBottom: 8 }}
        />
        <label style={{ display: 'block', fontSize: 12.5, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={importAck}
            onChange={(e) => setImportAck(e.target.checked)}
          />{' '}
          Entendo que isto substitui todos os dados atuais
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={!hasFile || !importAck}
          onClick={handleImport}
        >
          Importar
        </button>
      </div>

      <div className="card" style={cardGap}>
        <h2 style={h2Style}>Zona de perigo</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>
          Digite <strong>{CONFIRM_PHRASE}</strong> para habilitar. Ambas as ações fazem um backup
          antes.
        </p>
        <input
          type="text"
          aria-label="Frase de confirmação"
          className="field-input"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          style={{ display: 'block', marginBottom: 10 }}
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            className="button-primary"
            disabled={!phraseOk}
            onClick={() => run(() => api.wipeData(phrase.trim()), 'Dados apagados.')}
          >
            Apagar todos os dados
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={!phraseOk}
            onClick={() =>
              run(() => api.seedTestData(phrase.trim()), 'Dados de teste carregados.')
            }
          >
            Carregar dados de teste
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={h2Style}>Fechamento mensal</h2>
        {months.length === 0 ? (
          <p style={{ color: 'var(--text3)' }}>Nenhum mês com dados ainda.</p>
        ) : (
          months.map((row) => (
            <div
              key={row.month}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <input
                type="checkbox"
                checked={row.reviewed}
                aria-label={`Revisado ${row.month}`}
                onChange={() => toggleMonth(row)}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{row.month}</span>
              {row.reviewed && row.reviewedAt && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  revisado em {new Date(row.reviewedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/BackupDadosPage.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route in `frontend/src/App.tsx`**

Add the import:

```ts
import { BackupDadosPage } from './pages/BackupDadosPage.js';
```

Replace:

```tsx
            <Route path="/backup" element={<PlaceholderPage title="Backup & Dados" />} />
```

with:

```tsx
            <Route path="/backup" element={<BackupDadosPage />} />
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/BackupDadosPage.tsx frontend/src/pages/BackupDadosPage.test.tsx frontend/src/App.tsx
git commit -m "Add BackupDadosPage and mount the /backup route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Build, e2e QA, smoke test, checklist

**Files:**
- Modify: `scripts/qa-e2e.sh`
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Full test sweep**

Run: `cd server && npm test` — expected all green.
Run: `cd frontend && npm test` — expected all green.

- [ ] **Step 2: Production build**

Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 3: Add a Backup & Dados section to `scripts/qa-e2e.sh`**

Insert this block after the "Histórico Dólar" section and before the
"Análise" section:

```bash
echo
echo "== Backup & Dados =="
aeq "diagnostics has a rowCounts object" "object" "$(body GET /api/data/diagnostics | jq -r '.rowCounts | type')"
as  "export -> 200" 200 "$(code GET /api/data/export)"
body POST /api/income '{"date":"2026-04-01","amountBrlCents":123456}' >/dev/null
SNAP="$(body GET /api/data/export)"
echo "$SNAP" > "$TMP/snap.json"
aeq "wipe (right phrase) -> deleted object" "object" "$(body POST /api/data/wipe '{"confirm":"APAGAR TUDO"}' | jq -r '.deleted | type')"
aeq "income empty after wipe" "0" "$(body GET /api/income | jq 'length')"
body POST /api/data/import "$(cat "$TMP/snap.json")" >/dev/null
aeq "income restored after import" "1" "$(body GET /api/income | jq 'length')"
as  "wipe (wrong phrase) -> 400" 400 "$(code POST /api/data/wipe '{"confirm":"nope"}')"
aeq "seed-test (right phrase) -> seeded true" "true" "$(body POST /api/data/seed-test '{"confirm":"APAGAR TUDO"}' | jq -r .seeded)"
aeq "income non-empty after seed" "true" "$(body GET /api/income | jq 'length > 0')"
DM="$(body GET /api/monthly-close | jq -r '.[0].month')"
aeq "mark month reviewed" "true" "$(body PUT "/api/monthly-close/$DM" | jq -r .reviewed)"
aeq "month shows reviewed in the list" "true" "$(body GET /api/monthly-close | jq -r --arg m "$DM" 'map(select(.month==$m))[0].reviewed')"
as  "unmark month -> 200" 200 "$(code DELETE "/api/monthly-close/$DM")"
as  "mark bad month -> 400" 400 "$(code PUT /api/monthly-close/2026-6)"
```

- [ ] **Step 4: Run the e2e QA**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (83 prior + 13 new = 96).

- [ ] **Step 5: Restart the launchd server and smoke-test**

```bash
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'diagnostics (unauth): %{http_code}\n' http://localhost:4173/api/data/diagnostics
curl -s -o /dev/null -w 'backup page: %{http_code}\n' http://localhost:4173/backup
```

Expected: `health: 200`, `diagnostics (unauth): 401`, `backup page: 200`.

- [ ] **Step 6: Manual browser check**

Hard-refresh, open **Backup & Dados**. The Diagnóstico card shows row
counts for your real data, DB size, `001_initial_schema,
002_dollar_quotes`, and the last-backup line. Click **Baixar snapshot** —
a `fumarende-<date>.json` downloads. In **Fechamento mensal**, tick a
month — it shows "revisado em <date>"; untick it. **Do not** run the
danger-zone actions on real data unless you mean to (they back up
first, but they replace everything). To try them safely: export first,
then "Carregar dados de teste" with the phrase, look around, then
Importar your export back.

- [ ] **Step 7: Append to `docs/qa-checklist.md`**

```markdown

## Backup & Dados

- [x] `GET /api/data/export` returns a JSON snapshot with an
      `attachment` content-disposition; `GET /api/data/diagnostics`
      returns row counts + migrations (e2e).
- [x] Export → wipe (`confirm: APAGAR TUDO`) → import round-trips the
      data back; a wrong phrase → 400 (e2e; the import/export/wipe
      modules also have unit round-trip tests).
- [x] `seed-test` behind the same phrase replaces all data with the
      fixture and is deterministic across runs (e2e + unit).
- [x] `PUT`/`GET`/`DELETE /api/monthly-close/:month` mark, list, and
      clear a month's reviewed flag; a bad month → 400 (e2e).
- [x] Migration list, DB size, and backup count surface in diagnostics
      (unit; verified against a real temp dir).
- [ ] The page's Diagnóstico card, download button, import file flow,
      danger-zone phrase gate, and monthly-close checkboxes work in the
      browser (component-tested; a full manual pass is optional).
```

- [ ] **Step 8: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md
git commit -m "Add Backup & Dados e2e QA section and checklist items"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `DATA_TABLES` single source of truth + drift guard | 1 |
| `wipeData` (transaction, pre-delete counts, leaves auth/schema) | 2 |
| `exportData` (all tables, soft-deleted included, `version`/`exportedAt`) | 3 |
| `importData` (shape validation, transactional full-replace, missing-key tolerance) | 4 |
| `seedTestData` (wipe first, three-month deterministic fixture, a complete goal) | 5 |
| `diagnostics` (row counts ignoring soft-deleted, migrations, fs fields guarded) | 6 |
| Routes: export attachment header, import cheap-check-before-backup, phrase gate, monthly-close union query | 7 |
| `buildApp` `dataPaths` arg; `index.ts` passes config paths | 7 (Step 4) |
| Register data routes after dollar-quote routes | 7 (Step 4) |
| API client (7 functions + `EXPORT_URL` + 2 types) | 8 |
| `BackupDadosPage` — 5 sections; phrase gate; import checkbox+file gate; monthly-close toggle | 9 |
| Mount at `/backup` | 9 (Step 5) |
| e2e QA section | 10 (Step 3) |
| Testing at every layer | 1–9 |
| Out of scope: off-site backup, encryption, selective export, close-locks-editing | not implemented — correct |

**Placeholder scan:** none — every step has literal code or a literal command.

**Type consistency:** `Diagnostics` / `MonthCloseRow` fields match
between Task 6/7 (server) and Task 8 (`api.ts`) and Task 9's `diag`
fixture. `DataExport` `{ version, exportedAt, tables }` is identical in
Task 3 and consumed unchanged by Task 4's `importData` and Task 7's
route. `importData` returns `{ imported: Record<string, number> }` in
Task 4 and the route wraps it as `{ backupPath, imported }` in Task 7,
matching Task 8's `importData` client return type and Task 9's
`Object.values(imported).reduce(...)`. `wipeData` → `{ deleted:
Record<string, number> }` (Task 2) → route `{ backupPath, deleted }`
(Task 7) → client (Task 8). The confirmation phrase constant
`'APAGAR TUDO'` is identical in Task 7's `CONFIRM_PHRASE`, Task 9's
`CONFIRM_PHRASE`, and every test. `buildApp`'s third param
`dataPaths?: { dbPath; backupDir }` matches between Task 7's signature,
`index.ts`, and `registerDataRoutes`. Route paths (`/api/data/export`,
`/api/data/import`, `/api/data/wipe`, `/api/data/seed-test`,
`/api/data/diagnostics`, `/api/monthly-close`, `/api/monthly-close/:month`)
match between Task 7 and Task 8. Test label / aria-label strings
(`'Frase de confirmação'`, `'Arquivo de importação'`,
`'Apagar todos os dados'`, `'Carregar dados de teste'`, `'Importar'`,
`/substitui todos os dados/`, `'Revisado <month>'`) match between
Task 9's component and its test.
