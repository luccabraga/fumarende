# fumarende — câmbio web-search context + fuller cost tracker design

> **Phase 2, sub-project 2.4** — the last Claude slice before Phase 2.5
> (UX/UI polish). 2.1 foundation+analysis ✅ / 2.2 auto-categorization ✅
> / 2.3 PDF import ✅ / **2.4 web-search + cost tracker**. Its own
> brainstorm → spec → plan → implement cycle. Depends on 2.1's Claude
> client + `claude_api_calls` ledger + monthly cap.

## Context

The `cambio` analysis preset ("Converter dólares agora?") currently
carries the guardrail *"Você NÃO tem dados de mercado ao vivo — raciocine
apenas pelo histórico"*. This slice gives that one preset access to
Anthropic's server-side **web search tool** so it can factor in the
current USD/BRL rate, the recent trend, and relevant news — behind an
opt-in checkbox.

It also builds the fuller cost-tracker UI that 2.1's spec deferred: a
"Uso da IA" section on the Análise page with a by-kind spend breakdown
and a recent-calls log.

Decisions from the 2026-08-31 brainstorm:

- **Web search mode:** an opt-in checkbox next to the câmbio button
  ("com contexto de mercado (web)"). Unchecked = today's data-only run.
- **Search budget:** `max_uses: 3` per run, overridable with
  `FUMARENDE_AI_WEB_SEARCH_MAX`.
- **Cost tracker:** a "Uso da IA" section on the Análise page —
  month-to-date total, a by-kind breakdown, and the last ~20 calls.
  Backed by a new `GET /api/ai/usage`.
- **Kill switch:** `FUMARENDE_AI_WEB_SEARCH=on|off` (default `on`). Off →
  the checkbox is hidden and câmbio stays data-only even with a key.

## Goals

- `callClaude` can pass a `tools` array; `ClaudeResult` reports
  `webSearchRequests`.
- `estimateCostUsdCents` adds a per-search fee ($0.01 = 1 cent each).
- `runAnalysis(db, cfg, 'cambio', { webSearch: true })` — market-aware
  system prompt + the web-search tool; ledger `endpoint` =
  `analysis:cambio+web`; cost includes search fees; gated by the
  monthly cap like every other call.
- `aiStatus` reports `webSearch: boolean` (so the UI shows/hides the
  checkbox).
- `GET /api/ai/usage` — `{ monthToDateUsdCents, capUsdCents, usdBrlRate,
  byEndpoint, recent }`.
- `ConsultorIA` — the opt-in checkbox (câmbio only, only when
  `status.webSearch`).
- `AiUsageSection` — "Uso da IA" card on Análise: month-to-date vs cap,
  by-kind cost table, collapsible last-20 call log.

## Non-goals

- **No web search for `diagnostico` / `poupanca`** — those stay
  strictly data-only.
- **No migration.** Search fees fold into `cost_usd_cents`;
  web-search runs are told apart by the `endpoint` string
  (`analysis:cambio+web`). No per-search count column.
- No streaming, no citation-specific UI — Claude is told to cite
  sources inline in its Markdown and that renders as-is.
- No spend-history chart or cross-month trend — the usage section shows
  only the current month's breakdown plus a flat recent-calls list.
- No change to how the cap is enforced (still a pre-call
  `isOverCap` check).
- `runAnalysis` with `webSearch: true` when `cfg.webSearch === false`
  or `kind !== 'cambio'` → silently runs data-only (no error).

## Architecture

### Config — `server/src/config.ts`

`AiConfig` gains:

```ts
webSearch: boolean;        // FUMARENDE_AI_WEB_SEARCH, default true; 'off'|'false'|'0' → false
webSearchMaxUses: number;  // FUMARENDE_AI_WEB_SEARCH_MAX, default 3
```

`NOT_CONFIGURED_AI` gets `webSearch: true, webSearchMaxUses: 3`
(irrelevant with no key, but keeps the object complete). `loadConfig`:

```ts
webSearch: !['off', 'false', '0'].includes((env.FUMARENDE_AI_WEB_SEARCH ?? 'on').toLowerCase()),
webSearchMaxUses: Number(env.FUMARENDE_AI_WEB_SEARCH_MAX ?? 3),
```

The three existing `config.test.ts` deep-equal assertions on
`config.ai` get the two new keys added.

