# fumarende Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the persistent local server end-to-end — Fastify backend,
SQLite database with migrations, password auth with server-side sessions,
launchd process persistence, and a React frontend shell in the Pulse visual
style — proven working with one fully wired vertical-slice module
(Receitas/income).

**Architecture:** Two npm workspaces, `server/` (Fastify + better-sqlite3,
ESM/TypeScript) and `frontend/` (React + Vite + TypeScript). In production,
the server serves the frontend's built static files itself — one process,
one port. In development, Vite's dev server proxies `/api/*` to the
running Fastify server. Auth is a single shared password (scrypt hash
stored in the DB) gating opaque server-side sessions (random token stored
in a `sessions` table, verified per-request, sent as a plain — not
Fastify-signed — cookie since the DB lookup is the actual trust boundary).

**Tech Stack:** Node.js (20+), TypeScript, Fastify 5, better-sqlite3,
@fastify/cookie, @fastify/static, React 18, React Router 6, Vite 6,
Vitest (+ `@testing-library/react` for frontend component tests).

## Global Constraints

- Money is always stored and passed as **integer cents** — never floats,
  never decimal strings.
- Deletes are soft deletes: set `deleted_at`, never `DELETE FROM`. Reads
  always filter `WHERE deleted_at IS NULL` unless explicitly listing
  deleted rows.
