# Auto-categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill in `expenses.category` automatically — a free keyword-rule
pass, then a cheap Haiku fallback for unknown merchants that also learns
a new rule — triggered on expense create and by a "Categorizar
pendentes" batch button.

**Architecture:** A `server/src/categorize/` pipeline
(`categories` → `rules` → `claude-categorize` → `categorize`
orchestrator) reusing 2.1's Claude client, `claude_api_calls` ledger,
and monthly cap (extracted to `server/src/ai/budget.ts`). `category`
becomes optional at create time; blank rows are swept by
`POST /api/expenses/categorize-pending`. `category_rules` gets CRUD
routes and a management section on the Gastos page. No migration
(`category_rules` already exists; "uncategorized" is `category = ''`).

**Tech Stack:** Node 22+, TypeScript, Fastify 5, better-sqlite3, React
18, Vite 6, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-auto-categorization-design.md`

## Global Constraints

- **No new npm dependencies. No migration.**
- Creating an expense must **never fail** because of categorization
  (missing key, cap reached, upstream error, bad reply) — the row is
  just saved with `category = ''`.
- A keyword rule always wins; Claude is called only when no rule matches
  **and** `cfg.apiKey !== null` **and** the monthly cap is not reached.
- Categorization model: `cfg.categorizeModel`, default
  `claude-haiku-4-5` (analysis keeps `cfg.model`). Haiku rates
  `$1 / $5` per Mtok.
- Categorize calls write one `claude_api_calls` row each
  (`endpoint: 'categorize'`), count toward the same monthly cap and the
  "IA este mês" line.
- Only the expense **description** string is sent to Anthropic — no
  amounts/dates.
- `category_rules.keyword` is stored lowercased, matched by plain
  substring (no regex), queried with bound parameters.
- The 11-item category list is duplicated server (`categorize/categories.ts`)
  and frontend (`lib/expenses.ts`); a unit test on each asserts it.
- TDD every task. Server tests from `server/`, frontend from `frontend/`.
  Branch `auto-categorization` off `main`; the finishing skill merges
  it. One commit per task.

---

## Shared Types

```ts
// server/src/categorize/categories.ts
export const CATEGORIES = [
  'Moradia', 'Alimentação', 'Delivery', 'Transporte', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Vestuário', 'Outros',
] as const;
export type Category = (typeof CATEGORIES)[number];
export function isCategory(v: unknown): v is Category;

// server/src/categorize/rules.ts
export interface CategoryRule { id: number; keyword: string; category: string }

// server/src/categorize/claude-categorize.ts
export interface ClaudeCategoryGuess {
  category: Category | null;
  confidence: 'high' | 'low';
  keyword: string | null;
}
export interface ClaudeCategorizeOutcome {
  guess: ClaudeCategoryGuess;
  inputTokens: number;
  outputTokens: number;
}

// server/src/categorize/categorize.ts
export interface CategorizeResult {
  category: Category | null;
  source: 'rule' | 'claude' | 'none';
}
```

Frontend `lib/api.ts` re-declares `CategoryRule` identically.

---

## Task 1: Extract `ai/budget.ts` from `analysis.ts`

**Files:**
- Create: `server/src/ai/budget.ts`
- Create: `server/src/ai/budget.test.ts`
- Modify: `server/src/ai/analysis.ts`

**Interfaces:**
- Produces:
  - `monthToDateUsdCents(db: Database.Database, now?: Date): number`
  - `isOverCap(db: Database.Database, cfg: AiConfig, now?: Date): boolean`

- [ ] **Step 1: Write the failing test**

Create `server/src/ai/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { monthToDateUsdCents, isOverCap } from './budget.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk', model: 'm', categorizeModel: 'h', monthlyCapUsdCents: 100, usdBrlFallbackRate: 5,
};

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}
function call(d: Database.Database, created: string, cents: number, status = 'ok') {
  d.prepare(
    "INSERT INTO claude_api_calls (created_at, endpoint, model, cost_usd_cents, status) VALUES (?, 'x', 'm', ?, ?)",
  ).run(created, cents, status);
}

describe('ai/budget', () => {
  it('sums only ok rows in the given month', () => {
    const d = db();
    call(d, '2026-08-02T00:00:00Z', 30);
    call(d, '2026-08-09T00:00:00Z', 25);
    call(d, '2026-07-31T00:00:00Z', 99);      // other month
    call(d, '2026-08-10T00:00:00Z', 40, 'error'); // not ok
    expect(monthToDateUsdCents(d, NOW)).toBe(55);
  });

  it('isOverCap compares the month-to-date sum to the cap', () => {
    const d = db();
    call(d, '2026-08-02T00:00:00Z', 99);
    expect(isOverCap(d, CFG, NOW)).toBe(false);
    call(d, '2026-08-03T00:00:00Z', 1);
    expect(isOverCap(d, CFG, NOW)).toBe(true); // 100 >= 100
  });
});
```

> Note: `AiConfig` gains `categorizeModel` in Task 2. If Task 1 runs
> first, drop `categorizeModel` from the test's `CFG` literal and add it
> back in Task 2. (Recommended: do Task 2 first, then this test compiles
> as written. The plan orders Task 1 first only because `analysis.ts`
> already has the sum to extract; either order works.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/ai/budget.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `budget.ts`**

```ts
import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthToDateUsdCents(db: Database.Database, now: Date = new Date()): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd_cents),0) AS n FROM claude_api_calls WHERE status='ok' AND substr(created_at,1,7) = ?",
      )
      .get(monthKey(now)) as { n: number }
  ).n;
}

export function isOverCap(db: Database.Database, cfg: AiConfig, now: Date = new Date()): boolean {
  return monthToDateUsdCents(db, now) >= cfg.monthlyCapUsdCents;
}
```

- [ ] **Step 4: Re-point `analysis.ts`**

In `server/src/ai/analysis.ts`: delete the local `monthKey` +
`monthToDateUsdCents` helpers, `import { monthToDateUsdCents, isOverCap }
from './budget.js';`. In `runAnalysis` replace the inline cap check with:

```ts
  if (isOverCap(db, cfg, now)) {
    throw new BudgetExceededError(monthToDateUsdCents(db, now), cfg.monthlyCapUsdCents);
  }