### `callClaude` — `server/src/ai/client.ts`

```ts
export async function callClaude(
  cfg: AiConfig,
  args: { system: string; user: string | ContentBlock[]; maxTokens?: number; tools?: unknown[] },
  fetchImpl?: typeof fetch,
): Promise<ClaudeResult>;

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;   // NEW — 0 when absent
}
```

- Request body: `...(args.tools ? { tools: args.tools } : {})`.
- Response `usage` parse also reads
  `json.usage?.server_tool_use?.web_search_requests ?? 0` into
  `webSearchRequests`.
- `text` extraction unchanged (`content.filter(c => c.type === 'text')`
  — web-search adds `server_tool_use` / `web_search_tool_result` blocks
  which are skipped; `text` blocks may carry `citations` which we
  ignore).
- Every existing caller ignores the new `webSearchRequests` field — no
  change needed in `categorize.ts` / `extract.ts` / the non-web
  `runAnalysis` path.

### Cost — `server/src/ai/cost.ts`

```ts
export function estimateCostUsdCents(
  model: string,
  inTok: number,
  outTok: number,
  webSearchRequests = 0,
): number;
```

`Math.round(tokenUsd * 100) + webSearchRequests * 1` (1 cent per
search; the token part keeps its half-up rounding). Unknown model still
throws — callers already catch and record 0. `cost.test.ts` gains a
case with `webSearchRequests`.

### Web-search tool — `server/src/ai/web-search.ts`

```ts
export function webSearchTool(maxUses: number): { type: string; name: string; max_uses: number } {
  return { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses };
}
```

A tiny module so the tool-type string lives in one place.

### Analysis — `server/src/ai/analysis.ts`

`runAnalysis` gains a `webSearch` dep:

```ts
export async function runAnalysis(
  db: Database.Database,
  cfg: AiConfig,
  kind: AnalysisKind,
  deps?: { now?: Date; fetchImpl?: typeof fetch; webSearch?: boolean },
): Promise<AiAnalysisRow>;
```

- `const useWeb = kind === 'cambio' && deps.webSearch === true && cfg.webSearch;`
- `ANALYSES.cambio` stays the data-only entry. A new
  `CAMBIO_WEB_SYSTEM` constant (module-level, not in `ANALYSES`):

  > "Você é um consultor de câmbio com acesso a busca na web. Use a
  > ferramenta de busca para verificar a cotação USD/BRL atual, a
  > tendência recente (últimas semanas) e notícias macroeconômicas
  > relevantes (Brasil e EUA). Combine isso com o histórico do usuário
  > (contratos e cotações informadas). Cite as fontes entre parênteses.
  > Deixe claro que não é recomendação de investimento. Responda em
  > português do Brasil, em Markdown, no máximo ~280 palavras."

- The call:
  ```ts
  const spec = ANALYSES[kind];
  const system = useWeb ? CAMBIO_WEB_SYSTEM : spec.system;
  const tools = useWeb ? [webSearchTool(cfg.webSearchMaxUses)] : undefined;
  const maxTokens = useWeb ? 1400 : spec.maxTokens;
  result = await callClaude(cfg, { system, user: spec.userPrompt(snapshot), maxTokens, tools }, deps.fetchImpl ?? fetch);
  ```
- `const endpoint = useWeb ? 'analysis:cambio+web' : \`analysis:${kind}\`;`
  — used for **both** the ok row and the error row insert (replace the
  existing `\`analysis:${kind}\`` literals).
- Cost: `estimateCostUsdCents(cfg.model, result.inputTokens,
  result.outputTokens, result.webSearchRequests)`.
- Everything else (cap check, snapshot, transaction, `ai_analyses`
  insert, return shape) unchanged. The `ai_analyses.kind` column stays
  `'cambio'` — the web/no-web distinction lives only in the ledger's
  `endpoint`.

### Usage — `server/src/ai/usage.ts`

```ts
export interface AiUsageEndpoint { endpoint: string; calls: number; costUsdCents: number }
export interface AiUsageCall {
  createdAt: string;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsdCents: number;
  status: string;
}
export interface AiUsage {
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  byEndpoint: AiUsageEndpoint[];
  recent: AiUsageCall[];
}

export function aiUsage(db: Database.Database, cfg: AiConfig, now?: Date): AiUsage;
```

