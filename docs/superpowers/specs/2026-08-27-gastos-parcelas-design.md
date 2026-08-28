# fumarende — Gastos + Parcelas module design

> Follow-up #2 to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle. Follows the pattern
> established by the Câmbio module
> (`docs/superpowers/specs/2026-08-27-cambio-design.md`).

## Context

Modules shipped so far: Receitas (income) and Câmbio (exchange
contracts). This spec covers **Gastos** (expense entry, categorised,
essencial/não-essencial, with installment splitting), **Parcelas** (a
cross-month rollup of installment purchases), and **Gastos Fixos**
(recurring-expense templates with a one-click "apply to month").

The `expenses` and `fixed_expenses` tables already exist in the
Foundation schema
(`server/src/db/migrations/001_initial_schema.ts`), carried over
unchanged from the validated `stack-project` prototype. No migration is
needed. The validated behaviour reference is the prototype's
`app/src-tauri/src/db/expenses.rs`, `.../fixed_expenses.rs`, and
`app/src/pages/gastos.ts`.

## Goals

- Manual expense CRUD (create / list / soft-delete — no edit), with
  optional installment splitting into one dated row per installment.
- Correct, tested installment maths: an N-way split that sums **exactly**
  to the purchase amount, one row per calendar month with day-clamped
  dates, tied together by a shared `installment_group_id`.
- A Parcelas view that groups installment rows and shows, per purchase,
  how many installments are paid and how much BRL remains.
- Fixed-expense templates (CRUD) plus `apply to month`: stamp each active
  template into `expenses` for a month, idempotently.
- Deleting an installment purchase removes the **whole group** in one
  action.

## Non-goals (this pass)

