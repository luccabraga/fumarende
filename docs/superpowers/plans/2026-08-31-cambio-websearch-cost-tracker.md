# Câmbio Web-Search + Cost Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `cambio` analysis preset opt-in access to Anthropic's
web-search tool for live market context, and add a "Uso da IA" cost
tracker (by-kind breakdown + recent-calls log) to the Análise page.

**Architecture:** `callClaude` gains a `tools` passthrough and reports
`webSearchRequests`; `estimateCostUsdCents` adds a $0.01/search fee.
`runAnalysis(db, cfg, 'cambio', { webSearch: true })` swaps in a
market-aware system prompt + the web-search tool and tags the ledger row
`endpoint: 'analysis:cambio+web'` — no migration. A new `ai/usage.ts` +
`GET /api/ai/usage` back a `AiUsageSection` card. A checkbox on
`ConsultorIA` drives the câmbio opt-in, shown only when
`FUMARENDE_AI_WEB_SEARCH` is on.

**Tech Stack:** Node 22+, TypeScript, Fastify 5, better-sqlite3, React
18, Vite 6, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-cambio-websearch-cost-tracker-design.md`

## Global Constraints

- **No new npm dependencies. No migration.** Web-search runs are told
  apart by the ledger `endpoint` string (`analysis:cambio+web`); search
  fees fold into `cost_usd_cents`.
- Web search attaches to **`cambio` only**, **only when**
  `deps.webSearch === true` **and** `cfg.webSearch === true`. Any other
  case runs data-only with `endpoint: 'analysis:cambio'` /
  `analysis:${kind}` and no `tools`.
- The monthly cap gates web-search runs exactly as before (pre-call
  `isOverCap`). No new error paths on the route.
- `estimateCostUsdCents` gains an optional 4th arg defaulting to `0`;
  `categorize.ts` / `extract.ts` callers are unchanged.
- `GET /api/ai/usage` returns endpoint names, models, token counts,
  costs, statuses — **never** prompt/response content or `snapshot_json`.
- The whole test + e2e suite runs with **no API key** and makes no real
  search (`callClaude` takes an injectable `fetchImpl`).
- TDD every task. Server tests from `server/`, frontend from `frontend/`.
  Branch `cambio-websearch` off `main`; the finishing skill merges it.
  One commit per task.

---

## Shared Types

```ts
// server/src/config.ts — AiConfig gains:
webSearch: boolean;
webSearchMaxUses: number;

// server/src/ai/client.ts
export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;   // NEW, 0 when absent
}

// server/src/ai/usage.ts
export interface AiUsageEndpoint { endpoint: string; calls: number; costUsdCents: number }
export interface AiUsageCall {
  createdAt: string; endpoint: string; model: string;
  inputTokens: number; outputTokens: number; costUsdCents: number; status: string;
}
export interface AiUsage {
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  byEndpoint: AiUsageEndpoint[];
  recent: AiUsageCall[];
}

// server/src/ai/analysis.ts — AiStatus gains:
webSearch: boolean;
```

Frontend `lib/api.ts` re-declares `AiUsage` (+ its row types) and adds
`webSearch: boolean` to `AiStatus`, identically.

---

## Task 1: Config `webSearch` + `webSearchMaxUses`

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/config.test.ts`
- Modify: `server/.env.example`

**Interfaces:** `AiConfig.webSearch: boolean` (default `true`),
`AiConfig.webSearchMaxUses: number` (default `3`).

- [ ] **Step 1: Update the config tests**

In `server/src/config.test.ts`, the two full `expect(c.ai).toEqual({…})`
assertions get the two new keys. Defaults test:

```ts
    expect(c.ai).toEqual({
      apiKey: null,
      model: 'claude-sonnet-5',
      categorizeModel: 'claude-haiku-4-5',
      monthlyCapUsdCents: 400,
      usdBrlFallbackRate: 5.4,
      webSearch: true,
      webSearchMaxUses: 3,
    });
```

env-set test — add `FUMARENDE_AI_WEB_SEARCH: 'off'` and
`FUMARENDE_AI_WEB_SEARCH_MAX: '5'` to the input and
`webSearch: false, webSearchMaxUses: 5` to the expected object.

Add a focused test:

```ts
  it('parses the web-search kill switch', () => {
    for (const v of ['off', 'false', '0', 'OFF']) {
      expect(loadConfig({ FUMARENDE_AI_WEB_SEARCH: v }).ai.webSearch).toBe(false);
    }
    expect(loadConfig({ FUMARENDE_AI_WEB_SEARCH: 'on' }).ai.webSearch).toBe(true);
    expect(loadConfig({}).ai.webSearch).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: FAIL — `webSearch` / `webSearchMaxUses` undefined.

- [ ] **Step 3: Implement in `config.ts`**

Add to the `AiConfig` interface:

```ts
  webSearch: boolean;
  webSearchMaxUses: number;