- `monthToDateUsdCents` — `monthToDateUsdCents(db, now)` from `ai/budget.ts`.
- `usdBrlRate` — latest `dollar_quotes.rate` else `cfg.usdBrlFallbackRate`
  (same lookup as `aiStatus`; extract a shared `latestUsdBrlRate(db, cfg)`
  helper used by both).
- `byEndpoint` — `SELECT endpoint, COUNT(*) calls, COALESCE(SUM(cost_usd_cents),0) costUsdCents
  FROM claude_api_calls WHERE status='ok' AND substr(created_at,1,7)=<month>
  GROUP BY endpoint ORDER BY costUsdCents DESC, calls DESC`.
- `recent` — `SELECT created_at createdAt, endpoint, model,
  input_tokens inputTokens, output_tokens outputTokens,
  cost_usd_cents costUsdCents, status FROM claude_api_calls
  ORDER BY id DESC LIMIT 20` (any status, any month).

### `aiStatus` — add `webSearch`

`AiStatus` gains `webSearch: boolean`; `aiStatus` returns
`webSearch: cfg.webSearch`. (Frontend uses it to show/hide the
checkbox.)

### Routes — `server/src/routes/ai.ts`

- `POST /api/ai/analyses` body: `{ kind?: string; webSearch?: boolean }`.
  Pass `{ webSearch: body.webSearch === true }` into `runAnalysis`'s
  deps. No new error paths — an unsupported `webSearch: true` (no key /
  cap / `cfg.webSearch === false`) already resolves to the existing
  503 / 429 / data-only behaviour.
- `GET /api/ai/usage` — `{ preHandler: requireAuth(db) }` →
  `aiUsage(db, cfg)`.

### Frontend

**`frontend/src/lib/api.ts`:**

```ts
export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  webSearch: boolean;            // NEW
}
export interface AiUsage {
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  byEndpoint: { endpoint: string; calls: number; costUsdCents: number }[];
  recent: {
    createdAt: string; endpoint: string; model: string;
    inputTokens: number; outputTokens: number; costUsdCents: number; status: string;
  }[];
}
export function getAiUsage(): Promise<AiUsage> {
  return request('/api/ai/usage');
}
export function runAiAnalysis(
  kind: AiAnalysis['kind'],
  webSearch = false,
): Promise<AiAnalysis> {
  return request('/api/ai/analyses', {
    method: 'POST',
    body: JSON.stringify({ kind, webSearch }),
  });
}
```

**`frontend/src/components/ConsultorIA.tsx`:**
- New state `webSearch: boolean` (default false).
- When `status?.webSearch`: a `<label><input type="checkbox"
  aria-label="com contexto de mercado" checked={webSearch} …/> com
  contexto de mercado (web)</label>` rendered under the preset button
  row (a hint line notes it costs a little more).
- `run(kind)` → `api.runAiAnalysis(kind, kind === 'cambio' ? webSearch : false)`.
- No other change; the spend line and history stay as-is.

**`frontend/src/components/AiUsageSection.tsx`** (new) — a
`<div className="card">` headed `<h2>Uso da IA</h2>`:
- `useEffect` on mount → `api.getAiUsage()` into state; soft error
  string on failure (card still renders).
- Line: `Este mês: {brl(monthToDateUsdCents)} / {brl(capUsdCents)}`
  where `brl(usdCents) = formatCentsBRL(Math.round(usdCents * usdBrlRate))`.
- A small table of `byEndpoint`: `{ENDPOINT_LABEL[endpoint] ?? endpoint}`
  · `{calls}` · `{brl(costUsdCents)}`. Empty → "Nenhuma chamada este
  mês."
- A collapsible "Últimas chamadas" (button toggles). Each: `{date} ·
  {label} · {model} · {inputTokens}+{outputTokens} tok · {brl(cost)} ·
  {status === 'ok' ? 'ok' : 'erro'}`.
- `ENDPOINT_LABEL`: `{ 'analysis:diagnostico':'Diagnóstico',
  'analysis:poupanca':'Poupança', 'analysis:cambio':'Câmbio',
  'analysis:cambio+web':'Câmbio + web', 'categorize':'Categorização',
  'import':'Importação' }`.

**`frontend/src/pages/AnalisePage.tsx`** — render `<AiUsageSection />`
right after `<ConsultorIA />`.

