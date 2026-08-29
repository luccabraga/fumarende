# fumarende — AI foundation + on-demand analysis design

> **Phase 2, sub-project 2.1.** The first of four Phase 2 slices
> (foundation+analysis / auto-categorization / PDF import / web-search
> macro context). Its own brainstorm → spec → plan → implement cycle.
> Phase 1 and the nav-shell month selector are complete and on
> `origin/main`.

## Context

Phase 1 delivered eight deterministic modules plus the Dashboard. The
Phase 1 spec (`2026-08-13-fumarende-phase1-design.md`) reserved four
Claude-powered features for Phase 2. Brainstorming (2026-08-29) split
Phase 2 into four loosely-coupled sub-projects and picked the
**foundation + on-demand analysis** slice to build first: it is
read-only (never mutates financial data), it delivers the headline
"analytic / advisory" value, and everything else in Phase 2 depends on
the same Claude client and cost ledger.

Decisions from that session:

- **First slice:** foundation (Claude client + cost tracker) bundled
  with read-only on-demand analysis.
- **API key:** the user does not have an Anthropic API key yet. The
  build must work end-to-end without one — every AI route degrades to a
  clean "not configured" response, and the whole test + e2e suite runs
  with no key and makes no real network calls. The key is added later
  via `.env` / the launchd plist.
- **Web search:** deferred. v1 analysis reasons only from the user's own
  data.
- **Analysis form:** 2–3 **preset** analyses (fixed prompts), no
  free-text box in v1.
- **History:** every analysis run is saved (kind, snapshot, response,
  tokens, cost, timestamp) and shown as latest + collapsible history.
- **Budget:** a **soft monthly cap**, configurable, default ≈ R$ 20
  (USD 4.00). Over the cap, a call is refused before any spend.

## Goals

- A reusable server-side Claude client (`server/src/ai/`) — one
  non-streaming `POST /v1/messages` call, no SDK dependency, typed
  errors, fully mockable.
- A universal `claude_api_calls` ledger: one row per call (ok or
  error), cost stored in **USD cents** (the billed unit).
- Three preset analyses over a compact JSON snapshot built from existing
  deterministic code (`dashboardSummary`, `spendingBreakdown`,
  `projectSavings`, reserve tiers, goals, câmbio history, dollar
  quotes).
- `ai_analyses` history table + routes to run one and list past runs.
- A **soft monthly spend cap** enforced before each call.
- A `ConsultorIA` card on the existing **Análise** page: three buttons,
  a month-to-date spend line, the latest response rendered as Markdown,
  and a collapsible history — all gracefully disabled when the server
  reports `configured: false`.
- Config + launchd plumbing for `ANTHROPIC_API_KEY`, with no key
  committed and no key required to build, test, or run.

## Non-goals

- **No auto-categorization** (`category_rules` matching) — sub-project 2.2.
- **No PDF / CSV statement import** — sub-project 2.3.
- **No web-search / tool-use loop, no live macro data** — sub-project 2.4.
- **No free-text chat box** — a later addition to this slice if wanted.
- **No streaming responses.** One request, one JSON reply.
- **No `@anthropic-ai/sdk`, no `dotenv`, no `react-markdown`** — each is
  a few dozen lines of first-party code instead, matching the project's
  existing lean approach.
- **No changes to any Phase 1 module's behaviour.** The analysis is a
  new read-only card; the Análise page's deterministic math is
  untouched.
- No retry/backoff on upstream 429/5xx in v1 — surface the failure,
  write the error row, let the user retry.

## Architecture

### Config & secret delivery

`server/src/config.ts` — `Config` gains:

```ts
ai: {
  apiKey: string | null;        // ANTHROPIC_API_KEY, null when unset
  model: string;                // FUMARENDE_AI_MODEL, default 'claude-sonnet-5'
  monthlyCapUsdCents: number;    // FUMARENDE_AI_MONTHLY_CAP_USD_CENTS, default 400
  usdBrlFallbackRate: number;    // FUMARENDE_USD_BRL_FALLBACK, default 5.40
};
```

`loadConfig(env)` reads these from `env`. It stays a pure function of
its `env` argument — tests pass an explicit object, never touch
`process.env`.

