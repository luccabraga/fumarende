# AI Foundation + On-Demand Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side Claude client, a call/cost ledger, and three
preset read-only financial analyses surfaced as a "Consultor IA" card on
the Análise page — all working end-to-end with no API key configured.

**Architecture:** A raw-`fetch` Claude client (`server/src/ai/`), a
migration adding `claude_api_calls` + `ai_analyses`, a snapshot built
from existing deterministic helpers, an analysis service enforcing a
soft monthly USD cap, Fastify routes behind `requireAuth`, and a
frontend card with a ~40-line first-party Markdown renderer. Every AI
route degrades to a clean "not configured" response when
`ANTHROPIC_API_KEY` is unset; the whole suite runs offline.

**Tech Stack:** Node 22+, TypeScript, Fastify 5, better-sqlite3, React
18, Vite 6, Vitest (+ `@testing-library/react`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-ai-foundation-analysis-design.md`

## Global Constraints

- **No new npm dependencies.** No `@anthropic-ai/sdk`, no `dotenv`, no
  `react-markdown`.
- **No API key required** to build, test, run, or pass e2e. Tests never
  make a real network call — the Claude client takes an injectable
  `fetchImpl`.
- **Read-only.** Nothing here writes to a Phase 1 financial table. The
  only new writes are to `claude_api_calls` and `ai_analyses`.
- `loadConfig` and every server test are pure functions of an explicit
  `env` / args object — never `process.env`, never the live DB.
- Cost is stored in **USD cents** (integer, half-up). Displayed in BRL
  using the latest `dollar_quotes.rate`, else `usdBrlFallbackRate`.
- Model id string: `claude-sonnet-5`. Anthropic endpoint:
  `https://api.anthropic.com/v1/messages`, header `anthropic-version:
  2023-06-01`.
- Migration id: `003_ai`, export `migration003`. It must be idempotent
  via the existing `schema_migrations` mechanism.
- TDD every task. Server tests run from `server/`, frontend from
  `frontend/`. Branch `ai-foundation` off `main`; the finishing skill
  merges it. One commit per task.

---

## Shared Types (defined in Task 1 & Task 5, referenced everywhere)

```ts
// server/src/config.ts
export interface AiConfig {
  apiKey: string | null;
  model: string;
  monthlyCapUsdCents: number;
  usdBrlFallbackRate: number;
}

// server/src/ai/analysis.ts
export type AnalysisKind = 'diagnostico' | 'poupanca' | 'cambio';

export interface AiAnalysisRow {
  id: number;
  createdAt: string;
  kind: AnalysisKind;
  responseMd: string;
  costUsdCents: number;
  model: string;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
}
```

The frontend `frontend/src/lib/api.ts` re-declares `AiStatus` and
`AiAnalysis` (= `AiAnalysisRow`) with identical field names/types.

---

## Task 1: Config `ai` block + `.env` loader

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/config.test.ts`
- Create: `server/src/load-env.ts`
- Create: `server/src/load-env.test.ts`
- Create: `server/.env.example`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `AiConfig` interface (above); `Config` gains `ai: AiConfig`.
  - `loadConfig(env)` populates `config.ai` from `ANTHROPIC_API_KEY`,
    `FUMARENDE_AI_MODEL`, `FUMARENDE_AI_MONTHLY_CAP_USD_CENTS`,
    `FUMARENDE_USD_BRL_FALLBACK`.
  - `export const NOT_CONFIGURED_AI: AiConfig` — `apiKey: null` + the
    defaults (used by `buildApp` when no `aiConfig` arg is passed).
  - `loadDotEnv(filePath: string): void` in `load-env.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/config.test.ts`:

```ts
  it('populates config.ai from env with defaults', () => {
    const c = loadConfig({});
    expect(c.ai).toEqual({
      apiKey: null,
      model: 'claude-sonnet-5',
      monthlyCapUsdCents: 400,
      usdBrlFallbackRate: 5.4,
    });
  });

  it('reads the AI env vars when set', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      FUMARENDE_AI_MODEL: 'claude-opus-5',
      FUMARENDE_AI_MONTHLY_CAP_USD_CENTS: '1000',
      FUMARENDE_USD_BRL_FALLBACK: '5.9',
    });
    expect(c.ai).toEqual({
      apiKey: 'sk-test',
      model: 'claude-opus-5',
      monthlyCapUsdCents: 1000,
      usdBrlFallbackRate: 5.9,
    });
  });
```

Create `server/src/load-env.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDotEnv } from './load-env.js';

const KEYS = ['LE_A', 'LE_B', 'LE_C', 'LE_QUOTED', 'LE_EXISTING'];
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

function writeEnv(contents: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'le-')), '.env');
  fs.writeFileSync(p, contents);
  return p;
}

describe('loadDotEnv', () => {
  it('sets KEY=VALUE pairs, ignores comments and blanks, strips quotes', () => {
    const p = writeEnv('# comment\nLE_A=hello\n\nLE_B = world \nLE_QUOTED="a b c"\n');
    loadDotEnv(p);
    expect(process.env.LE_A).toBe('hello');
    expect(process.env.LE_B).toBe('world');
    expect(process.env.LE_QUOTED).toBe('a b c');
  });

  it('does not override an already-set key', () => {
    process.env.LE_EXISTING = 'keep';
    const p = writeEnv('LE_EXISTING=overwrite\n');
    loadDotEnv(p);
    expect(process.env.LE_EXISTING).toBe('keep');
  });

  it('is a no-op when the file is missing', () => {
    expect(() => loadDotEnv('/no/such/file/.env')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/config.test.ts src/load-env.test.ts`
Expected: FAIL — `config.ai` undefined; `load-env.js` missing.

- [ ] **Step 3: Write `load-env.ts`**

```ts
import fs from 'node:fs';

/**
 * Minimal .env loader: `KEY=VALUE` per line, `#` comments and blank
 * lines ignored, optional surrounding single/double quotes stripped,
 * surrounding whitespace trimmed. Never overrides a key already present
 * in `process.env`. A missing file is a silent no-op.
 */
export function loadDotEnv(filePath: string): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '' || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
```

- [ ] **Step 4: Add the `ai` block to `config.ts`**

Add above `loadConfig`:

```ts
export interface AiConfig {
  apiKey: string | null;
  model: string;
  monthlyCapUsdCents: number;
  usdBrlFallbackRate: number;
}

const AI_MODEL_DEFAULT = 'claude-sonnet-5';
const AI_MONTHLY_CAP_USD_CENTS_DEFAULT = 400;
const USD_BRL_FALLBACK_DEFAULT = 5.4;

export const NOT_CONFIGURED_AI: AiConfig = {
  apiKey: null,
  model: AI_MODEL_DEFAULT,
  monthlyCapUsdCents: AI_MONTHLY_CAP_USD_CENTS_DEFAULT,
  usdBrlFallbackRate: USD_BRL_FALLBACK_DEFAULT,
};
```

Add `ai: AiConfig;` to the `Config` interface. In the object `loadConfig`
returns, add:

```ts
    ai: {
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      model: env.FUMARENDE_AI_MODEL ?? AI_MODEL_DEFAULT,
      monthlyCapUsdCents: Number(
        env.FUMARENDE_AI_MONTHLY_CAP_USD_CENTS ?? AI_MONTHLY_CAP_USD_CENTS_DEFAULT,
      ),
      usdBrlFallbackRate: Number(env.FUMARENDE_USD_BRL_FALLBACK ?? USD_BRL_FALLBACK_DEFAULT),
    },
```

- [ ] **Step 5: Create `server/.env.example`**

```
# Copy to server/.env (gitignored) and fill in. Leaving ANTHROPIC_API_KEY
# blank is fine — the server just runs without AI features.
ANTHROPIC_API_KEY=
# Optional tuning:
FUMARENDE_AI_MODEL=claude-sonnet-5
FUMARENDE_AI_MONTHLY_CAP_USD_CENTS=400
FUMARENDE_USD_BRL_FALLBACK=5.40
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx vitest run src/config.test.ts src/load-env.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts server/src/load-env.ts server/src/load-env.test.ts server/.env.example
git commit -m "AI config block + minimal .env loader

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Migration `003_ai` + data-layer wiring

**Files:**
- Create: `server/src/db/migrations/003_ai.ts`
- Modify: `server/src/db/migrate.ts`
- Modify: `server/src/db/migrate.test.ts`
- Modify: `server/src/data/tables.ts`
- Modify: `server/src/data/tables.test.ts`
- Modify: `server/src/data/diagnostics.ts`

**Interfaces:**
- Consumes: `Migration` type from `migrate.ts`.
- Produces: tables `claude_api_calls`, `ai_analyses`; both listed in
  `DATA_TABLES` (with `ai_analyses` **before** `claude_api_calls` so
  `wipeData`'s in-order `DELETE` clears the child first) and in
  `TABLES_WITHOUT_DELETED_AT`.

- [ ] **Step 1: Write the failing tests**

In `server/src/db/migrate.test.ts`, add `'claude_api_calls'` and
`'ai_analyses'` to the `for (const expected of [...])` list, and change
the final assertion to:

```ts
    expect(applied.map((r) => r.id)).toEqual([
      '001_initial_schema',
      '002_dollar_quotes',
      '003_ai',
    ]);
```

`server/src/data/tables.test.ts` already computes `expected` from the
live schema, so it will fail until `DATA_TABLES` includes the two new
names — no edit needed there yet; it is the red test for Step 4.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/db/migrate.test.ts src/data/tables.test.ts`
Expected: FAIL — `003_ai` not applied; `DATA_TABLES` missing two tables.

- [ ] **Step 3: Write `003_ai.ts` and register it**

Create `server/src/db/migrations/003_ai.ts`:

```ts
import type { Migration } from '../migrate.js';

export const migration003: Migration = {
  id: '003_ai',
  sql: `
    CREATE TABLE claude_api_calls (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL,
      endpoint       TEXT    NOT NULL,
      model          TEXT    NOT NULL,
      input_tokens   INTEGER NOT NULL DEFAULT 0,
      output_tokens  INTEGER NOT NULL DEFAULT 0,
      cost_usd_cents INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL,
      error_message  TEXT
    );

    CREATE TABLE ai_analyses (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at         TEXT    NOT NULL,
      kind               TEXT    NOT NULL,
      snapshot_json      TEXT    NOT NULL,
      response_md        TEXT    NOT NULL,
      claude_api_call_id INTEGER NOT NULL
    );
  `,
};
```

In `server/src/db/migrate.ts`: import `migration003` and change

```ts
const MIGRATIONS: Migration[] = [migration001, migration002, migration003];
```

- [ ] **Step 4: Wire the data layer**

`server/src/data/tables.ts` — add to `DATA_TABLES`, immediately after
`'dollar_quotes'` and before `'monthly_close'`:

```ts
  'ai_analyses',
  'claude_api_calls',
```

(`ai_analyses` first: `wipeData` iterates in array order, so the
referencing table is emptied before the referenced one.)

`server/src/data/diagnostics.ts` — add both to the
`TABLES_WITHOUT_DELETED_AT` set:

```ts
  'ai_analyses',
  'claude_api_calls',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/db/migrate.test.ts src/data/tables.test.ts src/data`
Expected: PASS (migrate, tables drift-guard, wipe/export/import/diagnostics round-trips).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all green (a couple of `data/*` round-trip tests now also
cover the two empty tables).

- [ ] **Step 7: Commit**

```bash
git add server/src/db/migrations/003_ai.ts server/src/db/migrate.ts server/src/db/migrate.test.ts server/src/data/tables.ts server/src/data/tables.test.ts server/src/data/diagnostics.ts
git commit -m "Migration 003_ai: claude_api_calls + ai_analyses ledgers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Claude client + cost estimator

**Files:**
- Create: `server/src/ai/cost.ts`
- Create: `server/src/ai/cost.test.ts`
- Create: `server/src/ai/client.ts`
- Create: `server/src/ai/client.test.ts`

**Interfaces:**
- Consumes: `AiConfig` from `config.ts`.
- Produces:
  - `estimateCostUsdCents(model: string, inTok: number, outTok: number): number`
  - `MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }>`
  - `callClaude(cfg: AiConfig, args: { system: string; user: string; maxTokens?: number }, fetchImpl?: typeof fetch): Promise<ClaudeResult>`
  - `ClaudeResult = { text: string; inputTokens: number; outputTokens: number }`
  - `class ClaudeNotConfiguredError extends Error`
  - `class ClaudeUpstreamError extends Error { httpStatus: number | null }`

- [ ] **Step 1: Write the failing tests**

Create `server/src/ai/cost.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { estimateCostUsdCents } from './cost.js';

describe('estimateCostUsdCents', () => {
  it('prices a known model at $3/$15 per Mtok, rounded half-up', () => {
    // 1,000,000 in + 100,000 out = 300c + 150c = 450c
    expect(estimateCostUsdCents('claude-sonnet-5', 1_000_000, 100_000)).toBe(450);
    // 1500 in + 700 out = 0.45c + 1.05c = 1.5c -> 2
    expect(estimateCostUsdCents('claude-sonnet-5', 1500, 700)).toBe(2);
  });

  it('throws for an unknown model', () => {
    expect(() => estimateCostUsdCents('mystery', 10, 10)).toThrow(/unknown model/i);
  });
});
```

Create `server/src/ai/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { callClaude, ClaudeNotConfiguredError, ClaudeUpstreamError } from './client.js';
import type { AiConfig } from '../config.js';

const CFG: AiConfig = {
  apiKey: 'sk-test',
  model: 'claude-sonnet-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
};

function okResponse() {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'Olá' }, { type: 'text', text: ' mundo' }],
      usage: { input_tokens: 12, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('callClaude', () => {
  it('throws ClaudeNotConfiguredError and never fetches when apiKey is null', async () => {
    const fetchImpl = vi.fn();
    await expect(
      callClaude({ ...CFG, apiKey: null }, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to the messages endpoint with the right headers/body and parses text + usage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const res = await callClaude(
      CFG,
      { system: 'sys', user: 'ask', maxTokens: 900 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ text: 'Olá mundo', inputTokens: 12, outputTokens: 5 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 900,
      system: 'sys',
      messages: [{ role: 'user', content: 'ask' }],
    });
  });

  it('maps a non-2xx response to ClaudeUpstreamError with the status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const err = await callClaude(CFG, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeUpstreamError);
    expect(err.httpStatus).toBe(429);
  });

  it('maps a network throw to ClaudeUpstreamError with httpStatus null', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const err = await callClaude(CFG, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeUpstreamError);
    expect(err.httpStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/ai/cost.test.ts src/ai/client.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `cost.ts`**

```ts
export const MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
};

/** USD cents, rounded half-up. Throws on an unpriced model. */
export function estimateCostUsdCents(model: string, inTok: number, outTok: number): number {
  const rate = MODEL_RATES_USD_PER_MTOK[model];
  if (!rate) throw new Error(`unknown model rate: ${model}`);
  const usd = (inTok / 1_000_000) * rate.input + (outTok / 1_000_000) * rate.output;
  return Math.round(usd * 100);
}
```

- [ ] **Step 4: Write `client.ts`**

```ts
import type { AiConfig } from '../config.js';

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super('Anthropic API key is not configured');
    this.name = 'ClaudeNotConfiguredError';
  }
}

