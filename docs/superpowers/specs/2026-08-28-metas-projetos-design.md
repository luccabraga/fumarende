# fumarende — Metas + Projetos Especiais module design

> Follow-up #4 to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle. Follows the pattern of the
> Câmbio, Gastos, and Reserva modules.

## Context

Modules shipped: Receitas, Câmbio, Gastos + Parcelas + Gastos Fixos,
Reserva. This spec covers **Metas** (personal savings goals — a PS5, a
trip, a laptop) and **Projetos Especiais** (larger one-off efforts — an
apartment down-payment), kept as distinct pages per the Phase 1 design's
"larger, one-off efforts vs. personal targets" split.

The `goals` and `special_projects` tables already exist in the Foundation
schema (`server/src/db/migrations/001_initial_schema.ts`), carried over
from the prototype. They are **structurally identical** —
`id, name, target_cents, current_cents, target_date, status, deleted_at`
— except `special_projects` also has a `notes` column. No migration is
needed.

The Tauri prototype never implemented these; the behaviour reference is
the original single-file `stack-project/prototype/stacks.html`
(`saveMeta` / `saveProjeto` / `renderMetas` / `renderProjetos` /
`addToMeta`), adapted to the fumarende schema (which uses `target_date`
where the prototype used a raw months/years number, and has no per-goal
emoji column).

## Goals

- CRUD for goals and for special projects — create, list, edit, quick
  "add to current", soft-delete.
- Per-item progress: remaining amount, a capped progress %, and a
  suggested monthly contribution derived from `target_date`.
- A "concluída" state derived from the numbers (`current >= target`), not
  a manual toggle.
- Maximum code sharing between the two — one generic data layer, one
  card component — while keeping each page and endpoint named for its own
  concept.

## Non-goals (this pass)

- **No emoji.** The prototype had a per-item emoji; there is no column
  and this pass adds no migration.
- **No manual archive / status toggle.** Completion is derived; the
  `status` column stays at its `'active'` default. Manual archiving can
  be added later.
- **No per-contribution history.** `current_cents` is a plain mutable
  column (create sets the starting value, "adicionar" applies a positive
  delta, edit sets it directly). A dated contributions ledger would need
  a migration and is out of scope.
- **No linking** to Reserva or to income.
- **No month selector**, **no AI**.

## Architecture

Follows the established module pattern. Money is integer cents. Soft
deletes only. The two entities share a single generic data-layer module
parameterised by table name, and a single React card component; the
route registration is a factory called twice.

### Server

**`server/src/targets/progress.ts`** — pure, no DB.

```ts
/**
 * Whole months from `today` to `targetDate` (YYYY-MM-DD), clamped to a
 * minimum of 1. Returns null when `targetDate` is empty/null or is not
 * strictly after today's month.
 */
function monthsUntil(targetDate: string | null, today?: Date): number | null;

interface TargetInput {
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
}
interface TargetProgress {
  remainingCents: number;              // max(0, target - current)
  progressPct: number;                 // current / target * 100, capped at 100; 0 when target is 0
  suggestedMonthlyCents: number | null; // remaining / monthsUntil, rounded; null when monthsUntil is null or remaining is 0
  complete: boolean;                   // current >= target
}
function targetProgress(input: TargetInput, today?: Date): TargetProgress;
```

`monthsUntil` implementation: parse `targetDate`; compute
`(ty - cy) * 12 + (tm - cm)` on year/month only; if `<= 0` return null;
otherwise return that value (already `>= 1`). `today` defaults to
`new Date()`, a parameter only for deterministic tests.

**`server/src/db/targets.ts`** — one generic data layer.

