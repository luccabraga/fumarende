# fumarende — Reserva module design

> Follow-up #3 to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle. Follows the pattern of the
> Câmbio and Gastos + Parcelas modules.

## Context

Modules shipped: Receitas, Câmbio, Gastos + Parcelas + Gastos Fixos.
This spec covers **Reserva** — the emergency fund: signed
deposit/withdrawal ledger, a running balance, 3×/6× essential-expense
targets, and a per-month savings target with deficit-only rollover.

The `emergency_fund_entries` and `savings_monthly_targets` tables already
exist in the Foundation schema
(`server/src/db/migrations/001_initial_schema.ts`), carried over from the
validated `stack-project` prototype. No migration is needed.

Validated behaviour reference: the prototype's
`app/src-tauri/src/db/emergency_fund.rs`, `.../savings.rs`,
`app/src/lib/emergency-fund-math.ts`, and `app/src/pages/reserva.ts`.

There is a single savings ledger — Poupança and Reserva were merged in
the prototype (migration 005). "How much was saved this month" is the
net change in this same ledger, not a separate pot.

## Goals

- Signed emergency-fund ledger: deposits stored positive, withdrawals
  stored negative, balance is a plain `SUM`. Create / list / soft-delete
  (no edit).
- Essential-expense average: the mean of the most recent 3 months (of
  the last 6) that had any `essencial` spending, read from the existing
  `expenses` table.
- 3× and 6× targets off that average, a progress %, and a single alert
  line by tier.
- A per-month savings target (`pct` of that month's income, or a `fixed`
  amount) that **freezes** on first computation, with **deficit-only**
  rollover from the previous month.

## Non-goals (this pass)

- **No month selector.** The balance, 3×/6× targets, and full history are
  month-agnostic. The "Meta Mensal" card is tied to the **current
  calendar month** only (`new Date().toISOString().slice(0, 7)`). A
  shell-level month selector is a later cross-cutting concern.
- **No editing** of ledger entries — create / soft-delete only.
- **No linking** savings to Metas / Projetos Especiais — that is
  follow-up #4.
- **No AI / advisory flags.** The tiered alert here is a fixed
  3×/6× rule, not analysis.

## Architecture

Follows the established module pattern: pure logic → data layer →
Fastify routes behind `requireAuth` → register in `app.ts`; frontend lib
→ api client → page → route in `App.tsx`. Money is integer cents. Soft
deletes only. Rates/percentages are plain integers (`pct_value` is a
whole-number percent, matching the schema).

### Server

**`server/src/savings/essential-average.ts`** — pure, no DB. Port of
`averageEssentialExpenses`:

```ts
interface MinimalExpense {
  date: string;        // YYYY-MM-DD
  amountCents: number;
  type: string;        // 'essencial' | 'nao-essencial'
}
interface EssentialAverage {
  averageCents: number;  // mean of the qualifying months' totals; 0 if none
  monthsUsed: number;    // 0..3
}
function essentialAverage(expenses: MinimalExpense[], today?: Date): EssentialAverage;
```

Walk `i = 0..5` from `today`'s month backwards. For each month key
`YYYY-MM`, sum `amountCents` of rows where `date` starts with that key
**and** `type === 'essencial'`. Collect months whose total is `> 0`,
stopping once 3 are collected. `averageCents` = arithmetic mean of the
collected totals (a real number — do **not** round; the frontend
formats). `{ 0, 0 }` when none qualify. `today` defaults to
`new Date()`; it is a parameter purely so tests are deterministic.

**`server/src/db/emergency-fund.ts`** — mirrors `server/src/db/income.ts`.

```ts
interface EmergencyFundEntry {
  id: number;
  date: string;
  amountCents: number;   // signed: negative == withdrawal
  notes: string | null;
}
function createDeposit(db, input: { date: string; amountCents: number; notes?: string | null }): number;
function createWithdrawal(db, input: { date: string; amountCents: number; notes?: string | null }): number;
function listEmergencyFundEntries(db): EmergencyFundEntry[];
function softDeleteEmergencyFundEntry(db, id: number): void;
```

