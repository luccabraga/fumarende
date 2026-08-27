# fumarende — Câmbio module design

> Follow-up #1 to the Foundation plan
> (`docs/superpowers/plans/2026-08-13-foundation.md`). Its own
> brainstorm → spec → plan → implement cycle.

## Context

The Foundation plan shipped one fully wired vertical slice (Receitas /
income). Every other module is a placeholder page. This spec covers the
**Câmbio** module: manual entry of USD→BRL exchange-contract operations,
with the spread/IOF/VET math and a PTAX reference field.

Câmbio is the operation the owner runs once a month — a new job pays in
USD, converted to BRL via a bank câmbio contract — so it is the natural
first follow-up. The `exchange_contracts` table already exists in the
Foundation schema (`server/src/db/migrations/001_initial_schema.ts`),
carried over unchanged from the validated `stack-project` prototype. No
migration is needed.

The validated behavior reference is the prototype's
`stack-project/app/src-tauri/src/db/exchange_contracts.rs` (data layer +
tests) and `stack-project/app/src/lib/cambio-math.ts` (the arithmetic,
with tests). This module ports both to the fumarende stack.

This spec also folds in a small **Receitas correction**: the income form
currently captures only date / BRL amount / description, but the `income`
table also has `amount_usd_cents` and `source`. Those two fields are
added to the form here. (Linking an income row to the exchange contract
that produced it — `income.exchange_contract_id` — is deferred to a
later task.)

## Goals

- Manual CRUD (create / list / soft-delete — no edit) for exchange
  contracts, matching the prototype's data layer.
- Correct, tested spread math: gross BRL, total fees, net BRL, VET
  (valor efetivo total, i.e. net BRL per USD), and spread vs. PTAX in
  both BRL and percent.
- A live preview of that math in the entry form before saving.
- An all-time summary: total USD converted, total BRL net received,
  total fees, average VET, average PTAX, average spread %.
- Add `amount_usd_cents` and `source` to the Receitas entry form.

## Non-goals (this pass)

- **PTAX auto-fetch.** PTAX is a manual, optional number field. Fetching
  it from Banco Central's public API and populating `ptax_rate_cache`
  is a separate later task. The bank's own contract confirmation already
  prints the PTAX used, so manual entry is not a hardship.
- **PDF import.** `source_pdf_ref` stays a plain optional text field
  ("Nº comprovante / referência"). Statement/contract PDF import is
  Phase 2 (needs Claude extraction).
- **Editing contracts.** Create / list / soft-delete only, matching the
  prototype. A mistake is deleted and re-entered.
- **Income → contract linking.** `income.exchange_contract_id` stays
  unused by the UI this pass.
- **Month scoping.** The list and summary cover all contracts, newest
  first — identical to the current Receitas page. A month selector
  belongs in the nav shell (shared across pages) and is a later concern.
- **Annual fee projection.** The prototype showed `total fees × 12`;
  dropped as a guess.

## Architecture

Follows the Foundation module pattern exactly (pure logic → data layer →
routes → register in `app.ts`; frontend lib → api client → page → route
in `App.tsx`). Money is integer cents throughout. Rates
(`contracted_rate`, `ptax_rate`) are `REAL` / JS `number`, matching the
existing schema. Soft deletes only.

### Server

**`server/src/cambio/math.ts`** — pure, no DB. Port of the prototype's
`calcCambioPreview`:

```ts
interface CambioInput {
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate: number | null;
  iofCents: number;
  bankFeeCents: number;
}
interface CambioBreakdown {
  grossBrlCents: number;
  totalFeesCents: number;
  netBrlCents: number;
  vetRate: number;              // net BRL per USD, e.g. 4.9628 — never stored
  spreadBrlCents: number | null;
  spreadPct: number | null;
}
function calcCambio(input: CambioInput): CambioBreakdown;
```

Formulas (unchanged from the prototype):

- `grossBrlCents  = Math.round(amountUsdCents * contractedRate)`
- `totalFeesCents = iofCents + bankFeeCents`
- `netBrlCents    = grossBrlCents - totalFeesCents`
- `vetRate        = amountUsdCents > 0 ? netBrlCents / amountUsdCents : 0`
- if `ptaxRate` is a number `> 0`:
  - `spreadBrlCents = Math.round((ptaxRate - vetRate) * amountUsdCents)`
  - `spreadPct      = ((ptaxRate - vetRate) / ptaxRate) * 100`
  - else both `null`

**`server/src/db/exchange.ts`** — mirrors `server/src/db/income.ts`.

- `ExchangeContract` (camelCase view): `id`, `date`, `institution`,
  `operationType`, `amountUsdCents`, `contractedRate`,
  `ptaxRate: number | null`, `iofCents`, `bankFeeCents`, `netBrlCents`,
  `sourcePdfRef: string | null`, `notes: string | null`.
- `NewExchangeContract`: the same minus `id` and `netBrlCents`
  (`ptaxRate`, `sourcePdfRef`, `notes` optional).