export class ClaudeUpstreamError extends Error {
  constructor(message: string, readonly httpStatus: number | null) {
    super(message);
    this.name = 'ClaudeUpstreamError';
  }
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export async function callClaude(
  cfg: AiConfig,
  args: { system: string; user: string; maxTokens?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeResult> {
  if (cfg.apiKey === null) throw new ClaudeNotConfiguredError();

  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: args.maxTokens ?? 1200,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      }),
    });
  } catch (err) {
    throw new ClaudeUpstreamError(err instanceof Error ? err.message : String(err), null);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ClaudeUpstreamError(`Anthropic ${res.status}: ${body.slice(0, 500)}`, res.status);
  }

  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/ai/cost.test.ts src/ai/client.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/cost.ts server/src/ai/cost.test.ts server/src/ai/client.ts server/src/ai/client.test.ts
git commit -m "AI Claude client (raw fetch) + token cost estimator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Snapshot builder

**Files:**
- Create: `server/src/ai/snapshot.ts`
- Create: `server/src/ai/snapshot.test.ts`

**Interfaces:**
- Consumes: `dashboardSummary` (`../dashboard/summary.js`),
  `spendingBreakdown` + `projectSavings` (`../analysis/analysis.js` —
  confirmed exports), `essentialAverage`
  (`../savings/essential-average.js`). There is no server `reserveTiers`;
  compute `target3Cents`/`target6Cents` inline as `essentialAvgCents * 3`
  / `* 6` (the frontend `reserveTiers` does the same).
