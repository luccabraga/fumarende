# fumarende — PDF statement import design

> **Phase 2, sub-project 2.3.** Third of four Phase 2 slices
> (2.1 foundation+analysis ✅ / 2.2 auto-categorization ✅ /
> **2.3 PDF statement import** / 2.4 web-search macro context). Its own
> brainstorm → spec → plan → implement cycle. Depends on 2.1's Claude
> client + cost ledger + cap, and 2.2's `categorize()` pipeline.

## Context

Manual expense entry is the main friction point. This slice lets the
user upload a Brazilian credit-card statement PDF, have Claude extract
the line items, review/edit them in a table, and confirm the ones to
keep — each confirmed row becoming an ordinary expense that flows
through the 2.2 categorization pipeline.

Decisions from the 2026-08-31 brainstorm:

- **Extraction:** send the raw PDF as a native document content block to
  `claude-sonnet-5` (no local PDF parser dependency). ~$0.03–0.10 per
  statement; an occasional operation.
- **UI:** a collapsible "Importar extrato (PDF)" section on the Gastos
  page — no new nav route.
- **Persistence:** in-memory only. No stored PDFs, no `import_batches`
  table, no migration. Close the tab mid-review → re-upload.
- **Line filtering:** Claude tags each row's `kind` (purchase / payment
  / fee / fx); the review table shows every row but pre-unchecks the
  non-purchases; the user can re-check any.

## Goals

- `extractStatement(cfg, pdfBase64, deps?)` — one Sonnet call, returns a
  validated `{ rows, warnings, inputTokens, outputTokens }`; writes one
  `claude_api_calls` row (`endpoint: 'import'`).
- `callClaude` accepts a structured content-block array for `user` (for
  the document block), backward-compatible with the string form.
- `POST /api/expenses/import-preview` — raised body limit, decode-size
  guard, extraction + per-row rule-categorization + duplicate flag.