```

Add a default constant near the others:

```ts
const AI_WEB_SEARCH_MAX_DEFAULT = 3;
```

`NOT_CONFIGURED_AI` gains `webSearch: true, webSearchMaxUses: AI_WEB_SEARCH_MAX_DEFAULT`.

In `loadConfig`'s `ai` object, after `usdBrlFallbackRate`:

```ts
      webSearch: !['off', 'false', '0'].includes(
        (env.FUMARENDE_AI_WEB_SEARCH ?? 'on').toLowerCase(),
      ),
      webSearchMaxUses: Number(env.FUMARENDE_AI_WEB_SEARCH_MAX ?? AI_WEB_SEARCH_MAX_DEFAULT),
```

- [ ] **Step 4: `.env.example`**

Add under the tuning block:

```
FUMARENDE_AI_WEB_SEARCH=on
FUMARENDE_AI_WEB_SEARCH_MAX=3
```

- [ ] **Step 5: Fix the other `AiConfig` literals**

`grep -rl "categorizeModel:" server/src/**/*.test.ts` — every test file
with an inline `AiConfig` object (`ai/analysis.test.ts`,
`ai/client.test.ts`, `ai/budget.test.ts`, `categorize/*.test.ts`,
`import/extract.test.ts`) needs `webSearch: true, webSearchMaxUses: 3`
added so `tsc` passes. Add them.

- [ ] **Step 6: Run to verify pass + tsc + full suite**

Run: `cd server && npx vitest run src/config.test.ts`
Expected: PASS.
Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm test`
Expected: no type errors; all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts server/.env.example server/src/ai/*.test.ts server/src/categorize/*.test.ts server/src/import/*.test.ts
git commit -m "Config: FUMARENDE_AI_WEB_SEARCH + _MAX (web-search kill switch + budget)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `callClaude` tools + `webSearchRequests`; cost per-search fee; `web-search.ts`

**Files:**
- Modify: `server/src/ai/client.ts` + `.test.ts`
- Modify: `server/src/ai/cost.ts` + `.test.ts`
- Create: `server/src/ai/web-search.ts` + `.test.ts`

**Interfaces:**
- `callClaude(cfg, { system, user, maxTokens?, tools? }, fetchImpl?)` —
  `tools` (when set) goes in the request body.
- `ClaudeResult.webSearchRequests: number`.
- `estimateCostUsdCents(model, inTok, outTok, webSearchRequests = 0)`.
- `webSearchTool(maxUses: number): { type: string; name: string; max_uses: number }`.

- [ ] **Step 1: Write failing tests**

`server/src/ai/client.test.ts` — add:

```ts
  it('includes a tools array in the request body when given, and reports web_search_requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 4, server_tool_use: { web_search_requests: 2 } },
        }),
        { status: 200 },
      ),
    );
    const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    const res = await callClaude(CFG, { system: 's', user: 'u', tools }, fetchImpl as unknown as typeof fetch);
    expect(res.webSearchRequests).toBe(2);
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.tools).toEqual(tools);
  });

  it('omits tools and reports 0 web searches by default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const res = await callClaude(CFG, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch);
    expect(res.webSearchRequests).toBe(0);
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body).not.toHaveProperty('tools');
  });
```

`server/src/ai/cost.test.ts` — add:

```ts
  it('adds one cent per web search request', () => {
    // 1000 in + 500 out ≈ 1c token; + 3 searches = 4c
    expect(estimateCostUsdCents('claude-sonnet-5', 1000, 500, 3)).toBe(
      estimateCostUsdCents('claude-sonnet-5', 1000, 500) + 3,
    );
  });
```

`server/src/ai/web-search.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest';
import { webSearchTool } from './web-search.js';

describe('webSearchTool', () => {
  it('builds the web_search tool block', () => {
    expect(webSearchTool(3)).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run src/ai/client.test.ts src/ai/cost.test.ts src/ai/web-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `web-search.ts`**

```ts
/** Anthropic server-side web-search tool block. */
export function webSearchTool(maxUses: number): {
  type: string;
  name: string;
  max_uses: number;
} {
  return { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses };
}
```

- [ ] **Step 4: Implement `client.ts`**

- `args` type gains `tools?: unknown[]`.
- In the `JSON.stringify({...})` body, add
  `...(args.tools ? { tools: args.tools } : {})`.
- The `json.usage` type gains
  `server_tool_use?: { web_search_requests?: number }`.
- Return object gains
  `webSearchRequests: json.usage?.server_tool_use?.web_search_requests ?? 0`.

- [ ] **Step 5: Implement `cost.ts`**

```ts
export function estimateCostUsdCents(
  model: string,
  inTok: number,
  outTok: number,
  webSearchRequests = 0,
): number {
  const rate = MODEL_RATES_USD_PER_MTOK[model];
  if (!rate) throw new Error(`unknown model rate: ${model}`);
  const usd = (inTok / 1_000_000) * rate.input + (outTok / 1_000_000) * rate.output;
  return Math.round(usd * 100) + webSearchRequests * 1;
}
```

- [ ] **Step 6: Run to verify they pass + full suite**

Run: `cd server && npx vitest run src/ai/client.test.ts src/ai/cost.test.ts src/ai/web-search.test.ts && npm test`
Expected: PASS; full suite green (existing `estimateCostUsdCents` 3-arg
callers unaffected; `callClaude` callers get `webSearchRequests: 0` and
ignore it).

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/client.ts server/src/ai/client.test.ts server/src/ai/cost.ts server/src/ai/cost.test.ts server/src/ai/web-search.ts server/src/ai/web-search.test.ts
git commit -m "AI client: tools passthrough + web_search_requests; cost: per-search fee

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `runAnalysis` web câmbio path + `aiStatus.webSearch`

**Files:**
- Modify: `server/src/ai/analysis.ts` + `.test.ts`

**Interfaces:**
- `runAnalysis(db, cfg, kind, deps?: { now?; fetchImpl?; webSearch?: boolean })`.
- `AiStatus` gains `webSearch: boolean`.
- Export `latestUsdBrlRate(db, cfg): number` (extracted from `aiStatus`,
  reused by `usage.ts` in Task 4).

- [ ] **Step 1: Write failing tests**

`server/src/ai/analysis.test.ts` — add (the `CFG` there already gains
`webSearch: true, webSearchMaxUses: 3` from Task 1):

```ts
function webReply(text: string, searches: number) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 2000, output_tokens: 600, server_tool_use: { web_search_requests: searches } },
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
}