- `createDeposit` — throws unless `amountCents` is an integer `> 0`;
  inserts it positive.
- `createWithdrawal` — `amountCents` is a **non-negative magnitude**;
  throws unless it is an integer `> 0`; inserts `-amountCents`.
- `listEmergencyFundEntries` —
  `WHERE deleted_at IS NULL ORDER BY date DESC, id DESC`.
- `softDeleteEmergencyFundEntry` — `SET deleted_at = <ISO now>`.
- There is no balance column: callers sum `amountCents`.

**`server/src/db/savings-target.ts`** — ported from `savings.rs`, using
`better-sqlite3` transactions.

```ts
interface MonthlyTarget {
  month: string;                    // YYYY-MM
  pctOrFixed: string;               // 'pct' | 'fixed'
  pctValue: number | null;          // whole-number percent
  fixedValueCents: number | null;
  targetCents: number;              // frozen once written
  rolloverCents: number;
}
function getOrCreateMonthlyTarget(db, month: string): MonthlyTarget;
function updateMonthlyTargetConfig(
  db, month: string,
  pctOrFixed: string,
  pctValue: number | null,
  fixedValueCents: number | null,
): MonthlyTarget;
```

Helpers (private):

- `monthIncomeCents(db, month)` —
  `SELECT COALESCE(SUM(amount_brl_cents), 0) FROM income WHERE date LIKE '<month>%' AND deleted_at IS NULL`.
- `monthNetSavedCents(db, month)` — same shape over
  `emergency_fund_entries.amount_cents` (withdrawals already negative).
- `previousMonth(month)` — `'2026-01'` → `'2025-12'`, else decrement.
- `resolveTargetCents(db, month, pctOrFixed, pctValue, fixedValueCents)` —
  `fixed` → `fixedValueCents ?? 0`; `pct` →
  `Math.trunc(monthIncomeCents(db, month) * (pctValue ?? 0) / 100)`.
- `computeRolloverCents(db, month)` — let `prev = previousMonth(month)`;
  if no `savings_monthly_targets` row for `prev`, `0`; else
  `deficit = (prev.targetCents + prev.rolloverCents) - monthNetSavedCents(db, prev)`,
  return `deficit > 0 ? deficit : 0`.

`getOrCreateMonthlyTarget(db, month)`:

1. If a row for `month` exists, return it unchanged.
2. In a transaction: read the most recent prior row
   (`WHERE month < ? ORDER BY month DESC LIMIT 1`) for its
   `pct_or_fixed` / `pct_value` / `fixed_value_cents`; default
   `('pct', 0, null)` if none.
3. `targetCents = resolveTargetCents(...)`,
   `rolloverCents = computeRolloverCents(db, month)`.
4. `INSERT` the row; commit; return it. **Never recomputed after this.**

`updateMonthlyTargetConfig(db, month, pctOrFixed, pctValue, fixedValueCents)`:

1. Throw unless `pctOrFixed` is `'pct'` or `'fixed'`.
2. In a transaction: `targetCents = resolveTargetCents(...)` against
   **this** month's income; `rolloverCents = computeRolloverCents(db, month)`.