**`.env` loading.** A new `server/src/load-env.ts` exports
`loadDotEnv(path: string): void` — a ~20-line parser (`KEY=VALUE` lines,
`#` comments, optional surrounding quotes, ignores blanks, does **not**
override an already-set `process.env` key). `server/src/index.ts` calls
`loadDotEnv(path.join(process.cwd(), '.env'))` **before** `loadConfig()`.
Nothing else imports it; no test imports it. `server/.env` is already
covered by the root `.gitignore` (`.env` / `.env.*`). A
`server/.env.example` documents the four vars with placeholder values.

**launchd.** `scripts/com.lucca.fumarende.plist.template` gains an
`EnvironmentVariables` dict with `ANTHROPIC_API_KEY` (and optionally the
three tuning vars). `scripts/install-launchd.sh` substitutes the key
from the caller's environment or a prompt, and documents that leaving it
blank is fine — the server simply runs without AI. The committed
template carries an empty / `__ANTHROPIC_API_KEY__` placeholder, never a
real key.

### Migration `003_ai`

New `server/src/db/migrations/003_ai.ts`, appended to `MIGRATIONS[]` in
`migrate.ts`. Applies automatically to the live DB on the next restart
(same mechanism as `002_dollar_quotes`).

```sql
CREATE TABLE claude_api_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT    NOT NULL,          -- ISO-8601 UTC
  endpoint        TEXT    NOT NULL,          -- e.g. 'analysis:diagnostico'
  model           TEXT    NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd_cents  INTEGER NOT NULL DEFAULT 0, -- rounded, half-up
  status          TEXT    NOT NULL,          -- 'ok' | 'error'
  error_message   TEXT
);

CREATE TABLE ai_analyses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT    NOT NULL,
  kind                TEXT    NOT NULL,      -- 'diagnostico' | 'poupanca' | 'cambio'
  snapshot_json       TEXT    NOT NULL,      -- the exact JSON sent to Claude
  response_md         TEXT    NOT NULL,
  claude_api_call_id  INTEGER NOT NULL REFERENCES claude_api_calls(id)
);
```

`server/src/data/tables.ts` — add `'claude_api_calls'` and
`'ai_analyses'` to `DATA_TABLES` (so export / import / wipe / seed and
the drift-guard test cover them). Both are append-only ledgers with no
`deleted_at`; add both to `TABLES_WITHOUT_DELETED_AT` in the diagnostics
module and to the drift-guard test's no-`deleted_at` allowance.
`wipeData` clears them like any other table. `seedTestData` does **not**
seed them (no fake AI history).

### Claude client — `server/src/ai/client.ts`

```ts
export class ClaudeNotConfiguredError extends Error {}
export class ClaudeUpstreamError extends Error {
  constructor(message: string, readonly httpStatus: number | null) { super(message); }
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(
  cfg: Config['ai'],
  args: { system: string; user: string; maxTokens?: number },
  fetchImpl: typeof fetch = fetch,          // injectable for tests
): Promise<ClaudeResult>;
```

- `cfg.apiKey === null` → throw `ClaudeNotConfiguredError` before any
  network call.
- `POST https://api.anthropic.com/v1/messages`, headers
  `x-api-key`, `anthropic-version: 2023-06-01`, `content-type:
  application/json`. Body: `{ model: cfg.model, max_tokens: args.maxTokens ?? 1200,
  system: args.system, messages: [{ role: 'user', content: args.user }] }`.
- Non-2xx → `ClaudeUpstreamError(bodyTextTruncated, res.status)`.
  Network throw → `ClaudeUpstreamError(err.message, null)`.
- Success → concatenate `content[]` items of `type === 'text'`; read
  `usage.input_tokens` / `usage.output_tokens` (default 0).

### Cost — `server/src/ai/cost.ts`

```ts
export const MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  // extend as models are added; unknown model -> throw, caller catches
};

export function estimateCostUsdCents(model: string, inTok: number, outTok: number): number;
```