- `createExchangeContract(db, input): number` — computes `netBrlCents`
  via `calcCambio`, inserts all columns, returns `lastInsertRowid`.
- `listExchangeContracts(db): ExchangeContract[]` —
  `WHERE deleted_at IS NULL ORDER BY date DESC, id DESC`.
- `softDeleteExchangeContract(db, id): void` — `UPDATE ... SET
  deleted_at = <ISO now> WHERE id = ?`.

The `exchange_contracts` table has no `payer` column (the prototype's
did; the Foundation schema dropped it). `source_pdf_ref` carries the
optional receipt/reference string.

**`server/src/routes/exchange.ts`** — mirrors
`server/src/routes/income.ts`. All routes `preHandler: requireAuth(db)`.

- `GET /api/exchange-contracts` → `listExchangeContracts(db)`
- `POST /api/exchange-contracts` → validate, then
  `createExchangeContract`, `reply.code(201).send({ id })`
- `DELETE /api/exchange-contracts/:id` →
  `softDeleteExchangeContract(db, Number(params.id))`, `{ ok: true }`

Validation (400 `{ error }` on failure, matching the income route's
style):

| field | rule |
|---|---|
| `date` | present, non-empty |
| `institution` | present, non-blank after trim |
| `operationType` | exactly `"compra"` or `"venda"` |
| `amountUsdCents` | integer, `> 0` |
| `contractedRate` | finite number, `> 0` |
| `ptaxRate` | `undefined` / `null`, or finite number `> 0` |
| `iofCents` | integer, `>= 0` (default 0 if omitted) |
| `bankFeeCents` | integer, `>= 0` (default 0 if omitted) |

Registered in `server/src/app.ts` immediately after
`registerIncomeRoutes(app, db)`.

### Frontend

**`frontend/src/lib/cambio.ts`** — a copy of `calcCambio` (same types,
same formulas) for the live form preview. Deliberate duplication: the
`server/` and `frontend/` workspaces share no package, the function is
~15 lines of arithmetic, and both copies carry the same test vectors.

**`frontend/src/lib/money.ts`** — add:

```ts
/** Parses a plain exchange rate: "5.0994" or "5,0994" -> 5.0994.
 *  No thousands grouping (rates are < 100). NaN on anything else. */
function parseRate(value: string): number;
```

Money inputs (USD amount, IOF, bank fee) reuse the existing pt-BR
`parseCentsFromInput`.

**`frontend/src/lib/api.ts`** — add:

- `interface ExchangeContract` — same shape as the server view type.
- `listExchangeContracts(): Promise<ExchangeContract[]>` →
  `GET /api/exchange-contracts`
- `createExchangeContract(input): Promise<{ id: number }>` →
  `POST /api/exchange-contracts`
- `deleteExchangeContract(id: number): Promise<{ ok: true }>` →
  `DELETE /api/exchange-contracts/${id}`
- extend `createIncome`'s input with `source?: string | null`.

**`frontend/src/pages/CambioPage.tsx`** — replaces
`<PlaceholderPage title="Câmbio" />`. Same structure as
`ReceitasPage.tsx` (local `useState`, `refresh()` on mount, form submit
→ api call → refresh, inline error text).

Form fields:

- `date` (`<input type="date">`)
- `institution` (`<select>`: Banco Inter, Wise, Avenue, Nomad, Outro)
- `operationType` (`<select>`: `compra` "Compra (recebo BRL)",
  `venda` "Venda (envio BRL)")
- `amountUsd` (text, pt-BR money)
- `contractedRate` (text, rate)
- `ptaxRate` (text, rate, optional — placeholder "PTAX (opcional)")
- `iof` (text, pt-BR money, default "0")
- `bankFee` (text, pt-BR money, default "0")
- `sourcePdfRef` (text, optional — "Nº comprovante / referência")
- `notes` (text, optional)

Live preview block under the form, recomputed on every input via
`calcCambio` from `frontend/src/lib/cambio.ts`. Hidden until both
`amountUsd` and `contractedRate` parse to positive values. Shows:
BRL bruto, IOF + tarifas, **BRL líquido**, VET (`formatCentsBRL(round(
vetRate * 100))` per USD), spread vs PTAX (`— (sem PTAX)` when null,
otherwise `R$X (Y.YY%)`).

Contract list (card), newest first, one row each:
`{date} — {institution} — {formatCentsUSD(amountUsdCents)} →
{formatCentsBRL(netBrlCents)} (VET {(netBrlCents/amountUsdCents).toFixed(4)})`,
an operation-type label, and an "Excluir" button
(`onClick` → `api.deleteExchangeContract` → `refresh`).

Summary card above/below the list, over **all** contracts (hidden when
there are none):

- Total convertido — `Σ amountUsdCents` (USD)
- BRL líquido recebido — `Σ netBrlCents`
- Total em taxas — `Σ (iofCents + bankFeeCents)`
- VET médio — `Σ netBrlCents / Σ amountUsdCents`
- PTAX média — mean of `ptaxRate` over rows where it is non-null
  (omitted when none have it)