- No AI/Claude features anywhere in this plan — out of scope for Phase 1
  (see the design spec's Roadmap section).
- No PDF/CSV import in this plan — income/expense entry is manual only.
- The server binds `0.0.0.0` so it's reachable on the LAN; auth exists to
  stop casual access from other devices on the network, not to defend
  against a hostile actor already on it — plain HTTP is acceptable.
- Server-side session tokens are high-entropy random values (32 bytes /
  256 bits via `crypto.randomBytes`) validated against the `sessions`
  table on every request — the cookie itself carries no signed claims.
- Migration SQL lives as exported TS string constants, not loose `.sql`
  files, so there is no asset-copying step between `tsc` build output and
  runtime.
- This plan covers infrastructure plus one vertical-slice page (Receitas /
  income) only. Câmbio, Gastos, Parcelas, Reserva, Metas, Projetos
  Especiais, Análise/Projeção/Cenários, Histórico Dólar, and Backup & Dados
  are out of scope — separate follow-up plans per module group, once this
  foundation is verified working end-to-end.

**Before starting Task 1**, confirm the machine has Node.js 20+ (`node
--version`) and that `/Users/luccabraga/Documents/fumarende` is the repo
root with `git remote -v` showing `origin` → `github.com/luccabraga/
fumarende`.

---

## File Structure

```
server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    Entry point: builds app, listens on 0.0.0.0:PORT
    app.ts                      buildApp(): Fastify instance, plugin/route registration, static serving
    config.ts                   loadConfig(): PORT, DATA_DIR, DB_PATH, BACKUP_DIR, FRONTEND_DIST_DIR
    db/
      connection.ts             openDb(dbPath): Database, WAL pragma
      migrate.ts                runMigrations(db): applies pending migrations, tracks in schema_migrations
      migrations/
        001_initial_schema.ts   export const migration001: Migration (id + sql)
      backup.ts                 backupDatabase(dbPath, backupDir): timestamped copy, returns new path
      settings.ts               getSetting()/setSetting() against app_settings
      income.ts                 createIncome/listIncome/softDeleteIncome against a Database
    auth/
      password.ts               hashPassword()/verifyPassword() (scrypt)
      session.ts                createSession()/verifySession()/deleteSession()
      routes.ts                 registers /api/auth/status, /setup, /login, /logout
      require-auth.ts           requireAuth preHandler hook
    routes/
      health.ts                 GET /api/health
      income.ts                 GET/POST /api/income, DELETE /api/income/:id (all requireAuth)
frontend/
  package.json
  tsconfig.json
  vite.config.ts                dev proxy /api -> http://localhost:4173
  vitest.config.ts              jsdom environment
  index.html
  src/
    main.tsx
    App.tsx                     Router + AuthGate
    theme.css                   Pulse palette tokens + base layout styles
    lib/
      api.ts                    Typed fetch wrappers for auth + income endpoints
      money.ts                  formatCentsBRL(), formatCentsUSD(), parseCentsFromInput()
    context/
      AuthContext.tsx           auth state (passwordSet/authenticated), login()/setup()/logout()
    components/
      NavShell.tsx               Sidebar nav across all module routes (unbuilt ones link to PlaceholderPage)
      ProtectedRoute.tsx          Redirects to /login when not authenticated
    pages/
      LoginPage.tsx              Single form; behaves as setup or login depending on auth status
      DashboardPage.tsx          Placeholder
      ReceitasPage.tsx           Income list + add-entry form (the vertical slice)
      PlaceholderPage.tsx        Generic "coming soon" for not-yet-built modules
scripts/
  com.lucca.fumarende.plist.template
  install-launchd.sh            Renders the plist with absolute paths, installs + loads it
docs/
  qa-checklist.md                New file: foundation verification block
```

---

### Task 1: Backend scaffold and health endpoint

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` (async factory, no side effects
  beyond building the instance — does not call `.listen()`).

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "fumarende-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.2",
    "@fastify/static": "^8.1.0",
    "better-sqlite3": "^11.10.0",
    "fastify": "^5.3.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.13.10",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Install dependencies**

Run (from `server/`): `npm install`

- [ ] **Step 5: Write the failing test for `buildApp()`**

`server/src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('buildApp', () => {
  it('responds to GET /api/health with ok: true', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test` (from `server/`)
Expected: FAIL — `./app.js` has no exported member `buildApp` (file
doesn't exist yet).

- [ ] **Step 7: Create `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Create `server/src/index.ts`**

```ts
import { buildApp } from './app.js';

const port = Number(process.env.FUMARENDE_PORT ?? 4173);

const app = await buildApp();

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 10: Manually verify the server boots**

Run: `npm run dev` (from `server/`), then in another terminal:
`curl http://localhost:4173/api/health`
Expected: `{"ok":true}`. Stop the dev server (Ctrl-C) before continuing.

- [ ] **Step 11: Commit**

```bash
cd /Users/luccabraga/Documents/fumarende
git add server/package.json server/package-lock.json server/tsconfig.json server/vitest.config.ts server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "Add Fastify backend scaffold with health endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Config module

**Files:**
- Create: `server/src/config.ts`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(): Config` where
  `Config = { port: number; dataDir: string; dbPath: string; backupDir: string; frontendDistDir: string }`.
  Later tasks (DB connection, backup, static serving) take these paths as
  constructor/function arguments — they never read `process.env` directly.

- [ ] **Step 1: Write the failing test**

`server/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('derives dbPath and backupDir from dataDir', () => {
    const config = loadConfig({ FUMARENDE_DATA_DIR: '/tmp/fumarende-test' });
    expect(config.dataDir).toBe('/tmp/fumarende-test');
    expect(config.dbPath).toBe(path.join('/tmp/fumarende-test', 'fumarende.db'));
    expect(config.backupDir).toBe(path.join('/tmp/fumarende-test', 'backups'));
  });

  it('defaults port to 4173 when FUMARENDE_PORT is unset', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4173);
  });

  it('reads FUMARENDE_PORT when set', () => {
    const config = loadConfig({ FUMARENDE_PORT: '5000' });
    expect(config.port).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./config.js` has no exported member `loadConfig`.

- [ ] **Step 3: Create `server/src/config.ts`**

```ts
import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  frontendDistDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir =
    env.FUMARENDE_DATA_DIR ??
    path.join(os.homedir(), 'Library', 'Application Support', 'fumarende');

  return {
    port: Number(env.FUMARENDE_PORT ?? 4173),
    dataDir,
    dbPath: path.join(dataDir, 'fumarende.db'),
    backupDir: path.join(dataDir, 'backups'),
    frontendDistDir:
      env.FUMARENDE_FRONTEND_DIST ??
      path.join(process.cwd(), '..', 'frontend', 'dist'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts
git commit -m "Add server config module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Database connection and migration runner

**Files:**
- Create: `server/src/db/connection.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/migrations/001_initial_schema.ts`
- Test: `server/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `openDb(dbPath: string): Database.Database`;
  `runMigrations(db: Database.Database): void`; the `Migration` type
  `{ id: string; sql: string }` that every future migration file exports.
  All later DB-layer tasks (`db/income.ts`, `auth/session.ts`, etc.) call
  `openDb()` once at startup and pass the same `Database.Database` around.

- [ ] **Step 1: Create the schema migration**

`server/src/db/migrations/001_initial_schema.ts`:

```ts
import type { Migration } from '../migrate.js';

export const migration001: Migration = {
  id: '001_initial_schema',
  sql: `
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE exchange_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_usd_cents INTEGER NOT NULL,
      ptax_rate REAL,
      contracted_rate REAL,
      iof_cents INTEGER NOT NULL DEFAULT 0,
      bank_fee_cents INTEGER NOT NULL DEFAULT 0,
      net_brl_cents INTEGER NOT NULL,
      institution TEXT,
      operation_type TEXT,
      source_pdf_ref TEXT,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_brl_cents INTEGER NOT NULL,
      amount_usd_cents INTEGER,
      description TEXT,
      source TEXT,
      exchange_contract_id INTEGER REFERENCES exchange_contracts(id),
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      installment_number INTEGER,
      installment_total INTEGER,
      installment_group_id TEXT,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE fixed_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE emergency_fund_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE savings_monthly_targets (
      month TEXT PRIMARY KEY,
      pct_or_fixed TEXT NOT NULL,
      pct_value INTEGER,
      fixed_value_cents INTEGER,
      target_cents INTEGER NOT NULL DEFAULT 0,
      rollover_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      current_cents INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );

    CREATE TABLE special_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      current_cents INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );

    CREATE TABLE category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE ptax_rate_cache (
      date TEXT PRIMARY KEY,
      rate REAL NOT NULL
    );

    CREATE TABLE monthly_close (
      month TEXT PRIMARY KEY,
      reviewed_at TEXT NOT NULL
    );
  `,
};
```

- [ ] **Step 2: Write the failing test for the migration runner**

`server/src/db/migrate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  it('creates every Phase 1 table and is idempotent', () => {
    const db = new Database(':memory:');

    runMigrations(db);
    runMigrations(db); // must not throw or duplicate on a second run

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const expected of [
      'app_settings',
      'sessions',
      'income',
      'exchange_contracts',
      'expenses',
      'fixed_expenses',
      'emergency_fund_entries',
      'savings_monthly_targets',
      'goals',
      'special_projects',
      'category_rules',
      'ptax_rate_cache',
      'monthly_close',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }

    const applied = db
      .prepare('SELECT id FROM schema_migrations')
      .all() as { id: string }[];
    expect(applied).toHaveLength(1);
    expect(applied[0].id).toBe('001_initial_schema');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./migrate.js` has no exported member `runMigrations`.

- [ ] **Step 4: Create `server/src/db/migrate.ts`**

```ts
import type Database from 'better-sqlite3';
import { migration001 } from './migrations/001_initial_schema.js';

export interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [migration001];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const alreadyApplied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map(
      (row) => row.id,
    ),
  );

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (alreadyApplied.has(migration.id)) continue;
    db.exec(migration.sql);
    insertMigration.run(migration.id, new Date().toISOString());
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Create `server/src/db/connection.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
```

- [ ] **Step 7: Commit**

```bash
git add server/src/db/
git commit -m "Add SQLite connection and migration runner with Phase 1 schema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Backup utility

**Files:**
- Create: `server/src/db/backup.ts`
- Test: `server/src/db/backup.test.ts`

**Interfaces:**
- Consumes: nothing new (plain `fs` operations on a DB file path).
- Produces: `backupDatabase(dbPath: string, backupDir: string): string`
  (returns the path of the newly created backup file). Later tasks (danger
  zone / destructive routes, added in a follow-up plan) call this before
  any destructive operation.

- [ ] **Step 1: Write the failing test**

`server/src/db/backup.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupDatabase } from './backup.js';

describe('backupDatabase', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-backup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the db file into backupDir with a timestamped name', () => {
    const dbPath = path.join(tmpDir, 'fumarende.db');
    fs.writeFileSync(dbPath, 'fake-db-contents');
    const backupDir = path.join(tmpDir, 'backups');

    const backupPath = backupDatabase(dbPath, backupDir);

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('fake-db-contents');
    expect(path.dirname(backupPath)).toBe(backupDir);
  });

  it('creates backupDir if it does not exist yet', () => {
    const dbPath = path.join(tmpDir, 'fumarende.db');
    fs.writeFileSync(dbPath, 'x');
    const backupDir = path.join(tmpDir, 'nested', 'backups');

    backupDatabase(dbPath, backupDir);

    expect(fs.existsSync(backupDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./backup.js` has no exported member `backupDatabase`.

- [ ] **Step 3: Create `server/src/db/backup.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';

export function backupDatabase(dbPath: string, backupDir: string): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `fumarende-${timestamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/backup.ts server/src/db/backup.test.ts
git commit -m "Add timestamped database backup utility

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Password hashing

**Files:**
- Create: `server/src/auth/password.ts`
- Test: `server/src/auth/password.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `hashPassword(password: string): string`;
  `verifyPassword(password: string, stored: string): boolean`. Task 7
  (auth routes) calls these against the value stored under the
  `app_settings` key `password_hash`.

- [ ] **Step 1: Write the failing test**

`server/src/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies a correct password against its hash', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./password.js` has no exported member `hashPassword`.

- [ ] **Step 3: Create `server/src/auth/password.ts`**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, KEY_LENGTH);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/password.ts server/src/auth/password.test.ts
git commit -m "Add scrypt password hashing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings and session storage

**Files:**
- Create: `server/src/db/settings.ts`
- Create: `server/src/auth/session.ts`
- Test: `server/src/db/settings.test.ts`
- Test: `server/src/auth/session.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 3), `hashPassword`/`verifyPassword` (Task 5).
- Produces: `getSetting(db, key): string | undefined`,
  `setSetting(db, key, value): void`; `createSession(db): { token: string;
  expiresAt: string }`, `verifySession(db, token): boolean`,
  `deleteSession(db, token): void`. Task 7 (auth routes) is the only
  consumer of all four.

- [ ] **Step 1: Write the failing test for settings**

`server/src/db/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { getSetting, setSetting } from './settings.js';

describe('settings', () => {
  it('returns undefined for an unset key', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(getSetting(db, 'password_hash')).toBeUndefined();
  });

  it('round-trips a value through setSetting/getSetting', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setSetting(db, 'password_hash', 'abc:def');
    expect(getSetting(db, 'password_hash')).toBe('abc:def');
  });

  it('overwrites an existing value', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setSetting(db, 'password_hash', 'first');
    setSetting(db, 'password_hash', 'second');
    expect(getSetting(db, 'password_hash')).toBe('second');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./settings.js` has no exported member `getSetting`.

- [ ] **Step 3: Create `server/src/db/settings.ts`**

```ts
import type Database from 'better-sqlite3';

export function getSetting(db: Database.Database, key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write the failing test for sessions**

`server/src/auth/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { createSession, deleteSession, verifySession } from './session.js';

describe('sessions', () => {
  it('a newly created session verifies as valid', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    expect(verifySession(db, token)).toBe(true);
  });

  it('an unknown token does not verify', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(verifySession(db, 'not-a-real-token')).toBe(false);
  });

  it('a deleted session no longer verifies', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    deleteSession(db, token);
    expect(verifySession(db, token)).toBe(false);
  });

  it('an expired session does not verify', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      token,
    );
    expect(verifySession(db, token)).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./session.js` has no exported member `createSession`.

- [ ] **Step 7: Create `server/src/auth/session.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000; // ~1 year

export function createSession(db: Database.Database): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();

  db.prepare(
    'INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)',
  ).run(token, now.toISOString(), expiresAt);

  return { token, expiresAt };
}

export function verifySession(db: Database.Database, token: string): boolean {
  const row = db
    .prepare('SELECT expires_at FROM sessions WHERE token = ?')
    .get(token) as { expires_at: string } | undefined;

  if (!row) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/src/db/settings.ts server/src/db/settings.test.ts server/src/auth/session.ts server/src/auth/session.test.ts
git commit -m "Add app settings and server-side session storage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Auth routes and requireAuth middleware

**Files:**
- Create: `server/src/auth/require-auth.ts`
- Create: `server/src/auth/routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/app.test.ts`
- Test: `server/src/auth/routes.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 3), `hashPassword`/`verifyPassword` (Task 5),
  `getSetting`/`setSetting` (Task 6), `createSession`/`verifySession`/
  `deleteSession` (Task 6).
- Produces: `registerAuthRoutes(app: FastifyInstance, db: Database.Database):
  void`; `requireAuth(db: Database.Database):` a Fastify `preHandler`
  function `(request, reply) => void`. `buildApp()` now takes a
  `Database.Database` parameter. Task 9 (income routes) uses
  `requireAuth(db)` as its `preHandler`.

- [ ] **Step 1: Write the failing test**

`server/src/auth/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

function freshDb() {
  return new Database(':memory:');
}

describe('auth routes', () => {
  it('status reports passwordSet: false before setup', async () => {
    const app = await buildApp(freshDb());
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.json()).toEqual({ passwordSet: false, authenticated: false });
    await app.close();
  });

  it('setup sets the password, creates a session, and rejects a second setup', async () => {
    const app = await buildApp(freshDb());

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'first-run-password' },
    });
    expect(setupRes.statusCode).toBe(200);
    expect(setupRes.cookies.some((c) => c.name === 'session')).toBe(true);

    const secondSetupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'anything' },
    });
    expect(secondSetupRes.statusCode).toBe(409);

    await app.close();
  });

  it('login succeeds with the right password and fails with the wrong one', async () => {
    const app = await buildApp(freshDb());
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'correct-password' },
    });

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);

    const goodLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'correct-password' },
    });
    expect(goodLogin.statusCode).toBe(200);
    expect(goodLogin.cookies.some((c) => c.name === 'session')).toBe(true);

    await app.close();
  });

  it('a protected route requires a valid session cookie', async () => {
    const app = await buildApp(freshDb());
    app.get(
      '/api/protected-test-route',
      { preHandler: (await import('./require-auth.js')).requireAuth(app.dbForTests) },
      async () => ({ secret: true }),
    );

    const noCookie = await app.inject({ method: 'GET', url: '/api/protected-test-route' });
    expect(noCookie.statusCode).toBe(401);

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'correct-password' },
    });
    const sessionCookie = setupRes.cookies.find((c) => c.name === 'session')!;

    const withCookie = await app.inject({
      method: 'GET',
      url: '/api/protected-test-route',
      cookies: { session: sessionCookie.value },
    });
    expect(withCookie.statusCode).toBe(200);

    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildApp` still takes no arguments and `./require-auth.js`
doesn't exist yet.

- [ ] **Step 3: Create `server/src/auth/require-auth.ts`**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { verifySession } from './session.js';

export function requireAuth(db: Database.Database) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies.session;
    if (!token || !verifySession(db, token)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
```

- [ ] **Step 4: Create `server/src/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../db/settings.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, deleteSession, verifySession } from './session.js';

const PASSWORD_KEY = 'password_hash';
const COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 365 * 24 * 60 * 60,
};

interface PasswordBody {
  password: string;
}

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/auth/status', async (request) => {
    const passwordSet = getSetting(db, PASSWORD_KEY) !== undefined;
    const token = request.cookies.session;
    const authenticated = Boolean(token && verifySession(db, token));
    return { passwordSet, authenticated };
  });

  app.post<{ Body: PasswordBody }>('/api/auth/setup', async (request, reply) => {
    if (getSetting(db, PASSWORD_KEY) !== undefined) {
      return reply.code(409).send({ error: 'password already set' });
    }

    setSetting(db, PASSWORD_KEY, hashPassword(request.body.password));
    const { token } = createSession(db);
    reply.setCookie('session', token, COOKIE_OPTIONS);
    return { ok: true };
  });

  app.post<{ Body: PasswordBody }>('/api/auth/login', async (request, reply) => {
    const stored = getSetting(db, PASSWORD_KEY);
    if (!stored) return reply.code(400).send({ error: 'password not set' });

    if (!verifyPassword(request.body.password, stored)) {
      return reply.code(401).send({ error: 'invalid password' });
    }

    const { token } = createSession(db);
    reply.setCookie('session', token, COOKIE_OPTIONS);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies.session;
    if (token) deleteSession(db, token);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
}
```

- [ ] **Step 5: Update `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type Database from 'better-sqlite3';
import { registerAuthRoutes } from './auth/routes.js';

export async function buildApp(db: Database.Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cookie);

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db);

  // Exposed only so the test suite can build a requireAuth() preHandler
  // against the same database instance without a second export.
  (app as unknown as { dbForTests: Database.Database }).dbForTests = db;

  return app;
}
```

- [ ] **Step 6: Update `server/src/index.ts`**

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp(db);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 7: Update `server/src/app.test.ts`** (Task 1's test now needs
      a db argument)

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from './app.js';

describe('buildApp', () => {
  it('responds to GET /api/health with ok: true', async () => {
    const app = await buildApp(new Database(':memory:'));
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 8: Run full test suite to verify everything passes**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 9: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts server/src/index.ts server/src/auth/require-auth.ts server/src/auth/routes.ts server/src/auth/routes.test.ts
git commit -m "Add auth routes (setup/login/logout/status) and requireAuth middleware

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Income data layer

**Files:**
- Create: `server/src/db/income.ts`
- Test: `server/src/db/income.test.ts`

**Interfaces:**
- Consumes: `runMigrations` (Task 3, via test setup only).
- Produces: `IncomeEntry`, `NewIncomeEntry` types;
  `createIncome(db, input: NewIncomeEntry): number` (returns new id);
  `listIncome(db): IncomeEntry[]` (excludes soft-deleted, newest date
  first); `softDeleteIncome(db, id): void`. Task 9 (income routes) is the
  consumer.

- [ ] **Step 1: Write the failing test**

`server/src/db/income.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { createIncome, listIncome, softDeleteIncome } from './income.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('income data layer', () => {
  it('creates an entry and lists it back', () => {
    const db = freshDb();
    const id = createIncome(db, { date: '2026-08-01', amountBrlCents: 500000 });
    const entries = listIncome(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      date: '2026-08-01',
      amountBrlCents: 500000,
      amountUsdCents: null,
    });
  });

  it('stores an optional linked amountUsdCents and description', () => {
    const db = freshDb();
    createIncome(db, {
      date: '2026-08-05',
      amountBrlCents: 750000,
      amountUsdCents: 150000,
      description: 'Salário agosto',
    });
    const [entry] = listIncome(db);
    expect(entry.amountUsdCents).toBe(150000);
    expect(entry.description).toBe('Salário agosto');
  });

  it('excludes soft-deleted entries from listIncome', () => {
    const db = freshDb();
    const id = createIncome(db, { date: '2026-08-01', amountBrlCents: 100 });
    softDeleteIncome(db, id);
    expect(listIncome(db)).toHaveLength(0);
  });

  it('orders entries by date descending', () => {
    const db = freshDb();
    createIncome(db, { date: '2026-08-01', amountBrlCents: 100 });
    createIncome(db, { date: '2026-08-15', amountBrlCents: 200 });
    const entries = listIncome(db);
    expect(entries.map((e) => e.date)).toEqual(['2026-08-15', '2026-08-01']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./income.js` has no exported member `createIncome`.

- [ ] **Step 3: Create `server/src/db/income.ts`**

```ts
import type Database from 'better-sqlite3';

export interface IncomeEntry {
  id: number;
  date: string;
  amountBrlCents: number;
  amountUsdCents: number | null;
  description: string | null;
  source: string | null;
  exchangeContractId: number | null;
  notes: string | null;
}

export interface NewIncomeEntry {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
  source?: string | null;
  exchangeContractId?: number | null;
  notes?: string | null;
}

interface IncomeRow {
  id: number;
  date: string;
  amount_brl_cents: number;
  amount_usd_cents: number | null;
  description: string | null;
  source: string | null;
  exchange_contract_id: number | null;
  notes: string | null;
}

function toEntry(row: IncomeRow): IncomeEntry {
  return {
    id: row.id,
    date: row.date,
    amountBrlCents: row.amount_brl_cents,
    amountUsdCents: row.amount_usd_cents,
    description: row.description,
    source: row.source,
    exchangeContractId: row.exchange_contract_id,
    notes: row.notes,
  };
}

export function createIncome(db: Database.Database, input: NewIncomeEntry): number {
  const result = db
    .prepare(
      `INSERT INTO income
         (date, amount_brl_cents, amount_usd_cents, description, source, exchange_contract_id, notes)
       VALUES (@date, @amountBrlCents, @amountUsdCents, @description, @source, @exchangeContractId, @notes)`,
    )
    .run({
      date: input.date,
      amountBrlCents: input.amountBrlCents,
      amountUsdCents: input.amountUsdCents ?? null,
      description: input.description ?? null,
      source: input.source ?? null,
      exchangeContractId: input.exchangeContractId ?? null,
      notes: input.notes ?? null,
    });
  return Number(result.lastInsertRowid);
}

export function listIncome(db: Database.Database): IncomeEntry[] {
  const rows = db
    .prepare(
      `SELECT id, date, amount_brl_cents, amount_usd_cents, description, source, exchange_contract_id, notes
       FROM income
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as IncomeRow[];
  return rows.map(toEntry);
}

export function softDeleteIncome(db: Database.Database, id: number): void {
  db.prepare('UPDATE income SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/income.ts server/src/db/income.test.ts
git commit -m "Add income data layer (create/list/soft-delete)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Income API routes

**Files:**
- Create: `server/src/routes/income.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/routes/income.test.ts`

**Interfaces:**
- Consumes: `createIncome`/`listIncome`/`softDeleteIncome` (Task 8),
  `requireAuth` (Task 7).
- Produces: `registerIncomeRoutes(app, db): void`, mounted at `GET/POST
  /api/income` and `DELETE /api/income/:id`, all behind `requireAuth(db)`.
  The frontend's `lib/api.ts` (Task 10) is the consumer.

- [ ] **Step 1: Write the failing test**

`server/src/routes/income.test.ts`:

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

describe('income routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/income' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists income entries when authenticated', async () => {
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 300000 },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0]).toMatchObject({ date: '2026-08-10', amountBrlCents: 300000 });

    await app.close();
  });

  it('rejects a non-positive amountBrlCents', async () => {
    const { app, sessionCookie } = await authedApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 0 },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('soft-deletes an entry so it no longer appears in the list', async () => {
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 100 },
    });
    const { id } = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/income/${id}`,
      cookies: { session: sessionCookie },
    });
    expect(deleteRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);

    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/income` returns 404 (route not registered).

- [ ] **Step 3: Create `server/src/routes/income.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { createIncome, listIncome, softDeleteIncome, type NewIncomeEntry } from '../db/income.js';

interface CreateIncomeBody {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
  source?: string | null;
  exchangeContractId?: number | null;
  notes?: string | null;
}

export function registerIncomeRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/income', { preHandler: requireAuth(db) }, async () => listIncome(db));

  app.post<{ Body: CreateIncomeBody }>(
    '/api/income',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const body = request.body;
      if (!Number.isInteger(body.amountBrlCents) || body.amountBrlCents <= 0) {
        return reply.code(400).send({ error: 'amountBrlCents must be a positive integer' });
      }
      if (!body.date) {
        return reply.code(400).send({ error: 'date is required' });
      }

      const id = createIncome(db, body as NewIncomeEntry);
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/income/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      softDeleteIncome(db, Number(request.params.id));
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Update `server/src/app.ts`** — add the import and
      registration call:

```ts
import { registerIncomeRoutes } from './routes/income.js';
```

Add `registerIncomeRoutes(app, db);` on the line directly after
`registerAuthRoutes(app, db);`.

- [ ] **Step 5: Run full test suite to verify everything passes**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/income.ts server/src/routes/income.test.ts server/src/app.ts
git commit -m "Add income API routes behind requireAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend scaffold, Pulse theme, and auth flow

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/theme.css`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/context/AuthContext.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/App.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: the `/api/auth/*` endpoints from Task 7.
- Produces: `AuthProvider`/`useAuth()` returning
  `{ passwordSet: boolean | null; authenticated: boolean; setup(password:
  string): Promise<void>; login(password: string): Promise<void>;
  logout(): Promise<void> }`. Task 11 (`NavShell`, `ProtectedRoute`,
  module pages) consumes `useAuth()`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "fumarende-frontend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.14",
    "@types/react-dom": "^18.3.2",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.8.2",
    "vite": "^6.0.5",
    "vitest": "^3.0.9"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4173',
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 4: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setup-tests.ts'],
  },
});
```

- [ ] **Step 5: Create `frontend/src/setup-tests.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>fumarende</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Install dependencies**

Run (from `frontend/`): `npm install`

- [ ] **Step 8: Create `frontend/src/theme.css`**

```css
:root {
  --bg: #08080b;
  --bg2: #0d0d12;
  --card: #101016;
  --border: rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #eef0f5;
  --text2: #8890a0;
  --text3: #565d6e;

  --cyan: #00e0c6;
  --violet: #8b6bff;
  --coral: #ff5470;
  --amber: #ffb020;

  --mono: 'JetBrains Mono', monospace;
  --sans: 'Space Grotesk', -apple-system, sans-serif;
  --radius: 10px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  min-height: 100vh;
}

input,
button {
  font-family: inherit;
  font-size: 14px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 20px;
}

.button-primary {
  background: var(--cyan);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-weight: 600;
  cursor: pointer;
}

.field-input {
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--text);
}

.error-text {
  color: var(--coral);
  font-family: var(--mono);
  font-size: 12.5px;
}
```

- [ ] **Step 9: Create `frontend/src/lib/api.ts`**

```ts
export interface AuthStatus {
  passwordSet: boolean;
  authenticated: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return request('/api/auth/status');
}

export function setupPassword(password: string): Promise<{ ok: true }> {
  return request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
}

export function login(password: string): Promise<{ ok: true }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export interface IncomeEntry {
  id: number;
  date: string;
  amountBrlCents: number;
  amountUsdCents: number | null;
  description: string | null;
  source: string | null;
  exchangeContractId: number | null;
  notes: string | null;
}

export function listIncome(): Promise<IncomeEntry[]> {
  return request('/api/income');
}

export function createIncome(input: {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
}): Promise<{ id: number }> {
  return request('/api/income', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteIncome(id: number): Promise<{ ok: true }> {
  return request(`/api/income/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 10: Create `frontend/src/context/AuthContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from '../lib/api.js';

interface AuthContextValue {
  passwordSet: boolean | null;
  authenticated: boolean;
  setup: (password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  const refreshStatus = useCallback(async () => {
    const status = await api.fetchAuthStatus();
    setPasswordSet(status.passwordSet);
    setAuthenticated(status.authenticated);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const setup = useCallback(
    async (password: string) => {
      await api.setupPassword(password);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const login = useCallback(
    async (password: string) => {
      await api.login(password);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const logout = useCallback(async () => {
    await api.logout();
    await refreshStatus();
  }, [refreshStatus]);

  return (
    <AuthContext.Provider value={{ passwordSet, authenticated, setup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

- [ ] **Step 11: Write the failing test for `LoginPage`**

`frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext.js';
import { LoginPage } from './LoginPage.js';
import * as api from '../lib/api.js';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({ passwordSet: true, authenticated: false });
  });

  it('shows an error message when login fails', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('invalid password'));

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Senha'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('invalid password')).toBeInTheDocument();
  });

  it('calls login with the entered password on submit', async () => {
    const loginSpy = vi.spyOn(api, 'login').mockResolvedValue({ ok: true });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Senha'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(loginSpy).toHaveBeenCalledWith('my-password'));
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npm test` (from `frontend/`)
Expected: FAIL — `./LoginPage.js` doesn't exist yet.

- [ ] **Step 13: Create `frontend/src/pages/LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext.js';

export function LoginPage() {
  const { passwordSet, setup, login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSetupMode = passwordSet === false;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isSetupMode) {
        await setup(password);
      } else {
        await login(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 18, marginBottom: 16 }}>
        {isSetupMode ? 'Criar senha' : 'fumarende'}
      </h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="password" style={{ display: 'block', fontSize: 12.5, marginBottom: 6 }}>
          Senha
        </label>
        <input
          id="password"
          type="password"
          className="field-input"
          style={{ width: '100%', marginBottom: 12 }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="button-primary" style={{ width: '100%' }}>
          {isSetupMode ? 'Criar' : 'Entrar'}
        </button>
        {error && (
          <p className="error-text" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 15: Create `frontend/src/App.tsx`** (minimal — Task 11 adds
      routing, NavShell, and the other pages)

```tsx
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';

function Gate() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return null; // status still loading
  if (!authenticated) return <LoginPage />;
  return <p style={{ padding: 24 }}>Logged in — app shell arrives in Task 11.</p>;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
```

- [ ] **Step 16: Create `frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 17: Commit**

```bash
git add frontend/
git commit -m "Add frontend scaffold, Pulse theme, and password auth flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: App shell (nav + routing) and the Receitas vertical slice

**Files:**
- Create: `frontend/src/components/NavShell.tsx`
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Create: `frontend/src/pages/DashboardPage.tsx`
- Create: `frontend/src/pages/PlaceholderPage.tsx`
- Create: `frontend/src/pages/ReceitasPage.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/lib/money.ts`
- Test: `frontend/src/pages/ReceitasPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 10), `listIncome`/`createIncome` from
  `lib/api.ts` (Task 10).
- Produces: nothing consumed by later tasks in this plan — this is the
  final task. Follow-up plans (Câmbio, Gastos, etc.) will add their own
  routes/pages next to `ReceitasPage` and register nav entries in
  `NavShell`.

- [ ] **Step 1: Create `frontend/src/lib/money.ts`**

```ts
export function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatCentsUSD(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function parseCentsFromInput(value: string): number {
  const normalized = value.replace(',', '.');
  const amount = Number.parseFloat(normalized);
  if (Number.isNaN(amount)) return NaN;
  return Math.round(amount * 100);
}
```

- [ ] **Step 2: Create `frontend/src/components/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

export function ProtectedRoute() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return null;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 3: Create `frontend/src/pages/PlaceholderPage.tsx`**

```tsx
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="card">
      <p style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{title} — em breve</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/pages/DashboardPage.tsx`**

```tsx
export function DashboardPage() {
  return (
    <div className="card">
      <p style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
        Dashboard — em breve
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/NavShell.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/receitas', label: 'Receitas' },
  { to: '/cambio', label: 'Câmbio' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/parcelas', label: 'Parcelas' },
  { to: '/reserva', label: 'Reserva' },
  { to: '/metas', label: 'Metas' },
  { to: '/projetos', label: 'Projetos Especiais' },
  { to: '/analise', label: 'Análise' },
  { to: '/historico-dolar', label: 'Histórico Dólar' },
  { to: '/backup', label: 'Backup & Dados' },
];

export function NavShell() {
  const { logout } = useAuth();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 224,
          borderRight: '1px solid var(--border)',
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 22px 22px', fontFamily: 'var(--mono)', fontSize: 19 }}>
          fumarende
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              padding: '9px 22px',
              fontSize: 13,
              color: isActive ? 'var(--text)' : 'var(--text2)',
              borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
              textDecoration: 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => logout()}
          style={{
            marginTop: 'auto',
            marginLeft: 22,
            background: 'none',
            border: 'none',
            color: 'var(--text3)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Sair
        </button>
      </nav>
      <main style={{ flex: 1, padding: '32px 40px' }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Write the failing test for `ReceitasPage`**

`frontend/src/pages/ReceitasPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceitasPage } from './ReceitasPage.js';
import * as api from '../lib/api.js';

describe('ReceitasPage', () => {
  it('lists existing income entries on load', async () => {
    vi.spyOn(api, 'listIncome').mockResolvedValue([
      {
        id: 1,
        date: '2026-08-01',
        amountBrlCents: 500000,
        amountUsdCents: null,
        description: 'Salário',
        source: null,
        exchangeContractId: null,
        notes: null,
      },
    ]);

    render(<ReceitasPage />);

    expect(await screen.findByText('Salário')).toBeInTheDocument();
    expect(screen.getByText('R$ 5.000,00')).toBeInTheDocument();
  });

  it('submits a new entry and refreshes the list', async () => {
    const listSpy = vi
      .spyOn(api, 'listIncome')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 2,
          date: '2026-08-12',
          amountBrlCents: 100000,
          amountUsdCents: null,
          description: 'Novo lançamento',
          source: null,
          exchangeContractId: null,
          notes: null,
        },
      ]);
    const createSpy = vi.spyOn(api, 'createIncome').mockResolvedValue({ id: 2 });

    render(<ReceitasPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Descrição'), {
      target: { value: 'Novo lançamento' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-12',
        amountBrlCents: 100000,
        description: 'Novo lançamento',
      }),
    );
    expect(await screen.findByText('Novo lançamento')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./ReceitasPage.js` doesn't exist yet.

- [ ] **Step 8: Create `frontend/src/pages/ReceitasPage.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, parseCentsFromInput } from '../lib/money.js';

export function ReceitasPage() {
  const [entries, setEntries] = useState<api.IncomeEntry[]>([]);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setEntries(await api.listIncome());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const amountBrlCents = parseCentsFromInput(amount);
    if (Number.isNaN(amountBrlCents) || amountBrlCents <= 0) {
      setError('Valor inválido');
      return;
    }

    try {
      await api.createIncome({ date, amountBrlCents, description: description || null });
      setDate('');
      setAmount('');
      setDescription('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Receitas</h1>

      <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="date" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Data
          </label>
          <input
            id="date"
            type="date"
            className="field-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="amount" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Valor (R$)
          </label>
          <input
            id="amount"
            type="text"
            className="field-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="description" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Descrição
          </label>
          <input
            id="description"
            type="text"
            className="field-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button type="submit" className="button-primary">
          Adicionar
        </button>
      </form>

      {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card">
        {entries.length === 0 && <p style={{ color: 'var(--text3)' }}>Nenhum lançamento ainda.</p>}
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span>{entry.description ?? '—'}</span>
            <span style={{ color: 'var(--text2)' }}>{entry.date}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{formatCentsBRL(entry.amountBrlCents)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Update `frontend/src/App.tsx`** to wire routing:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ReceitasPage } from './pages/ReceitasPage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { NavShell } from './components/NavShell.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';

function Router() {
  const { passwordSet } = useAuth();
  if (passwordSet === null) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<NavShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/receitas" element={<ReceitasPage />} />
            <Route path="/cambio" element={<PlaceholderPage title="Câmbio" />} />
            <Route path="/gastos" element={<PlaceholderPage title="Gastos" />} />
            <Route path="/parcelas" element={<PlaceholderPage title="Parcelas" />} />
            <Route path="/reserva" element={<PlaceholderPage title="Reserva" />} />
            <Route path="/metas" element={<PlaceholderPage title="Metas" />} />
            <Route path="/projetos" element={<PlaceholderPage title="Projetos Especiais" />} />
            <Route path="/analise" element={<PlaceholderPage title="Análise" />} />
            <Route path="/historico-dolar" element={<PlaceholderPage title="Histórico Dólar" />} />
            <Route path="/backup" element={<PlaceholderPage title="Backup & Dados" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
```

- [ ] **Step 11: Run full frontend test suite**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 12: Commit**

```bash
git add frontend/
git commit -m "Add nav shell, routing, and Receitas vertical slice

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Production static serving

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `Config.frontendDistDir` (Task 2).
- Produces: `buildApp(db, frontendDistDir?: string)` — when
  `frontendDistDir` is provided and exists, serves the built frontend at
  `/` with an SPA fallback (any unmatched non-`/api` GET returns
  `index.html`) so client-side routes like `/receitas` work on a hard
  reload.

- [ ] **Step 1: Write the failing test**

Add to `server/src/app.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('static frontend serving', () => {
  it('serves index.html at / and falls back to it for unknown client routes', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>fumarende</html>');

    const app = await buildApp(new Database(':memory:'), distDir);

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);
    expect(rootRes.body).toContain('fumarende');

    const fallbackRes = await app.inject({ method: 'GET', url: '/receitas' });
    expect(fallbackRes.statusCode).toBe(200);
    expect(fallbackRes.body).toContain('fumarende');

    await app.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });
});
```

Add `import Database from 'better-sqlite3';` to the top of the file if not
already present from Task 7's edit.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GET /` returns 404 (no static plugin registered yet).

- [ ] **Step 3: Update `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { registerAuthRoutes } from './auth/routes.js';
import { registerIncomeRoutes } from './routes/income.js';

export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cookie);

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db);
  registerIncomeRoutes(app, db);

  if (frontendDistDir && fs.existsSync(path.join(frontendDistDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: frontendDistDir });

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  (app as unknown as { dbForTests: Database.Database }).dbForTests = db;

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 5: Update `server/src/index.ts`** to pass the config's dist
      dir through:

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp(db, config.frontendDistDir);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 6: Manually verify the full production path**

Run, from the repo root:
```bash
cd frontend && npm run build && cd ../server && npm run build
FUMARENDE_DATA_DIR=/tmp/fumarende-manual-check node dist/index.js
```
In another terminal: `curl -s http://localhost:4173/ | grep -o '<title>[^<]*'`
Expected: `<title>fumarende`. Stop the server (Ctrl-C) and remove the temp
data dir (`rm -rf /tmp/fumarende-manual-check`) before continuing.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts server/src/index.ts server/package.json server/package-lock.json
git commit -m "Serve built frontend from the Fastify server with SPA fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: launchd persistence

**Files:**
- Create: `scripts/com.lucca.fumarende.plist.template`
- Create: `scripts/install-launchd.sh`
- Create: `docs/qa-checklist.md`

**Interfaces:**
- Consumes: nothing (shell-level infra, not imported by any TS code).
- Produces: a running, boot-persistent server on port 4173. Nothing later
  in this plan depends on this task programmatically — it's the last task.

- [ ] **Step 1: Create `scripts/com.lucca.fumarende.plist.template`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lucca.fumarende</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_PATH__</string>
    <string>__REPO_ROOT__/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__REPO_ROOT__/server</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>__REPO_ROOT__/server/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>__REPO_ROOT__/server/launchd.err.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Create `scripts/install-launchd.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node)"
PLIST_DEST="$HOME/Library/LaunchAgents/com.lucca.fumarende.plist"

if [[ -z "$NODE_PATH" ]]; then
  echo "node not found on PATH" >&2
  exit 1
fi

sed \
  -e "s#__NODE_PATH__#${NODE_PATH}#g" \
  -e "s#__REPO_ROOT__#${REPO_ROOT}#g" \
  "${REPO_ROOT}/scripts/com.lucca.fumarende.plist.template" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Installed and loaded $PLIST_DEST"
echo "Check status with: launchctl list | grep com.lucca.fumarende"
```

- [ ] **Step 3: Make the script executable**

Run: `chmod +x scripts/install-launchd.sh`

- [ ] **Step 4: Build both projects for production**

Run (from repo root):
```bash
cd frontend && npm run build && cd ../server && npm run build
```

- [ ] **Step 5: Run the install script and verify it's alive**

Run: `./scripts/install-launchd.sh`
Then: `launchctl list | grep com.lucca.fumarende`
Expected: a line showing the label with a PID (not `-`).
Then: `curl http://localhost:4173/api/health`
Expected: `{"ok":true}`

- [ ] **Step 6: Verify restart-on-crash behavior**

Run: `launchctl list | grep com.lucca.fumarende` and note the PID, then
`kill -9 <PID>`. Wait a few seconds, run the `launchctl list` command
again — a new PID should appear (KeepAlive restarted it), and
`curl http://localhost:4173/api/health` should succeed again.

- [ ] **Step 7: Create `docs/qa-checklist.md`**

```markdown
# fumarende — QA checklist

## Foundation

- [ ] `curl http://localhost:4173/api/health` returns `{"ok":true}` after
      `./scripts/install-launchd.sh`.
- [ ] From another device on the same Wi-Fi, `http://<mac-hostname>.local:4173`
      loads the login/setup screen in a browser.
- [ ] First visit shows the password **setup** form, not login.
- [ ] After setup, reloading the page stays logged in (session cookie
      persists).
- [ ] Logging out and reloading shows the login form (not setup).
- [ ] Entering the wrong password shows an error and does not log in.
- [ ] Adding a Receitas entry appears in the list immediately without a
      manual refresh.
- [ ] Killing the server process (`kill -9 <PID>` from
      `launchctl list | grep com.lucca.fumarende`) results in it being
      relaunched automatically within a few seconds (`KeepAlive`).
- [ ] Rebooting the machine brings the server back up without any manual
      step (`RunAtLoad`).
```

- [ ] **Step 8: Commit**

```bash
git add scripts/ docs/qa-checklist.md
git commit -m "Add launchd persistence scripts and foundation QA checklist

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```

---

## Follow-up plans (not in this plan)

Each is its own brainstorm-lite → plan → implement cycle once this
foundation is merged and verified via the QA checklist above:

1. Câmbio + Receitas corrections (exchange contracts CRUD, spread/IOF
   math, PTAX rate reference).
2. Gastos + Parcelas (expense CRUD, installment grouping UI, fixed
   expenses + one-click apply-to-month).
3. Reserva (emergency fund deposits/withdrawals, monthly savings target,
   deficit rollover, essential-expense average).
4. Metas + Projetos Especiais.
5. Análise / Projeção / Cenários + Histórico Dólar.
6. Backup & Dados (manual export/import, diagnostics, danger zone using
   the Task 4 backup utility, test-data mode) + soft monthly close UI.