Pure, unit-tested: `(inTok/1e6*input + outTok/1e6*output) * 100`, rounded
half-up. An unknown model throws `Error('unknown model rate: <model>')`;
`runAnalysis` catches it and still records the call with
`cost_usd_cents = 0` and `status = 'ok'` (tokens are known; only the
price is not) — the ledger stays honest and the cap logic treats it as
free rather than crashing.

### Snapshot — `server/src/ai/snapshot.ts`

`buildSnapshot(db, now = new Date()): AnalysisSnapshot` — a compact,
stable-shaped object composed from existing deterministic code, no new
queries where an existing helper already computes the number:

- `month`, `generatedAt`
- `income`: last 3 months `{ month, brlCents, usdCents }[]`
- `expenses`: current + previous month totals, essential / non-essential
  split, `byCategory` (3-month sum, sorted desc) — from
  `spendingBreakdown` + `dashboardSummary`
- `reserve`: `balanceCents`, `essentialAvgCents`, `tier`, `target3Cents`,
  `target6Cents` — from `reserveTiers` / `essentialAverage`
- `savingsTarget`: `{ targetCents, savedThisMonthCents, rolloverCents }`
  for the current month, or `null`
- `projection`: `projectSavings` 12-month endpoint totals
- `goals`: `{ name, currentCents, targetCents, targetDate }[]` (active
  only), `specialProjects` likewise
- `cambio`: last 6 contracts `{ date, amountUsdCents, contractedRate,
  spreadPct, netBrlCents }[]` + mean spread
- `dollarQuotes`: last 6 `{ month, rate, salaryUsdCents }[]` + average
  rate

All amounts in cents / plain numbers; the prompt layer is responsible
for any human formatting it wants. Unit-tested against a
`seedTestData`-seeded in-memory DB: asserts month keys, the 3-month
income window, category ordering, and that it is JSON-serialisable and
below a sane size (< 8 KB for the seed fixture).

### Analyses — `server/src/ai/analysis.ts`

```ts
export type AnalysisKind = 'diagnostico' | 'poupanca' | 'cambio';

export const ANALYSES: Record<AnalysisKind, {
  label: string;                       // pt-BR button label
  system: string;                      // role + tone + "only use the data given" guardrail
  userPrompt: (s: AnalysisSnapshot) => string;
  maxTokens: number;
}>;
```

- **`diagnostico`** — "Diagnóstico geral": strengths, risks, and exactly
  three concrete next actions.
- **`poupanca`** — "Estou poupando o suficiente?": reserve adequacy vs
  the 3×/6× tiers and the monthly target, with a suggested monthly
  number.
- **`cambio`** — "Converter dólares agora?": reasons **only** from the
  user's own contract history + recorded quotes (spread trend, salary
  timing); explicitly states it has no live-market data and that this is
  not investment advice.

Every `system` prompt fixes: respond in Brazilian Portuguese, use
GitHub-flavoured Markdown, base every statement on the provided JSON, do
not invent numbers, and keep it under ~250 words.

```ts
export class BudgetExceededError extends Error {
  constructor(readonly monthToDateUsdCents: number, readonly capUsdCents: number) { super('AI monthly cap reached'); }
}

export async function runAnalysis(
  db: Database.Database,
  cfg: Config['ai'],
  kind: AnalysisKind,
  deps?: { now?: Date; fetchImpl?: typeof fetch },
): Promise<AiAnalysisRow>;
```

Flow:

1. `monthToDate = SUM(cost_usd_cents) FROM claude_api_calls WHERE
   substr(created_at,1,7) = <this month> AND status='ok'`. If
   `monthToDate >= cfg.monthlyCapUsdCents` → throw `BudgetExceededError`.
2. `snapshot = buildSnapshot(db, now)`.
3. `callClaude(cfg, { system, user: userPrompt(snapshot), maxTokens })`
   — inside a `try`:
   - **success:** `cost = estimateCostUsdCents(...)` (0 on unknown-model
     throw); insert `claude_api_calls` row `status='ok'`; insert
     `ai_analyses` row referencing it; return the joined row.
   - **`ClaudeUpstreamError`:** insert `claude_api_calls` row
     `status='error'`, `error_message` truncated to 500 chars, tokens 0,
     cost 0; re-throw.
   - **`ClaudeNotConfiguredError`:** re-throw without writing a row
     (nothing happened).