- Spread médio — `((avgPtax - avgVet) / avgPtax) * 100` (with avgPtax)

**`frontend/src/pages/ReceitasPage.tsx`** — add two optional inputs to
the existing form: "Valor (US$)" (pt-BR money → `amountUsdCents`) and
"Origem" (text → `source`). Pass both through `api.createIncome`
(omit / send `null` when blank). In the list rows, show
`formatCentsUSD(amountUsdCents)` next to the BRL amount when present.

**`frontend/src/App.tsx`** — replace the Câmbio placeholder `<Route>`
element with `<CambioPage />`; add the import.

## Data flow

1. User fills the Câmbio form. On each keystroke the page parses the
   money/rate fields and calls `calcCambio` (frontend copy) to render
   the preview. No network.
2. On submit, the page posts parsed integer-cents + number-rate values
   to `POST /api/exchange-contracts`.
3. The route validates, then `createExchangeContract` recomputes
   `netBrlCents` server-side via `calcCambio` (server copy) and inserts.
   The stored `net_brl_cents` is always the server's computation, never
   a client-supplied total.
4. The page calls `refresh()` → `GET /api/exchange-contracts` →
   re-renders list + summary.
5. "Excluir" → `DELETE /api/exchange-contracts/:id` → `refresh()`.

## Error handling

- Server validation failure → `400 { error: "<message>" }`. Unexpected
  DB errors bubble to Fastify's default 500. Missing/invalid session →
  `401` from `requireAuth` (unchanged).
- The frontend `request()` helper already throws `Error(body.error)` on
  a non-2xx response; both pages catch and render `.error-text`.
- Preview with incomplete input renders nothing (no error shown) —
  matches the prototype.

## Testing

TDD — one failing test at a time, per
`superpowers:test-driven-development`.

**Server**

- `server/src/cambio/math.test.ts` — ported vectors:
  - $5,000.00 (`500_000`), rate `5.0994`, PTAX `5.12`, IOF `65_318`,
    fee `3_000` → `grossBrlCents 2_549_700`, `totalFeesCents 68_318`,
    `netBrlCents 2_481_382`, `vetRate ≈ 4.962764` (5 dp),
    `spreadPct ≈ 3.07` (2 dp), `spreadBrlCents ===
    Math.round((5.12 - vetRate) * 500_000)`.
  - `ptaxRate: null` → `spreadBrlCents` and `spreadPct` both `null`.
  - `amountUsdCents: 0` → `vetRate === 0`.
- `server/src/db/exchange.test.ts` (ported from
  `exchange_contracts.rs`): create then list computes `netBrlCents`
  correctly (`2_481_382` for the sample); rejects negative
  `amountUsdCents`; rejects blank `institution`; rejects an
  `operationType` other than compra/venda; soft-deleted rows excluded
  from `listExchangeContracts`.
- `server/src/routes/exchange.test.ts` (mirrors `routes/income.test.ts`,
  same `authedApp()` helper): 401 unauthenticated; create + list when
  authenticated; 400 on non-positive `amountUsdCents`; 400 on invalid
  `operationType`; delete removes the row from the list; a `DELETE`
  carrying `content-type: application/json` with an empty body still
  succeeds (regression guard, matching the income suite).

**Frontend**

- `frontend/src/lib/cambio.test.ts` — the same three vectors as the
  server math test.
- `frontend/src/lib/money.test.ts` — add `parseRate`: `"5.0994"` →
  `5.0994`; `"5,0994"` → `5.0994`; `"abc"` → `NaN`; `""` → `NaN`.
- `frontend/src/pages/CambioPage.test.tsx` (mocks `../lib/api`):
  renders the form; typing a USD amount + rate shows a computed
  "BRL líquido" in the preview; submitting calls
  `api.createExchangeContract` once with the parsed integer-cents and
  numeric rate; an "Excluir" click calls `api.deleteExchangeContract`
  with the row id.
- `frontend/src/pages/ReceitasPage.test.tsx` — extend: filling "Valor
  (US$)" and "Origem" and submitting calls `api.createIncome` with
  `amountUsdCents` and `source` set.

## Files

New:

- `server/src/cambio/math.ts`, `server/src/cambio/math.test.ts`
- `server/src/db/exchange.ts`, `server/src/db/exchange.test.ts`
- `server/src/routes/exchange.ts`, `server/src/routes/exchange.test.ts`
- `frontend/src/lib/cambio.ts`, `frontend/src/lib/cambio.test.ts`
- `frontend/src/pages/CambioPage.tsx`,
  `frontend/src/pages/CambioPage.test.tsx`

Modified:

- `server/src/app.ts` — register the exchange routes
- `frontend/src/lib/api.ts` — exchange-contract client + `createIncome`
  `source`
- `frontend/src/lib/money.ts` — `parseRate`
- `frontend/src/lib/money.test.ts` — `parseRate` cases
- `frontend/src/pages/ReceitasPage.tsx` — USD + source inputs
- `frontend/src/pages/ReceitasPage.test.tsx` — USD + source assertions
- `frontend/src/App.tsx` — mount `CambioPage`