- `POST /api/expenses/import-confirm` — each checked row →
  `createExpense` (blank category resolved via 2.2's `categorize`); an
  installment statement line becomes **one** expense.
- A `StatementImportSection` on Gastos: file picker → review table
  (editable, checkboxes, kind badges, duplicate tags) → "Importar N
  selecionados" → the Gastos list refreshes.

## Non-goals

- **No stored PDFs, no `import_batches` table, no migration, no resume.**
- **No installment-series expansion.** A "PARC 03/12" line is a single
  charge on this statement — it becomes one expense; the "(3/12)" note
  is folded into the description, never turned into a 12-row series.
- No multi-file / multi-statement upload in one action.
- No CSV import (a separate future slice).
- No Haiku option for extraction (accuracy matters; it's rare).
- No reconciliation against existing expenses beyond a per-row
  `duplicate` flag (exact date+amount+description match).
- Not touching `exchange_contracts.source_pdf_ref` (that column is for a
  future câmbio-PDF feature, unrelated).
- No per-row Claude categorization in the preview — only the free rule
  pass; unknown merchants are categorized on confirm (or left blank),
  exactly like manual entry.

## Architecture

### `callClaude` extension — `server/src/ai/client.ts`

```ts
type ContentBlock = { type: string; [k: string]: unknown };

export async function callClaude(
  cfg: AiConfig,
  args: { system: string; user: string | ContentBlock[]; maxTokens?: number },
  fetchImpl?: typeof fetch,
): Promise<ClaudeResult>;
```

- When `args.user` is a string → `messages: [{ role: 'user', content:
  args.user }]` (unchanged).
- When it is an array → `messages: [{ role: 'user', content: args.user }]`
  (the array is the content blocks verbatim).
- Everything else (headers, error mapping, `usage` parsing) unchanged.
- 2.1's and 2.2's callers pass a string and are unaffected.

### Extraction — `server/src/import/extract.ts`

```ts
export type LineKind = 'purchase' | 'payment' | 'fee' | 'fx';

export interface ExtractedRow {
  date: string;                 // YYYY-MM-DD
  description: string;
  amountCents: number;          // always positive
  kind: LineKind;
  installment: { n: number; total: number } | null;
}

export interface StatementExtraction {
  rows: ExtractedRow[];
  warnings: string[];           // human-readable notes, e.g. "3 linhas ilegíveis ignoradas"
  inputTokens: number;
  outputTokens: number;
}

export async function extractStatement(
  cfg: AiConfig,
  pdfBase64: string,
  deps?: { now?: Date; fetchImpl?: typeof fetch; db?: Database.Database },
): Promise<StatementExtraction>;
```

Flow:

1. `cfg.apiKey === null` → throw `ClaudeNotConfiguredError`.
2. If `deps.db` given and `isOverCap(db, cfg, now)` → throw
   `BudgetExceededError`.
3. `callClaude(cfg, { system: SYSTEM, user: [documentBlock, textBlock],
   maxTokens: 4000 }, deps.fetchImpl)` where
   - `documentBlock = { type: 'document', source: { type: 'base64',
     media_type: 'application/pdf', data: pdfBase64 } }`
   - `textBlock = { type: 'text', text: USER_INSTRUCTION }`
   - `SYSTEM`: "Você extrai os lançamentos de uma fatura de cartão de
     crédito brasileira. Responda APENAS com um array JSON minificado.
     Cada item: {\"date\":\"YYYY-MM-DD\", \"description\": string,
     \"amountCents\": inteiro positivo, \"kind\":
     \"purchase\"|\"payment\"|\"fee\"|\"fx\", \"installment\":
     {\"n\":int,\"total\":int} | null}. Converta valores em reais
     (R$ 1.234,56 → 123456). Use o ano do período da fatura; se a linha
     só tiver DD/MM, infira o ano. kind: \"payment\" para pagamentos
     recebidos, estornos e créditos; \"fee\" para IOF, anuidade, juros e
     multa; \"fx\" para compras em moeda estrangeira; \"purchase\" para
     o resto. installment a partir de notações como \"PARC 03/12\" ou
     \"(3/12)\"."
   - `USER_INSTRUCTION`: "Extraia todos os lançamentos desta fatura."
4. On `ClaudeUpstreamError`: if `deps.db`, write a `claude_api_calls`
   error row (`endpoint: 'import'`, model `cfg.model`, tokens 0); rethrow.
5. Parse the response text: strip a leading/trailing ```json fence, then
   `JSON.parse`. Not an array → `{ rows: [], warnings: ['resposta da IA
   ilegível'], ... }`.
6. Validate each element; keep the good ones, count the rest:
   - `date` matches `/^\d{4}-\d{2}-\d{2}$/`
   - `description` non-empty string (trimmed)
   - `amountCents` positive integer
   - `kind` ∈ the 4 values (default `'purchase'` if missing/other →
     still counts as valid, coerced)
   - `installment` is `null` or `{ n, total }` with positive integers
     (else coerce to `null`)
   - dropped count > 0 → push `"${n} linha(s) não reconhecida(s) foram
     ignoradas"` to `warnings`.
7. If `deps.db`, write a `claude_api_calls` ok row (`endpoint: 'import'`,
   model `cfg.model`, tokens from the call, cost via
   `estimateCostUsdCents` / 0 on unpriced).
8. Return `{ rows, warnings, inputTokens, outputTokens }`.

### Type inference — `server/src/import/expense-type.ts`

```ts
export const ESSENTIAL_CATEGORIES = new Set(['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação']);
export function inferType(category: string): 'essencial' | 'nao-essencial';
```

`inferType('')` → `'nao-essencial'` (unknown). Used only to seed the
review table's Tipo select; the user can change it.

### Route: `POST /api/expenses/import-preview`

In `routes/expenses.ts`, `{ preHandler: requireAuth(db), bodyLimit: 20 *
1024 * 1024 }`.

Body: `{ dataBase64: string; filename?: string }`.

1. `dataBase64` not a non-empty string → `400 { error: 'dataBase64 is
   required' }`.
2. Decoded byte length (`Buffer.from(dataBase64, 'base64').length`) >
   12 MB → `400 { error: 'PDF acima de 12 MB' }`.
3. `try { extraction = await extractStatement(aiConfig, dataBase64, {
   db }) }`
   - `ClaudeNotConfiguredError` → `503 { error: 'IA não configurada' }`
   - `BudgetExceededError` → `429 { error: 'Limite mensal de IA
     atingido', monthToDateUsdCents, capUsdCents }`
   - `ClaudeUpstreamError` → `502 { error: 'Falha ao ler o PDF' }`
4. `rules = listRules(db)`; existing non-deleted expenses loaded once as
   a `Set` of `"${date}|${amountCents}|${description}"` keys.
5. For each `ExtractedRow` build a `PreviewRow`:

```ts
interface PreviewRow extends ExtractedRow {
  suggestedCategory: string;                 // matchRule(...)?.category ?? ''
  suggestedType: 'essencial' | 'nao-essencial';
  duplicate: boolean;
}
```

6. `200 { rows: PreviewRow[], warnings: string[] }`.

### Route: `POST /api/expenses/import-confirm`

`{ preHandler: requireAuth(db) }` (normal body limit — a confirm payload
is small JSON).

Body: `{ rows: ConfirmRow[] }`,

```ts
interface ConfirmRow {
  date: string;
  description: string;   // the frontend has already folded "(n/total)" in when relevant
  amountCents: number;
  category: string;      // '' allowed → resolved via categorize()
  type: 'essencial' | 'nao-essencial';
}
```

1. `rows` not a non-empty array → `400`.
2. Each row validated like the manual create route (`date` present,
   `amountCents` positive int, `type` one of the two, `description`
   non-blank). Any bad row → `400 { error, index }`, nothing inserted.
3. In one `db.transaction`:
   - for each row: `let category = row.category`; if blank →
     `category = (await categorize(db, aiConfig, { description:
     row.description })).category ?? ''`.

     *(Note: `categorize` is async and may call Claude; run the
     per-row categorize calls **before** opening the transaction —
     collect resolved categories into an array, then insert
     synchronously inside the transaction. better-sqlite3 transactions
     must be synchronous.)*
   - `createExpense(db, { date, description, amountCents, category,
     type, paymentMethod: 'Crédito', installmentTotal: null, notes:
     null })`.
4. `200 { created: rows.length }`.

`registerExpenseRoutes` already receives `aiConfig` (2.2). No signature
change.

### Frontend

**`frontend/src/lib/api.ts`:**

```ts
export type ImportLineKind = 'purchase' | 'payment' | 'fee' | 'fx';
export interface ImportPreviewRow {
  date: string;
  description: string;
  amountCents: number;
  kind: ImportLineKind;
  installment: { n: number; total: number } | null;
  suggestedCategory: string;
  suggestedType: 'essencial' | 'nao-essencial';
  duplicate: boolean;
}
export interface ImportConfirmRow {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: 'essencial' | 'nao-essencial';
}
export function importPreviewStatement(
  dataBase64: string,
  filename?: string,
): Promise<{ rows: ImportPreviewRow[]; warnings: string[] }> {
  return request('/api/expenses/import-preview', {
    method: 'POST',
    body: JSON.stringify({ dataBase64, filename }),
  });
}
export function importConfirmExpenses(
  rows: ImportConfirmRow[],
): Promise<{ created: number }> {
  return request('/api/expenses/import-confirm', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}
```

**`frontend/src/components/StatementImportSection.tsx`** — a
`<div className="card">` with a mono `<h2>Importar extrato (PDF)</h2>`:

- State: `phase: 'idle' | 'reading' | 'review'`, `rows: EditableRow[]`,
  `warnings: string[]`, `error: string | null`, `result: string | null`,
  `confirming: boolean`. `EditableRow = ImportPreviewRow & { checked:
  boolean; category: string; type: 'essencial'|'nao-essencial';
  date: string; description: string; amountText: string }`.
- **File input**: `<input type="file" accept="application/pdf,.pdf"
  aria-label="Arquivo do extrato">`. On change:
  - `phase='reading'`, `error=null`.
  - `FileReader.readAsDataURL(file)` → on load, strip the
    `data:...;base64,` prefix → `api.importPreviewStatement(base64,
    file.name)`.
  - success → build `EditableRow[]`: `checked = kind === 'purchase' &&
    !duplicate`; `category = suggestedCategory`; `type = suggestedType`;
    `date` from the row; `description` from the row with ` (${n}/${total})`
    appended when `installment` is set; `amountText =
    formatCentsBRL(amountCents)` (a single editable text field,
    re-parsed with `parseCentsFromInput` on confirm — same convention as
    the manual Gastos amount field). `phase='review'`.
  - error → map by `err.status`: 503 → "Configure a chave da IA no
    servidor."; 429 → "Limite mensal de IA atingido."; 502 → "Não
    consegui ler este PDF. Tente outro arquivo."; 400 → `err.message`;
    else → "Erro ao processar o PDF." `phase='idle'`.
- **Review table** (`phase==='review'`): one row per `EditableRow`:
  - checkbox (`aria-label={\`Incluir ${r.description}\`}`)
  - `<input type="date">` bound to `r.date`
  - `<input type="text">` bound to `r.description`
  - `<input type="text">` bound to `r.amountText` (parsed with
    `parseCentsFromInput` on confirm)
  - `<select>` category: `<option value="">Automático</option>` +
    `CATEGORIES`
  - `<select>` type: essencial / nao-essencial
  - a kind badge: `{ purchase:'Compra', payment:'Pagamento',
    fee:'Taxa', fx:'Câmbio' }[r.kind]`
  - `r.duplicate && <span>possível duplicata</span>`
  - `warnings.length > 0` → a muted line listing them.
  - **"Importar N selecionados"** button (`N` = checked count),
    `disabled={confirming || N === 0}`. On click:
    - build `ImportConfirmRow[]` from checked rows: `amountCents =
      parseCentsFromInput(r.amountText)`; skip / block if any is NaN or
      ≤ 0 (set `error`, don't send).
    - `api.importConfirmExpenses(rows)` → success:
      `result = \`${created} gasto(s) importado(s)\``, `phase='idle'`,
      `rows=[]`, call `onImported?.()`.
    - error → `error` from `err.message`.
- `<StatementImportSection onImported={refresh} />` rendered on
  `GastosPage` after `<CategoryRulesSection />`.

## Data flow

1. User picks a PDF → browser reads it as base64 → `POST
   /import-preview`.
2. Server: `extractStatement` (one Sonnet call, ledger row) → rule
   categorization + duplicate flags → `{ rows, warnings }`.
3. Review table: user unchecks noise, fixes categories/amounts/dates.
4. "Importar" → `POST /import-confirm` → per-row `categorize` for blanks
   → `createExpense` for each → `{ created }`.
5. `GastosPage.refresh()` shows the new expenses (already categorized).

## Error handling

| Situation | Server | UI |
|---|---|---|
| No API key | `503` from `/import-preview` | "Configure a chave da IA no servidor." |
| Monthly cap reached | `429` from `/import-preview` (no call) | "Limite mensal de IA atingido." |
| Anthropic error / unreadable PDF | `502`; `claude_api_calls` error row | "Não consegui ler este PDF…" |
| PDF > 12 MB / empty upload | `400` | the message |
| Some statement lines unparseable | `200` with `warnings` | muted "N linha(s) ignoradas" |
| Bad row on confirm | `400 { error, index }`, nothing inserted | "Linha N inválida: …" |
| Amount field left unparseable in review | — | inline error, confirm blocked |

`/import-confirm` needs no API key when every row already has a category;
a blank category triggers `categorize` (which itself degrades to
uncategorized without a key).

## Testing

**Server:**

- `ai/client.test.ts` — add: `callClaude` with `user` as a
  content-block array sends it through as `messages[0].content`
  unchanged; string form still works.
- `import/expense-type.test.ts` — `inferType` maps the 5 essential
  categories to `'essencial'`, everything else (incl. `''`) to
  `'nao-essencial'`.
- `import/extract.test.ts` — injected fetch:
  - builds a `document` block with `media_type: 'application/pdf'` and
    the given base64, plus a text block.
  - parses a clean JSON array into `ExtractedRow[]`; strips a ```json
    fence.
  - a row with a bad date / negative amount is dropped and a warning is
    added; a non-array reply → `rows: []` + a warning.
  - `installment` `{n,total}` kept; a malformed `installment` coerced to
    `null`.
  - with `deps.db`: a success writes one `endpoint='import'` ok row; an
    HTTP 500 writes one `error` row and rethrows `ClaudeUpstreamError`.
  - `apiKey: null` → `ClaudeNotConfiguredError`, no fetch.
  - `deps.db` over the cap → `BudgetExceededError`, no fetch.
- `routes/expenses.test.ts` — add:
  - `POST /import-preview` with no key → `503`; `{ dataBase64: '' }` →
    `400`; a `dataBase64` that decodes to > 12 MB → `400`.
  - `POST /import-confirm` with two rows (one `category: ''` + a seeded
    `padaria` rule, one explicit category) → `200 { created: 2 }`, both
    expenses listed with the right categories, `paymentMethod` `'Crédito'`.
  - `POST /import-confirm` with a row carrying `description: 'X (3/12)'`
    and no `installmentTotal` → exactly **one** expense row (no
    splitting).
  - `POST /import-confirm` `{ rows: [{ date: 'bad', ... }] }` → `400`,
    nothing inserted.
  - `POST /import-confirm` `{ rows: [] }` → `400`.

**Frontend:**

- `components/StatementImportSection.test.tsx`:
  - picking a file calls `importPreviewStatement` with the stripped
    base64; while pending a "Lendo…" state shows.
  - the review table renders one row per preview row; a `payment`/`fee`
    row and a `duplicate` row start unchecked, a plain `purchase` starts
    checked.
  - editing a category select + clicking "Importar N selecionados"
    calls `importConfirmExpenses` with only the checked rows and the
    edited category; on success `onImported` fires and a result line
    shows.
  - a preview rejection with `{ status: 429 }` shows the limit warning.
  - `warnings` from the preview render as a muted line.
- `pages/GastosPage.test.tsx` — `beforeEach` also stubs
  `importPreviewStatement` / `importConfirmExpenses` (defensive; the
  section makes no call on mount). Existing assertions unaffected.

**End-to-end — `scripts/qa-e2e.sh`** (isolated server, **no API key**):

- `POST /api/expenses/import-preview {"dataBase64":"JVBERi0xLjQK"}` →
  `503` (no key).
- `POST /api/expenses/import-preview {"dataBase64":""}` → `400`.
- `POST /api/expenses/import-confirm` with one valid row (seed a
  `mercado` rule first) → `200 { created: 1 }`; `GET /api/expenses`
  shows it with category `Alimentação` and `paymentMethod` `Crédito`.
- `POST /api/expenses/import-confirm {"rows":[{"date":"nope",...}]}` →
  `400`.
- `POST /api/expenses/import-confirm {"rows":[]}` → `400`.

**Live smoke** (key configured): on the Gastos page, upload a real
credit-card statement PDF → within a few seconds a review table appears
with the month's charges; payments/fees pre-unchecked; confirm a few →
they land in the expense list categorized; the Análise "IA este mês"
figure rises by a few cents; a `claude_api_calls` row with
`endpoint='import'` exists.

## Files

**New — server:**
- `server/src/import/extract.ts` + `.test.ts`
- `server/src/import/expense-type.ts` + `.test.ts`

**Modified — server:**
- `server/src/ai/client.ts` (+ `.test.ts`) — `user` may be a
  content-block array
- `server/src/routes/expenses.ts` (+ `.test.ts`) — `import-preview`
  and `import-confirm` routes
- (no `app.ts` change — `registerExpenseRoutes` already gets `aiConfig`)

**New — frontend:**
- `frontend/src/components/StatementImportSection.tsx` + `.test.tsx`

**Modified — frontend:**
- `frontend/src/lib/api.ts` — 2 types + 2 fns
- `frontend/src/pages/GastosPage.tsx` (+ `.test.tsx`) — render the
  section

**Modified — repo:**
- `scripts/qa-e2e.sh` — import section (no-key + confirm assertions)
- `docs/qa-checklist.md` — 2.3 section + header counts
- `README.md` — mark slice 3 done

## Security / cost notes

- No new secret. Extraction is one Sonnet call on the existing key +
  cap + ledger (`endpoint: 'import'`). ~$0.03–0.10 per statement.
- The **entire PDF is sent to Anthropic** — a credit-card statement
  contains account numbers, the cardholder name, and every transaction.
  This is inherent to the feature and is the user's explicit action
  (picking the file and clicking import). The PDF is held in memory for
  one request and never written to disk or the database; only the
  confirmed expense rows are persisted.
- `bodyLimit` is raised only on `/import-preview` (20 MB) — every other
  route keeps Fastify's 1 MB default.
- The confirm step reuses `createExpense`'s existing validation; a
  malformed row aborts the whole batch (transaction) rather than
  inserting a partial set.