```ts
type TargetTable = 'goals' | 'special_projects';

interface Target {
  id: number;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  notes: string | null;   // always null for goals
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

- `TABLES: Record<TargetTable, true>` guards the table name — every
  function throws on an unknown table so the name is never interpolated
  blindly. `notes` is only read/written for `special_projects`; for
  `goals` the column does not exist, so `createTarget`/`updateTarget`
  omit it from the SQL when `table === 'goals'` and the view's `notes`
  is hard-coded `null`.
- `createTarget` validation (throws): `name` non-blank after trim;
  `targetCents` an integer `> 0`; `currentCents` (default 0) an integer
  `>= 0`.
- `listTargets` — `WHERE deleted_at IS NULL ORDER BY id DESC`.
- `updateTarget` — builds a `SET` clause from the provided keys only;
  same field validations for any key present; a no-op if `patch` is
  empty.
- `addToTarget` — throws unless `deltaCents` is an integer `> 0`;
  `UPDATE <table> SET current_cents = current_cents + ? WHERE id = ? AND deleted_at IS NULL`.
- `softDeleteTarget` — `SET deleted_at = <ISO now>`.

**`server/src/routes/targets.ts`** — a factory.

```ts
function registerTargetRoutes(
  app: FastifyInstance,
  db: Database.Database,
  opts: { table: TargetTable; basePath: string },  // basePath e.g. '/api/goals'
): void;
```

Routes (all `preHandler: requireAuth(db)`), where `B = opts.basePath`:

- `GET  B`          → `listTargets(db, table)`
- `POST B`          → validate body, `createTarget`, `201 { id }`
- `PATCH B/:id`     → validate the provided keys, `updateTarget`, `{ ok: true }`
- `POST B/:id/add`  → body `{ deltaCents }`; 400 unless integer `> 0`; `addToTarget`; `{ ok: true }`
- `DELETE B/:id`    → `softDeleteTarget`; `{ ok: true }`

POST/PATCH validation (400 `{ error }`): `name` a non-blank string when
present (required on POST); `targetCents` an integer `> 0` when present
(required on POST); `currentCents` an integer `>= 0` when present;
`targetDate` a string or null when present; `notes` a string or null
when present.

`server/src/app.ts` calls the factory twice, after
`registerSavingsRoutes(app, db)`:

```ts
registerTargetRoutes(app, db, { table: 'goals', basePath: '/api/goals' });
registerTargetRoutes(app, db, { table: 'special_projects', basePath: '/api/special-projects' });
```

### Frontend

**`frontend/src/lib/targets.ts`** — a copy of `monthsUntil` and
`targetProgress` (identical bodies to the server module), operating on
plain numbers.

**`frontend/src/lib/api.ts`** — add:

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
  update(id: number, patch: {
    name?: string;
    targetCents?: number;
    currentCents?: number;
    targetDate?: string | null;
    notes?: string | null;
  }): Promise<{ ok: true }>;
  addTo(id: number, deltaCents: number): Promise<{ ok: true }>;
  remove(id: number): Promise<{ ok: true }>;
}

export function targetsClient(basePath: string): TargetsClient { ... }

export const goalsApi = targetsClient('/api/goals');
export const projectsApi = targetsClient('/api/special-projects');
```

`targetsClient` uses the existing private `request<T>()` helper:
`list` → `GET basePath`; `create` → `POST basePath`; `update` →
`PATCH basePath/${id}`; `addTo` → `POST basePath/${id}/add` with
`{ deltaCents }`; `remove` → `DELETE basePath/${id}`.

**`frontend/src/components/TargetCard.tsx`** — one card for one `Target`.

Props: `{ target: Target; onAdd(id, deltaCents); onUpdate(id, patch); onDelete(id); showNotes: boolean }`.

Renders: `target.name`; `{formatCentsBRL(currentCents)} de
{formatCentsBRL(targetCents)}`; a progress bar sized to
`progressPct`; when not complete, `Faltam {formatCentsBRL(remainingCents)}`
and — when `suggestedMonthlyCents !== null` —
`Sugestão {formatCentsBRL(suggestedMonthlyCents)}/mês`; when `complete`,
a **Concluída** badge (no suggestion line); the motivation text
(`target.notes`) when `showNotes` and it is set.