- **Category rules UI / auto-categorisation.** The `category_rules` table
  stays untouched; keyword→category matching and description-based
  category suggestion are Phase 2 (see the Phase 1 design's Roadmap).
- **Expense editing.** Create / list / soft-delete only, matching the
  prototype. A mistake is deleted and re-entered.
- **Month scoping / a month selector.** The expense list and the
  essencial/não-essencial totals cover all expenses, newest first —
  identical to the current Receitas and Câmbio pages. A shell-level
  month selector is a later, cross-cutting concern. The "apply fixed
  expenses" action targets the current calendar month automatically.
- **Advisory flags / analysis.** Out of scope here, but the data this
  module stores is deliberately analysis-ready: `GET /api/expenses`
  returns full history and every row carries `date`, `category`, `type`,
  and `amount_cents`, so a later Análise/Dashboard module can compute
  per-category monthly rollups and trends without a schema change.

## Architecture

Follows the Foundation/Câmbio module pattern: pure logic → data layer →
Fastify routes behind `requireAuth` → register in `app.ts`; then
frontend lib → api client → page, route wired in `App.tsx`. Money is
integer cents throughout. Soft deletes only.

### Server

**`server/src/expenses/installments.ts`** — pure, no DB.

```ts
/** Adds `months` calendar months to an ISO date (YYYY-MM-DD), clamping
 *  the day to the last valid day of the target month. Jan 31 + 1 month
 *  -> Feb 28 (or 29); Jan 31 + 2 months -> Mar 31; Dec 15 + 1 -> next
 *  year Jan 15. */
function addMonths(dateISO: string, months: number): string;

/** Splits `amountCents` into `count` positive integers that sum exactly
 *  to `amountCents`. The first element absorbs the remainder:
 *  splitInstallments(65_000, 3) -> [21_668, 21_666, 21_666].
 *  count <= 1 -> [amountCents]. */
function splitInstallments(amountCents: number, count: number): number[];
```

`addMonths` implementation note: compute a zero-based month index
`m0 = (month - 1) + months`, then `year += Math.floor(m0 / 12)` and
`month = (m0 % 12) + 1` (guard the JS `%` sign for negative `months` with
a `((m0 % 12) + 12) % 12`), then `day = Math.min(origDay,
daysInMonth(year, month))` where `daysInMonth(y, m) = new Date(y, m,
0).getDate()`. Return `YYYY-MM-DD` zero-padded.

`splitInstallments` implementation note: `base = Math.trunc(amountCents /
count)`, `remainder = amountCents - base * count`; element 0 is
`base + remainder`, the rest are `base`.

**`server/src/db/expenses.ts`** — mirrors `server/src/db/income.ts`, but
`createExpense` may insert several rows and returns `number[]`.

```ts
interface Expense {
  id: number;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;                       // 'essencial' | 'nao-essencial'
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
  installmentTotal?: number | null;   // null/undefined/1 -> a single row
  notes?: string | null;
}
function createExpense(db: Database.Database, input: NewExpense): number[];
function listExpenses(db: Database.Database): Expense[];
function softDeleteExpense(db: Database.Database, id: number): void;
function softDeleteExpenseGroup(db: Database.Database, groupId: string): void;
```

- Validation (throws): `amountCents` positive integer; `description`
  non-blank after trim; `type` exactly `'essencial'` or
  `'nao-essencial'`; `category` and `paymentMethod` non-blank.
- `installmentTotal` null/undefined or `<= 1` → one `INSERT`, no
  installment columns, return `[id]`.
- `installmentTotal` `n >= 2` → `db.transaction(() => { ... })`:
  `splitInstallments(amountCents, n)`, a group id from
  `crypto.randomBytes(8).toString('hex')`, then `n` inserts — row `i`
  (0-based) has `amount_cents = split[i]`, `date = addMonths(input.date,
  i)`, `installment_number = i + 1`, `installment_total = n`,
  `installment_group_id = groupId`. Return all `n` ids.
- `listExpenses`: `WHERE deleted_at IS NULL ORDER BY date DESC, id DESC`.
- `softDeleteExpense(id)`: one row, `SET deleted_at = <ISO now>`.
- `softDeleteExpenseGroup(groupId)`: `UPDATE expenses SET deleted_at =
  <ISO now> WHERE installment_group_id = ? AND deleted_at IS NULL`.

**`server/src/db/fixed-expenses.ts`** — mirrors the pattern.

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

- `createFixedExpense` validation: same as expenses minus date and
  installments.
- `listFixedExpenses`: `WHERE deleted_at IS NULL ORDER BY description`.
- `applyFixedExpensesToMonth(month)` — `month` must match
  `/^\d{4}-\d{2}$/` (throw otherwise). In one transaction, for each row
  from `listFixedExpenses`: if `SELECT count(*) FROM expenses WHERE
  description = ? AND date LIKE ? AND deleted_at IS NULL` (pattern
  `${month}%`) is `0`, `INSERT` an expense dated `${month}-01` with the
  template's description/amount/category/type/payment_method (no
  installment columns). Return the number of rows created. Repeated
  calls for the same month create nothing new (idempotent).

**`server/src/routes/expenses.ts`** — `registerExpenseRoutes(app, db)`,
every route `preHandler: requireAuth(db)`:

- `GET /api/expenses` → `Expense[]`
- `POST /api/expenses` → validate the body, `createExpense`,
  `reply.code(201).send({ ids })`
- `DELETE /api/expenses/:id` → `softDeleteExpense(Number(params.id))`,
  `{ ok: true }`
- `DELETE /api/expenses/group/:groupId` →
  `softDeleteExpenseGroup(params.groupId)`, `{ ok: true }`

POST validation (400 `{ error }`): `date` present; `description` a
non-blank string; `amountCents` a positive integer; `type` is
`'essencial'` or `'nao-essencial'`; `category` and `paymentMethod`
non-blank strings; `installmentTotal` is `undefined`/`null` or an
integer `>= 1`.

**`server/src/routes/fixed-expenses.ts`** —
`registerFixedExpenseRoutes(app, db)`, every route
`preHandler: requireAuth(db)`:

- `GET /api/fixed-expenses` → `FixedExpense[]`
- `POST /api/fixed-expenses` → validate, `createFixedExpense`,
  `201 { id }`
- `DELETE /api/fixed-expenses/:id` → `{ ok: true }`
- `POST /api/fixed-expenses/apply` → body `{ month: string }`; 400 if
  `month` is missing or not `YYYY-MM`; else `applyFixedExpensesToMonth`,
  `{ created }`