- Produces: `buildSnapshot(db: Database.Database, now?: Date): AnalysisSnapshot`
  and the `AnalysisSnapshot` interface. Every numeric field is
  cents/plain-number; the whole object is JSON-serialisable.

- [ ] **Step 1: Write the failing test**

Create `server/src/ai/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from '../data/seed.js';
import { buildSnapshot } from './snapshot.js';

const NOW = new Date(2026, 7, 15); // seed spans Jun/Jul/Aug 2026

function seeded() {
  const db = new Database(':memory:');
  runMigrations(db);
  seedTestData(db, NOW);
  return db;
}

describe('buildSnapshot', () => {
  it('produces a compact, serialisable snapshot from seeded data', () => {
    const s = buildSnapshot(seeded(), NOW);

    expect(s.month).toBe('2026-08');
    expect(s.income).toHaveLength(3);
    expect(s.income.map((r) => r.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(s.expenses.byCategory[0].cents).toBeGreaterThanOrEqual(
      s.expenses.byCategory[s.expenses.byCategory.length - 1].cents,
    );
    expect(s.reserve.balanceCents).toBe(750_000); // 700k + 150k - 100k
    expect(Array.isArray(s.goals)).toBe(true);

    const json = JSON.stringify(s);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json.length).toBeLessThan(8192);
  });

  it('handles an empty DB without throwing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const s = buildSnapshot(db, NOW);
    expect(s.income).toEqual([]);
    expect(s.savingsTarget).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/ai/snapshot.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `snapshot.ts`**

Implement `buildSnapshot` composing existing helpers. Shape:

```ts
export interface AnalysisSnapshot {
  month: string;
  generatedAt: string;
  income: { month: string; brlCents: number; usdCents: number }[]; // last 3 months asc
  expenses: {
    currentMonthCents: number;
    previousMonthCents: number;
    essentialCents: number;
    nonEssentialCents: number;
    byCategory: { category: string; cents: number }[]; // 3-month sum, desc
  };
  reserve: {
    balanceCents: number;
    essentialAvgCents: number;
    target3Cents: number;
    target6Cents: number;
  };
  savingsTarget: { targetCents: number; savedThisMonthCents: number; rolloverCents: number } | null;
  projection: { endTotalCents: number; endSavingsCents: number };
  goals: { name: string; currentCents: number; targetCents: number; targetDate: string | null }[];
  specialProjects: { name: string; currentCents: number; targetCents: number; targetDate: string | null }[];
  cambio: {
    recent: { date: string; amountUsdCents: number; contractedRate: number; spreadPct: number; netBrlCents: number }[];
    meanSpreadPct: number | null;
  };
  dollarQuotes: { recent: { month: string; rate: number; salaryUsdCents: number | null }[]; averageRate: number | null };
}
```

Rules:
- `month` / `generatedAt` from `now`.
- `income`: `SELECT substr(date,1,7) m, SUM(amount_brl_cents) b,
  COALESCE(SUM(amount_usd_cents),0) u FROM income WHERE deleted_at IS
  NULL GROUP BY m ORDER BY m DESC LIMIT 3`, reversed to ascending.
- `expenses`: reuse `dashboardSummary(db, { now })` for
  `currentMonthCents`, `previousMonthCents`, `essentialCents`,
  `nonEssentialCents`. `byCategory`: `SELECT category, SUM(amount_cents)
  cents FROM expenses WHERE deleted_at IS NULL AND date >= <first day of
  month-2> GROUP BY category ORDER BY cents DESC`.
- `reserve`: `balanceCents` = `SUM(amount_cents)` of
  `emergency_fund_entries WHERE deleted_at IS NULL`. `essentialAvgCents`
  via `essentialAverage(<all expenses>, monthAnchor)` where `monthAnchor
  = new Date(y, m-1, 15)` for the current month. `target3/6Cents` =
  `essentialAvgCents * 3` / `* 6`.
- `savingsTarget`: row from `savings_monthly_targets WHERE month =
  <current>`; `savedThisMonthCents` = current-month
  `emergency_fund_entries` sum; `null` when no row.
- `projection`: `projectSavings({ reserveBalanceCents, monthlyTargetCents:
  target?.target_cents ?? 0, goalsSavedCents })` — mirror how
  `AnalisePage`/server analysis calls it; take `endTotalCents` /
  `endSavingsCents` (or the last row's totals).
- `goals` / `specialProjects`: `SELECT name, current_cents, target_cents,
  target_date FROM <t> WHERE deleted_at IS NULL AND status = 'active'
  ORDER BY id`.
- `cambio.recent`: last 6 `exchange_contracts` (by id desc, reversed to
  asc), computing `spreadPct` via `calcCambio` like `dashboardSummary`
  does; `meanSpreadPct` = mean of those, or `null` if none.
- `dollarQuotes.recent`: last 6 `dollar_quotes` by month desc reversed;
  `averageRate` = mean rate or `null`.

Keep it defensive: every aggregate uses `COALESCE(...,0)`, arrays
default to `[]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/ai/snapshot.test.ts`
Expected: PASS. Adjust the seeded-value assertions only if the seed
fixture legitimately produces different numbers — do **not** loosen the
serialisability / size assertions.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/snapshot.ts server/src/ai/snapshot.test.ts
git commit -m "AI analysis snapshot builder (read-only, from existing helpers)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Analysis service

**Files:**
- Create: `server/src/ai/analysis.ts`
- Create: `server/src/ai/analysis.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot` (Task 4), `callClaude` + error classes
  (Task 3), `estimateCostUsdCents` (Task 3), `AiConfig` (Task 1).
- Produces:
  - `AnalysisKind`, `AiAnalysisRow`, `AiStatus` (shapes in "Shared
    Types").
  - `ANALYSES: Record<AnalysisKind, { label: string; system: string; userPrompt: (s: AnalysisSnapshot) => string; maxTokens: number }>`
  - `class BudgetExceededError extends Error { monthToDateUsdCents: number; capUsdCents: number }`
  - `runAnalysis(db, cfg, kind, deps?: { now?: Date; fetchImpl?: typeof fetch }): Promise<AiAnalysisRow>`
  - `listAnalyses(db, limit?: number): AiAnalysisRow[]`
  - `aiStatus(db, cfg, now?: Date): AiStatus`

- [ ] **Step 1: Write the failing tests**

Create `server/src/ai/analysis.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from '../data/seed.js';
import {
  runAnalysis,
  listAnalyses,
  aiStatus,
  BudgetExceededError,
} from './analysis.js';
import { ClaudeUpstreamError } from './client.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk-test',
  model: 'claude-sonnet-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
};

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  seedTestData(d, NOW);
  return d;
}
function fakeFetch(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), { status: 200 }),
  );
}

