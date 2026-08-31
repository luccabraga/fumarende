# fumarende — auto-categorization design

> **Phase 2, sub-project 2.2.** Second of four Phase 2 slices
> (2.1 foundation+analysis ✅ / **2.2 auto-categorization** / 2.3 PDF
> import / 2.4 web-search macro context). Its own brainstorm → spec →
> plan → implement cycle. Depends on 2.1's Claude client + cost ledger.

## Context

`category_rules` (`id, keyword, category, deleted_at`) has existed since
migration 001, unused — the Phase 1 spec reserved the matching logic for
Phase 2. Today `expenses.category` is `TEXT NOT NULL` and the Gastos
form forces a pick from a fixed list of 11 categories
(`frontend/src/lib/expenses.ts` `CATEGORIES`), so an uncategorized
expense is not currently possible.

This slice makes `category` optional at entry time and fills it in
automatically: a free keyword-rule pass first, then a cheap Claude
(Haiku) fallback for unknown merchants, which also teaches a new rule so
the same merchant is free next time.

Decisions from the 2026-08-31 brainstorm:

- **Trigger:** on expense create **and** a "Categorizar pendentes" batch
  button on the Gastos page.
- **Rule vs Claude:** a keyword rule always wins (instant, free); Claude
  is consulted only when no rule matches.
- **Confirmation:** auto-apply. If Claude is not confident, leave the
  category blank (it lands in "pendentes") rather than guessing.
- **Model:** `claude-haiku-4-5` for categorization (analysis keeps
  `claude-sonnet-5`).

## Goals

- `categorize(db, cfg, { description }, deps?)` — rule pass, then Haiku
  fallback, returning a known category or `null`.
- A high-confidence Claude answer auto-creates a `{keyword → category}`
  rule.
- `POST /api/expenses` accepts a blank/absent `category` and resolves it
  before insert (one call per installment group).
- `POST /api/expenses/categorize-pending` — batch over blank-category
  expenses, deduped by description, cap-aware.
- `GET / POST / DELETE /api/category-rules` — CRUD for the rule list.
- Gastos page: an "Automático" default in the category select, a
  "Categorizar pendentes (n)" button, `— sem categoria` on blank rows,
  and a "Regras de categoria" management section.
- Categorization spend flows through the existing `claude_api_calls`
  ledger, the same monthly cap, and the "IA este mês" line.

## Non-goals

- **No review queue.** Claude's high-confidence pick is written
  directly; low-confidence leaves the row blank.
- **No re-categorization** of expenses that already have a category
  (only `category = ''` rows are touched).
- **No new `expenses` column**, **no migration.** `category_rules`
  already exists; "uncategorized" is `category = ''`.
- **No Claude guess for `type`** (essencial / não-essencial) — that
  stays a manual field.
- **No streaming, no tool use, no web search** — one Haiku request per
  unknown merchant.
- **No bulk rule import**, no rule editing (delete + re-add).
- Claude-created rules are not visually distinguished from user-created
  ones in v1 (no `created_by` column).
- Creating an expense must **never fail** because of the AI (cap
  reached, key missing, upstream error) — it just stays uncategorized.

## Architecture

### Config

`server/src/config.ts` — `AiConfig` gains one field:

```ts
categorizeModel: string; // FUMARENDE_AI_CATEGORIZE_MODEL, default 'claude-haiku-4-5'
```

`NOT_CONFIGURED_AI` and `loadConfig` set it. Existing tests that deep-
equal `config.ai` get the new key added.

### Cost table

`server/src/ai/cost.ts` — add Haiku to `MODEL_RATES_USD_PER_MTOK`:

```ts
'claude-haiku-4-5': { input: 1, output: 5 },
```

(`estimateCostUsdCents` already throws on an unpriced model and callers
already tolerate that with `cost = 0`.)

### Rule matching — `server/src/categorize/rules.ts`

```ts
export interface CategoryRule { id: number; keyword: string; category: string }

export function listRules(db: Database.Database): CategoryRule[];      // id ASC, not deleted
export function addRule(db, keyword: string, category: string): CategoryRule;
export function deleteRule(db: Database.Database, id: number): void;   // soft delete
export function matchRule(rules: CategoryRule[], description: string): CategoryRule | null;
```