Both register functions are called in `server/src/app.ts` immediately
after `registerExchangeRoutes(app, db)`.

### Frontend

**`frontend/src/lib/expenses.ts`** — shared constants and the Parcelas
rollup helper (pure).

```ts
const CATEGORIES = [
  'Moradia', 'Alimentação', 'Delivery', 'Transporte', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Vestuário', 'Outros',
];
const PAYMENT_METHODS = ['Crédito', 'Débito', 'Pix', 'Dinheiro', 'Transferência'];

interface InstallmentGroup {
  groupId: string;
  description: string;
  installmentTotal: number;
  paidCount: number;       // rows dated <= todayISO
  remainingCents: number;  // sum of rows dated > todayISO
  totalCents: number;      // sum of all rows in the group
}

/** Groups expenses that have an installmentGroupId, newest purchase
 *  first (by the earliest row's date). Rows without a group id are
 *  ignored. */
function groupInstallments(
  expenses: import('./api.js').Expense[],
  todayISO: string,
): InstallmentGroup[];
```

**`frontend/src/lib/api.ts`** — add:

- `interface Expense` (same shape as the server view type).
- `listExpenses(): Promise<Expense[]>`
- `createExpense(input): Promise<{ ids: number[] }>` — input:
  `{ date; description; amountCents; category; type: 'essencial' |
  'nao-essencial'; paymentMethod; installmentTotal?: number | null;
  notes?: string | null }`
- `deleteExpense(id: number): Promise<{ ok: true }>`
- `deleteExpenseGroup(groupId: string): Promise<{ ok: true }>`
- `interface FixedExpense` (same shape as the server view type).
- `listFixedExpenses(): Promise<FixedExpense[]>`
- `createFixedExpense(input): Promise<{ id: number }>` — input:
  `{ description; amountCents; category; type: 'essencial' |
  'nao-essencial'; paymentMethod }`
- `deleteFixedExpense(id: number): Promise<{ ok: true }>`
- `applyFixedExpenses(month: string): Promise<{ created: number }>` →
  `POST /api/fixed-expenses/apply` with `{ month }`

**`frontend/src/pages/GastosPage.tsx`** — replaces
`<PlaceholderPage title="Gastos" />`. Structure mirrors
`ReceitasPage`/`CambioPage` (local `useState`, `refresh()` on mount,
submit → api call → refresh, inline `.error-text`).

Expense form fields:

- `date` (`<input type="date">`)
- `description` (text)
- `amount` (text, pt-BR money via `parseCentsFromInput`)
- `category` (`<select>` from `CATEGORIES`)
- `type` (`<select>`: `essencial` "Essencial", `nao-essencial`
  "Não-essencial")
- `paymentMethod` (`<select>` from `PAYMENT_METHODS`)
- `installments` (`<input type="number" min="1">`, optional — blank or
  `1` means no split)

On submit: parse `amount` (reject `NaN`/`<= 0` with an inline error),
parse `installments` (blank → `null`; otherwise an integer `>= 1`, else
inline error), call `api.createExpense`, reset the form, `refresh()`.

Totals card (over **all** expenses, hidden when there are none):
Total = `Σ amountCents`; Essencial = `Σ amountCents where type ===
'essencial'`; Não-essencial = `total − essencial`. All via
`formatCentsBRL`.

Expense list card, newest first, one row each:
`{date} — {description} — {formatCentsBRL(amountCents)} [{category}]`,
plus `({installmentNumber}/{installmentTotal})` when
`installmentTotal !== null`, plus an **Excluir** button. Excluir calls
`api.deleteExpenseGroup(installmentGroupId)` when the row has a group id,
otherwise `api.deleteExpense(id)`; then `refresh()`. `aria-label` =
`Excluir gasto de {date}`.

Below the expense list, render `<FixedExpensesSection onApplied={refresh} />`.

**`frontend/src/components/FixedExpensesSection.tsx`** — self-contained,
own `useState` + `refresh()`.