```

`aiStatus` keeps calling `monthToDateUsdCents` (now imported). No
behaviour change.

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run src/ai/budget.test.ts src/ai/analysis.test.ts`
Expected: PASS (analysis tests unchanged and still green).

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/budget.ts server/src/ai/budget.test.ts server/src/ai/analysis.ts
git commit -m "Extract ai/budget.ts (month-to-date spend + isOverCap)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Config `categorizeModel` + Haiku cost rate

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/config.test.ts`
- Modify: `server/src/ai/cost.ts`
- Modify: `server/src/ai/cost.test.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `AiConfig.categorizeModel: string`;
  `MODEL_RATES_USD_PER_MTOK['claude-haiku-4-5']`.

- [ ] **Step 1: Write failing tests**

`server/src/config.test.ts` — update the two AI tests to include the new
key:

```ts
  it('populates config.ai from env with defaults', () => {
    const c = loadConfig({});
    expect(c.ai).toEqual({
      apiKey: null,
      model: 'claude-sonnet-5',
      categorizeModel: 'claude-haiku-4-5',
      monthlyCapUsdCents: 400,
      usdBrlFallbackRate: 5.4,
    });
  });

  it('reads the AI env vars when set', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      FUMARENDE_AI_MODEL: 'claude-opus-5',
      FUMARENDE_AI_CATEGORIZE_MODEL: 'claude-sonnet-5',
      FUMARENDE_AI_MONTHLY_CAP_USD_CENTS: '1000',
      FUMARENDE_USD_BRL_FALLBACK: '5.9',
    });
    expect(c.ai).toEqual({
      apiKey: 'sk-test',
      model: 'claude-opus-5',
      categorizeModel: 'claude-sonnet-5',
      monthlyCapUsdCents: 1000,
      usdBrlFallbackRate: 5.9,
    });
  });
```

`server/src/ai/cost.test.ts` — add:

```ts
  it('prices Haiku at $1/$5 per Mtok', () => {
    // 1,000,000 in + 100,000 out = 100c + 50c = 150c
    expect(estimateCostUsdCents('claude-haiku-4-5', 1_000_000, 100_000)).toBe(150);
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/config.test.ts src/ai/cost.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`server/src/config.ts`:
- Add `categorizeModel: string;` to `AiConfig`.
- Add `const AI_CATEGORIZE_MODEL_DEFAULT = 'claude-haiku-4-5';`
- `NOT_CONFIGURED_AI` gains `categorizeModel: AI_CATEGORIZE_MODEL_DEFAULT`.
- In `loadConfig`'s `ai` object: `categorizeModel: env.FUMARENDE_AI_CATEGORIZE_MODEL ?? AI_CATEGORIZE_MODEL_DEFAULT,`

`server/src/ai/cost.ts` — add to `MODEL_RATES_USD_PER_MTOK`:

```ts
  'claude-haiku-4-5': { input: 1, output: 5 },
```

`server/.env.example` — add under the tuning block:

```
FUMARENDE_AI_CATEGORIZE_MODEL=claude-haiku-4-5
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run src/config.test.ts src/ai/cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts server/src/ai/cost.ts server/src/ai/cost.test.ts server/.env.example
git commit -m "Config: categorizeModel (default claude-haiku-4-5) + Haiku cost rate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `categories.ts` + `rules.ts`

**Files:**
- Create: `server/src/categorize/categories.ts` + `.test.ts`
- Create: `server/src/categorize/rules.ts` + `.test.ts`

**Interfaces:** see "Shared Types". `rules.ts` also exports:
- `listRules(db): CategoryRule[]` — `id ASC`, `deleted_at IS NULL`
- `addRule(db, keyword, category): CategoryRule`
- `deleteRule(db, id): void` — soft delete
- `matchRule(rules: CategoryRule[], description: string): CategoryRule | null`

- [ ] **Step 1: Write failing tests**

`server/src/categorize/categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CATEGORIES, isCategory } from './categories.js';

describe('categories', () => {
  it('is the agreed 11-item list', () => {
    expect([...CATEGORIES]).toEqual([
      'Moradia', 'Alimentação', 'Delivery', 'Transporte', 'Saúde',
      'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Vestuário', 'Outros',
    ]);
  });
  it('isCategory guards membership', () => {
    expect(isCategory('Transporte')).toBe(true);
    expect(isCategory('Nope')).toBe(false);
    expect(isCategory(null)).toBe(false);
  });
});
```