Controls: **Adicionar** toggles a small `<input>` + confirm button →
`onAdd(target.id, parseCentsFromInput(value))` (ignored if `NaN`/`<= 0`).
**Editar** toggles a field set (name, valor, data alvo, valor atual, and
motivação when `showNotes`), pre-filled from `target` → `onUpdate(
target.id, patch)`. **Excluir** → `onDelete(target.id)`.
`aria-label`s: `Adicionar à meta ${name}` (card is concept-agnostic, so
use "meta" in both — see below), `Editar ${name}`, `Excluir ${name}`.
(To keep the shared component simple the aria-labels read "meta"; the
page headings carry the Metas/Projetos distinction.)

**`frontend/src/components/TargetSection.tsx`** — the reusable body of
both pages.

Props: `{ api: TargetsClient; showNotes: boolean; heading: string;
emptyText: string }`.

- `useState<Target[]>`, `refresh()` on mount → `api.list()`.
- A create form: `name`, `valor` (pt-BR money → `targetCents`), `data
  alvo` (`<input type="date">` → `targetDate`), `valor já guardado`
  (pt-BR money → `currentCents`, default blank → omit), and — when
  `showNotes` — `motivação` (text → `notes`). Submit validates `name`
  non-blank and `targetCents > 0` (inline error otherwise), calls
  `api.create`, resets, `refresh()`.
- Renders a `<TargetCard>` per item (passing `api.addTo` / `api.update`
  / `api.remove` wrapped to `refresh()` after), or `emptyText` when the
  list is empty.

**`frontend/src/pages/MetasPage.tsx`**

```tsx
import { goalsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function MetasPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Metas</h1>
      <TargetSection api={goalsApi} showNotes={false} heading="Suas metas"
        emptyText="Nenhuma meta ainda. Crie a primeira." />
    </div>
  );
}
```

**`frontend/src/pages/ProjetosPage.tsx`** — the same, `projectsApi`,
`showNotes`, heading "Seus projetos especiais", empty text "Seus grandes
sonhos ficam aqui. Crie o primeiro."

**`frontend/src/App.tsx`** — replace the `/metas` and `/projetos`
placeholders with `<MetasPage />` and `<ProjetosPage />`; add the
imports.

## Data flow

1. Page mount → `api.list()` → render cards.
2. Create form → `api.create(input)` → `refresh()`.
3. Card "Adicionar" → `api.addTo(id, deltaCents)` → `refresh()`.
4. Card "Editar" → `api.update(id, patch)` → `refresh()`.
5. Card "Excluir" → `api.remove(id)` → `refresh()`.
6. `progressPct` / `remainingCents` / `suggestedMonthlyCents` /
   `complete` are computed client-side by `targetProgress` from the row
   fields — never stored.

## Error handling

- Server validation failures → `400 { error }`; data-layer `throw`s are
  duplicated by the route guards so bad input is a clean 400. Unknown
  table names are impossible from the wired routes (the factory is
  called with literals) but the data layer still guards.
- The frontend `request()` helper throws `Error(body.error)` on non-2xx;
  the create form and each card action catch and render `.error-text`.

## Testing

TDD — one failing test at a time.

**Server**

- `server/src/targets/progress.test.ts`:
  - `monthsUntil('2026-11-01', new Date(2026, 7, 15))` → `3`;
    `monthsUntil(null, ...)` → `null`; `monthsUntil('2026-07-01', new
    Date(2026, 7, 15))` (past) → `null`;
    `monthsUntil('2026-09-30', new Date(2026, 7, 15))` → `1` (same
    partial month still counts as 1... actually Aug→Sep = 1).
  - `targetProgress({ targetCents: 100_000, currentCents: 25_000,
    targetDate: '2026-11-01' }, new Date(2026, 7, 15))` →
    `remainingCents 75_000`, `progressPct 25`, `suggestedMonthlyCents
    25_000` (75_000 / 3), `complete false`.
  - `targetProgress({ targetCents: 100_000, currentCents: 120_000,
    targetDate: null })` → `remainingCents 0`, `progressPct 100`,
    `suggestedMonthlyCents null`, `complete true`.
  - `targetProgress({ targetCents: 0, currentCents: 0, targetDate: null })`
    → `progressPct 0`, `complete true`.