- Heading "Gastos fixos".
- List card: `{description} — {formatCentsBRL(amountCents)} [{category}]`
  + an **Excluir** button (`api.deleteFixedExpense(id)` → local
  refresh). `aria-label` = `Excluir gasto fixo {description}`.
- Add form: `description` (text), `amount` (text, pt-BR money),
  `category` (`<select>`), `type` (`<select>`), `paymentMethod`
  (`<select>`) → `api.createFixedExpense` → local refresh.
- An **"Aplicar ao mês atual"** button: computes the current month as
  `new Date().toISOString().slice(0, 7)` (YYYY-MM), calls
  `api.applyFixedExpenses(month)`, shows `"{created} gasto(s)
  aplicado(s) a {month}."`, then calls the `onApplied` prop (so
  GastosPage re-fetches its expense list).
- `onApplied?: () => void` prop.

**`frontend/src/pages/ParcelasPage.tsx`** — replaces
`<PlaceholderPage title="Parcelas" />`.

- `refresh()` → `api.listExpenses()` → store; derive
  `groupInstallments(expenses, new Date().toISOString().slice(0, 10))`.
- Empty state: "Nenhuma compra parcelada."
- One row per group:
  `{description} — parcela {paidCount}/{installmentTotal} — restante
  {formatCentsBRL(remainingCents)} — total {formatCentsBRL(totalCents)}`
  + an **Excluir** button → `api.deleteExpenseGroup(groupId)` →
  `refresh()`. `aria-label` = `Excluir parcelamento {description}`.

**`frontend/src/App.tsx`** — replace the two placeholders:

```tsx
<Route path="/gastos" element={<GastosPage />} />
<Route path="/parcelas" element={<ParcelasPage />} />
```

and add the imports.

## Data flow

1. Gastos form → parsed integer cents + optional installment count →
   `POST /api/expenses`.
2. The route validates; `createExpense` either inserts one row or, for
   `n >= 2`, opens a transaction and inserts `n` dated rows sharing a
   generated `installment_group_id`, the amounts from
   `splitInstallments`. Response `{ ids }`.
3. GastosPage `refresh()` → `GET /api/expenses` → re-renders list +
   totals. ParcelasPage `refresh()` → same endpoint → `groupInstallments`
   → re-renders groups.
4. Excluir on an installment row/group → `DELETE
   /api/expenses/group/:groupId` (soft-deletes every row in the group);
   Excluir on a one-off → `DELETE /api/expenses/:id`.
5. FixedExpensesSection "Aplicar ao mês atual" → `POST
   /api/fixed-expenses/apply { month }` → inserts one expense per
   not-yet-applied template → `{ created }` → `onApplied()` refreshes
   GastosPage.

## Error handling

- Server validation failures → `400 { error }`. DB errors bubble to
  Fastify's default 500. Missing/invalid session → `401` from
  `requireAuth`.
- The frontend `request()` helper already throws `Error(body.error)` on
  a non-2xx response; each page/section catches and renders
  `.error-text`.

## Testing

TDD — one failing test at a time.

**Server**

- `server/src/expenses/installments.test.ts`:
  - `addMonths('2026-01-31', 1)` → `'2026-02-28'`; `addMonths(
    '2026-01-31', 2)` → `'2026-03-31'`; `addMonths('2026-12-15', 1)` →
    `'2027-01-15'`; `addMonths('2026-08-05', 0)` → `'2026-08-05'`.
  - `splitInstallments(65_000, 3)` → `[21_668, 21_666, 21_666]` and the
    sum is `65_000`; `splitInstallments(10_000, 1)` → `[10_000]`;
    `splitInstallments(100, 3)` → `[34, 33, 33]` summing to `100`.
- `server/src/db/expenses.test.ts`:
  - single create (no `installmentTotal`) → `listExpenses` has one row,
    `installmentTotal` null, returns one id.
  - `installmentTotal: 3` on `2026-01-15`, amount `65_000` → three rows;
    sorted by `installmentNumber` the amounts are `[21_668, 21_666,
    21_666]` summing to `65_000`, dates `['2026-01-15', '2026-02-15',
    '2026-03-15']`, all sharing one non-null `installmentGroupId`,
    `installmentTotal` `3` on each.
  - rejects `amountCents <= 0`, blank `description`, `type` not in
    {essencial, nao-essencial}.
  - `softDeleteExpense(id)` removes just that row; `softDeleteExpenseGroup
    (groupId)` removes every row in the group.
  - `listExpenses` orders by date descending.