**`frontend/src/pages/AnalisePage.test.tsx`** — `beforeEach` also mocks
`api.getAiUsage` (→ a zeroed `{ monthToDateUsdCents: 0, capUsdCents:
400, usdBrlRate: 5, byEndpoint: [], recent: [] }`) and the updated
`getAiStatus` (→ add `webSearch: false`). Existing assertions
unaffected; add one that the "Uso da IA" heading renders.

## Data flow

1. Análise page mounts `ConsultorIA` + `AiUsageSection` → `GET
   /api/ai/status`, `GET /api/ai/analyses`, `GET /api/ai/usage`.
2. If `status.webSearch`, the câmbio checkbox is available. User checks
   it and clicks "Converter dólares agora?".
3. `POST /api/ai/analyses { kind: 'cambio', webSearch: true }` →
   `runAnalysis(..., { webSearch: true })` → cap check → snapshot →
   `callClaude` with the web-search tool → Anthropic runs the searches
   server-side and returns the final Markdown (with inline citations) →
   ledger row `endpoint: 'analysis:cambio+web'`, cost = tokens + N×1¢ →
   `ai_analyses` row (`kind: 'cambio'`).
4. `ConsultorIA` shows the answer; its spend line bumps by the returned
   cost.
5. `AiUsageSection` (on next mount / a manual reload) shows the
   `Câmbio + web` row in the breakdown and the call in the log.

## Error handling

| Situation | Behaviour |
|---|---|
| `webSearch: true` but no API key | `503` (unchanged no-key path) |
| `webSearch: true` but over the monthly cap | `429` (cap check runs first, no call) |
| `webSearch: true` but `cfg.webSearch === false` | runs **data-only**, `endpoint: 'analysis:cambio'`, no `tools` |
| `webSearch: true` on `diagnostico` / `poupanca` | ignored — data-only |
| Anthropic error mid-search | `502`; one `error` ledger row (`endpoint: 'analysis:cambio+web'`) |
| `GET /api/ai/usage` with no calls yet | `200` with `byEndpoint: []`, `recent: []` |
| `getAiUsage` fails in the browser | the `AiUsageSection` shows a soft error; the rest of Análise is fine |

## Testing

**Server:**

- `config.test.ts` — `webSearch` default `true`;
  `FUMARENDE_AI_WEB_SEARCH=off` → `false` (also `'false'`, `'0'`);
  `webSearchMaxUses` default `3` + `FUMARENDE_AI_WEB_SEARCH_MAX`
  override. Update the two `config.ai` deep-equals.
- `ai/client.test.ts` — `callClaude` with `tools` puts them in the
  request body; a response `usage.server_tool_use.web_search_requests`
  is surfaced as `webSearchRequests`; absent → `0`; a call with no
  `tools` has no `tools` key in the body.
- `ai/cost.test.ts` — `estimateCostUsdCents('claude-sonnet-5', 1000,
  500, 3)` = token cost + 3.