3. `INSERT ... ON CONFLICT(month) DO UPDATE SET pct_or_fixed, pct_value,
   fixed_value_cents, target_cents = excluded.target_cents` — note
   `rollover_cents` is **not** in the `DO UPDATE` list, so an existing
   row keeps its rollover (rollover depends on the previous month, not
   this month's config); a brand-new row gets the computed value from
   the `INSERT`.
4. Commit; return the row.

**`server/src/routes/savings.ts`** — `registerSavingsRoutes(app, db)`,
every route `preHandler: requireAuth(db)`:

- `GET /api/emergency-fund` → `listEmergencyFundEntries(db)`
- `POST /api/emergency-fund` — body
  `{ kind: 'deposit' | 'withdrawal', date: string, amountCents: number, notes?: string | null }`.
  400 unless `kind` is one of the two, `date` is present, and
  `amountCents` is an integer `> 0`. Dispatches to `createDeposit` /
  `createWithdrawal`. `201 { id }`.
- `DELETE /api/emergency-fund/:id` →
  `softDeleteEmergencyFundEntry(db, Number(params.id))`, `{ ok: true }`.
- `GET /api/savings-target/:month` — 400 unless `params.month` matches
  `/^\d{4}-\d{2}$/`; else `getOrCreateMonthlyTarget(db, month)`. A doc
  comment states the side effect: **the first GET for a month creates
  and freezes its row.**
- `PUT /api/savings-target/:month` — body
  `{ pctOrFixed: string, pctValue?: number | null, fixedValueCents?: number | null }`.
  400 on a bad `month` or a `pctOrFixed` other than `pct`/`fixed`; else
  `updateMonthlyTargetConfig(db, month, pctOrFixed, pctValue ?? null, fixedValueCents ?? null)`.

Registered in `server/src/app.ts` immediately after
`registerFixedExpenseRoutes(app, db)`.

### Frontend

**`frontend/src/lib/reserva.ts`** — pure.

```ts
// A copy of essentialAverage (identical to server/src/savings/essential-average.ts),
// operating on the frontend api.Expense shape.
function essentialAverage(expenses: Expense[], today?: Date): { averageCents: number; monthsUsed: number };

interface ReserveTiers {
  target3Cents: number;   // 3 * averageCents, rounded
  target6Cents: number;   // 6 * averageCents, rounded
  progressPct: number;    // balance / target6, * 100, capped at 100; 0 when target6 is 0
  tier: 'no-data' | 'below-3' | 'below-6' | 'complete';
}
function reserveTiers(balanceCents: number, averageCents: number): ReserveTiers;
```

`tier`: `no-data` when `averageCents === 0`; else `below-3` when
`balance < target3`, `below-6` when `balance < target6`, otherwise
`complete`.

**`frontend/src/lib/api.ts`** — add:

- `interface EmergencyFundEntry { id; date; amountCents; notes }`
- `interface MonthlyTarget { month; pctOrFixed; pctValue; fixedValueCents; targetCents; rolloverCents }`
- `listEmergencyFund(): Promise<EmergencyFundEntry[]>` → `GET /api/emergency-fund`
- `createEmergencyFundEntry(input: { kind: 'deposit' | 'withdrawal'; date: string; amountCents: number; notes?: string | null }): Promise<{ id: number }>` → `POST /api/emergency-fund`
- `deleteEmergencyFundEntry(id: number): Promise<{ ok: true }>` → `DELETE /api/emergency-fund/${id}`
- `getMonthlyTarget(month: string): Promise<MonthlyTarget>` → `GET /api/savings-target/${month}`
- `updateMonthlyTarget(month: string, cfg: { pctOrFixed: 'pct' | 'fixed'; pctValue?: number | null; fixedValueCents?: number | null }): Promise<MonthlyTarget>` → `PUT /api/savings-target/${month}`

**`frontend/src/pages/ReservaPage.tsx`** — replaces
`<PlaceholderPage title="Reserva" />`. Local `useState`, `refresh()` on
mount fetching `listEmergencyFund()` + `listExpenses()` +
`getMonthlyTarget(currentMonth)`.

Sections:

1. **Status card** (month-agnostic). `balance = Σ amountCents`;
   `{ averageCents } = essentialAverage(expenses)`;
   `tiers = reserveTiers(balance, averageCents)`. Show: Já guardado
   (`formatCentsBRL(balance)`), Meta 3 meses
   (`formatCentsBRL(tiers.target3Cents)`), Meta ideal 6 meses, Progresso
   (`${tiers.progressPct.toFixed(0)}%`), and one alert line switched on
   `tiers.tier`:
   - `no-data` → "Registre seus gastos essenciais em Gastos para
     calcular a reserva ideal."
   - `below-3` → "🚨 Abaixo do mínimo recomendado (3 meses)."
   - `below-6` → "⚠️ Bom progresso — meta ideal é 6 meses."
   - `complete` → "✅ Reserva completa (6+ meses)."

2. **Depósito form** — `date` (default `today`), `amount` (pt-BR money),
   `notes` (optional). Submit → `createEmergencyFundEntry({ kind:
   'deposit', date, amountCents, notes: notes || null })` → `refresh()`.
   Rejects `NaN` / `<= 0` with an inline error.

3. **Retirada form** — same fields; button "− Retirar da reserva". If
   `amountCents > balance`, render an inline warning line (not a block) —
   the submit still goes through. Submit →
   `createEmergencyFundEntry({ kind: 'withdrawal', date, amountCents,
   notes: notes || null })`.

4. **Meta Mensal card** (current month). `month = new
   Date().toISOString().slice(0, 7)`; `target` from state.
   `addedThisMonth = Σ amountCents of entries whose date starts with
   month`; `totalTarget = target.targetCents + target.rolloverCents`;
   `diff = addedThisMonth - totalTarget`. Show: "Meta mensal
   `formatCentsBRL(totalTarget)`" (append "(inclui
   `formatCentsBRL(rolloverCents)` de déficit anterior)" when
   `rolloverCents > 0`), "Adicionado este mês
   `formatCentsBRL(addedThisMonth)`", and `diff >= 0` → "✅ Meta batida —
   sobra `formatCentsBRL(diff)`" else "⚠️ Faltam
   `formatCentsBRL(-diff)`". Config form: a `<select>` `pct` / `fixed`,
   a pct `<input type="number">`, a fixed R$ `<input type="text">`
   (pt-BR money), pre-filled from `target`. Submit →
   `updateMonthlyTarget(month, { pctOrFixed, pctValue: pctOrFixed ===
   'pct' && pctRaw ? Number(pctRaw) : null, fixedValueCents: pctOrFixed
   === 'fixed' && fixedRaw ? parseCentsFromInput(fixedRaw) : null })` →
   `refresh()`.