- `server/src/db/fixed-expenses.test.ts`:
  - create → list → soft-delete; rejects blank description / bad type.
  - `applyFixedExpensesToMonth('2026-08')` with one template → returns
    `1`, and `listExpenses` has one row dated `'2026-08-01'` with the
    template's fields.
  - a second `applyFixedExpensesToMonth('2026-08')` → returns `0`,
    `listExpenses` still length 1.
  - `applyFixedExpensesToMonth('2026-8')` / `'nope'` → throws.
- `server/src/routes/expenses.test.ts` (mirrors
  `routes/income.test.ts`'s `authedApp()` helper): 401 unauthenticated;
  create one-off → `201`, `ids.length === 1`; create with
  `installmentTotal: 4` → `ids.length === 4`; list returns them; `400`
  on `type: 'x'`; `DELETE /api/expenses/:id` drops one row; `DELETE
  /api/expenses/group/:groupId` drops the whole group; a `DELETE` with
  `content-type: application/json` and an empty body still succeeds
  (regression guard).
- `server/src/routes/fixed-expenses.test.ts`: 401 unauthenticated;
  create + list; delete; `POST /api/fixed-expenses/apply { month:
  '2026-08' }` → `{ created: 1 }`; a repeat → `{ created: 0 }`; `400`
  on `{ month: 'bad' }`.

**Frontend**

- `frontend/src/lib/expenses.test.ts` — `groupInstallments`:
  - three rows sharing a group id, two dated `<= today` and one `>` →
    one group with `paidCount 2`, `remainingCents` = the future row's
    amount, `totalCents` = all three.
  - rows without a group id are ignored.
  - two distinct group ids → two groups.
- `frontend/src/pages/GastosPage.test.tsx` (mocks `../lib/api`):
  renders; submitting the form calls `api.createExpense` once with the
  parsed integer cents, the selected category/type/payment method, and
  `installmentTotal` (`null` when the field is blank, the integer when
  set); totals card shows the summed values; an "Excluir" click on a
  non-installment row calls `api.deleteExpense(id)`; an "Excluir" click
  on an installment row calls `api.deleteExpenseGroup(groupId)`.
- `frontend/src/components/FixedExpensesSection.test.tsx` (mocks
  `../lib/api`): renders existing templates; submitting the add form
  calls `api.createFixedExpense`; clicking "Aplicar ao mês atual" calls
  `api.applyFixedExpenses` with a `YYYY-MM` string, shows the returned
  count, and calls the `onApplied` prop.
- `frontend/src/pages/ParcelasPage.test.tsx` (mocks `../lib/api`):
  renders one group row from a mocked `listExpenses` with the
  paid/remaining text; an "Excluir" click calls
  `api.deleteExpenseGroup(groupId)` and re-fetches.

## Files

New:

- `server/src/expenses/installments.ts` + `.test.ts`
- `server/src/db/expenses.ts` + `.test.ts`
- `server/src/db/fixed-expenses.ts` + `.test.ts`
- `server/src/routes/expenses.ts` + `.test.ts`
- `server/src/routes/fixed-expenses.ts` + `.test.ts`
- `frontend/src/lib/expenses.ts` + `.test.ts`
- `frontend/src/pages/GastosPage.tsx` + `.test.tsx`
- `frontend/src/pages/ParcelasPage.tsx` + `.test.tsx`
- `frontend/src/components/FixedExpensesSection.tsx` + `.test.tsx`

Modified:

- `server/src/app.ts` — register the expense + fixed-expense routes
- `frontend/src/lib/api.ts` — expense + fixed-expense client
- `frontend/src/App.tsx` — mount `GastosPage` and `ParcelasPage`
- `docs/qa-checklist.md` — append Gastos / Parcelas checks