describe('runAnalysis', () => {
  it('writes one ok call row + one analysis row and returns the joined shape', async () => {
    const d = db();
    const row = await runAnalysis(d, CFG, 'diagnostico', { now: NOW, fetchImpl: fakeFetch('# Resultado\nOk') });

    expect(row).toMatchObject({ kind: 'diagnostico', responseMd: '# Resultado\nOk', model: 'claude-sonnet-5' });
    expect(row.costUsdCents).toBe(750); // 1000in*3/M + 500out*15/M = 0.3c+0.75c... -> see cost test; adjust to actual
    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok'").get()).toEqual({ n: 1 });
    expect(d.prepare('SELECT COUNT(*) n FROM ai_analyses').get()).toEqual({ n: 1 });
  });

  it('records an error row and re-throws on an upstream failure', async () => {
    const d = db();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      runAnalysis(d, CFG, 'poupanca', { now: NOW, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(ClaudeUpstreamError);

    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error'").get()).toEqual({ n: 1 });
    expect(d.prepare('SELECT COUNT(*) n FROM ai_analyses').get()).toEqual({ n: 0 });
  });

  it('throws BudgetExceededError and makes no call once month-to-date >= cap', async () => {
    const d = db();
    d.prepare(
      `INSERT INTO claude_api_calls (created_at, endpoint, model, cost_usd_cents, status)
       VALUES (?, 'x', 'claude-sonnet-5', 400, 'ok')`,
    ).run(NOW.toISOString());
    const fetchImpl = vi.fn();
    await expect(
      runAnalysis(d, CFG, 'diagnostico', { now: NOW, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('listAnalyses / aiStatus', () => {
  it('lists newest first with cost joined', async () => {
    const d = db();
    await runAnalysis(d, CFG, 'diagnostico', { now: NOW, fetchImpl: fakeFetch('a') });
    await runAnalysis(d, CFG, 'cambio', { now: NOW, fetchImpl: fakeFetch('b') });
    const rows = listAnalyses(d, 10);
    expect(rows.map((r) => r.kind)).toEqual(['cambio', 'diagnostico']);
    expect(rows[0]).toHaveProperty('costUsdCents');
  });

  it('reports configured flag, month-to-date spend, and a dollar-quote rate', () => {
    const d = db();
    const st = aiStatus(d, CFG, NOW);
    expect(st.configured).toBe(true);
    expect(st.capUsdCents).toBe(400);
    expect(st.usdBrlRate).toBeGreaterThan(0); // seed writes dollar_quotes
    expect(aiStatus(d, { ...CFG, apiKey: null }, NOW).configured).toBe(false);
  });
});
```

> Note: fix the `costUsdCents` expectation in the first test to whatever
> `estimateCostUsdCents('claude-sonnet-5', 1000, 500)` actually returns
> (compute it: `1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105` USD
> → `1.05c` → **1**). Use `1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/ai/analysis.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `analysis.ts`**

Key pieces:

```ts
import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';
import { buildSnapshot, type AnalysisSnapshot } from './snapshot.js';
import { callClaude, ClaudeNotConfiguredError, ClaudeUpstreamError } from './client.js';
import { estimateCostUsdCents } from './cost.js';

export type AnalysisKind = 'diagnostico' | 'poupanca' | 'cambio';

export interface AiAnalysisRow {
  id: number;
  createdAt: string;
  kind: AnalysisKind;
  responseMd: string;
  costUsdCents: number;
  model: string;
}
export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
}

export class BudgetExceededError extends Error {
  constructor(readonly monthToDateUsdCents: number, readonly capUsdCents: number) {
    super('AI monthly cap reached');
    this.name = 'BudgetExceededError';
  }
}

const SHARED_GUARDRAIL =
  'Responda em português do Brasil, em Markdown (GitHub-flavored). Baseie cada afirmação ' +
  'estritamente nos dados JSON fornecidos; não invente números. Seja direto, no máximo ~250 palavras.';

export const ANALYSES: Record<AnalysisKind, {
  label: string;
  system: string;
  userPrompt: (s: AnalysisSnapshot) => string;
  maxTokens: number;
}> = {
  diagnostico: {
    label: 'Diagnóstico geral',
    system: `Você é um consultor financeiro pessoal. ${SHARED_GUARDRAIL} Estruture: pontos fortes, riscos, e exatamente 3 ações concretas.`,
    userPrompt: (s) => `Analise minha situação financeira e dê um diagnóstico.\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 1200,
  },
  poupanca: {
    label: 'Estou poupando o suficiente?',
    system: `Você é um consultor financeiro pessoal focado em reserva de emergência e metas. ${SHARED_GUARDRAIL} Compare o que é guardado com as metas 3x/6x e a meta mensal; sugira um valor mensal.`,
    userPrompt: (s) => `Estou poupando o suficiente? Considere reserva, meta mensal e metas.\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 1000,
  },
  cambio: {
    label: 'Converter dólares agora?',
    system: `Você é um consultor de câmbio. ${SHARED_GUARDRAIL} Você NÃO tem dados de mercado ao vivo — raciocine apenas pelo histórico de contratos e cotações informadas pelo usuário (tendência de spread, timing do salário). Deixe claro que não é recomendação de investimento.`,
    userPrompt: (s) => `Devo converter dólares para reais agora, com base no meu histórico?\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 900,
  },
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
```

`runAnalysis`:

```ts
export async function runAnalysis(
  db: Database.Database,
  cfg: AiConfig,
  kind: AnalysisKind,
  deps: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<AiAnalysisRow> {
  const now = deps.now ?? new Date();
  const spec = ANALYSES[kind];
  if (!spec) throw new Error(`unknown analysis kind: ${kind}`);

  const mtd = (
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd_cents),0) n FROM claude_api_calls WHERE status='ok' AND substr(created_at,1,7)=?",
      )
      .get(monthKey(now)) as { n: number }
  ).n;
  if (mtd >= cfg.monthlyCapUsdCents) throw new BudgetExceededError(mtd, cfg.monthlyCapUsdCents);

  const snapshot = buildSnapshot(db, now);

  let result;
  try {
    result = await callClaude(
      cfg,
      { system: spec.system, user: spec.userPrompt(snapshot), maxTokens: spec.maxTokens },
      deps.fetchImpl ?? fetch,
    );
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) throw err; // nothing happened
    if (err instanceof ClaudeUpstreamError) {
      db.prepare(
        `INSERT INTO claude_api_calls (created_at, endpoint, model, status, error_message)
         VALUES (?, ?, ?, 'error', ?)`,
      ).run(now.toISOString(), `analysis:${kind}`, cfg.model, String(err.message).slice(0, 500));
    }
    throw err;
  }

  let cost = 0;
  try {
    cost = estimateCostUsdCents(cfg.model, result.inputTokens, result.outputTokens);
  } catch {
    cost = 0; // unpriced model — tokens known, price not; keep the ledger honest
  }

  const insert = db.transaction((): AiAnalysisRow => {
    const callId = Number(
      db
        .prepare(
          `INSERT INTO claude_api_calls (created_at, endpoint, model, input_tokens, output_tokens, cost_usd_cents, status)
           VALUES (?, ?, ?, ?, ?, ?, 'ok')`,
        )
        .run(now.toISOString(), `analysis:${kind}`, cfg.model, result.inputTokens, result.outputTokens, cost)
        .lastInsertRowid,
    );
    const analysisId = Number(
      db
        .prepare(
          `INSERT INTO ai_analyses (created_at, kind, snapshot_json, response_md, claude_api_call_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(now.toISOString(), kind, JSON.stringify(snapshot), result.text, callId).lastInsertRowid,
    );
    return {
      id: analysisId,
      createdAt: now.toISOString(),
      kind,
      responseMd: result.text,
      costUsdCents: cost,
      model: cfg.model,
    };
  });
  return insert();
}
```

`listAnalyses`:

```ts
export function listAnalyses(db: Database.Database, limit = 20): AiAnalysisRow[] {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  return db
    .prepare(
      `SELECT a.id, a.created_at AS createdAt, a.kind, a.response_md AS responseMd,
              c.cost_usd_cents AS costUsdCents, c.model AS model
       FROM ai_analyses a
       LEFT JOIN claude_api_calls c ON c.id = a.claude_api_call_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(n) as AiAnalysisRow[];
}
```

`aiStatus`:

```ts
export function aiStatus(db: Database.Database, cfg: AiConfig, now: Date = new Date()): AiStatus {
  const monthToDateUsdCents = (
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd_cents),0) n FROM claude_api_calls WHERE status='ok' AND substr(created_at,1,7)=?",
      )
      .get(monthKey(now)) as { n: number }
  ).n;
  const q = db
    .prepare('SELECT rate FROM dollar_quotes WHERE deleted_at IS NULL ORDER BY month DESC LIMIT 1')
    .get() as { rate: number } | undefined;
  return {
    configured: cfg.apiKey !== null,
    model: cfg.model,
    monthToDateUsdCents,
    capUsdCents: cfg.monthlyCapUsdCents,
    usdBrlRate: q?.rate ?? cfg.usdBrlFallbackRate,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/ai/analysis.test.ts`
Expected: PASS. Fix the `costUsdCents` assertion to `1` per the note.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/analysis.ts server/src/ai/analysis.test.ts
git commit -m "AI analysis service: presets, soft monthly cap, call+result ledger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: AI routes + buildApp/index wiring

**Files:**
- Create: `server/src/routes/ai.ts`
- Create: `server/src/routes/ai.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `runAnalysis`, `listAnalyses`, `aiStatus`, `AnalysisKind`,
  `BudgetExceededError` (Task 5); `ClaudeNotConfiguredError`,
  `ClaudeUpstreamError` (Task 3); `AiConfig`, `NOT_CONFIGURED_AI` (Task 1).
- Produces: `registerAiRoutes(app, db, cfg: AiConfig)`; `buildApp` gains
  a 4th param `aiConfig?: AiConfig` (defaults to `NOT_CONFIGURED_AI`).

- [ ] **Step 1: Write the failing tests**

Create `server/src/routes/ai.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authedApp(aiConfig?: Parameters<typeof buildApp>[3]) {
  const app = await buildApp(new Database(':memory:'), undefined, undefined, aiConfig);
  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'test-password' } });
  const session = setup.cookies.find((c) => c.name === 'session')!.value;
  return { app, session };
}

describe('AI routes (no key configured)', () => {
  it('401s without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/ai/status' })).statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/ai/status reports configured:false', async () => {
    const { app, session } = await authedApp();
    const res = await app.inject({ method: 'GET', url: '/api/ai/status', cookies: { session } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, capUsdCents: 400 });
    await app.close();
  });

  it('POST /api/ai/analyses -> 503 when not configured, 400 on a bad kind', async () => {
    const { app, session } = await authedApp();
    const notConfigured = await app.inject({
      method: 'POST', url: '/api/ai/analyses', cookies: { session }, payload: { kind: 'diagnostico' },
    });
    expect(notConfigured.statusCode).toBe(503);

    const badKind = await app.inject({
      method: 'POST', url: '/api/ai/analyses', cookies: { session }, payload: { kind: 'nope' },
    });
    expect(badKind.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/ai/analyses -> 200 [] and rejects limit=0', async () => {
    const { app, session } = await authedApp();
    expect((await app.inject({ method: 'GET', url: '/api/ai/analyses', cookies: { session } })).json()).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: '/api/ai/analyses?limit=0', cookies: { session } })).statusCode,
    ).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/routes/ai.test.ts`
Expected: FAIL — route not registered; `buildApp` has no 4th param.

- [ ] **Step 3: Write `routes/ai.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import type { AiConfig } from '../config.js';
import {
  runAnalysis,
  listAnalyses,
  aiStatus,
  ANALYSES,
  BudgetExceededError,
  type AnalysisKind,
} from '../ai/analysis.js';
import { ClaudeNotConfiguredError, ClaudeUpstreamError } from '../ai/client.js';

export function registerAiRoutes(app: FastifyInstance, db: Database.Database, cfg: AiConfig): void {
  app.get('/api/ai/status', { preHandler: requireAuth(db) }, async () => aiStatus(db, cfg));

  app.get<{ Querystring: { limit?: string } }>(
    '/api/ai/analyses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const raw = request.query.limit;
      if (raw !== undefined) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 100) {
          return reply.code(400).send({ error: 'limit must be an integer 1–100' });
        }
        return listAnalyses(db, n);
      }
      return listAnalyses(db);
    },
  );

  app.post<{ Body: { kind?: string } }>(
    '/api/ai/analyses',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const kind = request.body?.kind;
      if (!kind || !(kind in ANALYSES)) {
        return reply.code(400).send({ error: 'unknown analysis kind' });
      }
      try {
        const row = await runAnalysis(db, cfg, kind as AnalysisKind);
        return reply.code(201).send(row);
      } catch (err) {
        if (err instanceof ClaudeNotConfiguredError) {
          return reply.code(503).send({ error: 'IA não configurada' });
        }
        if (err instanceof BudgetExceededError) {
          return reply.code(429).send({
            error: 'Limite mensal de IA atingido',
            monthToDateUsdCents: err.monthToDateUsdCents,
            capUsdCents: err.capUsdCents,
          });
        }
        if (err instanceof ClaudeUpstreamError) {
          return reply.code(502).send({ error: 'Falha ao consultar a IA' });
        }
        throw err;
      }
    },
  );
}
```

- [ ] **Step 4: Wire `app.ts`**

- Import: `import { registerAiRoutes } from './routes/ai.js';` and
  `import { NOT_CONFIGURED_AI, type AiConfig } from './config.js';`
- Signature:

```ts
export async function buildApp(
  db: Database.Database,
  frontendDistDir?: string,
  dataPaths?: { dbPath: string; backupDir: string },
  aiConfig: AiConfig = NOT_CONFIGURED_AI,
): Promise<FastifyInstance> {
```

- After `registerDashboardRoutes(app, db, dataPaths);` add
  `registerAiRoutes(app, db, aiConfig);`

- [ ] **Step 5: Wire `index.ts`**

```ts
import path from 'node:path';
import { loadDotEnv } from './load-env.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';

loadDotEnv(path.join(process.cwd(), '.env'));
const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp(
  db,
  config.frontendDistDir,
  { dbPath: config.dbPath, backupDir: config.backupDir },
  config.ai,
);
```

(keep the existing `app.listen` try/catch)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx vitest run src/routes/ai.test.ts && npm test`
Expected: `ai.test.ts` PASS; full suite green (existing `buildApp`
callers unaffected — the 4th param defaults).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/ai.ts server/src/routes/ai.test.ts server/src/app.ts server/src/index.ts
git commit -m "AI routes (/api/ai/status, /api/ai/analyses) + buildApp/.env wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend Markdown renderer

**Files:**
- Create: `frontend/src/lib/markdown.tsx`
- Create: `frontend/src/lib/markdown.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Markdown({ source }: { source: string }): JSX.Element` — a
  `<div>` of block elements. No `dangerouslySetInnerHTML`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/markdown.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders headings, paragraphs, bold, and lists', () => {
    render(
      <Markdown
        source={'# Título\n\nUm **forte** e um *ênfase*.\n\n- a\n- b\n\n1. um\n2. dois'}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeInTheDocument();
    expect(screen.getByText('forte').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b', 'um', 'dois']);
  });

  it('renders inline code and does not inject HTML', () => {
    render(<Markdown source={'Use `x` aqui. <script>alert(1)</script>'} />);
    expect(screen.getByText('x').tagName).toBe('CODE');
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/markdown.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `markdown.tsx`**

A minimal block parser. Split `source` into lines; group into blocks
(heading / unordered list / ordered list / paragraph, blank line ends a
block). Render inline spans with a single regex pass over
`` `code` ``, `**bold**`, `*italic*`, emitting `<code>`, `<strong>`,
`<em>`, or plain strings as React children (so any literal `<` stays
text). Keep it ~60 lines. Export `Markdown`. Example inline renderer:

```tsx
import { Fragment, type ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`')) return <code key={i}>{tok.slice(1, -1)}</code>;
    if (tok.startsWith('**') && tok.endsWith('**')) return <strong key={i}>{tok.slice(2, -2)}</strong>;
    if (tok.startsWith('*') && tok.endsWith('*')) return <em key={i}>{tok.slice(1, -1)}</em>;
    return <Fragment key={i}>{tok}</Fragment>;
  });
}
```

Block loop: `#`/`##`/`###ppp ` → `<h1|h2|h3>`; lines matching `/^\s*[-*]\s+/`
collect into `<ul><li>`; lines matching `/^\s*\d+\.\s+/` into `<ol><li>`;
otherwise join consecutive non-blank lines into a `<p>`. Wrap all blocks
in a `<div className="markdown">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/markdown.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/markdown.tsx frontend/src/lib/markdown.test.tsx
git commit -m "Add a minimal first-party Markdown renderer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend API + ConsultorIA card + Análise wiring

**Files:**
- Modify: `frontend/src/lib/api.ts` (add 3 fns + a `status` field on the thrown error)
- Create: `frontend/src/components/ConsultorIA.tsx`
- Create: `frontend/src/components/ConsultorIA.test.tsx`
- Modify: `frontend/src/pages/AnalisePage.tsx`
- Modify: `frontend/src/pages/AnalisePage.test.tsx`

**Pre-step — expose the HTTP status on request errors.** `request()`
currently does `throw new Error(body.error ?? 'Request failed')` with no
status. Change those two lines to:

```ts
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    const err = new Error(body.error ?? 'Request failed') as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
```

No existing test inspects this error's shape, so the full frontend suite
must stay green after the change (run it as part of Step 7).

**Interfaces:**
- Consumes: `Markdown` (Task 7); the three new api fns.
- Produces:
  - `api.getAiStatus(): Promise<AiStatus>`
  - `api.listAiAnalyses(limit?: number): Promise<AiAnalysis[]>`
  - `api.runAiAnalysis(kind): Promise<AiAnalysis>`
  - `<ConsultorIA />` rendered at the bottom of `AnalisePage`.

- [ ] **Step 1: Add the api functions**

In `frontend/src/lib/api.ts` (near the dashboard section):

```ts
export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
}
export interface AiAnalysis {
  id: number;
  createdAt: string;
  kind: 'diagnostico' | 'poupanca' | 'cambio';
  responseMd: string;
  costUsdCents: number;
  model: string;
}
export function getAiStatus(): Promise<AiStatus> {
  return request('/api/ai/status');
}
export function listAiAnalyses(limit?: number): Promise<AiAnalysis[]> {
  return request(`/api/ai/analyses${limit ? `?limit=${limit}` : ''}`);
}
export function runAiAnalysis(kind: AiAnalysis['kind']): Promise<AiAnalysis> {
  return request('/api/ai/analyses', { method: 'POST', body: JSON.stringify({ kind }) });
}
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/ConsultorIA.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConsultorIA } from './ConsultorIA.js';
import * as api from '../lib/api.js';

const STATUS_ON: api.AiStatus = {
  configured: true, model: 'claude-sonnet-5',
  monthToDateUsdCents: 50, capUsdCents: 400, usdBrlRate: 5,
};

beforeEach(() => {
  vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('ConsultorIA', () => {
  it('disables the buttons and shows a note when not configured', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue({ ...STATUS_ON, configured: false });
    render(<ConsultorIA />);
    const btn = await screen.findByRole('button', { name: 'Diagnóstico geral' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
  });

  it('runs a preset and renders the Markdown response', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    const run = vi.spyOn(api, 'runAiAnalysis').mockResolvedValue({
      id: 1, createdAt: '2026-08-15T00:00:00Z', kind: 'diagnostico',
      responseMd: '## Diagnóstico\nVocê vai bem.', costUsdCents: 1, model: 'claude-sonnet-5',
    });
    render(<ConsultorIA />);
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnóstico geral' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('diagnostico'));
    expect(await screen.findByRole('heading', { name: 'Diagnóstico' })).toBeInTheDocument();
  });

  it('shows the limit warning on a 429', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    vi.spyOn(api, 'runAiAnalysis').mockRejectedValue(
      Object.assign(new Error('Limite mensal de IA atingido'), { status: 429 }),
    );
    render(<ConsultorIA />);
    fireEvent.click(await screen.findByRole('button', { name: 'Estou poupando o suficiente?' }));
    expect(await screen.findByText(/Limite mensal de IA atingido/)).toBeInTheDocument();
  });

  it('lists history collapsed and expands an entry', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([
      { id: 2, createdAt: '2026-08-10T00:00:00Z', kind: 'cambio', responseMd: '# Câmbio\nEspere.', costUsdCents: 1, model: 'm' },
    ]);
    render(<ConsultorIA />);
    const toggle = await screen.findByRole('button', { name: /Histórico/ });
    fireEvent.click(toggle);
    expect(await screen.findByRole('heading', { name: 'Câmbio' })).toBeInTheDocument();
  });
});
```

The `{ status: 429 }` shape in the test above matches the Pre-step change
(`err.status = response.status`). `ConsultorIA` branches on
`err.status === 429` for the cap warning, anything else → the generic
"Falha ao consultar a IA. Tente novamente."

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 4: Write `ConsultorIA.tsx`**

A `<div className="card">` with:
- `useEffect` on mount: `Promise.all([getAiStatus(), listAiAnalyses()])`
  into state; on error, set a soft error string (card still renders).
- Header: `<h2>Consultor IA</h2>` + a `<span>` spend line —
  `IA este mês: {formatCentsBRL(Math.round(monthToDateUsdCents * usdBrlRate))} / {formatCentsBRL(Math.round(capUsdCents * usdBrlRate))}`.
- If `!configured`: `<p className="…">Configure <code>ANTHROPIC_API_KEY</code> no servidor para habilitar.</p>`
- Three `<button>`s from a local `const PRESETS = [['diagnostico','Diagnóstico geral'],['poupanca','Estou poupando o suficiente?'],['cambio','Converter dólares agora?']] as const;`
  — `disabled={!configured || pending !== null}`. Click → `setPending(kind)`,
  `runAiAnalysis(kind)`, on success `setLatest(row)` + prepend to
  `history` + refresh the spend line from `row.costUsdCents`; on error
  set `warn` (429 → "Limite mensal de IA atingido." else "Falha ao
  consultar a IA. Tente novamente."). `finally setPending(null)`.
- Latest: `{latest && <Markdown source={latest.responseMd} />}`
- History: a `<button>` toggling a list; each row
  `{kind label} · {new Date(createdAt).toLocaleDateString('pt-BR')} · {formatCentsBRL(...)}`
  → click sets that row as the expanded one, shown via `<Markdown>`.

- [ ] **Step 5: Render it on the Análise page**

`frontend/src/pages/AnalisePage.tsx` — `import { ConsultorIA } from
'../components/ConsultorIA.js';` and add `<ConsultorIA />` as the last
child of the page `<div>`, after the "Cenários" card. No other change.

- [ ] **Step 6: Update `AnalisePage.test.tsx`**

In `beforeEach`, add:

```ts
  vi.spyOn(api, 'getAiStatus').mockResolvedValue({
    configured: false, model: 'claude-sonnet-5',
    monthToDateUsdCents: 0, capUsdCents: 400, usdBrlRate: 5,
  });
  vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([]);
```

Add one assertion in the "renders the four sections" test:

```ts
    expect(await screen.findByRole('heading', { name: 'Consultor IA' })).toBeInTheDocument();
```

- [ ] **Step 7: Run tests + type-check**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx src/pages/AnalisePage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test && npx tsc -p tsconfig.json --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/ConsultorIA.tsx frontend/src/components/ConsultorIA.test.tsx frontend/src/pages/AnalisePage.tsx frontend/src/pages/AnalisePage.test.tsx
git commit -m "Consultor IA card on Análise: preset analyses + spend line + history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: e2e, docs

**Files:**
- Modify: `scripts/qa-e2e.sh`
- Modify: `docs/qa-checklist.md`
- Modify: `README.md`

**Key delivery — no script changes needed.** launchd sets the process
cwd to `WorkingDirectory` (`<repo>/server`), and `index.ts` already
calls `loadDotEnv(path.join(process.cwd(), '.env'))` (Task 6). So the
user just creates `server/.env` with `ANTHROPIC_API_KEY=…` (gitignored,
documented by `server/.env.example` from Task 1) and restarts the
service — the plist and `install-launchd.sh` stay untouched.

- [ ] **Step 1: Full sweep + builds**

Run: `cd server && npm test` — green.
Run: `cd frontend && npm test` — green.
Run: `cd server && npm run build` — exit 0.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 2: Extend `scripts/qa-e2e.sh`**

Add a new section after the Dashboard block (the throwaway env has **no**
`ANTHROPIC_API_KEY`):

```bash
echo
echo "== IA (Phase 2, sem chave configurada) =="
S="$(body GET /api/ai/status)"
aeq "ai/status configured is false" "false" "$(echo "$S" | jq -r '.configured')"
aeq "ai/status cap is 400" "400" "$(echo "$S" | jq -r '.capUsdCents')"
as  "POST ai/analyses without a key -> 503" 503 "$(code POST /api/ai/analyses '{"kind":"diagnostico"}')"
as  "POST ai/analyses bad kind -> 400" 400 "$(code POST /api/ai/analyses '{"kind":"nope"}')"
aeq "ai/analyses list is empty" "[]" "$(body GET /api/ai/analyses | jq -c '.')"
as  "ai/analyses?limit=0 -> 400" 400 "$(code GET '/api/ai/analyses?limit=0')"
```

- [ ] **Step 3: Run e2e**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (103 prior + 6 new = 109).

- [ ] **Step 4: Confirm the key path (no code change)**

`grep -n "loadDotEnv" server/src/index.ts` — verify Task 6 wired it and
that `server/.env.example` exists. Nothing to edit; `server/.env` is the
delivery mechanism and is already gitignored.

- [ ] **Step 5: Restart live server + smoke (still no key)**

```bash
cd server && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'ai/status unauth: %{http_code}\n' http://localhost:4173/api/ai/status   # expect 401
```

(Optionally log in via the browser and confirm the Análise page shows a
disabled "Consultor IA" card.)

- [ ] **Step 6: Docs**

`docs/qa-checklist.md` — bump the header counts (server + frontend test
totals, e2e assertion count) and add an `## IA — fundação + análise`
section mirroring the e2e assertions plus the `[ ]` browser checks
(card visible + disabled without a key; with a key, a preset returns
Markdown and the spend line moves).

`README.md` — update the status paragraph: Phase 1 + month selector
complete; Phase 2 sub-project 2.1 (Claude foundation + on-demand
analysis) shipped, key not yet configured; 2.2 auto-categorization next.

- [ ] **Step 7: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md README.md
git commit -m "AI foundation: e2e assertions + docs"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| Config `ai` block (key, model, cap, fallback rate) + defaults | 1 |
| `.env` loader, no `dotenv`, no override, missing-file no-op | 1 |
| `server/.env.example`, `.env` gitignored | 1 |
| Migration `003_ai` — `claude_api_calls` + `ai_analyses`, idempotent | 2 |
| `DATA_TABLES` + `TABLES_WITHOUT_DELETED_AT` + drift guard | 2 |
| `ai_analyses` before `claude_api_calls` for `wipeData` order | 2 |
| Raw-`fetch` client, injectable `fetchImpl`, typed errors | 3 |
| `ClaudeNotConfiguredError` before any network call | 3 |
| Non-2xx → `ClaudeUpstreamError(status)`; network → `(null)` | 3 |
| `estimateCostUsdCents`, model rate table, unknown-model throw | 3 |
| Snapshot from existing helpers, serialisable, size-bounded | 4 |
| Three preset analyses with pt-BR + data-only guardrails | 5 |
| Soft monthly cap checked before the call | 5 |
| Success writes `ok` call row + analysis row in one txn | 5 |
| Upstream failure writes `error` row and re-throws | 5 |
| Unknown model → cost 0, still `ok` | 5 |
| `listAnalyses` newest-first + cost join; `aiStatus` w/ rate fallback | 5 |
| `GET /api/ai/status` | 6 |
| `GET /api/ai/analyses?limit=` (400 on 1–100 violation) | 6 |
| `POST /api/ai/analyses` — 201 / 400 / 503 / 429 / 502 | 6 |
| `buildApp` optional `aiConfig` defaulting to not-configured | 6 |
| `index.ts` `loadDotEnv` before `loadConfig`, passes `config.ai` | 6 |
| `snapshot_json` stored, not returned by the API | 5 (insert) / 6 (row shape omits it) |
| First-party `<Markdown>`, no `dangerouslySetInnerHTML` | 7 |
| `ConsultorIA` card: presets, spend line, disabled w/o key, history | 8 |
| Rendered at the bottom of `AnalisePage`, math untouched | 8 |
| `AnalisePage.test` mocks the 3 fns + asserts the heading | 8 |
| e2e no-key assertions | 9 |
| Key via `server/.env` (gitignored) + `.env.example`, no plist edit | 1, 6, 9 |
| `docs/qa-checklist.md` + `README.md` | 9 |

**Placeholder scan:** no literal `TODO`/`TBD`/`__PLACEHOLDER__` tokens.
Task 4 Step 3 and Task 8 Step 4 describe prose algorithms rather than
full code for the two genuinely mechanical pieces (snapshot SQL, card
JSX) but pin every field name, query shape, and class name they use; no
"handle errors" hand-waving.

**Type consistency:**
- `AiConfig` — defined Task 1, consumed identically in Tasks 3/5/6.
- `AiAnalysisRow` (server) ≡ `AiAnalysis` (frontend): `{ id:number,
  createdAt:string, kind:'diagnostico'|'poupanca'|'cambio',
  responseMd:string, costUsdCents:number, model:string }` — Tasks 5, 6, 8
  agree; `snapshot_json` is never in this shape.
- `AiStatus` — `{ configured, model, monthToDateUsdCents, capUsdCents,
  usdBrlRate }` identical in Tasks 5, 6, 8.
- `callClaude(cfg, { system, user, maxTokens? }, fetchImpl?)` — signature
  identical in Task 3 def, Task 3 tests, and Task 5's call.
- `runAnalysis(db, cfg, kind, deps?)` — Task 5 def matches Task 5 tests
  and the Task 6 route call (`runAnalysis(db, cfg, kind)`, deps omitted).
- `estimateCostUsdCents(model, inTok, outTok)` — Task 3 def matches Task
  5 usage.
- `NOT_CONFIGURED_AI: AiConfig` — Task 1 export, Task 6 default param.
- Migration export name `migration003` / id `'003_ai'` — Task 2
  throughout, matches the `migration001`/`migration002` pattern.
- `buildApp` 4th positional param `aiConfig?` — Task 6 signature matches
  the Task 6 test's `buildApp(db, undefined, undefined, aiConfig)` and
  Task 6's `index.ts` call.