- `ai/web-search.test.ts` — `webSearchTool(3)` shape.
- `ai/analysis.test.ts`:
  - `runAnalysis(db, cfg, 'cambio', { webSearch: true, fetchImpl })`
    with a fake reply carrying `server_tool_use: { web_search_requests: 2 }`:
    the request body has a `tools` array; the `system` is the
    market-aware prompt (assert a distinctive substring, e.g. "busca na
    web"); the `claude_api_calls` row has `endpoint='analysis:cambio+web'`
    and `cost_usd_cents` ≥ 2; the returned row's `kind` is still
    `'cambio'`.
  - same call with `cfg.webSearch: false` → no `tools` in the body,
    `endpoint='analysis:cambio'`.
  - `runAnalysis(db, cfg, 'diagnostico', { webSearch: true })` → no
    `tools`, `endpoint='analysis:diagnostico'`.
  - existing cambio/diagnostico/cap/error tests still pass (the
    `endpoint` for a plain cambio run is unchanged).
- `ai/usage.test.ts` — seed `claude_api_calls` rows across endpoints,
  months, and statuses: `monthToDateUsdCents` sums this-month ok only;
  `byEndpoint` groups this-month ok only, sorted by cost desc; `recent`
  is the last 20 by id desc regardless of status/month;
  `usdBrlRate` uses the latest `dollar_quotes` else the fallback.
- `routes/ai.test.ts` — `GET /api/ai/usage` → `200` with the shape,
  `401` without a session; `POST /api/ai/analyses { kind: 'cambio',
  webSearch: true }` with no key → `503` (unchanged). `GET
  /api/ai/status` now includes `webSearch`.

**Frontend:**

- `components/ConsultorIA.test.tsx` — with `status.webSearch: true` the
  "com contexto de mercado" checkbox renders; checking it and clicking
  "Converter dólares agora?" calls `runAiAnalysis('cambio', true)`;
  clicking "Diagnóstico geral" calls `runAiAnalysis('diagnostico',
  false)` regardless of the checkbox; with `status.webSearch: false` the
  checkbox is absent. Add `getAiUsage`/`webSearch` to the existing
  mocks.
- `components/AiUsageSection.test.tsx` (new) — renders the month-to-date
  line, a `byEndpoint` row with its label, and expands "Últimas
  chamadas" to show a call; a `getAiUsage` rejection shows a soft
  error.
- `pages/AnalisePage.test.tsx` — mock `getAiUsage`; assert the "Uso da
  IA" heading; keep the existing assertions green.

**End-to-end — `scripts/qa-e2e.sh`** (isolated server, **no key**):

- `GET /api/ai/status` → `.webSearch` is a boolean (`true` by default).
- `GET /api/ai/usage` → `200`, `.byEndpoint` is `[]`, `.recent` is
  `[]`, `.capUsdCents == 400`.
- `POST /api/ai/analyses { kind: 'cambio', webSearch: true }` → `503`
  (no key). No real search happens in CI.

**Live smoke** (key configured): on Análise, the câmbio checkbox is
present; check it and run "Converter dólares agora?" → the answer cites
a current rate / source; the "Uso da IA" section shows a `Câmbio + web`
row whose cost is a few cents above a data-only câmbio run; a
`claude_api_calls` row with `endpoint='analysis:cambio+web'` exists.

## Files

**New — server:**
- `server/src/ai/web-search.ts` + `.test.ts`
- `server/src/ai/usage.ts` + `.test.ts`

**Modified — server:**
- `server/src/config.ts` (+ `.test.ts`) — `webSearch`, `webSearchMaxUses`
- `server/src/ai/client.ts` (+ `.test.ts`) — `tools`, `webSearchRequests`
- `server/src/ai/cost.ts` (+ `.test.ts`) — per-search fee
- `server/src/ai/analysis.ts` (+ `.test.ts`) — web câmbio path,
  `endpoint` string, `webSearch` dep; `aiStatus` gains `webSearch`;
  extract `latestUsdBrlRate` shared with `usage.ts`
- `server/src/routes/ai.ts` (+ `.test.ts`) — `webSearch` body field,
  `GET /api/ai/usage`

**New — frontend:**
- `frontend/src/components/AiUsageSection.tsx` + `.test.tsx`

**Modified — frontend:**
- `frontend/src/lib/api.ts` — `AiStatus.webSearch`, `AiUsage` +
  `getAiUsage`, `runAiAnalysis(kind, webSearch?)`
- `frontend/src/components/ConsultorIA.tsx` (+ `.test.tsx`) — the
  checkbox
- `frontend/src/pages/AnalisePage.tsx` (+ `.test.tsx`) — render
  `<AiUsageSection />`

**Modified — repo:**
- `server/.env.example` — the two `FUMARENDE_AI_WEB_SEARCH*` vars
- `scripts/qa-e2e.sh` — usage + web-search assertions
- `docs/qa-checklist.md` — 2.4 section + header counts
- `README.md` — mark slice 4 done (Phase 2 Claude slices complete)

## Security / cost notes

- No new secret. Web search reuses the existing key + cap + ledger.
  A câmbio-with-web run costs ~$0.03–0.06 (tokens + up to 3 × $0.01
  search fees) vs ~$0.02 data-only; the monthly cap still bounds total
  spend and the checkbox means it never happens unless asked.
- The web-search queries Claude issues are derived from the câmbio
  question + the snapshot context (rates, spreads). No account numbers
  or personal identifiers are in that context.
- `FUMARENDE_AI_WEB_SEARCH=off` is a hard disable independent of the
  key — the checkbox disappears and the tool is never attached.
- `GET /api/ai/usage` returns endpoint names, models, token counts, and
  costs — no prompt or response content, no `snapshot_json`.