- `server/src/db/targets.test.ts` — run the shared cases against **both**
  `'goals'` and `'special_projects'` via `it.each`:
  - create then list returns the row with the right fields and
    `status 'active'`.
  - `createTarget` rejects a blank name, `targetCents <= 0`, negative
    `currentCents`.
  - `listTargets` orders by `id` descending.
  - `updateTarget(table, id, { currentCents: 5_000, name: 'x' })`
    applies both; an empty patch is a no-op.
  - `addToTarget(table, id, 2_000)` increments `currentCents`; a
    non-positive delta throws.
  - `softDeleteTarget` drops the row from `listTargets`.
  - `'goals'` specifically: `notes` on the returned view is always
    `null` even if a `notes` value was passed to `createTarget`.
  - `'special_projects'` specifically: a `notes` value round-trips.
- `server/src/routes/targets.test.ts` (mirrors the `authedApp()`
  helper). Parameterise over `basePath` in `['/api/goals',
  '/api/special-projects']`:
  - 401 unauthenticated on `GET basePath`.
  - `POST basePath` creates → `201`, `id` numeric; `GET` lists it.
  - `POST basePath` with a blank name → 400; with `targetCents: 0` → 400.
  - `PATCH basePath/:id` `{ currentCents: 9_000 }` → the list shows the
    new value.
  - `POST basePath/:id/add` `{ deltaCents: 1_000 }` → list value grew by
    1_000; `{ deltaCents: 0 }` → 400.
  - `DELETE basePath/:id` → gone from the list; a `DELETE` with
    `content-type: application/json` and an empty body still succeeds
    (regression guard).
  - `/api/special-projects` only: `notes` round-trips through
    `POST` + `GET`.

**Frontend**

- `frontend/src/lib/targets.test.ts` — the same `monthsUntil` and
  `targetProgress` vectors as the server test.
- `frontend/src/components/TargetCard.test.tsx` (renders a card in
  isolation, passing `vi.fn()` handlers):
  - shows `formatCentsBRL` current/target and a "Faltam …" line for an
    in-progress target.
  - shows the **Concluída** badge and no suggestion line when
    `currentCents >= targetCents`.
  - clicking **Adicionar**, typing `50`, confirming → `onAdd(id, 5_000)`.
  - clicking **Excluir** → `onDelete(id)`.
  - `showNotes` false hides the motivation text even when `notes` is set.
- `frontend/src/components/TargetSection.test.tsx` (mocks a
  `TargetsClient` object of `vi.fn()`s):
  - lists items from `api.list`.
  - the create form with name + valor calls `api.create` with parsed
    `targetCents` (and `currentCents` when the "já guardado" field is
    filled).
  - `showNotes` true renders the motivação input and passes `notes`
    through; `showNotes` false renders no motivação input.
- `frontend/src/pages/MetasPage.test.tsx` and
  `ProjetosPage.test.tsx` — a smoke test each: mock the respective
  api client's `list` to resolve `[]`, render the page, assert the
  heading text and that `list` was called.

## Files

New:

- `server/src/targets/progress.ts` + `.test.ts`
- `server/src/db/targets.ts` + `.test.ts`
- `server/src/routes/targets.ts` + `.test.ts`
- `frontend/src/lib/targets.ts` + `.test.ts`
- `frontend/src/components/TargetCard.tsx` + `.test.tsx`
- `frontend/src/components/TargetSection.tsx` + `.test.tsx`
- `frontend/src/pages/MetasPage.tsx` + `.test.tsx`
- `frontend/src/pages/ProjetosPage.tsx` + `.test.tsx`

Modified:

- `server/src/app.ts` — register the two target route sets
- `frontend/src/lib/api.ts` — `Target` type, `targetsClient`, `goalsApi`, `projectsApi`
- `frontend/src/App.tsx` — mount `MetasPage` and `ProjetosPage`
- `docs/qa-checklist.md` — append Metas / Projetos checks