5. **Histórico list** — every entry newest first:
   `{date} — {notes ?? '—'} — {amountCents < 0 ? '− ' : '+ '}${formatCentsBRL(Math.abs(amountCents))}`
   plus an **Excluir** button →
   `deleteEmergencyFundEntry(id)` → `refresh()`. `aria-label` =
   `Excluir lançamento de {date}`.

**`frontend/src/App.tsx`** — replace the Reserva placeholder route with
`<ReservaPage />`; add the import.

## Data flow

1. Page mount → `listEmergencyFund()` + `listExpenses()` +
   `getMonthlyTarget(currentMonth)`. The `getMonthlyTarget` call
   creates-and-freezes the current month's row on first ever visit.
2. Deposit/withdraw submit → `POST /api/emergency-fund` with an explicit
   `kind`; the server writes the sign. → `refresh()`.
3. Meta config submit → `PUT /api/savings-target/:month`; the server
   recomputes `target_cents` against that month's income and returns the
   row. → `refresh()`.
4. Excluir → `DELETE /api/emergency-fund/:id` → `refresh()`.
5. `rollover_cents` is only ever computed at row-creation time; it is
   read, never recalculated by the page.

## Error handling

- Server validation failures → `400 { error }`. Data-layer `throw`s
  (bad amount, bad `pctOrFixed`) surface as Fastify's default 500 only
  if they slip past the route guards, which duplicate those checks — so
  in practice every bad input is a clean 400.
- The frontend `request()` helper throws `Error(body.error)` on non-2xx;
  each form catches and renders `.error-text`.
- The "withdrawal exceeds balance" warning is advisory frontend text —
  never blocks the request.

## Testing

TDD — one failing test at a time.

**Server**

- `server/src/savings/essential-average.test.ts` — ported vectors:
  - Aug/Jul/Jun essenciais 100k/200k/300k, plus a `nao-essencial` and an
    older row → `averageCents 200_000`, `monthsUsed 3`.
  - Gaps in the lookback (Aug, Jun, Apr have essenciais; Jul, May do
    not) → mean of the three present months, `monthsUsed 3`.
  - `[]` → `{ averageCents: 0, monthsUsed: 0 }`.
- `server/src/db/emergency-fund.test.ts`:
  - a deposit then a withdrawal → two rows, `Σ amountCents` is the net,
    the withdrawal row is stored negative.
  - `createDeposit` rejects `0` and negative amounts.
  - `createWithdrawal` rejects `0` and negative magnitudes.
  - soft-deleted entries drop out of `listEmergencyFundEntries`.