- `matchRule`: lowercase `description`; return the **first** rule (by the
  array's order, i.e. `id ASC`) whose lowercased `keyword` is a
  non-empty substring of it; else `null`.
- `addRule`: trims inputs; rejects a blank keyword or a `category` not in
  the shared known-categories list (see below); lowercases the stored
  keyword; if an identical non-deleted `(keyword, category)` already
  exists, returns it instead of inserting a duplicate.

### Known categories — `server/src/categorize/categories.ts`

```ts
export const CATEGORIES = [
  'Moradia', 'Alimentação', 'Delivery', 'Transporte', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Vestuário', 'Outros',
] as const;
export type Category = (typeof CATEGORIES)[number];
export function isCategory(v: unknown): v is Category;
```

The frontend already has the same list in `frontend/src/lib/expenses.ts`;
the two are kept in sync by hand (a 3-line unit test on each side
asserts the array, and a comment in each file points at the other). Not
worth a shared package for 11 strings.

### Claude fallback — `server/src/categorize/claude-categorize.ts`

```ts
export interface ClaudeCategoryGuess {
  category: Category | null;
  confidence: 'high' | 'low';
  keyword: string | null; // lowercased merchant token to save as a rule; null when unsure
}

export interface ClaudeCategorizeOutcome {
  guess: ClaudeCategoryGuess;
  inputTokens: number;
  outputTokens: number;
}

export async function claudeCategorize(
  cfg: AiConfig,
  description: string,
  fetchImpl?: typeof fetch,
): Promise<ClaudeCategorizeOutcome>;
```

It calls `callClaude` with `{ ...cfg, model: cfg.categorizeModel }` and
returns that call's token counts alongside the parsed guess, so the
orchestrator can write an accurate ledger row.

- Builds a system prompt: "You classify a Brazilian credit-card expense
  description into exactly one of these categories: <list>. Reply with
  ONLY minified JSON `{\"category\": <one of the list or null>,
  \"confidence\": \"high\"|\"low\", \"keyword\": <short lowercased
  merchant token or null>}`. Use `null` + `low` when the description is
  too vague."
- User message: the raw `description`.
- `callClaude(cfg with model = cfg.categorizeModel, { system, user, maxTokens: 120 })`.
- Parse: `JSON.parse` the response text (strip a leading/trailing code
  fence if present). Validate: `category` is `null` or `isCategory`;
  `confidence` is `'high'|'low'` (default `'low'`); `keyword` is a
  non-empty string or `null`. Any parse/validation failure →
  `{ category: null, confidence: 'low', keyword: null }` (never throws
  for a bad reply; a network/HTTP failure still throws
  `ClaudeUpstreamError` from `callClaude` — the caller handles it).

### Orchestrator — `server/src/categorize/categorize.ts`

```ts
export interface CategorizeResult {
  category: Category | null;
  source: 'rule' | 'claude' | 'none';
}

export async function categorize(
  db: Database.Database,
  cfg: AiConfig,
  input: { description: string },
  deps?: { now?: Date; fetchImpl?: typeof fetch; rules?: CategoryRule[] },
): Promise<CategorizeResult>;
```

Flow:

1. `rules = deps.rules ?? listRules(db)`. `matchRule` → hit:
   `{ category, source: 'rule' }`. Done. No Claude, no ledger row.
2. No rule. If `cfg.apiKey === null` → `{ category: null, source: 'none' }`.
3. **Cap check** — `isOverCap(db, cfg, deps.now)` (from `ai/budget.ts`)
   → `{ category: null, source: 'none' }` (no call, no throw).
4. `try { outcome = await claudeCategorize(cfg, description, deps.fetchImpl) }`
   - `ClaudeUpstreamError` → write a `claude_api_calls` error row
     (`endpoint: 'categorize'`, model `cfg.categorizeModel`, tokens 0),
     return `{ category: null, source: 'none' }` (swallow —
     categorization is best-effort).
5. Write a `claude_api_calls` ok row (`endpoint: 'categorize'`, model =
   `cfg.categorizeModel`, `outcome.inputTokens` / `outcome.outputTokens`,
   cost via `estimateCostUsdCents` / 0 on unpriced).
6. `outcome.guess.confidence === 'high' && outcome.guess.category !== null`:
   - if `outcome.guess.keyword` is a non-empty string → `addRule(db,
     outcome.guess.keyword, outcome.guess.category)` (best-effort; ignore
     a duplicate).
   - return `{ category: outcome.guess.category, source: 'claude' }`.
7. Otherwise → `{ category: null, source: 'none' }`.

`categorize` is the single choke point; the create route and the batch
route both call it.

### Expense create — relax + resolve

`server/src/db/expenses.ts`:
- `validate()` — drop the `category` non-blank check. `category` may be
  `''`. Everything else unchanged.
- `NewExpense.category` stays `string` (callers pass `''`).
- `createExpense` unchanged otherwise — it already writes whatever
  `category` it is given to every installment row.

`server/src/routes/expenses.ts`:
- The create handler no longer 400s on a blank `category`; a missing
  `category` defaults to `''`.
- After validation, before `createExpense`:

  ```ts
  let category = body.category ?? '';
  if (category.trim() === '') {
    const r = await categorize(db, aiConfig, { description: input.description });
    category = r.category ?? '';
  }
  ```

  then `createExpense(db, { ...input, category })`.
- `registerExpenseRoutes` gains an `aiConfig: AiConfig` parameter;
  `app.ts` passes it (same value handed to `registerAiRoutes`).
- The handler stays `async`; a Haiku call adds ~1s to that one request.
  A cap-reached / no-key / failed call just yields `category = ''`.

### Batch endpoint

`POST /api/expenses/categorize-pending` (in `routes/expenses.ts`, behind
`requireAuth`):

```ts
async () => {
  const rules = listRules(db);
  const pending = db.prepare(
    "SELECT id, description FROM expenses WHERE deleted_at IS NULL AND category = '' ORDER BY id"
  ).all() as { id: number; description: string }[];

  // one categorize() per distinct description, then fan the result out
  const byDesc = new Map<string, Category | null>();
  let stoppedAtCap = false;
  for (const desc of new Set(pending.map((p) => p.description))) {
    if (isOverCap(db, aiConfig)) { stoppedAtCap = true; break; }
    const r = await categorize(db, aiConfig, { description: desc }, { rules });
    byDesc.set(desc, r.category);
  }

  const update = db.prepare('UPDATE expenses SET category = ? WHERE id = ?');
  let updated = 0;
  const tx = db.transaction(() => {
    for (const p of pending) {
      const c = byDesc.get(p.description);
      if (c) { update.run(c, p.id); updated += 1; }
    }
  });
  tx();

  const stillPending = db.prepare(
    "SELECT COUNT(*) n FROM expenses WHERE deleted_at IS NULL AND category = ''"
  ).get().n;
  return { updated, stillPending, stoppedAtCap };
}
```

`isOverCap(db, cfg, now?)` and `monthToDateUsdCents(db, now?)` live in a
new `server/src/ai/budget.ts`, extracted from the month-to-date sum
`runAnalysis` does inline in 2.1. `analysis.ts` is re-pointed at the
helper — no behaviour change, covered by the existing analysis tests.
`categorize` (cap check, step 3) and this batch route both use
`isOverCap`.

### `category_rules` routes — `server/src/routes/category-rules.ts`

`registerCategoryRuleRoutes(app, db)`, all behind `requireAuth`:

| Route | Body / Params | Success | Errors |
|---|---|---|---|
| `GET /api/category-rules` | — | `200 CategoryRule[]` (id ASC) | — |
| `POST /api/category-rules` | `{ keyword, category }` | `201 CategoryRule` | `400` blank keyword or unknown category |
| `DELETE /api/category-rules/:id` | `id` param | `200 { ok: true }` | — |

Registered in `app.ts` after the expense routes.

### Frontend

**`frontend/src/lib/api.ts`:**

```ts
export interface CategoryRule { id: number; keyword: string; category: string }
export function listCategoryRules(): Promise<CategoryRule[]>;
export function createCategoryRule(input: { keyword: string; category: string }): Promise<CategoryRule>;
export function deleteCategoryRule(id: number): Promise<{ ok: true }>;
export function categorizePending(): Promise<{ updated: number; stillPending: number; stoppedAtCap: boolean }>;
```

`createExpense`'s input type: `category` becomes optional / allowed to be
`''` (no functional change — it already forwards the string).

**`frontend/src/pages/GastosPage.tsx`:**
- `const AUTO = '';` — the category `<select>` gets a first
  `<option value="">Automático (regras + IA)</option>`; initial
  `category` state is `AUTO`.
- On submit, send `category` as-is (`''` when Automático). Existing
  reset sets it back to `AUTO`.
- Expense list rows: `{e.category || '— sem categoria'}` in the muted
  category span (add `fontStyle: italic, color: var(--text3)` when
  blank).
- Above the list, when `expenses.some((e) => e.category === '')`:
  a `Categorizar pendentes ({count})` button → `api.categorizePending()`
  → on resolve, `refresh()` and show a transient line
  `{updated} categorizados · {stillPending} pendentes{stoppedAtCap ? ' (limite de IA atingido)' : ''}`.
  Button disabled while the request is in flight.

**`frontend/src/components/CategoryRulesSection.tsx`** (new, modeled on
`FixedExpensesSection`): a `<div className="card">` with
- an add form: `keyword` text input + a `category` `<select>` over
  `CATEGORIES` + a `+ Adicionar regra` button → `createCategoryRule`
  → refresh; inline `.error-text` on 400.
- a list of `keyword → category` rows, each with an `Excluir` button
  (`aria-label={`Excluir regra ${keyword}`}`) → `deleteCategoryRule`
  → refresh.
- Rendered on the Gastos page below `FixedExpensesSection`.

## Data flow

1. User adds an expense with category = "Automático" → `POST
   /api/expenses` with `category: ''`.
2. Server: `categorize()` → rule hit ⇒ instant; else Haiku ⇒ ledger row,
   maybe a new rule ⇒ category or `''`.
3. `createExpense` writes the (possibly still blank) category to the row
   / all installment rows.
4. The list re-fetch shows the resolved category or `— sem categoria`.
5. Later, "Categorizar pendentes" sweeps every `category = ''` row,
   one Haiku call per distinct description, stopping if the monthly cap
   is hit.
6. "Regras de categoria" lets the user add/delete keyword rules; added
   rules take effect on the next categorize call.

## Error handling

| Situation | Behaviour |
|---|---|
| No rule + no API key | expense saved with `category = ''` |
| Monthly cap reached | Claude skipped; `category = ''`; batch returns `stoppedAtCap: true` |
| Haiku HTTP/network error | error row in `claude_api_calls`; `category = ''`; create/batch still succeed |
| Haiku returns unparseable / off-list / low-confidence | `category = ''`; no rule saved |
| `POST /api/category-rules` blank keyword or unknown category | `400 { error }` |
| Duplicate `(keyword, category)` rule | `addRule` returns the existing row; `201` with it |

Creating an expense never fails due to categorization.

## Testing

**Server (new/changed unit + integration):**

- `categorize/rules.test.ts` — `matchRule` first-substring-wins,
  case-insensitive, no-match `null`; `addRule` trims/lowercases, rejects
  blank keyword + unknown category, dedupes; `deleteRule` soft-deletes
  (row gone from `listRules`).
- `categorize/claude-categorize.test.ts` — with an injected `fetch`:
  builds the prompt with the category list + uses `cfg.categorizeModel`;
  parses a clean JSON reply; strips a ```json fence; a bad/empty/off-list
  reply → `{ category: null, confidence: 'low', keyword: null }`; an
  HTTP 500 propagates `ClaudeUpstreamError`.
- `categorize/categorize.test.ts` — rule hit ⇒ `source: 'rule'`, no
  ledger row, no fetch; no rule + no key ⇒ `source: 'none'`; no rule +
  key + fake high-confidence ⇒ category returned, one `ok`
  `claude_api_calls` row with `endpoint='categorize'`, a new
  `category_rules` row created; low-confidence ⇒ `category: null`, no
  rule; cap reached ⇒ no fetch, `source: 'none'`; upstream error ⇒
  `error` ledger row, `source: 'none'`, no throw.
- `ai/budget.test.ts` — `monthToDateUsdCents` sums only `status='ok'`
  rows in the given month; `isOverCap` compares to `cfg.monthlyCapUsdCents`.
  (2.1's `analysis.test.ts` still passes after the extract.)
- `routes/expenses.test.ts` — add: `POST /api/expenses` with
  `category: ''` and a matching rule seeded ⇒ 201 and the stored row has
  the rule's category; with no rule and no key ⇒ 201 and `category = ''`;
  an installment group with `category: ''` + a rule ⇒ all N rows get the
  same category; the old "blank category → 400" test is removed/inverted.
- `routes/expenses.test.ts` — `POST /api/expenses/categorize-pending`
  with two blank rows sharing a description + a seeded rule ⇒
  `{ updated: 2, stillPending: 0, stoppedAtCap: false }` and both rows
  updated; with the cap pre-exceeded ⇒ `updated: 0, stoppedAtCap: true`.
- `routes/category-rules.test.ts` — CRUD happy paths; `401` without a
  session; `POST` blank keyword → 400; `POST` unknown category → 400;
  `DELETE` then `GET` shows it gone.
- `categorize/categories.test.ts` — the array equals the expected 11.
- `config.test.ts` — `config.ai.categorizeModel` default +
  `FUMARENDE_AI_CATEGORIZE_MODEL` override.
- `ai/cost.test.ts` — `estimateCostUsdCents('claude-haiku-4-5', …)` at
  $1/$5.

**Frontend (new):**

- `pages/GastosPage.test.tsx` — the category select has an "Automático"
  option and defaults to it; submitting sends `category: ''`; a blank-
  category row renders `— sem categoria`; the "Categorizar pendentes"
  button shows the count, calls `api.categorizePending`, and refreshes;
  mock the new api fns in `beforeEach`.
- `components/CategoryRulesSection.test.tsx` — lists seeded rules; the
  add form calls `createCategoryRule` and refreshes; a 400 shows the
  error; `Excluir` calls `deleteCategoryRule`.
- `lib/expenses.test.ts` (or wherever `CATEGORIES` is asserted) — keep
  the list in sync with the server (assert the 11).

**End-to-end — `scripts/qa-e2e.sh`** (throwaway env, no API key):

- Seed a rule: `POST /api/category-rules {"keyword":"uber","category":"Transporte"}` → 201.
- `POST /api/expenses` with `"category":""` and `"description":"UBER *TRIP"` → 201; then `GET /api/expenses` shows that row's `category == "Transporte"`.
- `POST /api/expenses` with `"category":""`, `"description":"loja xyz"` (no rule, no key) → 201; the row's `category == ""`.
- `POST /api/expenses/categorize-pending` → 200 with a JSON body
  `{updated, stillPending, stoppedAtCap}` (the "loja xyz" row stays
  pending: `stillPending >= 1`, no key).
- `GET /api/category-rules` → 200 array incl. the seeded rule;
  `DELETE /api/category-rules/:id` → 200; `POST` blank keyword → 400.

**Live smoke** (after deploy, key IS configured now): add an expense on
the Gastos page with "Automático" and a real merchant name → it comes
back categorized within a second or two; the "IA este mês" figure on
Análise ticks up by ~R$0,01; a `category_rules` row appears for that
merchant.

## Files

**New — server:**
- `server/src/categorize/categories.ts` + `.test.ts`
- `server/src/categorize/rules.ts` + `.test.ts`
- `server/src/categorize/claude-categorize.ts` + `.test.ts`
- `server/src/categorize/categorize.ts` + `.test.ts`
- `server/src/ai/budget.ts` + `.test.ts`
- `server/src/routes/category-rules.ts` + `.test.ts`

**Modified — server:**
- `server/src/config.ts` (+ `.test.ts`) — `categorizeModel`
- `server/src/ai/cost.ts` (+ `.test.ts`) — Haiku rate
- `server/src/ai/analysis.ts` — use `ai/budget.ts` (no behaviour change)
- `server/src/db/expenses.ts` — allow blank `category`
- `server/src/routes/expenses.ts` (+ `.test.ts`) — resolve blank
  category on create, `categorize-pending` route, `aiConfig` param
- `server/src/app.ts` — pass `aiConfig` to `registerExpenseRoutes`,
  register `category-rules` routes

**New — frontend:**
- `frontend/src/components/CategoryRulesSection.tsx` + `.test.tsx`

**Modified — frontend:**
- `frontend/src/lib/api.ts` — `CategoryRule` + 4 fns; `createExpense`
  input `category` optional
- `frontend/src/pages/GastosPage.tsx` (+ `.test.tsx`) — Automático
  option, pendentes button, `— sem categoria`, render
  `CategoryRulesSection`
- `frontend/src/lib/expenses.ts` — a comment pointing at the server
  copy of `CATEGORIES`

**Modified — repo:**
- `scripts/qa-e2e.sh` — categorization section
- `docs/qa-checklist.md` — 2.2 section + header counts
- `README.md` — mark slice 2.2 done

## Security / cost notes

- No new secret. Categorize calls reuse 2.1's key + client + ledger +
  monthly cap. Haiku ≈ $0.001 per unknown merchant; repeat merchants are
  free once a rule exists.
- Sent to Anthropic per unknown merchant: only the expense
  **description** string (a merchant name) — no amounts, dates, or other
  records. This is the minimum needed to classify and is the user's
  intent in choosing "Automático".
- The cap already caps categorization spend; the batch route stops at
  the cap rather than erroring.
- `category_rules.keyword` is stored lowercased and only ever used for a
  substring test — no regex, no SQL interpolation (parameterised).