4. The two inserts in the success path run in one
   `db.transaction(...)()`.

`listAnalyses(db, limit = 20): AiAnalysisRow[]` — newest first, joins
the cost row for `costUsdCents` + `model`.

`aiStatus(db, cfg, now): AiStatus` —
`{ configured: cfg.apiKey !== null, model, monthToDateUsdCents,
capUsdCents, usdBrlRate }`. `usdBrlRate` = latest `dollar_quotes.rate`
(most recent month) else `cfg.usdBrlFallbackRate`.

### Routes — `server/src/routes/ai.ts`

`registerAiRoutes(app, db, cfg)`, all `{ preHandler: requireAuth(db) }`,
registered in `app.ts` after the dashboard routes. `buildApp` gains an
optional `aiConfig?: Config['ai']` parameter; when omitted (all existing
tests, and `buildApp` callers that don't care) it defaults to
`{ apiKey: null, model: 'claude-sonnet-5', monthlyCapUsdCents: 400,
usdBrlFallbackRate: 5.40 }` — i.e. "not configured". `index.ts` passes
`config.ai`.

| Route | Success | Errors |
|---|---|---|
| `GET /api/ai/status` | `200 AiStatus` | — |
| `GET /api/ai/analyses?limit=` | `200 AiAnalysisRow[]` | `400` if `limit` present and not 1–100 |
| `POST /api/ai/analyses` `{ kind }` | `201 AiAnalysisRow` | `400` unknown `kind`; `503 { error }` `ClaudeNotConfiguredError`; `429 { error, monthToDateUsdCents, capUsdCents }` `BudgetExceededError`; `502 { error }` `ClaudeUpstreamError` |

`AiAnalysisRow` (the shared client/server shape):
`{ id, createdAt, kind, responseMd, costUsdCents, model }`. The
`snapshot_json` column is stored but **not** returned by the API (it is
large and internal; available via the raw export if ever needed).

### Frontend

**`frontend/src/lib/api.ts`:**

```ts
export interface AiStatus {
  configured: boolean; model: string;
  monthToDateUsdCents: number; capUsdCents: number; usdBrlRate: number;
}
export interface AiAnalysis {
  id: number; createdAt: string; kind: 'diagnostico' | 'poupanca' | 'cambio';
  responseMd: string; costUsdCents: number; model: string;
}
export function getAiStatus(): Promise<AiStatus>;
export function listAiAnalyses(limit?: number): Promise<AiAnalysis[]>;
export function runAiAnalysis(kind: AiAnalysis['kind']): Promise<AiAnalysis>;
```

**`frontend/src/lib/markdown.tsx`** — exports a `Markdown({ source }: {
source: string }): JSX.Element` component (block-parses `source` and
returns a `<div>` of elements). Supports `#`/`##`/`###` headings,
`**bold**`, `*italic*`, `-`/`1.` lists, paragraphs, and inline
`` `code` ``. Deliberately minimal; unit-tested on a representative
blob. No raw HTML passthrough — text is placed via React children, never
`dangerouslySetInnerHTML`.

**`frontend/src/components/ConsultorIA.tsx`** — rendered as a new
`<div className="card">` at the bottom of `AnalisePage`, below
"Cenários":

- On mount: `getAiStatus()` + `listAiAnalyses()`.
- Header row: "Consultor IA" + a subtle spend line —
  `IA este mês: R$ X,XX / R$ Y,YY` where BRL = `usdCents/100 *
  usdBrlRate`. When `!configured`: an italic note
  "Configure `ANTHROPIC_API_KEY` no servidor para habilitar." and the
  buttons are `disabled`.
- Three buttons (`Diagnóstico geral`, `Estou poupando o suficiente?`,
  `Converter dólares agora?`). Click → `runAiAnalysis(kind)`, button
  shows a pending state, all buttons disabled while in flight.
  - `429` → inline warning "Limite mensal de IA atingido."
  - `502` → inline error "Falha ao consultar a IA. Tente novamente."
  - success → prepend to the list, show its `responseMd` via
    `renderMarkdown`.
- Latest response shown expanded; older runs in a collapsible
  "Histórico" list (label = kind + date + `R$` cost), click to expand
  one.

**`frontend/src/pages/AnalisePage.tsx`** — import and render
`<ConsultorIA />` after the Cenários card. No other change; the existing
data-loading effect is untouched.

**`frontend/src/pages/AnalisePage.test.tsx`** — `beforeEach` mocks the
three new api fns (`getAiStatus` → `{ configured: false, ... }` by
default, `listAiAnalyses` → `[]`). Existing assertions unaffected.

**`frontend/src/components/ConsultorIA.test.tsx`** (new):
- `configured: false` → buttons disabled, the config note shown.
- `configured: true`, click `Diagnóstico geral` → `runAiAnalysis`
  called with `'diagnostico'`, the resolved `responseMd` rendered
  (assert a heading/paragraph from a Markdown fixture).
- `runAiAnalysis` rejects with a `429`-shaped error → the limit warning
  appears.
- history from `listAiAnalyses` renders collapsed; expanding shows the
  body.

## Data flow

1. `AnalisePage` mounts `ConsultorIA` → `GET /api/ai/status` +
   `GET /api/ai/analyses`.
2. User clicks a preset → `POST /api/ai/analyses { kind }`.
3. Server: cap check → `buildSnapshot(db)` → `callClaude` →
   `claude_api_calls` row → `ai_analyses` row → `201`.
4. Card prepends the new analysis, re-renders the spend line from the
   returned cost (or a follow-up `getAiStatus()`).
5. No Phase 1 data is read or written by any of this beyond the
   read-only snapshot queries.

## Error handling

| Situation | Server | UI |
|---|---|---|
| No API key | `503 { error: 'IA não configurada' }`; `status.configured=false` | buttons disabled + config note |
| Monthly cap hit | `429 { error, monthToDateUsdCents, capUsdCents }`; no call made | "Limite mensal de IA atingido." |
| Anthropic 4xx/5xx or network fail | `502 { error }`; `claude_api_calls` error row written | "Falha ao consultar a IA. Tente novamente." |
| Unknown `kind` | `400` | n/a (buttons only send valid kinds) |
| Unknown model rate | call still recorded, `cost_usd_cents=0`, `status='ok'` | normal response, spend line unchanged |
| `localStorage`/UI errors | n/a | standard `.error-text` |

## Testing

**Server (new unit/integration):**

- `ai/cost.test.ts` — `estimateCostUsdCents` for known model (a couple
  of token vectors, half-up rounding), unknown model throws.
- `ai/client.test.ts` — `callClaude` with an injected fake `fetch`:
  builds the right URL/headers/body; parses `text` + `usage`; maps a
  500 to `ClaudeUpstreamError` with `httpStatus`; maps a network throw
  to `ClaudeUpstreamError(null)`; `apiKey: null` throws
  `ClaudeNotConfiguredError` and never calls `fetch`.
- `ai/snapshot.test.ts` — against a `seedTestData` DB: shape, month
  windows, category sort, JSON size bound.
- `ai/analysis.test.ts` — `runAnalysis` with a fake `fetch`: success
  writes one `claude_api_calls` (`ok`) + one `ai_analyses` row and
  returns the joined shape; upstream error writes one `error` row and
  re-throws; cap reached throws `BudgetExceededError` and makes no call;
  `listAnalyses` order + join; `aiStatus` configured flag + rate
  fallback.
- `routes/ai.test.ts` — `buildApp` with no `aiConfig`: `GET
  /api/ai/status` → `200 { configured: false }`; `POST /api/ai/analyses
  { kind: 'diagnostico' }` → `503`; `{ kind: 'bogus' }` → `400`; `GET
  /api/ai/analyses?limit=0` → `400`; all → `401` without a session.
  With an `aiConfig` carrying a dummy key **and an injected fake fetch**
  (via a test-only seam on `buildApp`, or by testing `runAnalysis`
  directly and keeping the route test to the no-key paths) → `201` and
  the row shape. Prefer: route tests cover the no-key + validation
  paths; the happy path is covered at the `runAnalysis` unit level.
- `config.test.ts` — `loadConfig` maps the four `env` vars and their
  defaults; `apiKey` is `null` when `ANTHROPIC_API_KEY` is unset.
- `load-env.test.ts` — the parser: `KEY=VALUE`, quotes, `#` comments,
  blank lines, no-override of an existing key, missing file is a no-op.
- `db/migrate.test.ts` — `003_ai` present; `claude_api_calls` +
  `ai_analyses` exist after migration.
- `data/tables.test.ts` — drift guard still passes with the two new
  tables listed.

**Frontend (new):**

- `lib/markdown.test.ts` — headings, bold/italic, ordered + unordered
  lists, paragraphs, inline code; no HTML injection.
- `components/ConsultorIA.test.tsx` — the four cases above.
- `pages/AnalisePage.test.tsx` — updated mocks; assert the "Consultor
  IA" heading renders.

**End-to-end — `scripts/qa-e2e.sh`** (throwaway env, **no API key**, no
real calls):

- `GET /api/ai/status` → `200`, `.configured == false`, `.capUsdCents
  == 400`.
- `POST /api/ai/analyses {"kind":"diagnostico"}` → `503`.
- `POST /api/ai/analyses {"kind":"nope"}` → `400`.
- `GET /api/ai/analyses` → `200`, `[]`.
- `GET /api/ai/analyses?limit=0` → `400`.

**Live smoke** (after deploy, still no key): `/api/ai/status` → `200
{configured:false}` behind auth; the Análise page shows the disabled
Consultor card.

## Files

**New — server:**

- `server/src/load-env.ts` + `server/src/load-env.test.ts`
- `server/src/db/migrations/003_ai.ts`
- `server/src/ai/client.ts` + `client.test.ts`
- `server/src/ai/cost.ts` + `cost.test.ts`
- `server/src/ai/snapshot.ts` + `snapshot.test.ts`
- `server/src/ai/analysis.ts` + `analysis.test.ts`
- `server/src/routes/ai.ts` + `ai.test.ts`
- `server/.env.example`

**New — frontend:**

- `frontend/src/lib/markdown.tsx` + `markdown.test.tsx`
- `frontend/src/components/ConsultorIA.tsx` + `ConsultorIA.test.tsx`

**Modified — server:**

- `server/src/config.ts` — `ai` block + `config.test.ts`
- `server/src/index.ts` — `loadDotEnv` before `loadConfig`; pass
  `config.ai` to `buildApp`
- `server/src/app.ts` — `buildApp` optional `aiConfig`; register AI routes
- `server/src/db/migrate.ts` — append `003_ai`; `migrate.test.ts`
- `server/src/data/tables.ts` — two new `DATA_TABLES`; `tables.test.ts`
- `server/src/data/diagnostics.ts` — two new `TABLES_WITHOUT_DELETED_AT`

**Modified — frontend:**

- `frontend/src/lib/api.ts` — `AiStatus`, `AiAnalysis`, three fns
- `frontend/src/pages/AnalisePage.tsx` — render `<ConsultorIA />`
- `frontend/src/pages/AnalisePage.test.tsx` — mocks + one assertion

**Modified — repo:**

- `scripts/com.lucca.fumarende.plist.template` — `EnvironmentVariables`
- `scripts/install-launchd.sh` — key substitution + docs
- `scripts/qa-e2e.sh` — AI section (no-key assertions)
- `docs/qa-checklist.md` — AI foundation section
- `README.md` — Phase 2 status line
- `.gitignore` — confirm `server/.env` is covered (it is, via `.env` /
  `.env.*`); no change expected

## Security / cost notes

- The API key is never committed: `.env` is gitignored, the plist
  template carries a placeholder, `install-launchd.sh` injects at
  install time.
- `loadConfig` and every test are pure functions of an explicit `env` /
  args object — the real key and the live DB are never touched by the
  suite; the whole build runs offline.
- `snapshot_json` is stored locally in the user's own SQLite file (same
  trust boundary as the rest of the financial data) and is **not**
  returned over the API.
- Sent to Anthropic: the compact financial snapshot (amounts,
  categories, rates — no names beyond goal/project labels the user
  typed, no credentials). This is inherent to the feature and is the
  user's explicit intent in running an analysis.
- The soft cap is the cost backstop; there is no retry loop to amplify
  spend on failure.