`server/src/categorize/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { listRules, addRule, deleteRule, matchRule } from './rules.js';

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}

describe('rules', () => {
  it('addRule trims + lowercases the keyword and rejects bad input', () => {
    const d = db();
    const r = addRule(d, '  UBER ', 'Transporte');
    expect(r).toMatchObject({ keyword: 'uber', category: 'Transporte' });
    expect(() => addRule(d, '   ', 'Transporte')).toThrow();
    expect(() => addRule(d, 'x', 'Bogus')).toThrow();
  });

  it('addRule dedupes an identical non-deleted (keyword, category)', () => {
    const d = db();
    const a = addRule(d, 'ifood', 'Delivery');
    const b = addRule(d, 'IFOOD', 'Delivery');
    expect(b.id).toBe(a.id);
    expect(listRules(d)).toHaveLength(1);
  });

  it('deleteRule soft-deletes', () => {
    const d = db();
    const r = addRule(d, 'netflix', 'Assinaturas');
    deleteRule(d, r.id);
    expect(listRules(d)).toHaveLength(0);
  });

  it('matchRule returns the first substring hit, case-insensitively', () => {
    const rules = [
      { id: 1, keyword: 'uber', category: 'Transporte' },
      { id: 2, keyword: 'mercado', category: 'Alimentação' },
    ];
    expect(matchRule(rules, 'UBER *TRIP HELP.UBER.CO')?.category).toBe('Transporte');
    expect(matchRule(rules, 'Compra no MERCADO livre')?.category).toBe('Alimentação');
    expect(matchRule(rules, 'Farmácia São João')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/categorize/categories.test.ts src/categorize/rules.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write `categories.ts`**

```ts
export const CATEGORIES = [
  'Moradia', 'Alimentação', 'Delivery', 'Transporte', 'Saúde',
  'Educação', 'Lazer', 'Viagem', 'Assinaturas', 'Vestuário', 'Outros',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Write `rules.ts`**

```ts
import type Database from 'better-sqlite3';
import { isCategory } from './categories.js';

export interface CategoryRule {
  id: number;
  keyword: string;
  category: string;
}

export function listRules(db: Database.Database): CategoryRule[] {
  return db
    .prepare(
      'SELECT id, keyword, category FROM category_rules WHERE deleted_at IS NULL ORDER BY id',
    )
    .all() as CategoryRule[];
}

export function addRule(db: Database.Database, keyword: string, category: string): CategoryRule {
  const kw = keyword.trim().toLowerCase();
  if (kw === '') throw new Error('keyword is required');
  if (!isCategory(category)) throw new Error(`unknown category: ${category}`);

  const existing = db
    .prepare(
      'SELECT id, keyword, category FROM category_rules WHERE deleted_at IS NULL AND keyword = ? AND category = ?',
    )
    .get(kw, category) as CategoryRule | undefined;
  if (existing) return existing;

  const id = Number(
    db
      .prepare('INSERT INTO category_rules (keyword, category) VALUES (?, ?)')
      .run(kw, category).lastInsertRowid,
  );
  return { id, keyword: kw, category };
}

export function deleteRule(db: Database.Database, id: number): void {
  db.prepare('UPDATE category_rules SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    new Date().toISOString(),
    id,
  );
}

export function matchRule(rules: CategoryRule[], description: string): CategoryRule | null {
  const hay = description.toLowerCase();
  for (const r of rules) {
    const kw = r.keyword.toLowerCase();
    if (kw !== '' && hay.includes(kw)) return r;
  }
  return null;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd server && npx vitest run src/categorize/categories.test.ts src/categorize/rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/categorize/categories.ts server/src/categorize/categories.test.ts server/src/categorize/rules.ts server/src/categorize/rules.test.ts
git commit -m "categorize: category list + keyword rule matching/CRUD

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `claude-categorize.ts`

**Files:**
- Create: `server/src/categorize/claude-categorize.ts` + `.test.ts`

**Interfaces:** see "Shared Types" — `claudeCategorize(cfg, description,
fetchImpl?): Promise<ClaudeCategorizeOutcome>`.

- [ ] **Step 1: Write failing test**

`server/src/categorize/claude-categorize.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { claudeCategorize } from './claude-categorize.js';
import type { AiConfig } from '../config.js';

const CFG: AiConfig = {
  apiKey: 'sk', model: 'claude-sonnet-5', categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400, usdBrlFallbackRate: 5.4,
};
function reply(text: string, usage = { input_tokens: 40, output_tokens: 12 }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), { status: 200 }),
  ) as unknown as typeof fetch;
}

describe('claudeCategorize', () => {
  it('uses the categorize model and parses a clean JSON reply', async () => {
    const f = reply('{"category":"Transporte","confidence":"high","keyword":"uber"}');
    const out = await claudeCategorize(CFG, 'UBER *TRIP', f);
    expect(out.guess).toEqual({ category: 'Transporte', confidence: 'high', keyword: 'uber' });
    expect(out.inputTokens).toBe(40);
    const body = JSON.parse((f as unknown as { mock: { calls: any[][] } }).mock.calls[0][1].body);
    expect(body.model).toBe('claude-haiku-4-5');
  });

  it('strips a ```json fence', async () => {
    const f = reply('```json\n{"category":"Delivery","confidence":"high","keyword":"ifood"}\n```');
    expect((await claudeCategorize(CFG, 'IFOOD', f)).guess.category).toBe('Delivery');
  });

  it('returns a null/low guess for an unparseable or off-list reply', async () => {
    expect((await claudeCategorize(CFG, 'x', reply('not json'))).guess).toEqual({
      category: null, confidence: 'low', keyword: null,
    });
    expect(
      (await claudeCategorize(CFG, 'x', reply('{"category":"Bogus","confidence":"high","keyword":"z"}'))).guess
        .category,
    ).toBeNull();
  });

  it('propagates an upstream error', async () => {
    const f = vi.fn().mockResolvedValue(new Response('err', { status: 500 })) as unknown as typeof fetch;
    await expect(claudeCategorize(CFG, 'x', f)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/categorize/claude-categorize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `claude-categorize.ts`**

```ts
import type { AiConfig } from '../config.js';
import { callClaude } from '../ai/client.js';
import { CATEGORIES, isCategory, type Category } from './categories.js';

export interface ClaudeCategoryGuess {
  category: Category | null;
  confidence: 'high' | 'low';
  keyword: string | null;
}
export interface ClaudeCategorizeOutcome {
  guess: ClaudeCategoryGuess;
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM =
  `Você classifica a descrição de um gasto de cartão brasileiro em exatamente uma destas categorias: ` +
  `${CATEGORIES.join(', ')}. ` +
  `Responda APENAS com JSON minificado: {"category": <uma da lista ou null>, "confidence": "high"|"low", ` +
  `"keyword": <token curto do estabelecimento em minúsculas ou null>}. ` +
  `Use null + "low" quando a descrição for vaga demais.`;

const FALLBACK: ClaudeCategoryGuess = { category: null, confidence: 'low', keyword: null };

function parseGuess(text: string): ClaudeCategoryGuess {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  if (fence) s = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return FALLBACK;
  }
  if (typeof obj !== 'object' || obj === null) return FALLBACK;
  const o = obj as Record<string, unknown>;
  const category = isCategory(o.category) ? (o.category as Category) : null;
  const confidence = o.confidence === 'high' ? 'high' : 'low';
  const keyword =
    typeof o.keyword === 'string' && o.keyword.trim() !== '' ? o.keyword.trim().toLowerCase() : null;
  return { category, confidence, keyword };
}

export async function claudeCategorize(
  cfg: AiConfig,
  description: string,
  fetchImpl?: typeof fetch,
): Promise<ClaudeCategorizeOutcome> {
  const res = await callClaude(
    { ...cfg, model: cfg.categorizeModel },
    { system: SYSTEM, user: description, maxTokens: 120 },
    fetchImpl,
  );
  return { guess: parseGuess(res.text), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run src/categorize/claude-categorize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/categorize/claude-categorize.ts server/src/categorize/claude-categorize.test.ts
git commit -m "categorize: Haiku fallback classifier (strict-JSON, best-effort parse)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `categorize.ts` orchestrator

**Files:**
- Create: `server/src/categorize/categorize.ts` + `.test.ts`

**Interfaces:** `categorize(db, cfg, { description }, deps?):
Promise<CategorizeResult>` — see "Shared Types" and the spec's flow.
`deps?: { now?: Date; fetchImpl?: typeof fetch; rules?: CategoryRule[] }`.

- [ ] **Step 1: Write failing test**

`server/src/categorize/categorize.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { addRule, listRules } from './rules.js';
import { categorize } from './categorize.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const KEY: AiConfig = {
  apiKey: 'sk', model: 'claude-sonnet-5', categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400, usdBrlFallbackRate: 5.4,
};
const NOKEY: AiConfig = { ...KEY, apiKey: null };

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}
function fetchGuess(json: string) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: 'text', text: json }], usage: { input_tokens: 30, output_tokens: 10 } }), { status: 200 }),
  ) as unknown as typeof fetch;
}