- `server/src/db/savings-target.test.ts` (ported from `savings.rs`):
  - no prior data → `getOrCreateMonthlyTarget` returns `pctOrFixed
    'pct'`, `pctValue 0`, `targetCents 0`, `rolloverCents 0`.
  - `updateMonthlyTargetConfig(month, 'pct', 20, null)` with 1,000,000
    income that month → `targetCents 200_000`.
  - `updateMonthlyTargetConfig(month, 'fixed', null, 150_000)` with
    income present → `targetCents 150_000`.
  - June target 200,000, June net saved 150,000 →
    `getOrCreateMonthlyTarget('2026-07').rolloverCents === 50_000` and it
    inherits `pctValue 20`.
  - June surplus (net saved 250,000) → July `rolloverCents === 0`.
  - June deposit 250,000 + withdrawal 100,000 (net 150,000) → July
    `rolloverCents === 50_000`.
  - target frozen: after `updateMonthlyTargetConfig('2026-06','pct',20,
    null)` with 1,000,000 income, adding another 1,000,000 of June income
    then `getOrCreateMonthlyTarget('2026-06')` still shows `targetCents
    200_000`.
- `server/src/routes/savings.test.ts` (mirrors `routes/income.test.ts`'s
  `authedApp()` helper): 401 unauthenticated on `GET /api/emergency-fund`;
  `POST` a deposit then a withdrawal, `GET` returns both with the right
  signs; `POST` with `kind: 'x'` → 400; `POST` with `amountCents: 0` →
  400; `DELETE /api/emergency-fund/:id` drops the row; `GET
  /api/savings-target/2026-08` returns a target object; `GET
  /api/savings-target/2026-8` → 400; `PUT /api/savings-target/2026-08`
  `{ pctOrFixed: 'pct', pctValue: 15 }` returns the updated target; `PUT`
  with `pctOrFixed: 'weekly'` → 400; a `DELETE` carrying
  `content-type: application/json` with an empty body still succeeds
  (regression guard).

**Frontend**

- `frontend/src/lib/reserva.test.ts`:
  - `essentialAverage` — the same three vectors as the server test,
    adapted to the `Expense` shape.
  - `reserveTiers(0, 0)` → `tier 'no-data'`, `progressPct 0`.
  - `reserveTiers(100_000, 100_000)` → `target3 300_000`, `target6
    600_000`, `tier 'below-3'`.
  - `reserveTiers(400_000, 100_000)` → `tier 'below-6'`,
    `progressPct` ≈ 66.
  - `reserveTiers(600_000, 100_000)` → `tier 'complete'`, `progressPct
    100`.
- `frontend/src/pages/ReservaPage.test.tsx` (mocks `../lib/api`):
  - renders the status card from a mocked balance + expenses (assert a
    formatted "Já guardado" value and the tier line).
  - the deposit form calls `createEmergencyFundEntry` once with
    `{ kind: 'deposit', date, amountCents: <parsed>, notes: null }`.
  - the withdrawal form calls it with `kind: 'withdrawal'`.
  - entering a withdrawal larger than the balance shows the inline
    warning text but the submit still calls the api.
  - the Meta Mensal config form calls `updateMonthlyTarget` with the
    current `YYYY-MM` and the chosen `pctOrFixed` / parsed value.
  - an Excluir click calls `deleteEmergencyFundEntry` with the row id.

## Files

New:

- `server/src/savings/essential-average.ts` + `.test.ts`
- `server/src/db/emergency-fund.ts` + `.test.ts`
- `server/src/db/savings-target.ts` + `.test.ts`
- `server/src/routes/savings.ts` + `.test.ts`
- `frontend/src/lib/reserva.ts` + `.test.ts`
- `frontend/src/pages/ReservaPage.tsx` + `.test.tsx`

Modified:

- `server/src/app.ts` — register the savings routes
- `frontend/src/lib/api.ts` — emergency-fund + savings-target client
- `frontend/src/App.tsx` — mount `ReservaPage`
- `docs/qa-checklist.md` — append Reserva checks