describe('runAnalysis web search', () => {
  it('câmbio with webSearch attaches the tool, tags the ledger, and bills the searches', async () => {
    const d = db();
    const f = webReply('# Câmbio\nRate ~5,1 (fonte).', 2);
    const row = await runAnalysis(d, CFG, 'cambio', { now: NOW, fetchImpl: f, webSearch: true });
    expect(row.kind).toBe('cambio');

    const body = JSON.parse((f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.system).toMatch(/busca na web/i);

    const call = d.prepare("SELECT endpoint, cost_usd_cents c FROM claude_api_calls WHERE status='ok'").get() as { endpoint: string; c: number };
    expect(call.endpoint).toBe('analysis:cambio+web');
    expect(call.c).toBeGreaterThanOrEqual(2); // ≥ the 2 search cents
  });

  it('câmbio with webSearch but cfg.webSearch=false runs data-only', async () => {
    const d = db();
    const f = webReply('# Câmbio\nSó histórico.', 0);
    await runAnalysis(d, { ...CFG, webSearch: false }, 'cambio', { now: NOW, fetchImpl: f, webSearch: true });
    const body = JSON.parse((f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('tools');
    expect(
      d.prepare("SELECT endpoint FROM claude_api_calls WHERE status='ok'").get(),
    ).toEqual({ endpoint: 'analysis:cambio' });
  });

  it('webSearch is ignored for non-câmbio kinds', async () => {
    const d = db();
    const f = webReply('# Diag\nok.', 0);
    await runAnalysis(d, CFG, 'diagnostico', { now: NOW, fetchImpl: f, webSearch: true });
    const body = JSON.parse((f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('tools');
    expect(
      d.prepare("SELECT endpoint FROM claude_api_calls WHERE status='ok'").get(),
    ).toEqual({ endpoint: 'analysis:diagnostico' });
  });
});
```

Also add to the existing `aiStatus` test: `expect(st.webSearch).toBe(true)`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run src/ai/analysis.test.ts`
Expected: FAIL — no `tools`, `endpoint` always `analysis:cambio`,
`aiStatus` has no `webSearch`.

- [ ] **Step 3: Implement in `analysis.ts`**

- Import: `import { webSearchTool } from './web-search.js';`
- `AiStatus` interface gains `webSearch: boolean;`.
- Add a module-level constant:

```ts
const CAMBIO_WEB_SYSTEM =
  'Você é um consultor de câmbio com acesso a busca na web. Use a ferramenta de busca ' +
  'para verificar a cotação USD/BRL atual, a tendência recente (últimas semanas) e ' +
  'notícias macroeconômicas relevantes (Brasil e EUA). Combine isso com o histórico do ' +
  'usuário (contratos e cotações informadas). Cite as fontes entre parênteses. Deixe ' +
  'claro que não é recomendação de investimento. Responda em português do Brasil, em ' +
  'Markdown, no máximo ~280 palavras.';
```

- `runAnalysis` signature: `deps: { now?: Date; fetchImpl?: typeof fetch; webSearch?: boolean } = {}`.
- After `const spec = ANALYSES[kind];`:

```ts
  const useWeb = kind === 'cambio' && deps.webSearch === true && cfg.webSearch;
  const endpoint = useWeb ? 'analysis:cambio+web' : `analysis:${kind}`;
```

- The `callClaude` call:

```ts
    result = await callClaude(
      cfg,
      {
        system: useWeb ? CAMBIO_WEB_SYSTEM : spec.system,
        user: spec.userPrompt(snapshot),
        maxTokens: useWeb ? 1400 : spec.maxTokens,
        tools: useWeb ? [webSearchTool(cfg.webSearchMaxUses)] : undefined,
      },
      deps.fetchImpl ?? fetch,
    );
```

- Replace **both** `` `analysis:${kind}` `` literals (the error-row
  insert at ~line 102 and the ok-row insert at ~line 123) with
  `endpoint`.
- The cost line:

```ts
    cost = estimateCostUsdCents(cfg.model, result.inputTokens, result.outputTokens, result.webSearchRequests);
```

- Extract the rate lookup: add

```ts
export function latestUsdBrlRate(db: Database.Database, cfg: AiConfig): number {
  const quote = db
    .prepare('SELECT rate FROM dollar_quotes WHERE deleted_at IS NULL ORDER BY month DESC LIMIT 1')
    .get() as { rate: number } | undefined;
  return quote?.rate ?? cfg.usdBrlFallbackRate;
}
```

  and change `aiStatus` to use it plus return `webSearch: cfg.webSearch`:

```ts
  return {
    configured: cfg.apiKey !== null,
    model: cfg.model,
    monthToDateUsdCents: monthToDateUsdCents(db, now),
    capUsdCents: cfg.monthlyCapUsdCents,
    usdBrlRate: latestUsdBrlRate(db, cfg),
    webSearch: cfg.webSearch,
  };
```

- [ ] **Step 4: Run to verify they pass + full suite**

Run: `cd server && npx vitest run src/ai/analysis.test.ts && npm test`
Expected: PASS; full suite green (a plain `cambio` run still writes
`endpoint: 'analysis:cambio'`).

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/analysis.ts server/src/ai/analysis.test.ts
git commit -m "Analysis: opt-in web search for the câmbio preset (endpoint analysis:cambio+web)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `ai/usage.ts` + `GET /api/ai/usage` + `webSearch` body field

**Files:**
- Create: `server/src/ai/usage.ts` + `.test.ts`
- Modify: `server/src/routes/ai.ts` + `.test.ts`

**Interfaces:** see "Shared Types" — `aiUsage(db, cfg, now?): AiUsage`;
`GET /api/ai/usage`; `POST /api/ai/analyses` body gains `webSearch?`.

- [ ] **Step 1: Write failing tests**

`server/src/ai/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { aiUsage } from './usage.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk', model: 'm', categorizeModel: 'h',
  monthlyCapUsdCents: 400, usdBrlFallbackRate: 5.4, webSearch: true, webSearchMaxUses: 3,
};
function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}
function call(d: Database.Database, created: string, endpoint: string, cost: number, status = 'ok') {
  d.prepare(
    "INSERT INTO claude_api_calls (created_at, endpoint, model, input_tokens, output_tokens, cost_usd_cents, status) VALUES (?, ?, 'm', 10, 5, ?, ?)",
  ).run(created, endpoint, cost, status);
}

describe('aiUsage', () => {
  it('summarises this month by endpoint (ok only) and lists recent calls', () => {
    const d = db();
    call(d, '2026-08-02T00:00:00Z', 'analysis:cambio+web', 6);
    call(d, '2026-08-03T00:00:00Z', 'analysis:cambio+web', 4);
    call(d, '2026-08-04T00:00:00Z', 'categorize', 1);
    call(d, '2026-08-05T00:00:00Z', 'import', 12, 'error');   // error → not in byEndpoint/mtd
    call(d, '2026-07-30T00:00:00Z', 'analysis:diagnostico', 9); // other month

    const u = aiUsage(d, CFG, NOW);
    expect(u.monthToDateUsdCents).toBe(11); // 6+4+1
    expect(u.byEndpoint[0]).toEqual({ endpoint: 'analysis:cambio+web', calls: 2, costUsdCents: 10 });
    expect(u.byEndpoint.map((e) => e.endpoint)).not.toContain('import'); // error row
    expect(u.recent.length).toBe(5);           // all rows, any status/month
    expect(u.recent[0].endpoint).toBe('analysis:diagnostico'); // newest id last inserted
    expect(u.capUsdCents).toBe(400);
  });

  it('falls back to the config USD/BRL rate with no dollar_quotes', () => {
    expect(aiUsage(db(), CFG, NOW).usdBrlRate).toBe(5.4);
  });
});
```

`server/src/routes/ai.test.ts` — add:

```ts
  it('GET /api/ai/status includes webSearch; GET /api/ai/usage returns the shape', async () => {
    const { app, session } = await authedApp();
    const status = await app.inject({ method: 'GET', url: '/api/ai/status', cookies: { session } });
    expect(typeof status.json().webSearch).toBe('boolean');

    const usage = await app.inject({ method: 'GET', url: '/api/ai/usage', cookies: { session } });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ byEndpoint: [], recent: [], capUsdCents: 400 });
    await app.close();
  });

  it('GET /api/ai/usage is 401 without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/ai/usage' })).statusCode).toBe(401);
    await app.close();
  });

  it('POST /api/ai/analyses accepts a webSearch flag (still 503 with no key)', async () => {
    const { app, session } = await authedApp();
    const res = await app.inject({
      method: 'POST', url: '/api/ai/analyses', cookies: { session },
      payload: { kind: 'cambio', webSearch: true },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
```

(`authedApp` is the helper already in that file; if it does not exist,
mirror the `buildApp` + setup pattern used by the other tests there.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run src/ai/usage.test.ts src/routes/ai.test.ts`
Expected: FAIL — module + route missing.

- [ ] **Step 3: Implement `usage.ts`**

```ts
import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';
import { monthToDateUsdCents } from './budget.js';
import { latestUsdBrlRate } from './analysis.js';

export interface AiUsageEndpoint {
  endpoint: string;
  calls: number;
  costUsdCents: number;
}
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

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function aiUsage(db: Database.Database, cfg: AiConfig, now: Date = new Date()): AiUsage {
  const byEndpoint = db
    .prepare(
      `SELECT endpoint,
              COUNT(*) AS calls,
              COALESCE(SUM(cost_usd_cents), 0) AS costUsdCents
       FROM claude_api_calls
       WHERE status = 'ok' AND substr(created_at, 1, 7) = ?
       GROUP BY endpoint
       ORDER BY costUsdCents DESC, calls DESC`,
    )
    .all(monthKey(now)) as AiUsageEndpoint[];

  const recent = db
    .prepare(
      `SELECT created_at AS createdAt, endpoint, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cost_usd_cents AS costUsdCents, status
       FROM claude_api_calls
       ORDER BY id DESC LIMIT 20`,
    )
    .all() as AiUsageCall[];

  return {
    monthToDateUsdCents: monthToDateUsdCents(db, now),
    capUsdCents: cfg.monthlyCapUsdCents,
    usdBrlRate: latestUsdBrlRate(db, cfg),
    byEndpoint,
    recent,
  };
}
```

> Check for an import cycle: `usage.ts` imports from `analysis.ts`
> (`latestUsdBrlRate`); `analysis.ts` must **not** import from
> `usage.ts`. If a cycle is unavoidable later, move `latestUsdBrlRate`
> to `ai/budget.ts`. As specced there is no cycle.

- [ ] **Step 4: Wire `routes/ai.ts`**

- Import `aiUsage` from `../ai/usage.js`.
- Add: `app.get('/api/ai/usage', { preHandler: requireAuth(db) }, async () => aiUsage(db, cfg));`
- In `POST /api/ai/analyses`, change the `runAnalysis` call to pass
  `{ webSearch: request.body?.webSearch === true }` as the deps arg, and
  add `webSearch?: boolean` to the route's `Body` generic.

- [ ] **Step 5: Run to verify they pass + tsc + full suite**

Run: `cd server && npx vitest run src/ai/usage.test.ts src/routes/ai.test.ts`
Expected: PASS.
Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm test`
Expected: no type errors; all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/usage.ts server/src/ai/usage.test.ts server/src/routes/ai.ts server/src/routes/ai.test.ts
git commit -m "AI: GET /api/ai/usage (by-endpoint + recent calls); webSearch body flag

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend api + `ConsultorIA` checkbox

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/ConsultorIA.tsx` + `.test.tsx`

**Interfaces:**
- `AiStatus` gains `webSearch: boolean`.
- `AiUsage` + its row types; `getAiUsage(): Promise<AiUsage>`.
- `runAiAnalysis(kind, webSearch = false)`.

- [ ] **Step 1: Update `api.ts`**

Add `webSearch: boolean;` to the `AiStatus` interface. Add:

```ts
export interface AiUsageEndpoint { endpoint: string; calls: number; costUsdCents: number }
export interface AiUsageCall {
  createdAt: string; endpoint: string; model: string;
  inputTokens: number; outputTokens: number; costUsdCents: number; status: string;
}
export interface AiUsage {
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  byEndpoint: AiUsageEndpoint[];
  recent: AiUsageCall[];
}
export function getAiUsage(): Promise<AiUsage> {
  return request('/api/ai/usage');
}
```

Change `runAiAnalysis`:

```ts
export function runAiAnalysis(kind: AiAnalysis['kind'], webSearch = false): Promise<AiAnalysis> {
  return request('/api/ai/analyses', {
    method: 'POST',
    body: JSON.stringify({ kind, webSearch }),
  });
}
```

- [ ] **Step 2: Update `ConsultorIA.test.tsx`**

- `STATUS_ON` gains `webSearch: true`. Any other `getAiStatus` mock in
  the file gets `webSearch` too.
- Add tests:

```ts
  it('offers a market-context checkbox and passes it for câmbio only', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    const run = vi.spyOn(api, 'runAiAnalysis').mockResolvedValue({
      id: 1, createdAt: 'x', kind: 'cambio', responseMd: '# ok', costUsdCents: 3, model: 'm',
    });
    render(<ConsultorIA />);
    fireEvent.click(await screen.findByLabelText('com contexto de mercado'));
    fireEvent.click(screen.getByRole('button', { name: 'Converter dólares agora?' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('cambio', true));

    fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico geral' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('diagnostico', false));
  });

  it('hides the checkbox when the server has web search off', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue({ ...STATUS_ON, webSearch: false });
    render(<ConsultorIA />);
    await screen.findByRole('button', { name: 'Diagnóstico geral' });
    expect(screen.queryByLabelText('com contexto de mercado')).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx`
Expected: FAIL — no checkbox; `runAiAnalysis` called with one arg.

- [ ] **Step 4: Implement in `ConsultorIA.tsx`**

- New state: `const [webSearch, setWebSearch] = useState(false);`
- `run(kind)` → `await api.runAiAnalysis(kind, kind === 'cambio' ? webSearch : false);`
- After the `PRESETS.map(...)` button row, when `status?.webSearch`:

```tsx
  {status?.webSearch && (
    <label style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
      <input
        type="checkbox"
        aria-label="com contexto de mercado"
        checked={webSearch}
        onChange={(e) => setWebSearch(e.target.checked)}
        disabled={!configured || pending !== null}
      />{' '}
      com contexto de mercado (web) — usa busca na web no “Converter dólares agora?”, custa um pouco mais
    </label>
  )}
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/ConsultorIA.tsx frontend/src/components/ConsultorIA.test.tsx
git commit -m "Consultor IA: opt-in 'com contexto de mercado' web-search checkbox

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `AiUsageSection` + Análise wiring

**Files:**
- Create: `frontend/src/components/AiUsageSection.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/AnalisePage.tsx`
- Modify: `frontend/src/pages/AnalisePage.test.tsx`

**Interfaces:** consumes `api.getAiUsage`; rendered on Análise after
`<ConsultorIA />`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/AiUsageSection.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiUsageSection } from './AiUsageSection.js';
import * as api from '../lib/api.js';

afterEach(() => vi.restoreAllMocks());

const USAGE: api.AiUsage = {
  monthToDateUsdCents: 40,
  capUsdCents: 400,
  usdBrlRate: 5,
  byEndpoint: [
    { endpoint: 'analysis:cambio+web', calls: 2, costUsdCents: 10 },
    { endpoint: 'categorize', calls: 8, costUsdCents: 1 },
  ],
  recent: [
    {
      createdAt: '2026-08-15T00:00:00Z', endpoint: 'analysis:cambio+web', model: 'claude-sonnet-5',
      inputTokens: 2000, outputTokens: 600, costUsdCents: 5, status: 'ok',
    },
  ],
};

describe('AiUsageSection', () => {
  it('shows the month-to-date line and the by-endpoint breakdown', async () => {
    vi.spyOn(api, 'getAiUsage').mockResolvedValue(USAGE);
    render(<AiUsageSection />);
    expect(await screen.findByRole('heading', { name: 'Uso da IA' })).toBeInTheDocument();
    expect(screen.getByText(/Câmbio \+ web/)).toBeInTheDocument();
    expect(screen.getByText(/Categorização/)).toBeInTheDocument();
  });

  it('expands the recent-calls log', async () => {
    vi.spyOn(api, 'getAiUsage').mockResolvedValue(USAGE);
    render(<AiUsageSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Últimas chamadas/ }));
    expect(await screen.findByText(/claude-sonnet-5/)).toBeInTheDocument();
  });

  it('shows a soft error when the fetch fails', async () => {
    vi.spyOn(api, 'getAiUsage').mockRejectedValue(new Error('boom'));
    render(<AiUsageSection />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AiUsageSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `AiUsageSection.tsx`**

A `<div className="card">` headed `<h2>Uso da IA</h2>` (mono, 15/16):
- `useEffect` mount → `api.getAiUsage()` into state; `catch` → soft
  error string.
- `const brl = (usdCents: number) => formatCentsBRL(Math.round(usdCents * (usage?.usdBrlRate ?? 0)));`
- Line: `Este mês: {brl(monthToDateUsdCents)} / {brl(capUsdCents)}`.
- `ENDPOINT_LABEL` map (spec). `byEndpoint.length === 0` → "Nenhuma
  chamada este mês." else rows: `{label(e.endpoint)} · {e.calls}
  chamada(s) · {brl(e.costUsdCents)}`.
- A `<button>` toggling `showLog`; when open, list `recent`:
  `{new Date(c.createdAt).toLocaleDateString('pt-BR')} · {label(c.endpoint)}
  · {c.model} · {c.inputTokens}+{c.outputTokens} tok · {brl(c.costUsdCents)}
  · {c.status === 'ok' ? 'ok' : 'erro'}`.
- `error` → `<p className="error-text">`.

- [ ] **Step 4: Wire Análise**

`frontend/src/pages/AnalisePage.tsx` — `import { AiUsageSection } from
'../components/AiUsageSection.js';` and render `<AiUsageSection />` right
after `<ConsultorIA />`.

`frontend/src/pages/AnalisePage.test.tsx` — in `beforeEach`, add
`vi.spyOn(api, 'getAiUsage').mockResolvedValue({ monthToDateUsdCents: 0,
capUsdCents: 400, usdBrlRate: 5, byEndpoint: [], recent: [] });` and add
`webSearch: false` to the existing `getAiStatus` mock. Add one
assertion in the "renders the four sections" test:
`expect(await screen.findByRole('heading', { name: 'Uso da IA' })).toBeInTheDocument();`

- [ ] **Step 5: Run to verify pass + full frontend suite + tsc**

Run: `cd frontend && npx vitest run src/components/AiUsageSection.test.tsx src/pages/AnalisePage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AiUsageSection.tsx frontend/src/components/AiUsageSection.test.tsx frontend/src/pages/AnalisePage.tsx frontend/src/pages/AnalisePage.test.tsx
git commit -m "Análise: 'Uso da IA' card — by-kind spend + recent-calls log

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: e2e, docs, build, smoke

**Files:**
- Modify: `scripts/qa-e2e.sh`
- Modify: `docs/qa-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: Full sweep + builds**

Run: `cd server && npm test` — green.
Run: `cd frontend && npm test` — green.
Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 2: Extend `scripts/qa-e2e.sh`**

In the `== IA ==` block, after the existing assertions:

```bash
aeq "ai/status exposes webSearch (bool)" "true" "$(echo "$S" | jq -r '.webSearch | type == "boolean"')"
U="$(body GET /api/ai/usage)"
aeq "ai/usage byEndpoint is empty" "[]" "$(echo "$U" | jq -c '.byEndpoint')"
aeq "ai/usage recent is empty" "[]" "$(echo "$U" | jq -c '.recent')"
aeq "ai/usage cap is 400" "400" "$(echo "$U" | jq -r '.capUsdCents')"
as  "ai/usage unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/ai/usage")"
as  "POST ai/analyses {cambio, webSearch} without a key -> 503" 503 "$(code POST /api/ai/analyses '{"kind":"cambio","webSearch":true}')"
```

(`S` is the `/api/ai/status` body already captured in that block; if the
variable name differs, reuse whatever the block assigned.)

- [ ] **Step 3: Run e2e**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (127 prior + 6 new).

- [ ] **Step 4: Restart live server + smoke (key configured)**

```bash
cd server && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'ai/usage unauth: %{http_code}\n' http://localhost:4173/api/ai/usage   # expect 401
```

Manual (key configured): on Análise, the "com contexto de mercado"
checkbox is present; check it and run "Converter dólares agora?" → the
answer references a current rate / cites a source; the "Uso da IA"
section shows a `Câmbio + web` row; a `claude_api_calls` row with
`endpoint='analysis:cambio+web'` exists and costs a few cents more than
a data-only câmbio run.

- [ ] **Step 5: Docs**

`docs/qa-checklist.md` — bump header counts; add a `## Câmbio +
contexto de mercado / Uso da IA (Phase 2.4)` section mirroring the unit
+ e2e coverage, plus the `[ ]` browser checks (checkbox present, a web
run cites a source, the Uso da IA breakdown + log render).

`README.md` — mark slice 4 done; note the Phase 2 Claude slices are
complete and Phase 2.5 (UX/UI polish) is next.

- [ ] **Step 6: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md README.md
git commit -m "Câmbio web search + Uso da IA: e2e assertions + docs"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `AiConfig.webSearch` (`FUMARENDE_AI_WEB_SEARCH`, `off`/`false`/`0`) + `webSearchMaxUses` | 1 |
| `.env.example` entries | 1 |
| `callClaude` `tools` passthrough; body omits `tools` when unset | 2 |
| `ClaudeResult.webSearchRequests` (from `usage.server_tool_use`, 0 default) | 2 |
| `estimateCostUsdCents` +$0.01/search (4th arg, default 0) | 2 |
| `webSearchTool(maxUses)` | 2 |
| `runAnalysis` `webSearch` dep; `useWeb` gate (`cambio` + dep + cfg) | 3 |
| market-aware `CAMBIO_WEB_SYSTEM`; `tools` + `maxTokens 1400` when web | 3 |
| ledger `endpoint` = `analysis:cambio+web` / `analysis:${kind}` for BOTH inserts | 3 |
| cost passes `result.webSearchRequests` | 3 |
| `AiStatus.webSearch`; `latestUsdBrlRate` extracted + shared | 3, 4 |
| `aiUsage` — mtd (this-month ok), `byEndpoint` (this-month ok, cost desc), `recent` (last 20 any) | 4 |
| `GET /api/ai/usage` (+ 401) | 4 |
| `POST /api/ai/analyses` `webSearch?` body → deps | 4 |
| frontend `AiStatus.webSearch`, `AiUsage` + `getAiUsage`, `runAiAnalysis(kind, webSearch?)` | 5 |
| `ConsultorIA` checkbox — câmbio-only, hidden when `!status.webSearch` | 5 |
| `AiUsageSection` — mtd line, by-kind table, collapsible log, soft error | 6 |
| rendered on Análise after `ConsultorIA`; test mocks + heading assert | 6 |
| e2e usage + webSearch assertions (no key); docs; README | 7 |
| no dep / no migration / usage returns no content | all (constraints) |

**Placeholder scan:** no `TODO`/`TBD`. Tasks 5–6 describe JSX in prose
but pin every `aria-label`, state name, label string, and api call; all
server logic (config parse, client body, cost, analysis gate, usage
SQL, route) is given in full. The `web_search_20250305` type string is
isolated in `web-search.ts` — a wrong value is a one-line fix caught by
the live smoke, never by CI.

**Type consistency:**
- `AiConfig` gains exactly `webSearch: boolean` + `webSearchMaxUses:
  number` (Task 1); every inline `AiConfig` literal in server tests is
  updated in Task 1 Step 5 so `tsc` stays green through Tasks 2–4.
- `ClaudeResult.webSearchRequests: number` (Task 2) — read in Task 3's
  cost call; every other `callClaude` caller ignores it.
- `estimateCostUsdCents(model, in, out, webSearchRequests?)` — Task 2
  signature; Task 3 passes 4 args, `categorize.ts`/`extract.ts` keep
  passing 3.
- `endpoint` strings `'analysis:cambio+web'` / `'analysis:${kind}'`
  (Task 3) === the `ENDPOINT_LABEL` keys in Task 6 and the e2e/tests in
  Task 4.
- `AiUsage` / `AiUsageEndpoint` / `AiUsageCall` — identical field names
  and types in `ai/usage.ts` (Task 4) and `lib/api.ts` (Task 5), and
  the `AnalisePage.test` / `AiUsageSection.test` fixtures (Task 6).
- `runAiAnalysis(kind, webSearch = false)` (Task 5) matches the Task 5
  test's `toHaveBeenCalledWith('cambio', true)` and the Task 4 route
  body `{ kind, webSearch }`.
- `latestUsdBrlRate(db, cfg)` exported from `analysis.ts` (Task 3),
  imported by `usage.ts` (Task 4) — one-directional, no cycle.