describe('categorize', () => {
  it('returns a rule hit without calling Claude or writing a ledger row', async () => {
    const d = db();
    addRule(d, 'uber', 'Transporte');
    const f = vi.fn();
    const r = await categorize(d, KEY, { description: 'UBER *TRIP' }, { now: NOW, fetchImpl: f as any });
    expect(r).toEqual({ category: 'Transporte', source: 'rule' });
    expect(f).not.toHaveBeenCalled();
    expect(d.prepare('SELECT COUNT(*) n FROM claude_api_calls').get()).toEqual({ n: 0 });
  });

  it('returns none when there is no rule and no API key', async () => {
    const d = db();
    const r = await categorize(d, NOKEY, { description: 'loja xyz' }, { now: NOW });
    expect(r).toEqual({ category: null, source: 'none' });
  });

  it('on a high-confidence guess: applies it, writes an ok ledger row, learns a rule', async () => {
    const d = db();
    const f = fetchGuess('{"category":"Delivery","confidence":"high","keyword":"ifood"}');
    const r = await categorize(d, KEY, { description: 'IFOOD *pedido' }, { now: NOW, fetchImpl: f });
    expect(r).toEqual({ category: 'Delivery', source: 'claude' });
    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok' AND endpoint='categorize'").get()).toEqual({ n: 1 });
    expect(listRules(d).map((x) => [x.keyword, x.category])).toEqual([['ifood', 'Delivery']]);
  });

  it('low-confidence guess leaves it uncategorized and learns nothing', async () => {
    const d = db();
    const f = fetchGuess('{"category":"Delivery","confidence":"low","keyword":"x"}');
    const r = await categorize(d, KEY, { description: 'algo' }, { now: NOW, fetchImpl: f });
    expect(r).toEqual({ category: null, source: 'none' });
    expect(listRules(d)).toHaveLength(0);
  });

  it('does not call Claude once the monthly cap is reached', async () => {
    const d = db();
    d.prepare(
      "INSERT INTO claude_api_calls (created_at, endpoint, model, cost_usd_cents, status) VALUES (?, 'x', 'm', 400, 'ok')",
    ).run(NOW.toISOString());
    const f = vi.fn();
    const r = await categorize(d, KEY, { description: 'loja xyz' }, { now: NOW, fetchImpl: f as any });
    expect(r).toEqual({ category: null, source: 'none' });
    expect(f).not.toHaveBeenCalled();
  });

  it('on an upstream error: writes an error row and returns none (no throw)', async () => {
    const d = db();
    const f = vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r = await categorize(d, KEY, { description: 'loja xyz' }, { now: NOW, fetchImpl: f });
    expect(r).toEqual({ category: null, source: 'none' });
    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error'").get()).toEqual({ n: 1 });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/categorize/categorize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `categorize.ts`**

```ts
import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';
import { isOverCap } from '../ai/budget.js';
import { estimateCostUsdCents } from '../ai/cost.js';
import { ClaudeUpstreamError } from '../ai/client.js';
import { listRules, matchRule, addRule, type CategoryRule } from './rules.js';
import { claudeCategorize } from './claude-categorize.js';
import type { Category } from './categories.js';

export interface CategorizeResult {
  category: Category | null;
  source: 'rule' | 'claude' | 'none';
}

export async function categorize(
  db: Database.Database,
  cfg: AiConfig,
  input: { description: string },
  deps: { now?: Date; fetchImpl?: typeof fetch; rules?: CategoryRule[] } = {},
): Promise<CategorizeResult> {
  const now = deps.now ?? new Date();
  const rules = deps.rules ?? listRules(db);

  const hit = matchRule(rules, input.description);
  if (hit) return { category: hit.category as Category, source: 'rule' };

  if (cfg.apiKey === null) return { category: null, source: 'none' };
  if (isOverCap(db, cfg, now)) return { category: null, source: 'none' };

  let outcome;
  try {
    outcome = await claudeCategorize(cfg, input.description, deps.fetchImpl);
  } catch (err) {
    if (err instanceof ClaudeUpstreamError) {
      db.prepare(
        `INSERT INTO claude_api_calls (created_at, endpoint, model, status, error_message)
         VALUES (?, 'categorize', ?, 'error', ?)`,
      ).run(now.toISOString(), cfg.categorizeModel, String(err.message).slice(0, 500));
    }
    return { category: null, source: 'none' };
  }

  let cost = 0;
  try {
    cost = estimateCostUsdCents(cfg.categorizeModel, outcome.inputTokens, outcome.outputTokens);
  } catch {
    cost = 0;
  }
  db.prepare(
    `INSERT INTO claude_api_calls (created_at, endpoint, model, input_tokens, output_tokens, cost_usd_cents, status)
     VALUES (?, 'categorize', ?, ?, ?, ?, 'ok')`,
  ).run(now.toISOString(), cfg.categorizeModel, outcome.inputTokens, outcome.outputTokens, cost);

  const { guess } = outcome;
  if (guess.confidence === 'high' && guess.category !== null) {
    if (guess.keyword) {
      try {
        addRule(db, guess.keyword, guess.category);
      } catch {
        /* dup or race — ignore */
      }
    }
    return { category: guess.category, source: 'claude' };
  }
  return { category: null, source: 'none' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run src/categorize/categorize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/categorize/categorize.ts server/src/categorize/categorize.test.ts
git commit -m "categorize: orchestrator (rule → cap → Haiku → learn rule, best-effort)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Relax expense create + `categorize-pending` route

**Files:**
- Modify: `server/src/db/expenses.ts`
- Modify: `server/src/db/expenses.test.ts`
- Modify: `server/src/routes/expenses.ts`
- Modify: `server/src/routes/expenses.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- `createExpense` / `NewExpense` unchanged except `category` may be `''`.
- `registerExpenseRoutes(app, db, aiConfig: AiConfig)`.
- `POST /api/expenses/categorize-pending` → `{ updated: number;
  stillPending: number; stoppedAtCap: boolean }`.

- [ ] **Step 1: Write failing tests**

`server/src/db/expenses.test.ts` — add inside `describe('expense data
layer', …)` (fixtures are `freshDb()` and `sampleInput()`):

```ts
  it('accepts a blank category (uncategorized)', () => {
    const db = freshDb();
    const [id] = createExpense(db, { ...sampleInput(), category: '' });
    const row = db.prepare('SELECT category FROM expenses WHERE id = ?').get(id) as { category: string };
    expect(row.category).toBe('');
  });
```

(The existing "rejects a non-positive amount, blank description, or bad
type" test does not assert on category — leave it as is.)

`server/src/routes/expenses.test.ts` — add a describe block:

```ts
import { addRule } from '../categorize/rules.js';

describe('expense categorization', () => {
  it('fills a blank category from a matching rule on create', async () => {
    const { app, sessionCookie } = await authedApp();
    addRule(app.dbForTests, 'uber', 'Transporte');

    const res = await app.inject({
      method: 'POST', url: '/api/expenses', cookies: { session: sessionCookie },
      payload: { ...validBody, category: '', description: 'UBER *TRIP SP' },
    });
    expect(res.statusCode).toBe(201);
    const list = (await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })).json();
    expect(list[0].category).toBe('Transporte');
    await app.close();
  });

  it('leaves the category blank when nothing matches and no key is set', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST', url: '/api/expenses', cookies: { session: sessionCookie },
      payload: { ...validBody, category: '', description: 'loja desconhecida' },
    });
    expect(res.statusCode).toBe(201);
    const list = (await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })).json();
    expect(list[0].category).toBe('');
    await app.close();
  });

  it('applies one rule result to every installment row', async () => {
    const { app, sessionCookie } = await authedApp();
    addRule(app.dbForTests, 'tênis', 'Vestuário');
    await app.inject({
      method: 'POST', url: '/api/expenses', cookies: { session: sessionCookie },
      payload: { ...validBody, category: '', description: 'Tênis Nike', amountCents: 30_000, installmentTotal: 3 },
    });
    const list = (await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })).json();
    expect(list).toHaveLength(3);
    expect(list.every((e: { category: string }) => e.category === 'Vestuário')).toBe(true);
    await app.close();
  });

  it('categorize-pending sweeps blank rows and reports counts', async () => {
    const { app, sessionCookie } = await authedApp();
    // two blank rows sharing a description, plus a rule added after they exist
    for (const _ of [0, 1]) {
      await app.inject({
        method: 'POST', url: '/api/expenses', cookies: { session: sessionCookie },
        payload: { ...validBody, category: '', description: 'PADARIA CENTRAL' },
      });
    }
    addRule(app.dbForTests, 'padaria', 'Alimentação');

    const res = await app.inject({
      method: 'POST', url: '/api/expenses/categorize-pending', cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, stillPending: 0, stoppedAtCap: false });
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/db/expenses.test.ts src/routes/expenses.test.ts`
Expected: FAIL — blank category rejected; `categorize-pending` 404;
`registerExpenseRoutes` arity.

- [ ] **Step 3: Relax `db/expenses.ts`**

In `validate()` delete:

```ts
  if (input.category.trim() === '') {
    throw new Error('category is required');
  }
```

- [ ] **Step 4: Update `routes/expenses.ts`**

- Signature: `export function registerExpenseRoutes(app: FastifyInstance,
  db: Database.Database, aiConfig: AiConfig): void` (import `AiConfig`
  from `../config.js`).
- Import: `import { categorize } from '../categorize/categorize.js';`
  `import { listRules } from '../categorize/rules.js';`
  `import { isOverCap } from '../ai/budget.js';`
- In the create handler, remove the `!nonBlankString(body.category)` →
  400 branch. Then:

```ts
      let category = typeof body.category === 'string' ? body.category : '';
      if (category.trim() === '') {
        const r = await categorize(db, aiConfig, { description: body.description });
        category = r.category ?? '';
      }
      const input: NewExpense = { ...as before..., category };
```

- New route (before the `DELETE`s):

```ts
  app.post('/api/expenses/categorize-pending', { preHandler: requireAuth(db) }, async () => {
    const rules = listRules(db);
    const pending = db
      .prepare("SELECT id, description FROM expenses WHERE deleted_at IS NULL AND category = '' ORDER BY id")
      .all() as { id: number; description: string }[];

    const byDesc = new Map<string, string | null>();
    let stoppedAtCap = false;
    for (const desc of new Set(pending.map((p) => p.description))) {
      if (isOverCap(db, aiConfig)) { stoppedAtCap = true; break; }
      const r = await categorize(db, aiConfig, { description: desc }, { rules });
      byDesc.set(desc, r.category);
    }

    const update = db.prepare('UPDATE expenses SET category = ? WHERE id = ?');
    let updated = 0;
    db.transaction(() => {
      for (const p of pending) {
        const c = byDesc.get(p.description);
        if (c) { update.run(c, p.id); updated += 1; }
      }
    })();

    const stillPending = (
      db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL AND category = ''").get() as { n: number }
    ).n;
    return { updated, stillPending, stoppedAtCap };
  });
```

> Route order: register `/api/expenses/categorize-pending` **before**
> `/api/expenses/:id`-style routes is not required (distinct method+path),
> but keep it grouped with the other `/api/expenses` POSTs for clarity.

- [ ] **Step 5: Wire `app.ts`**

Change `registerExpenseRoutes(app, db);` → `registerExpenseRoutes(app, db, aiConfig);`

- [ ] **Step 6: Run to verify pass + full server suite**

Run: `cd server && npx vitest run src/db/expenses.test.ts src/routes/expenses.test.ts`
Expected: PASS.
Run: `cd server && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/expenses.ts server/src/db/expenses.test.ts server/src/routes/expenses.ts server/src/routes/expenses.test.ts server/src/app.ts
git commit -m "Expenses: resolve a blank category on create + categorize-pending sweep

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `category_rules` CRUD routes

**Files:**
- Create: `server/src/routes/category-rules.ts` + `.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:** `registerCategoryRuleRoutes(app, db)`. Routes per the
spec table.

- [ ] **Step 1: Write failing test**

`server/src/routes/category-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authed() {
  const app = await buildApp(new Database(':memory:'));
  const s = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'test-password' } });
  return { app, session: s.cookies.find((c) => c.name === 'session')!.value };
}

describe('category-rules routes', () => {
  it('401 without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/category-rules' })).statusCode).toBe(401);
    await app.close();
  });

  it('CRUD round-trip', async () => {
    const { app, session } = await authed();

    const created = await app.inject({
      method: 'POST', url: '/api/category-rules', cookies: { session },
      payload: { keyword: 'Uber', category: 'Transporte' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json()).toMatchObject({ keyword: 'uber', category: 'Transporte' });

    const list = await app.inject({ method: 'GET', url: '/api/category-rules', cookies: { session } });
    expect(list.json()).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/api/category-rules/${id}`, cookies: { session } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/category-rules', cookies: { session } })).json()).toHaveLength(0);
    await app.close();
  });

  it('400 on blank keyword or unknown category', async () => {
    const { app, session } = await authed();
    expect((await app.inject({
      method: 'POST', url: '/api/category-rules', cookies: { session }, payload: { keyword: '  ', category: 'Transporte' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/category-rules', cookies: { session }, payload: { keyword: 'x', category: 'Bogus' },
    })).statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd server && npx vitest run src/routes/category-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `routes/category-rules.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth/require-auth.js';
import { listRules, addRule, deleteRule } from '../categorize/rules.js';

export function registerCategoryRuleRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/category-rules', { preHandler: requireAuth(db) }, async () => listRules(db));

  app.post<{ Body: { keyword?: string; category?: string } }>(
    '/api/category-rules',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const { keyword, category } = request.body ?? {};
      try {
        return reply.code(201).send(addRule(db, String(keyword ?? ''), String(category ?? '')));
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid rule' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/category-rules/:id',
    { preHandler: requireAuth(db) },
    async (request) => {
      deleteRule(db, Number(request.params.id));
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`**

Import `registerCategoryRuleRoutes` and call it after
`registerExpenseRoutes(app, db, aiConfig);`:

```ts
  registerCategoryRuleRoutes(app, db);
```

- [ ] **Step 5: Run to verify pass**

Run: `cd server && npx vitest run src/routes/category-rules.test.ts && npm test`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/category-rules.ts server/src/routes/category-rules.test.ts server/src/app.ts
git commit -m "Routes: category_rules CRUD (/api/category-rules)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend api + GastosPage wiring

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/GastosPage.tsx`
- Modify: `frontend/src/pages/GastosPage.test.tsx`

**Interfaces:**
- `CategoryRule`, `listCategoryRules`, `createCategoryRule`,
  `deleteCategoryRule`, `categorizePending` in `api.ts`.
- `createExpense` input `category` becomes `string` (already is) — no
  change needed; it forwards `''` fine.

- [ ] **Step 1: Add api functions**

In `frontend/src/lib/api.ts` (near the expense section):

```ts
export interface CategoryRule {
  id: number;
  keyword: string;
  category: string;
}
export function listCategoryRules(): Promise<CategoryRule[]> {
  return request('/api/category-rules');
}
export function createCategoryRule(input: { keyword: string; category: string }): Promise<CategoryRule> {
  return request('/api/category-rules', { method: 'POST', body: JSON.stringify(input) });
}
export function deleteCategoryRule(id: number): Promise<{ ok: true }> {
  return request(`/api/category-rules/${id}`, { method: 'DELETE' });
}
export function categorizePending(): Promise<{ updated: number; stillPending: number; stoppedAtCap: boolean }> {
  return request('/api/expenses/categorize-pending', { method: 'POST' });
}
```

- [ ] **Step 2: Update `GastosPage.test.tsx`**

- `beforeEach`: add `vi.spyOn(api, 'listCategoryRules').mockResolvedValue([]);`
  (the `CategoryRulesSection` added in Task 9 will fetch on mount; adding
  the mock now keeps the suite green across both tasks).
- Add tests:

```ts
  it('defaults the category select to Automático and submits a blank category', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createExpense').mockResolvedValue({ ids: [1] });
    render(<GastosPage />);
    await waitFor(() => expect(api.listExpenses).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'IFOOD' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar gasto' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ category: '' })),
    );
  });

  it('shows "— sem categoria" for a blank-category row and a Categorizar pendentes button', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([expense({ id: 1, category: '' })]);
    const sweep = vi
      .spyOn(api, 'categorizePending')
      .mockResolvedValue({ updated: 1, stillPending: 0, stoppedAtCap: false });
    render(<GastosPage />);

    expect(await screen.findByText('— sem categoria')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Categorizar pendentes/ }));
    await waitFor(() => expect(sweep).toHaveBeenCalled());
  });
```

- The existing "submits a new expense …" test explicitly sets Categoria
  to `'Educação'`, so it stays valid.

- [ ] **Step 3: Run to verify fail**

Run: `cd frontend && npx vitest run src/pages/GastosPage.test.tsx`
Expected: FAIL — no "Automático" option, no pendentes button, no
`— sem categoria`.

- [ ] **Step 4: Update `GastosPage.tsx`**

- `const AUTO = '';`
- `const [category, setCategory] = useState<string>(AUTO);`
- Category select: prepend
  `<option value="">Automático (regras + IA)</option>` before the
  `CATEGORIES.map(...)`.
- On successful submit reset: `setCategory(AUTO);`
- Expense list row category span:
  `{e.category ? e.category : <span style={{ fontStyle: 'italic', color: 'var(--text3)' }}>— sem categoria</span>}`
- Above the list (after the totals card), when
  `expenses.some((e) => e.category === '')`:

```tsx
  const pendingCount = expenses.filter((e) => e.category === '').length;
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  async function sweep() {
    setSweeping(true);
    setSweepMsg(null);
    try {
      const r = await api.categorizePending();
      await refresh();
      setSweepMsg(
        `${r.updated} categorizados · ${r.stillPending} pendentes${r.stoppedAtCap ? ' (limite de IA atingido)' : ''}`,
      );
    } catch {
      setSweepMsg('Falha ao categorizar.');
    } finally {
      setSweeping(false);
    }
  }
```

  ```tsx
  {pendingCount > 0 && (
    <div style={{ marginBottom: 12 }}>
      <button type="button" className="button-primary" disabled={sweeping} onClick={sweep}>
        {sweeping ? 'Categorizando…' : `Categorizar pendentes (${pendingCount})`}
      </button>
      {sweepMsg && <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--text3)' }}>{sweepMsg}</span>}
    </div>
  )}
  ```

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run src/pages/GastosPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/GastosPage.tsx frontend/src/pages/GastosPage.test.tsx
git commit -m "Gastos: Automático category, pendentes sweep, sem-categoria row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `CategoryRulesSection` component

**Files:**
- Create: `frontend/src/components/CategoryRulesSection.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/GastosPage.tsx`

**Interfaces:** default-styled card; consumes `api.listCategoryRules` /
`createCategoryRule` / `deleteCategoryRule` and `CATEGORIES` from
`../lib/expenses.js`.

- [ ] **Step 1: Write failing test**

`frontend/src/components/CategoryRulesSection.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CategoryRulesSection } from './CategoryRulesSection.js';
import * as api from '../lib/api.js';

beforeEach(() => {
  vi.spyOn(api, 'listCategoryRules').mockResolvedValue([
    { id: 1, keyword: 'uber', category: 'Transporte' },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe('CategoryRulesSection', () => {
  it('lists rules and deletes one', async () => {
    const del = vi.spyOn(api, 'deleteCategoryRule').mockResolvedValue({ ok: true });
    render(<CategoryRulesSection />);
    expect(await screen.findByText(/uber/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir regra uber' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
  });

  it('adds a rule via the form', async () => {
    const add = vi
      .spyOn(api, 'createCategoryRule')
      .mockResolvedValue({ id: 2, keyword: 'ifood', category: 'Delivery' });
    render(<CategoryRulesSection />);
    await screen.findByText(/uber/);

    fireEvent.change(screen.getByLabelText('Palavra-chave'), { target: { value: 'iFood' } });
    fireEvent.change(screen.getByLabelText('Categoria da regra'), { target: { value: 'Delivery' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar regra' }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ keyword: 'iFood', category: 'Delivery' }),
    );
  });

  it('shows an error when the add call 400s', async () => {
    vi.spyOn(api, 'createCategoryRule').mockRejectedValue(new Error('keyword is required'));
    render(<CategoryRulesSection />);
    await screen.findByText(/uber/);
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar regra' }));
    expect(await screen.findByText(/keyword is required/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/components/CategoryRulesSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `CategoryRulesSection.tsx`**

Model on `FixedExpensesSection`. A `<div className="card">` with:
- mount `useEffect` → `api.listCategoryRules()` into `rules` state
  (soft error string on failure).
- add form: `<input aria-label="Palavra-chave" className="field-input">`,
  `<select aria-label="Categoria da regra" className="field-input">` over
  `CATEGORIES`, `<button className="button-primary">+ Adicionar regra</button>`.
  On submit: `await api.createCategoryRule({ keyword, category })` →
  refetch → clear keyword; `catch` → `.error-text` with `err.message`.
- list: for each rule a row `{keyword} → {category}` + a
  `<button aria-label={`Excluir regra ${keyword}`}>Excluir</button>` →
  `api.deleteCategoryRule(id)` → refetch.
- heading `<h2>Regras de categoria</h2>` (mono, matching other sections).

- [ ] **Step 4: Render on GastosPage**

`frontend/src/pages/GastosPage.tsx` — `import { CategoryRulesSection }
from '../components/CategoryRulesSection.js';` and render
`<CategoryRulesSection />` right after `<FixedExpensesSection />`.

- [ ] **Step 5: Run to verify pass + full frontend suite + tsc**

Run: `cd frontend && npx vitest run src/components/CategoryRulesSection.test.tsx src/pages/GastosPage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test && npx tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CategoryRulesSection.tsx frontend/src/components/CategoryRulesSection.test.tsx frontend/src/pages/GastosPage.tsx
git commit -m "Gastos: Regras de categoria management section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: e2e, docs, build, smoke

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

New section after the IA block (throwaway env, **no API key**):

```bash
echo
echo "== Categorização (Phase 2.2, sem chave) =="
RULEID="$(body POST /api/category-rules '{"keyword":"uber","category":"Transporte"}' | jq -r '.id')"
as  "create rule -> 201 (implied)" 200 "$([ -n "$RULEID" ] && echo 200 || echo 0)"
as  "expense w/ blank category + matching rule -> 201" 201 "$(code POST /api/expenses '{"date":"2026-08-05","description":"UBER *TRIP","amountCents":3210,"category":"","type":"nao-essencial","paymentMethod":"Crédito"}')"
aeq "…and it is auto-categorized" "Transporte" "$(body GET /api/expenses | jq -r '[.[] | select(.description=="UBER *TRIP")][0].category')"
as  "expense w/ blank category, no rule/key -> 201" 201 "$(code POST /api/expenses '{"date":"2026-08-06","description":"LOJA DESCONHECIDA","amountCents":1000,"category":"","type":"nao-essencial","paymentMethod":"Crédito"}')"
aeq "…stays uncategorized" "" "$(body GET /api/expenses | jq -r '[.[] | select(.description=="LOJA DESCONHECIDA")][0].category')"
CP="$(body POST /api/expenses/categorize-pending)"
aeq "categorize-pending returns stoppedAtCap flag" "false" "$(echo "$CP" | jq -r '.stoppedAtCap')"
aeq "…still-pending count is a number >= 1" "true" "$(echo "$CP" | jq -r '.stillPending >= 1')"
aeq "rules list has the seeded rule" "Transporte" "$(body GET /api/category-rules | jq -r '[.[] | select(.keyword=="uber")][0].category')"
as  "delete rule -> 200" 200 "$(code DELETE "/api/category-rules/$RULEID")"
as  "rule POST blank keyword -> 400" 400 "$(code POST /api/category-rules '{"keyword":"  ","category":"Transporte"}')"
as  "rule POST unknown category -> 400" 400 "$(code POST /api/category-rules '{"keyword":"x","category":"Bogus"}')"
```

> `body`/`code`/`as`/`aeq` are the existing helpers. If `body POST` with
> a payload isn't already supported, use the `code`+separate-`body`
> pattern already used elsewhere in the script.

- [ ] **Step 3: Run e2e**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (109 prior + ~10 new).

- [ ] **Step 4: Restart live server + smoke (key IS configured)**

```bash
cd server && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'category-rules unauth: %{http_code}\n' http://localhost:4173/api/category-rules  # expect 401
```

Manual: on the Gastos page, add an expense with category "Automático" and
a real merchant description → within ~2s it comes back categorized; a
`category_rules` row appears; the Análise "IA este mês" figure ticks up
a fraction of a cent.

- [ ] **Step 5: Docs**

`docs/qa-checklist.md` — bump the header test/assertion counts; add an
`## Auto-categorização (Phase 2.2)` section mirroring the e2e + unit
coverage, plus `[ ]` browser checks (Automático default; pendentes
button; Regras section add/delete; a real merchant gets categorized
live).

`README.md` — mark slice 2 done in the Phase 2 list; note the key is now
configured.

- [ ] **Step 6: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md README.md
git commit -m "Auto-categorization: e2e assertions + docs"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `ai/budget.ts` (`monthToDateUsdCents`, `isOverCap`), analysis retargeted | 1 |
| `config.ai.categorizeModel` (default `claude-haiku-4-5`) | 2 |
| Haiku `$1/$5` cost rate | 2 |
| `categories.ts` (11-item list + `isCategory`) | 3 |
| `rules.ts` — `matchRule` first-substring-wins CI, `addRule` trim/lowercase/dedupe/validate, `deleteRule` soft | 3 |
| `claude-categorize.ts` — categorize model, strict-JSON parse, fence strip, best-effort fallback, error propagates | 4 |
| `categorize.ts` — rule wins (no ledger), no-key → none, cap → none, high-conf applies + learns rule + ok ledger row, low-conf → none, upstream error → error row + none (no throw) | 5 |
| `expenses` create accepts blank category + resolves it (once per group) | 6 |
| `POST /api/expenses/categorize-pending` (dedup by description, cap-aware, `{updated,stillPending,stoppedAtCap}`) | 6 |
| `registerExpenseRoutes` gains `aiConfig`; `app.ts` passes it | 6 |
| `GET/POST/DELETE /api/category-rules` (400 blank/unknown, 401 no session) | 7 |
| Frontend api: `CategoryRule` + 4 fns | 8 |
| Gastos: "Automático" default, blank submit, `— sem categoria`, pendentes button | 8 |
| `CategoryRulesSection` (list/add/delete, 400 surface) on Gastos | 9 |
| e2e no-key assertions; docs; README | 10 |
| No migration; no new deps; create never fails on AI | all (constraints) |
| Only description sent to Anthropic | 4 (prompt), 5 (call) |

**Placeholder scan:** no `TODO`/`TBD`. Task 8 Step 4 and Task 9 Step 3
describe JSX/wiring in prose but pin every label, `aria-label`, state
name, and api call; all logic-bearing code (budget, rules, claude parse,
orchestrator, routes) is given in full.

**Type consistency:**
- `AiConfig` gains exactly `categorizeModel: string` (Task 2); every
  `AiConfig` literal in new tests includes it (Tasks 1 note, 4, 5).
- `CategoryRule` `{ id:number; keyword:string; category:string }` —
  identical in `rules.ts` (Task 3), `routes/category-rules.ts` (Task 7),
  and `lib/api.ts` (Task 8).
- `CategorizeResult` `{ category: Category|null; source:
  'rule'|'claude'|'none' }` — Task 5 def matches Task 6's usage
  (`r.category ?? ''`).
- `claudeCategorize` → `ClaudeCategorizeOutcome { guess, inputTokens,
  outputTokens }` — Task 4 def matches Task 5's `outcome.inputTokens` /
  `outcome.guess`.
- `isOverCap(db, cfg, now?)` / `monthToDateUsdCents(db, now?)` — Task 1
  def matches usage in Task 5 (`categorize`) and Task 6 (batch route)
  and the retargeted `analysis.ts`.
- `categorize-pending` response `{ updated:number; stillPending:number;
  stoppedAtCap:boolean }` — Task 6 route matches Task 8's
  `categorizePending()` return type and the Task 8 test's `toEqual`.
- `registerExpenseRoutes(app, db, aiConfig)` — Task 6 signature matches
  the Task 6 `app.ts` call; `buildApp`'s existing `aiConfig` (2.1) is
  the value passed.
