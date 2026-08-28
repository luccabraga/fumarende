# fumarende — Backup & Dados module design

> Follow-up #6 to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle.

## Context

Feature modules shipped: Receitas, Câmbio, Gastos + Parcelas + Gastos
Fixos, Reserva, Metas + Projetos Especiais, Análise, Histórico Dólar.
This spec covers the **Backup & Dados** page (`/backup` in the nav):
diagnostics, a JSON export/import of the whole dataset, a danger-zone
wipe, an optional test-data seed, and the soft monthly-close review.

The Foundation plan (Task 4) already built
`server/src/db/backup.ts` — `backupDatabase(dbPath, backupDir)` copies
the SQLite file to a timestamped name. This module calls it before every
destructive operation, per the Phase 1 design's integrity rule
("Automatic timestamped backup of the SQLite file before any destructive
operation").

The `monthly_close` table (`month TEXT PRIMARY KEY, reviewed_at TEXT NOT
NULL`) already exists in the Foundation schema. Reviewing a month is
**purely informational — it never locks or blocks editing** (Phase 1
design).

## Goals

- **Diagnóstico**: read-only stats — row count per data table, DB file
  size, applied migration ids, last-backup time and count.
- **Exportar**: download the entire dataset as one JSON file
  (`{ version, exportedAt, tables }`), auth/session tables excluded.
- **Importar**: upload a previously-exported JSON; it **replaces all
  data** after an automatic DB-file backup, in one transaction.
- **Zona de perigo**: a typed-phrase gate (`APAGAR TUDO`) enabling two
  actions, each of which backs up first — wipe all data, or wipe + seed
  a small test fixture.
- **Fechamento mensal**: a checkbox per month (the union of months that
  have data and months already marked) toggling a `monthly_close` row.

## Non-goals (this pass)

- **No off-site / synced backups**, **no encryption-at-rest** — Phase 1
  rule; backups stay local.
- **No per-table selective export/import** — it is all-or-nothing.
- **No additive/merge import** — import is full-replace.
- **Monthly close never locks editing** — it is a review marker only.
- No month selector in the shell.

## Architecture

Follows the established pattern: pure-ish `data/` modules → Fastify
routes behind `requireAuth` → register in `app.ts`; frontend api client
→ page → route in `App.tsx`. The export/import/wipe/seed/diagnostics
logic lives in small server modules so each is unit-tested in isolation.

`buildApp` gains an optional third argument so the routes can reach the
DB path and backup dir:

```ts
export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
  dataPaths?: { dbPath: string; backupDir: string },
): Promise<FastifyInstance>;
```

`server/src/index.ts` passes `{ dbPath: config.dbPath, backupDir:
config.backupDir }`. When `dataPaths` is absent (every existing test
calls `buildApp(db)` or `buildApp(db, distDir)`), the backup step is
**skipped** and `backupPath` in the responses is `null`; diagnostics'
`dbSizeBytes` is `0` and `lastBackup` is `null`.

### Server

**`server/src/data/tables.ts`**

```ts
/** Every table that holds user data. Auth/session/schema tables are
 *  deliberately excluded from export / import / wipe / diagnostics. */
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

A test asserts `DATA_TABLES` equals the set of tables in a freshly
migrated DB minus `app_settings`, `sessions`, `schema_migrations` — so
adding a new table without updating this list fails CI.

**`server/src/data/export.ts`**

```ts
interface DataExport {
  version: 1;
  exportedAt: string;   // ISO
  tables: Record<string, unknown[]>;
}
function exportData(db: Database.Database): DataExport;
```

For each `DATA_TABLES` entry: `SELECT * FROM <table>` (soft-deleted rows
**included** — a backup is complete). `exportedAt = new Date().toISOString()`.

**`server/src/data/import.ts`**

```ts
interface ImportResult { imported: Record<string, number> }
function importData(db: Database.Database, payload: unknown): ImportResult;
```

- Throws unless `payload` is an object with `version === 1` and a
  `tables` object whose every key is in `DATA_TABLES` and every value is
  an array. A `DATA_TABLES` entry **missing** from `tables` is treated
  as an empty array (tolerant).
- In one `db.transaction`: for each `DATA_TABLES` entry `DELETE FROM
  <table>`, then for each row in `payload.tables[table]` build
  `INSERT INTO <table> (<row keys>) VALUES (<?…>)` from that row's own
  keys and run it. (A row with a key that is not a column of the table
  throws — acceptable for a same-version restore.)
- Returns `{ imported: { <table>: <row count inserted> } }`.

**`server/src/data/wipe.ts`**

```ts
interface WipeResult { deleted: Record<string, number> }
function wipeData(db: Database.Database): WipeResult;
```

One transaction: for each `DATA_TABLES` entry, read
`SELECT count(*)` then `DELETE FROM <table>`. Returns the pre-delete
counts. Leaves `app_settings`, `sessions`, `schema_migrations`, and the
schema itself untouched.

**`server/src/data/seed.ts`**

```ts
interface SeedResult { seeded: true }
function seedTestData(db: Database.Database, now?: Date): SeedResult;
```

Calls `wipeData(db)`, then inserts a small deterministic fixture across
three months (`now`'s month and the two before it — `now` defaults to
`new Date()`, a parameter only for deterministic tests):

- **income** — one salary row per month (`amountBrlCents ≈ 1_800_000`,
  `amountUsdCents 350_000`, `source 'Salário'`), plus one small extra in
  the current month.
- **expenses** — per month: Moradia/essencial `280_000`,
  Alimentação/essencial `120_000`, Transporte/essencial `40_000`,
  Delivery/nao-essencial `35_000`, Lazer/nao-essencial `50_000`; and one
  3× installment purchase ("Notebook", `600_000`) starting in the
  earliest month (three dated rows, shared group id).
- **exchange_contracts** — one per month (`amountUsdCents 350_000`,
  `contractedRate ≈ 5.1`, `ptaxRate ≈ 5.15`, `iofCents`, `bankFeeCents`,
  computed `netBrlCents`).
- **emergency_fund_entries** — two deposits (`700_000`, `150_000`) and
  one withdrawal (`-100_000`).
- **savings_monthly_targets** — the current month, `pct` 20, resolved
  against that month's seeded income.
- **goals** — "Viagem Japão" (`1_500_000` / `400_000`, target date
  `now` + 8 months), "Notebook novo" (`800_000` / `800_000` — complete).
- **special_projects** — "Entrada apartamento" (`8_000_000` /
  `1_200_000`, notes "Liberdade e patrimônio").
- **dollar_quotes** — the three months, rates `5.05` / `5.12` / `5.20`,
  `salary_usd_cents 350_000`.

All amounts hard-coded; all dates derived from `now`.

**`server/src/data/diagnostics.ts`**

```ts
interface Diagnostics {
  rowCounts: Record<string, number>;   // per DATA_TABLES entry; non-deleted where the table has deleted_at, else total
  dbSizeBytes: number;                 // 0 when no dbPath
  migrations: string[];                // applied ids, ascending
  lastBackup: string | null;           // ISO mtime of the newest file in backupDir, or null
  backupCount: number;                 // .db files in backupDir, or 0
}
function diagnostics(
  db: Database.Database,
  paths?: { dbPath: string; backupDir: string },
): Diagnostics;
```

`rowCounts`: for tables that have a `deleted_at` column, count
`WHERE deleted_at IS NULL`; for the rest (`savings_monthly_targets`,
`monthly_close`), count all. `migrations` from `SELECT id FROM
schema_migrations ORDER BY id`. `dbSizeBytes` / `lastBackup` /
`backupCount` from `fs` only when `paths` is given and the paths exist
(guard every `fs` call).

**`server/src/routes/data.ts`** —
`registerDataRoutes(app, db, dataPaths?)`, every route
`preHandler: requireAuth(db)`:

- `GET /api/data/diagnostics` → `diagnostics(db, dataPaths)`
- `GET /api/data/export` → `reply
    .header('content-disposition', \`attachment; filename="fumarende-\${date}.json"\`)
    .send(exportData(db))` where `date = new Date().toISOString().slice(0, 10)`
- `POST /api/data/import` → body is the export object;
  `const backupPath = dataPaths ? backupDatabase(dataPaths.dbPath, dataPaths.backupDir) : null;`
  then `importData(db, body)`; returns `{ backupPath, imported }`. A
  validation `throw` from `importData` is caught and returned as
  `400 { error }`.
- `POST /api/data/wipe` → body `{ confirm: string }`; `400` unless
  `confirm === 'APAGAR TUDO'`; backup (as above), `wipeData(db)`;
  returns `{ backupPath, deleted }`.
- `POST /api/data/seed-test` → body `{ confirm: string }`; same phrase
  gate; backup, `seedTestData(db)`; returns `{ backupPath, seeded: true }`.
- `GET /api/monthly-close` → `MonthCloseRow[]` (see below)
- `PUT /api/monthly-close/:month` → `400` unless `:month` matches
  `/^\d{4}-\d{2}$/`; `INSERT INTO monthly_close (month, reviewed_at)
  VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET reviewed_at = excluded.reviewed_at`
  with `new Date().toISOString()`; returns `{ month, reviewed: true, reviewedAt }`
- `DELETE /api/monthly-close/:month` → `DELETE FROM monthly_close WHERE
  month = ?`; `{ ok: true }`

`MonthCloseRow`:

```ts
interface MonthCloseRow {
  month: string;
  reviewed: boolean;
  reviewedAt: string | null;
}
```

`GET /api/monthly-close` builds the month set as the **union** of:
`SELECT DISTINCT substr(date, 1, 7)` from `income`, `expenses`,
`exchange_contracts`, `emergency_fund_entries` (all have a `date`
column), plus `month` from `savings_monthly_targets`, `dollar_quotes`,
and `monthly_close`; filter each to non-deleted where applicable. For
each month in that set, `reviewed`/`reviewedAt` come from its
`monthly_close` row (absent → `false` / `null`). Sorted by `month`
descending.

Registered in `server/src/app.ts` immediately after
`registerDollarQuoteRoutes(app, db)`, passing the `dataPaths` argument
through from `buildApp`.

### Frontend

**`frontend/src/lib/api.ts`** — add:

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

**`frontend/src/pages/BackupDadosPage.tsx`** — replaces
`<PlaceholderPage title="Backup & Dados" />`. Local `useState`, an
`async load()` on mount fetching `getDiagnostics()` + `listMonthlyClose()`.

Sections (each a `.card`):

1. **Diagnóstico** — a small two-column list: "Linhas — <table>: <n>"
   for each `rowCounts` entry; "Tamanho do banco:
   `(dbSizeBytes / 1024).toFixed(1)` KB"; "Migrações:
   `migrations.join(', ')`"; "Último backup: `lastBackup ? new
   Date(lastBackup).toLocaleString('pt-BR') : '—'` (`backupCount`
   arquivos)".

2. **Exportar** — `<a href={api.EXPORT_URL} download>Baixar snapshot
   (.json)</a>` styled as a button. (Same-origin GET; the session cookie
   rides along; the server's `content-disposition` names the file.)

3. **Importar** — an `<input type="file" accept="application/json,.json">`,
   a checkbox "Entendo que isto substitui todos os dados atuais", and a
   button "Importar" disabled until a file is chosen **and** the box is
   checked. On click: `FileReader` → `JSON.parse` → `api.importData(parsed)`;
   on success show "Importado. Backup em <backupPath>." and reload the
   diagnostics; on a parse error or a rejected request show an inline
   error.

4. **Zona de perigo** — an `<input>` for the confirmation phrase
   (`aria-label="Frase de confirmação"`), a hint "Digite APAGAR TUDO
   para habilitar", and two buttons enabled only when the field's
   trimmed value `=== 'APAGAR TUDO'`:
   - **Apagar todos os dados** → `api.wipeData(phrase)` → "Dados
     apagados. Backup em <backupPath>." + reload diagnostics; clears the
     field.
   - **Carregar dados de teste** → `api.seedTestData(phrase)` → "Dados
     de teste carregados. Backup em <backupPath>." + reload.

5. **Fechamento mensal** — a list from `listMonthlyClose()`; per month:
   the `month`, a checkbox (`checked = row.reviewed`,
   `aria-label={\`Revisado \${month}\`}`) that on change calls
   `api.markMonthReviewed(month)` / `api.unmarkMonthReviewed(month)`
   then reloads the list, and — when reviewed — "revisado em `new
   Date(reviewedAt).toLocaleDateString('pt-BR')`". Empty state: "Nenhum
   mês com dados ainda."

**`frontend/src/App.tsx`** — replace the Backup placeholder route with
`<BackupDadosPage />`; add the import.

## Data flow

1. Mount → `GET /api/data/diagnostics` + `GET /api/monthly-close`.
2. Export → a browser navigation to `/api/data/export`; the server
   streams the JSON as an attachment. No fetch.
3. Import → file read client-side, parsed, `POST /api/data/import`. The
   server backs up the DB file, then replaces every data table in one
   transaction. → reload diagnostics.
4. Wipe / seed → `POST` with the confirmation phrase; server validates
   the phrase, backs up, mutates. → reload diagnostics.
5. Monthly-close toggle → `PUT` / `DELETE /api/monthly-close/:month` →
   reload the month list.

## Error handling

- Wrong confirmation phrase → `400 { error }` before any backup or
  mutation.
- Malformed import payload: the `POST /api/data/import` route does a
  cheap shape check first — `body?.version === 1 && body.tables &&
  typeof body.tables === 'object'` — and returns `400 { error }` on
  failure **before** taking a backup, so a bad file changes nothing and
  leaves no backup. Only after that check does it back up and call
  `importData`, whose per-table validation `throw` is also caught and
  returned as `400 { error }` (this later failure is inside the
  transaction, which rolls back, so the data is intact — but a backup
  file was written, which is harmless).
- The frontend `request()` helper throws `Error(body.error)` on non-2xx;
  every section catches and renders `.error-text`.
- A DB with no `dataPaths` (tests) → `backupPath: null`,
  `dbSizeBytes: 0`, `lastBackup: null`; nothing throws.

## Testing

TDD — one failing test at a time.

**Server**

- `server/src/data/tables.test.ts`:
  - `DATA_TABLES` equals the migrated DB's table set minus
    `app_settings`, `sessions`, `schema_migrations` (sorted comparison).
- `server/src/data/export.test.ts`:
  - after inserting an income row and a goal, `exportData(db).tables`
    has `income` and `goals` arrays containing those rows;
    `version === 1`; `exportedAt` parses as a date.
  - a soft-deleted expense row still appears in `tables.expenses`.
- `server/src/data/import.test.ts`:
  - round-trip: seed a couple rows, `exportData`, `wipeData`,
    `importData(exported)` → the rows are back (compare `listIncome` /
    `listTargets`).
  - `importData` rejects `{ version: 2, tables: {} }`,
    `{ version: 1, tables: [] }`, and
    `{ version: 1, tables: { not_a_table: [] } }`.
  - a payload missing the `goals` key still imports the other tables and
    leaves `goals` empty.
- `server/src/data/wipe.test.ts`:
  - after inserting rows in several data tables, `wipeData(db)` empties
    them all and returns the right pre-delete counts; `app_settings`
    (seed a row) and `schema_migrations` are untouched.
- `server/src/data/seed.test.ts`:
  - `seedTestData(db, new Date(2026, 7, 15))` → `listIncome`,
    `listExpenses`, `listExchangeContracts`, `listEmergencyFundEntries`,
    `listTargets('goals')`, `listTargets('special_projects')`,
    `listQuotes` are all non-empty; the expense rows span exactly three
    `YYYY-MM` months around `2026-08`; a completed goal
    (`currentCents >= targetCents`) exists.
  - calling it twice leaves the same counts (it wipes first).
- `server/src/data/diagnostics.test.ts`:
  - `rowCounts` reflects inserted rows and ignores a soft-deleted one;
    `migrations` is `['001_initial_schema', '002_dollar_quotes']`;
    with no `paths`, `dbSizeBytes === 0` and `lastBackup === null`;
    with a real temp `dbPath` + `backupDir` containing one `.db` file,
    `dbSizeBytes > 0` and `backupCount === 1`.
- `server/src/routes/data.test.ts` (authed helper):
  - 401 unauthenticated on `GET /api/data/diagnostics`.
  - `GET /api/data/export` → 200, `content-disposition` contains
    `attachment; filename="fumarende-`, body parses and has a `tables`
    object.
  - HTTP round-trip: create an income row via `/api/income`,
    `GET /api/data/export`, `POST /api/data/import` with that body after
    a `POST /api/data/wipe` (`confirm: 'APAGAR TUDO'`) → `GET /api/income`
    has the row again; the import response has `imported.income === 1`
    and `backupPath === null` (in-memory).
  - `POST /api/data/wipe` with `{ confirm: 'nope' }` → 400; with the
    right phrase → 200 and `deleted` present.
  - `POST /api/data/seed-test` with the wrong phrase → 400; the right
    phrase → 200, `seeded: true`, and a following `GET /api/income` is
    non-empty.
  - `POST /api/data/import` with `{ version: 1, tables: { nope: [] } }`
    → 400.
  - `GET /api/monthly-close` after seeding returns rows with
    `reviewed: false`; `PUT /api/monthly-close/2026-08` → `reviewed: true`
    with a `reviewedAt`; a following `GET` shows that month reviewed;
    `DELETE /api/monthly-close/2026-08` → the month is back to
    `reviewed: false`; `PUT /api/monthly-close/2026-8` → 400.

**Frontend**

- `frontend/src/pages/BackupDadosPage.test.tsx` (mocks `../lib/api`):
  - renders the diagnostics from a mocked `getDiagnostics` (assert a row
    count and the migrations string).
  - the danger-zone buttons are disabled; typing `APAGAR TUDO` enables
    them; clicking "Apagar todos os dados" calls `api.wipeData` with
    `'APAGAR TUDO'`; clicking "Carregar dados de teste" calls
    `api.seedTestData` with `'APAGAR TUDO'`.
  - the Importar button is disabled until a file is selected and the
    checkbox is ticked; then a `change` on the file input with a `File`
    whose text is `'{"version":1,"tables":{}}'`, ticking the box, and
    clicking Importar calls `api.importData` with `{ version: 1, tables:
    {} }`.
  - a monthly-close checkbox reflecting `reviewed: false` calls
    `api.markMonthReviewed(month)` on change; one at `reviewed: true`
    calls `api.unmarkMonthReviewed(month)`.

**End-to-end** — a "Backup & Dados" section in `scripts/qa-e2e.sh`:
`GET /api/data/diagnostics` → 200 with a `rowCounts` object;
`GET /api/data/export` → 200; create an income row, export, wipe
(`confirm: APAGAR TUDO`), confirm `/api/income` empty, import the export,
confirm `/api/income` has the row; `POST /api/data/wipe` with a bad
phrase → 400; `POST /api/data/seed-test` (`confirm: APAGAR TUDO`) → 200
then `/api/income` non-empty; `PUT /api/monthly-close/2026-06` → 200,
`GET /api/monthly-close` shows it reviewed, `DELETE` → not reviewed,
`PUT /api/monthly-close/2026-6` → 400.

## Files

New:

- `server/src/data/tables.ts` + `.test.ts`
- `server/src/data/export.ts` + `.test.ts`
- `server/src/data/import.ts` + `.test.ts`
- `server/src/data/wipe.ts` + `.test.ts`
- `server/src/data/seed.ts` + `.test.ts`
- `server/src/data/diagnostics.ts` + `.test.ts`
- `server/src/routes/data.ts` + `.test.ts`
- `frontend/src/pages/BackupDadosPage.tsx` + `.test.tsx`

Modified:

- `server/src/app.ts` — `buildApp` third arg `dataPaths`; register the data routes
- `server/src/index.ts` — pass `{ dbPath, backupDir }` to `buildApp`
- `frontend/src/lib/api.ts` — `Diagnostics` / `MonthCloseRow` types + 7 client functions + `EXPORT_URL`
- `frontend/src/App.tsx` — mount `BackupDadosPage`
- `scripts/qa-e2e.sh` — add a Backup & Dados section
- `docs/qa-checklist.md` — append Backup & Dados checks
