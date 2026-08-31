# PDF Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload a credit-card statement PDF, have `claude-sonnet-5`
extract its line items, review/edit them in a table, and confirm the
ones to keep — each becoming an ordinary categorized expense.

**Architecture:** `server/src/import/` — `extract.ts` sends the raw PDF
as a native document content block (one Sonnet call, existing
`claude_api_calls` ledger + monthly cap), returns validated rows.
`callClaude` is extended to accept a content-block array for `user`. Two
routes on `/api/expenses`: `import-preview` (extract + rule-categorize +
duplicate-flag, raised body limit) and `import-confirm` (each checked
row → `createExpense` via the 2.2 categorize pipeline; an installment
statement line stays one expense). A collapsible
`StatementImportSection` on the Gastos page drives the flow. No new
table, no migration, no stored PDFs.

**Tech Stack:** Node 22+, TypeScript, Fastify 5, better-sqlite3, React
18, Vite 6, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-pdf-statement-import-design.md`

## Global Constraints

- **No new npm dependencies. No migration. No stored PDFs.**
- Extraction is one `claude-sonnet-5` call via a native document block —
  no local PDF parser. Writes one `claude_api_calls` row
  (`endpoint: 'import'`), counts toward the same monthly cap + "IA este
  mês" line.
- Unlike 2.2's categorize, extraction has **no fallback**: `503` no key,
  `429` over cap, `502` upstream error.
- **An installment statement line ("PARC 03/12") becomes ONE expense.**
  The "(n/total)" note is folded into the description client-side;
  `import-confirm` always passes `installmentTotal: null`.
- Imported expenses get `paymentMethod: 'Crédito'`.
- `import-confirm` runs any per-row `categorize()` calls **before**
  opening the better-sqlite3 transaction (transactions must be sync).
- `bodyLimit` is raised only on `/import-preview` (20 MB); every other
  route keeps the 1 MB default. Decoded PDF > 12 MB → `400`.
- The whole test + e2e suite runs with **no API key** and makes no real
  network call (`extractStatement` takes an injectable `fetchImpl`).
- TDD every task. Server tests from `server/`, frontend from `frontend/`.
  Branch `pdf-import` off `main`; the finishing skill merges it. One
  commit per task.

---

## Shared Types

```ts
// server/src/import/extract.ts
export type LineKind = 'purchase' | 'payment' | 'fee' | 'fx';
export interface ExtractedRow {
  date: string;                                  // YYYY-MM-DD
  description: string;
  amountCents: number;                           // positive
  kind: LineKind;
  installment: { n: number; total: number } | null;
}
export interface StatementExtraction {
  rows: ExtractedRow[];
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
}

// routes/expenses.ts (import-preview response)
interface PreviewRow extends ExtractedRow {
  suggestedCategory: string;                     // '' when no rule matched
  suggestedType: 'essencial' | 'nao-essencial';
  duplicate: boolean;
}

// import-confirm request
interface ConfirmRow {
  date: string;
  description: string;
  amountCents: number;
  category: string;                              // '' → resolved via categorize()
  type: 'essencial' | 'nao-essencial';
}
```

Frontend `lib/api.ts` re-declares `ImportPreviewRow` (= `PreviewRow`
with `ImportLineKind`) and `ImportConfirmRow` (= `ConfirmRow`)
identically.

---

## Task 1: `callClaude` accepts a content-block array

**Files:**
- Modify: `server/src/ai/client.ts`
- Modify: `server/src/ai/client.test.ts`

**Interfaces:**
- Produces: `callClaude(cfg, { system, user: string | ContentBlock[],
  maxTokens? }, fetchImpl?)` — array `user` passed through as
  `messages[0].content` verbatim; string form unchanged.
  `export type ContentBlock = { type: string; [k: string]: unknown };`

- [ ] **Step 1: Add the failing test**

In `server/src/ai/client.test.ts`, add:

```ts
  it('passes a content-block array straight through as the message content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const blocks = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QQ==' } },
      { type: 'text', text: 'extraia' },
    ];
    await callClaude(CFG, { system: 'sys', user: blocks }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: 'user', content: blocks }]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/ai/client.test.ts`
Expected: FAIL — a TS/runtime issue passing an array where a string is
typed, or the assertion (currently `content` would be the array only if
TS allowed it; the test proves the runtime shape).

- [ ] **Step 3: Implement**

In `server/src/ai/client.ts`:

```ts
export type ContentBlock = { type: string; [k: string]: unknown };
```

Change the `args` type:

```ts
  args: { system: string; user: string | ContentBlock[]; maxTokens?: number },
```

The body already does `messages: [{ role: 'user', content: args.user }]`
— that works for both a string and an array with no change. Nothing else
to modify.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/ai/client.test.ts && npm test`
Expected: PASS; full server suite green (2.1/2.2 string callers
unaffected).

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/client.ts server/src/ai/client.test.ts
git commit -m "callClaude: accept a content-block array for the user message

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `import/expense-type.ts`

**Files:**
- Create: `server/src/import/expense-type.ts` + `.test.ts`

**Interfaces:**
- Produces: `inferType(category: string): 'essencial' | 'nao-essencial'`;
  `ESSENTIAL_CATEGORIES: Set<string>`.

- [ ] **Step 1: Write the failing test**

`server/src/import/expense-type.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inferType } from './expense-type.js';

describe('inferType', () => {
  it('maps the essential categories to essencial', () => {
    for (const c of ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação']) {
      expect(inferType(c)).toBe('essencial');
    }
  });
  it('maps everything else (including blank) to nao-essencial', () => {
    for (const c of ['Lazer', 'Delivery', 'Assinaturas', 'Outros', '']) {
      expect(inferType(c)).toBe('nao-essencial');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/import/expense-type.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
export const ESSENTIAL_CATEGORIES = new Set([
  'Moradia',
  'Alimentação',
  'Transporte',
  'Saúde',
  'Educação',
]);

export function inferType(category: string): 'essencial' | 'nao-essencial' {
  return ESSENTIAL_CATEGORIES.has(category) ? 'essencial' : 'nao-essencial';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/import/expense-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/import/expense-type.ts server/src/import/expense-type.test.ts
git commit -m "import: inferType (essential-category → expense type)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `import/extract.ts`

**Files:**
- Create: `server/src/import/extract.ts` + `.test.ts`

**Interfaces:** see "Shared Types" — `extractStatement(cfg, pdfBase64,
deps?): Promise<StatementExtraction>`; `deps?: { now?: Date; fetchImpl?:
typeof fetch; db?: Database.Database }`.

- [ ] **Step 1: Write the failing test**

`server/src/import/extract.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { extractStatement } from './extract.js';
import { ClaudeNotConfiguredError } from '../ai/client.js';
import { BudgetExceededError } from '../ai/analysis.js';
import type { AiConfig } from '../config.js';

const CFG: AiConfig = {
  apiKey: 'sk',
  model: 'claude-sonnet-5',
  categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
};
const NOW = new Date(2026, 7, 15);

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}
function reply(text: string, usage = { input_tokens: 5000, output_tokens: 400 }) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), { status: 200 }),
    ) as unknown as typeof fetch;
}

const GOOD =
  '[{"date":"2026-08-03","description":"UBER *TRIP","amountCents":3210,"kind":"purchase","installment":null},' +
  '{"date":"2026-08-05","description":"NETFLIX.COM","amountCents":5590,"kind":"purchase","installment":{"n":1,"total":1}},' +
  '{"date":"2026-08-10","description":"PAGAMENTO FATURA","amountCents":120000,"kind":"payment","installment":null}]';

describe('extractStatement', () => {
  it('builds a document block and parses the rows', async () => {
    const f = reply(GOOD);
    const out = await extractStatement(CFG, 'JVBERi0x', { fetchImpl: f, now: NOW });
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2].kind).toBe('payment');
    expect(out.warnings).toEqual([]);

    const body = JSON.parse((f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body);
    const content = body.messages[0].content;
    expect(content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' },
    });
    expect(content[1].type).toBe('text');
    expect(body.model).toBe('claude-sonnet-5');
  });

  it('strips a ```json fence and drops invalid rows with a warning', async () => {
    const f = reply(
      '```json\n[{"date":"2026-08-03","description":"OK","amountCents":100,"kind":"purchase","installment":null},' +
        '{"date":"nope","description":"bad","amountCents":1,"kind":"purchase","installment":null},' +
        '{"date":"2026-08-04","description":"neg","amountCents":-5,"kind":"purchase","installment":null}]\n```',
    );
    const out = await extractStatement(CFG, 'JVBERi0x', { fetchImpl: f });
    expect(out.rows).toHaveLength(1);
    expect(out.warnings.join(' ')).toMatch(/2 linha/);
  });

  it('returns [] + a warning for a non-array reply', async () => {
    const out = await extractStatement(CFG, 'JVBERi0x', { fetchImpl: reply('desculpe, não consegui') });
    expect(out.rows).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('writes an ok ledger row when given a db', async () => {
    const d = db();
    await extractStatement(CFG, 'JVBERi0x', { fetchImpl: reply(GOOD), db: d, now: NOW });
    expect(
      d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok' AND endpoint='import'").get(),
    ).toEqual({ n: 1 });
  });

  it('writes an error ledger row and rethrows on an upstream failure', async () => {
    const d = db();
    const f = vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(extractStatement(CFG, 'JVBERi0x', { fetchImpl: f, db: d })).rejects.toThrow();
    expect(
      d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error' AND endpoint='import'").get(),
    ).toEqual({ n: 1 });
  });

  it('throws ClaudeNotConfiguredError with no key and no fetch', async () => {
    const f = vi.fn();
    await expect(
      extractStatement({ ...CFG, apiKey: null }, 'JVBERi0x', { fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
    expect(f).not.toHaveBeenCalled();
  });

  it('throws BudgetExceededError when the db shows the cap is reached', async () => {
    const d = db();
    d.prepare(
      "INSERT INTO claude_api_calls (created_at, endpoint, model, cost_usd_cents, status) VALUES (?, 'x', 'm', 400, 'ok')",
    ).run(NOW.toISOString());
    const f = vi.fn();
    await expect(
      extractStatement(CFG, 'JVBERi0x', { fetchImpl: f as unknown as typeof fetch, db: d, now: NOW }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/import/extract.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `extract.ts`**

```ts
import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';
import { callClaude, ClaudeNotConfiguredError, ClaudeUpstreamError } from '../ai/client.js';
import { estimateCostUsdCents } from '../ai/cost.js';
import { isOverCap } from '../ai/budget.js';
import { BudgetExceededError } from '../ai/analysis.js';

export type LineKind = 'purchase' | 'payment' | 'fee' | 'fx';

export interface ExtractedRow {
  date: string;
  description: string;
  amountCents: number;
  kind: LineKind;
  installment: { n: number; total: number } | null;
}

export interface StatementExtraction {
  rows: ExtractedRow[];
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
}

const KINDS: LineKind[] = ['purchase', 'payment', 'fee', 'fx'];

const SYSTEM =
  'Você extrai os lançamentos de uma fatura de cartão de crédito brasileira. ' +
  'Responda APENAS com um array JSON minificado. Cada item: ' +
  '{"date":"YYYY-MM-DD","description":string,"amountCents":inteiro positivo,' +
  '"kind":"purchase"|"payment"|"fee"|"fx","installment":{"n":int,"total":int}|null}. ' +
  'Converta valores em reais (R$ 1.234,56 vira 123456). Use o ano do período da fatura; ' +
  'se a linha só tiver DD/MM, infira o ano. kind: "payment" para pagamentos recebidos, ' +
  'estornos e créditos; "fee" para IOF, anuidade, juros e multa; "fx" para compras em ' +
  'moeda estrangeira; "purchase" para o resto. installment a partir de "PARC 03/12" ou "(3/12)".';

function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function coerceRow(raw: unknown): ExtractedRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (description === '') return null;
  if (!isPosInt(o.amountCents)) return null;
  const kind = KINDS.includes(o.kind as LineKind) ? (o.kind as LineKind) : 'purchase';
  let installment: ExtractedRow['installment'] = null;
  if (
    typeof o.installment === 'object' &&
    o.installment !== null &&
    isPosInt((o.installment as Record<string, unknown>).n) &&
    isPosInt((o.installment as Record<string, unknown>).total)
  ) {
    const i = o.installment as { n: number; total: number };
    installment = { n: i.n, total: i.total };
  }
  return { date: o.date, description, amountCents: o.amountCents, kind, installment };
}

function parseRows(text: string): { rows: ExtractedRow[]; warnings: string[] } {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  if (fence) s = fence[1].trim();

  let arr: unknown;
  try {
    arr = JSON.parse(s);
  } catch {
    return { rows: [], warnings: ['A resposta da IA não pôde ser lida.'] };
  }
  if (!Array.isArray(arr)) {
    return { rows: [], warnings: ['A resposta da IA não veio no formato esperado.'] };
  }

  const rows: ExtractedRow[] = [];
  let dropped = 0;
  for (const el of arr) {
    const row = coerceRow(el);
    if (row) rows.push(row);
    else dropped += 1;
  }
  const warnings = dropped > 0 ? [`${dropped} linha(s) não reconhecida(s) foram ignoradas.`] : [];
  return { rows, warnings };
}

export async function extractStatement(
  cfg: AiConfig,
  pdfBase64: string,
  deps: { now?: Date; fetchImpl?: typeof fetch; db?: Database.Database } = {},
): Promise<StatementExtraction> {
  if (cfg.apiKey === null) throw new ClaudeNotConfiguredError();
  const now = deps.now ?? new Date();
  if (deps.db && isOverCap(deps.db, cfg, now)) {
    throw new BudgetExceededError(0, cfg.monthlyCapUsdCents);
  }

  const userBlocks = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: 'Extraia todos os lançamentos desta fatura.' },
  ];

  let res;
  try {
    res = await callClaude(
      cfg,
      { system: SYSTEM, user: userBlocks, maxTokens: 4000 },
      deps.fetchImpl,
    );
  } catch (err) {
    if (deps.db && err instanceof ClaudeUpstreamError) {
      deps.db
        .prepare(
          `INSERT INTO claude_api_calls (created_at, endpoint, model, status, error_message)
           VALUES (?, 'import', ?, 'error', ?)`,
        )
        .run(now.toISOString(), cfg.model, String(err.message).slice(0, 500));
    }
    throw err;
  }

  const { rows, warnings } = parseRows(res.text);

  if (deps.db) {
    let cost = 0;
    try {
      cost = estimateCostUsdCents(cfg.model, res.inputTokens, res.outputTokens);
    } catch {
      cost = 0;
    }
    deps.db
      .prepare(
        `INSERT INTO claude_api_calls (created_at, endpoint, model, input_tokens, output_tokens, cost_usd_cents, status)
         VALUES (?, 'import', ?, ?, ?, ?, 'ok')`,
      )
      .run(now.toISOString(), cfg.model, res.inputTokens, res.outputTokens, cost);
  }

  return { rows, warnings, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
```

> `BudgetExceededError` is currently exported from `server/src/ai/analysis.js`
> (2.1). Importing it from there is fine. If a reviewer prefers, it can be
> moved to `ai/budget.ts` in a separate refactor — out of scope here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/import/extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/import/extract.ts server/src/import/extract.test.ts
git commit -m "import: extractStatement (native PDF → Sonnet → validated rows)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `import-preview` + `import-confirm` routes

**Files:**
- Modify: `server/src/routes/expenses.ts`
- Modify: `server/src/routes/expenses.test.ts`

**Interfaces:**
- `POST /api/expenses/import-preview` `{ dataBase64, filename? }` →
  `{ rows: PreviewRow[], warnings: string[] }`; `bodyLimit: 20MB`;
  errors `400 / 503 / 429 / 502`.
- `POST /api/expenses/import-confirm` `{ rows: ConfirmRow[] }` →
  `{ created: number }`; errors `400`.

- [ ] **Step 1: Write the failing tests**

In `server/src/routes/expenses.test.ts` add:

```ts
import { extractStatement } from '../import/extract.js';

// ... inside the existing describe('expense categorization' ...) or a new describe:

describe('expense import', () => {
  it('import-preview -> 503 with no key, 400 on an empty upload', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/expenses/import-preview',
          cookies: { session: sessionCookie },
          payload: { dataBase64: 'JVBERi0xLjQK' },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/expenses/import-preview',
          cookies: { session: sessionCookie },
          payload: { dataBase64: '' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('import-confirm creates one expense per row and categorizes blanks', async () => {
    const { app, sessionCookie } = await authedApp();
    addRule(app.dbForTests, 'mercado', 'Alimentação');

    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses/import-confirm',
      cookies: { session: sessionCookie },
      payload: {
        rows: [
          { date: '2026-08-03', description: 'MERCADO LIVRE', amountCents: 4500, category: '', type: 'nao-essencial' },
          { date: '2026-08-04', description: 'Cinema (2/2)', amountCents: 3000, category: 'Lazer', type: 'nao-essencial' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: 2 });

    const list = (
      await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })
    ).json();
    expect(list).toHaveLength(2);
    expect(list.every((e: { paymentMethod: string }) => e.paymentMethod === 'Crédito')).toBe(true);
    expect(list.every((e: { installmentTotal: number | null }) => e.installmentTotal === null)).toBe(true);
    const byDesc = Object.fromEntries(list.map((e: { description: string; category: string }) => [e.description, e.category]));
    expect(byDesc['MERCADO LIVRE']).toBe('Alimentação');
    expect(byDesc['Cinema (2/2)']).toBe('Lazer');
    await app.close();
  });

  it('import-confirm rejects a malformed row and an empty list', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/expenses/import-confirm',
          cookies: { session: sessionCookie },
          payload: { rows: [{ date: 'nope', description: 'x', amountCents: 1, category: '', type: 'nao-essencial' }] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/expenses/import-confirm',
          cookies: { session: sessionCookie },
          payload: { rows: [] },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
```

(`extractStatement` import is unused in the tests as written — the
happy-path preview is covered by `import/extract.test.ts`. Drop the
import line if the linter complains, or keep the route tests to the
no-key/validation paths as shown.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && npx vitest run src/routes/expenses.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement in `routes/expenses.ts`**

Add imports:

```ts
import { extractStatement } from '../import/extract.js';
import { matchRule } from '../categorize/rules.js';
import { inferType } from '../import/expense-type.js';
import { monthToDateUsdCents } from '../ai/budget.js';
import { ClaudeNotConfiguredError, ClaudeUpstreamError } from '../ai/client.js';
import { BudgetExceededError } from '../ai/analysis.js';
```

Add the two routes inside `registerExpenseRoutes`, after the
`categorize-pending` route:

```ts
  app.post<{ Body: { dataBase64?: unknown; filename?: unknown } }>(
    '/api/expenses/import-preview',
    { preHandler: requireAuth(db), bodyLimit: 20 * 1024 * 1024 },
    async (request, reply) => {
      const dataBase64 = request.body?.dataBase64;
      if (typeof dataBase64 !== 'string' || dataBase64.trim() === '') {
        return reply.code(400).send({ error: 'dataBase64 is required' });
      }
      if (Buffer.from(dataBase64, 'base64').length > 12 * 1024 * 1024) {
        return reply.code(400).send({ error: 'PDF acima de 12 MB' });
      }

      let extraction;
      try {
        extraction = await extractStatement(aiConfig, dataBase64, { db });
      } catch (err) {
        if (err instanceof ClaudeNotConfiguredError) {
          return reply.code(503).send({ error: 'IA não configurada' });
        }
        if (err instanceof BudgetExceededError) {
          return reply.code(429).send({
            error: 'Limite mensal de IA atingido',
            monthToDateUsdCents: monthToDateUsdCents(db),
            capUsdCents: aiConfig.monthlyCapUsdCents,
          });
        }
        if (err instanceof ClaudeUpstreamError) {
          return reply.code(502).send({ error: 'Falha ao ler o PDF' });
        }
        throw err;
      }

      const rules = listRules(db);
      const seen = new Set(
        (
          db
            .prepare(
              "SELECT date, amount_cents AS amountCents, description FROM expenses WHERE deleted_at IS NULL",
            )
            .all() as { date: string; amountCents: number; description: string }[]
        ).map((e) => `${e.date}|${e.amountCents}|${e.description}`),
      );

      const rows = extraction.rows.map((r) => {
        const suggestedCategory = matchRule(rules, r.description)?.category ?? '';
        return {
          ...r,
          suggestedCategory,
          suggestedType: inferType(suggestedCategory),
          duplicate: seen.has(`${r.date}|${r.amountCents}|${r.description}`),
        };
      });

      return { rows, warnings: extraction.warnings };
    },
  );

  app.post<{
    Body: {
      rows?: {
        date?: unknown;
        description?: unknown;
        amountCents?: unknown;
        category?: unknown;
        type?: unknown;
      }[];
    };
  }>(
    '/api/expenses/import-confirm',
    { preHandler: requireAuth(db) },
    async (request, reply) => {
      const rows = request.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return reply.code(400).send({ error: 'rows must be a non-empty array' });
      }
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        if (
          typeof r.date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
          typeof r.description !== 'string' ||
          r.description.trim() === '' ||
          !Number.isInteger(r.amountCents) ||
          (r.amountCents as number) <= 0 ||
          (r.type !== 'essencial' && r.type !== 'nao-essencial')
        ) {
          return reply.code(400).send({ error: 'linha inválida', index: i });
        }
      }

      // resolve blank categories BEFORE the sync transaction
      const resolved: string[] = [];
      for (const r of rows) {
        let category = typeof r.category === 'string' ? r.category : '';
        if (category.trim() === '') {
          category = (await categorize(db, aiConfig, { description: r.description as string })).category ?? '';
        }
        resolved.push(category);
      }

      db.transaction(() => {
        rows.forEach((r, i) => {
          createExpense(db, {
            date: r.date as string,
            description: (r.description as string).trim(),
            amountCents: r.amountCents as number,
            category: resolved[i],
            type: r.type as 'essencial' | 'nao-essencial',
            paymentMethod: 'Crédito',
            installmentTotal: null,
            notes: null,
          });
        });
      })();

      return { created: rows.length };
    },
  );
```

- [ ] **Step 4: Run to verify they pass + full server suite + tsc**

Run: `cd server && npx vitest run src/routes/expenses.test.ts`
Expected: PASS.
Run: `cd server && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/expenses.ts server/src/routes/expenses.test.ts
git commit -m "Expenses: import-preview + import-confirm routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend api + `StatementImportSection`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/StatementImportSection.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/GastosPage.tsx`
- Modify: `frontend/src/pages/GastosPage.test.tsx`

**Interfaces:**
- `api.importPreviewStatement(dataBase64, filename?)` →
  `{ rows: ImportPreviewRow[]; warnings: string[] }`
- `api.importConfirmExpenses(rows: ImportConfirmRow[])` →
  `{ created: number }`
- `<StatementImportSection onImported={() => void} />`

- [ ] **Step 1: Add the api functions**

In `frontend/src/lib/api.ts` (after the category-rule fns):

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

- [ ] **Step 2: Write the failing component test**

`frontend/src/components/StatementImportSection.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatementImportSection } from './StatementImportSection.js';
import * as api from '../lib/api.js';

afterEach(() => vi.restoreAllMocks());

const PREVIEW: { rows: api.ImportPreviewRow[]; warnings: string[] } = {
  rows: [
    {
      date: '2026-08-03', description: 'UBER *TRIP', amountCents: 3210, kind: 'purchase',
      installment: null, suggestedCategory: 'Transporte', suggestedType: 'essencial', duplicate: false,
    },
    {
      date: '2026-08-10', description: 'PAGAMENTO FATURA', amountCents: 120000, kind: 'payment',
      installment: null, suggestedCategory: '', suggestedType: 'nao-essencial', duplicate: false,
    },
    {
      date: '2026-08-05', description: 'NETFLIX', amountCents: 5590, kind: 'purchase',
      installment: null, suggestedCategory: 'Assinaturas', suggestedType: 'nao-essencial', duplicate: true,
    },
  ],
  warnings: ['1 linha(s) não reconhecida(s) foram ignoradas.'],
};

function pickFile() {
  const input = screen.getByLabelText('Arquivo do extrato') as HTMLInputElement;
  const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('StatementImportSection', () => {
  it('reads a picked PDF and shows a review table', async () => {
    const preview = vi.spyOn(api, 'importPreviewStatement').mockResolvedValue(PREVIEW);
    render(<StatementImportSection onImported={() => {}} />);
    pickFile();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(preview.mock.calls[0][0]).not.toContain('data:'); // stripped base64
    expect(await screen.findByText('UBER *TRIP')).toBeInTheDocument();
    expect(screen.getByText(/1 linha/)).toBeInTheDocument();
  });

  it('pre-unchecks payments and duplicates, then confirms only checked rows', async () => {
    vi.spyOn(api, 'importPreviewStatement').mockResolvedValue(PREVIEW);
    const confirm = vi
      .spyOn(api, 'importConfirmExpenses')
      .mockResolvedValue({ created: 1 });
    const onImported = vi.fn();
    render(<StatementImportSection onImported={onImported} />);
    pickFile();
    await screen.findByText('UBER *TRIP');

    expect((screen.getByLabelText('Incluir UBER *TRIP') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Incluir PAGAMENTO FATURA') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Incluir NETFLIX') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Importar 1 selecionado/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toEqual([
      expect.objectContaining({ description: 'UBER *TRIP', category: 'Transporte', amountCents: 3210 }),
    ]);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it('shows the limit warning on a 429 preview', async () => {
    vi.spyOn(api, 'importPreviewStatement').mockRejectedValue(
      Object.assign(new Error('Limite mensal de IA atingido'), { status: 429 }),
    );
    render(<StatementImportSection onImported={() => {}} />);
    pickFile();
    expect(await screen.findByText(/Limite mensal de IA atingido/)).toBeInTheDocument();
  });
});
```

> `FileReader` in jsdom: `readAsDataURL` works. If a test env quirk
> surfaces, the component may read via `file.arrayBuffer()` +
> `btoa(String.fromCharCode(...new Uint8Array(buf)))` instead — pick
> whichever is reliable and keep the "strip any `data:` prefix" assertion.

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/StatementImportSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Write `StatementImportSection.tsx`**

A `<div className="card">` headed `<h2>Importar extrato (PDF)</h2>`
(mono, size 16, matching the other Gastos sections). Behaviour:

- State: `phase: 'idle' | 'reading' | 'review'`, `rows: EditableRow[]`,
  `warnings: string[]`, `error: string | null`, `result: string | null`,
  `confirming: boolean`.
- `EditableRow` = the `ImportPreviewRow` fields plus `checked: boolean`,
  `category: string`, `type: 'essencial' | 'nao-essencial'`,
  `date: string`, `description: string`, `amountText: string`.
- `<input type="file" accept="application/pdf,.pdf" aria-label="Arquivo do extrato">`.
  On `change`: take `e.target.files[0]`; `setPhase('reading'); setError(null)`.
  `const reader = new FileReader(); reader.onload = () => { const s = String(reader.result);
  const base64 = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s; ... };
  reader.readAsDataURL(file);`
  Then `api.importPreviewStatement(base64, file.name)`:
  - success → `setRows(preview.rows.map(toEditable)); setWarnings(preview.warnings);
    setPhase('review')` where `toEditable(r)` sets
    `checked: r.kind === 'purchase' && !r.duplicate`,
    `category: r.suggestedCategory`, `type: r.suggestedType`,
    `date: r.date`,
    `description: r.installment ? \`${r.description} (${r.installment.n}/${r.installment.total})\` : r.description`,
    `amountText: formatCentsBRL(r.amountCents)`.
  - error → `setError(mapError(err)); setPhase('idle')` with
    `mapError`: `status===503 → 'Configure a chave da IA no servidor.'`;
    `429 → 'Limite mensal de IA atingido.'`;
    `502 → 'Não consegui ler este PDF. Tente outro arquivo.'`;
    `400 → err.message`; else `'Erro ao processar o PDF.'`.
- `phase === 'reading'` → a `<p>Lendo o extrato…</p>`.
- `phase === 'review'` → a table. Each row:
  - `<input type="checkbox" aria-label={\`Incluir ${row.description}\`}
    checked={row.checked} onChange={toggle(i)}>`
  - `<input type="date" value={row.date} onChange={set(i,'date')}>`
  - `<input type="text" value={row.description} onChange={set(i,'description')}>`
  - `<input type="text" value={row.amountText} onChange={set(i,'amountText')}>`
  - `<select value={row.category} onChange={set(i,'category')}>` with
    `<option value="">Automático</option>` + `CATEGORIES`
  - `<select value={row.type} onChange={set(i,'type')}>` essencial /
    nao-essencial
  - a kind badge: `{ purchase:'Compra', payment:'Pagamento', fee:'Taxa', fx:'Câmbio' }[row.kind]`
  - `row.duplicate && <span style={{ color: 'var(--text3)' }}>possível duplicata</span>`
  - `warnings.length > 0` → a muted `<p>` joining them.
  - a button `Importar {checkedCount} selecionado(s)`,
    `disabled={confirming || checkedCount === 0}`. On click:
    - build `ImportConfirmRow[]` from checked rows:
      `amountCents = parseCentsFromInput(row.amountText)`; if any is
      `NaN` or `<= 0` → `setError('Confira os valores das linhas
      selecionadas.')` and return.
      `{ date, description: description.trim(), amountCents, category, type }`.
    - `setConfirming(true)`; `await api.importConfirmExpenses(rows)`;
      on success → `setResult(\`${created} gasto(s) importado(s)\`);
      setPhase('idle'); setRows([]); setWarnings([]); onImported?.()`.
    - `catch` → `setError(err instanceof Error ? err.message : 'Falha ao importar.')`.
    - `finally setConfirming(false)`.
- `error` → `<p className="error-text">`; `result` → a muted line.

Reuse `formatCentsBRL` / `parseCentsFromInput` from `../lib/money.js`
and `CATEGORIES` from `../lib/expenses.js`.

- [ ] **Step 5: Render on GastosPage**

`frontend/src/pages/GastosPage.tsx` — `import { StatementImportSection }
from '../components/StatementImportSection.js';` and render
`<StatementImportSection onImported={refresh} />` after
`<CategoryRulesSection />`.

`frontend/src/pages/GastosPage.test.tsx` — no new mock strictly needed
(the section makes no call on mount), but add
`vi.spyOn(api, 'importPreviewStatement').mockResolvedValue({ rows: [], warnings: [] });`
to `beforeEach` defensively so a future test that triggers it has a stub.

- [ ] **Step 6: Run to verify pass + full frontend suite + tsc**

Run: `cd frontend && npx vitest run src/components/StatementImportSection.test.tsx src/pages/GastosPage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/StatementImportSection.tsx frontend/src/components/StatementImportSection.test.tsx frontend/src/pages/GastosPage.tsx frontend/src/pages/GastosPage.test.tsx
git commit -m "Gastos: Importar extrato (PDF) section — upload, review table, confirm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: e2e, docs, build, smoke

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

After the "Categorização" block:

```bash
echo
echo "== Importação de extrato (Phase 2.3, sem chave) =="
as  "import-preview without a key -> 503" 503 "$(code POST /api/expenses/import-preview '{"dataBase64":"JVBERi0xLjQK"}')"
as  "import-preview empty upload -> 400" 400 "$(code POST /api/expenses/import-preview '{"dataBase64":""}')"
body POST /api/category-rules '{"keyword":"mercado","category":"Alimentação"}' >/dev/null
IC="$(body POST /api/expenses/import-confirm '{"rows":[{"date":"2026-08-03","description":"MERCADO X","amountCents":4500,"category":"","type":"nao-essencial"}]}')"
aeq "import-confirm created count" "1" "$(echo "$IC" | jq -r '.created')"
aeq "…row imported as Crédito" "Crédito" "$(body GET /api/expenses | jq -r '[.[] | select(.description=="MERCADO X")][0].paymentMethod')"
aeq "…and auto-categorized from the rule" "Alimentação" "$(body GET /api/expenses | jq -r '[.[] | select(.description=="MERCADO X")][0].category')"
as  "import-confirm malformed row -> 400" 400 "$(code POST /api/expenses/import-confirm '{"rows":[{"date":"nope","description":"x","amountCents":1,"category":"","type":"nao-essencial"}]}')"
as  "import-confirm empty list -> 400" 400 "$(code POST /api/expenses/import-confirm '{"rows":[]}')"
```

- [ ] **Step 3: Run e2e**

Run: `bash scripts/qa-e2e.sh`
Expected: `RESULT: N passed, 0 failed` (120 prior + ~7 new).

- [ ] **Step 4: Restart live server + smoke (key configured)**

```bash
cd server && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'health: %{http_code}\n' http://localhost:4173/api/health
curl -s -o /dev/null -w 'import-preview unauth: %{http_code}\n' -X POST http://localhost:4173/api/expenses/import-preview   # expect 401
```

Manual (needs a real statement PDF from the user): on the Gastos page,
open "Importar extrato (PDF)", pick a statement → a review table appears
within a few seconds; payments/fees pre-unchecked; confirm a few → they
land in the expense list categorized; a `claude_api_calls` row with
`endpoint='import'` exists; the Análise "IA este mês" figure rises a few
cents.

- [ ] **Step 5: Docs**

`docs/qa-checklist.md` — bump header counts; add an `## Importação de
extrato PDF (Phase 2.3)` section mirroring the unit + e2e coverage, plus
the `[ ]` browser check (real PDF → review table → confirm).

`README.md` — mark slice 3 done in the Phase 2 list; leave slice 4 as
next.

- [ ] **Step 6: Commit**

```bash
git add scripts/qa-e2e.sh docs/qa-checklist.md README.md
git commit -m "PDF import: e2e assertions + docs"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `callClaude` accepts a content-block array | 1 |
| `inferType` / `ESSENTIAL_CATEGORIES` | 2 |
| `extractStatement` — document block, Sonnet, `maxTokens 4000` | 3 |
| Parse: fence strip, per-row validate, drop-invalid + warnings, non-array → `[]` + warning | 3 |
| `endpoint='import'` ok/error ledger rows; cost via `estimateCostUsdCents(cfg.model,…)` | 3 |
| `ClaudeNotConfiguredError` (no key, no fetch); `BudgetExceededError` (db over cap, no fetch); upstream → error row + rethrow | 3 |
| `POST /import-preview` — `bodyLimit 20MB`, empty → 400, >12MB decoded → 400 | 4 |
| preview error mapping 503 / 429 / 502 | 4 |
| per-row `suggestedCategory` (rule pass only), `suggestedType`, `duplicate` (date\|amount\|description) | 4 |
| `POST /import-confirm` — non-empty array, per-row validate, 400+index on a bad row | 4 |
| confirm resolves blank categories **before** the sync transaction | 4 |
| installment line → **one** expense (`installmentTotal: null`), `paymentMethod: 'Crédito'` | 4 |
| `import-confirm {rows: []}` → 400 | 4 |
| frontend `ImportPreviewRow` / `ImportConfirmRow` + 2 fns | 5 |
| `StatementImportSection` — file → base64 (strip `data:`), review table, pre-uncheck payments+dupes, confirm only checked, 429 warning, warnings line | 5 |
| rendered on Gastos after `CategoryRulesSection` | 5 |
| e2e no-key + confirm assertions; docs; README | 6 |
| no dep / no migration / no stored PDF | all (constraints) |
| whole PDF sent to Anthropic — documented, user-initiated, memory-only | 3 + spec security note |

**Placeholder scan:** no `TODO`/`TBD`. Task 5 Step 4 describes the
component in prose but pins every `aria-label`, state field, option
value, error string, and api call; all server logic (client, extract,
routes) is given in full. The two "if a test-env quirk surfaces" asides
name a concrete alternative and keep the observable assertion fixed.

**Type consistency:**
- `ContentBlock` (Task 1) — the document/text blocks built in
  `extract.ts` (Task 3) are plain objects assignable to
  `{ type: string; [k: string]: unknown }[]`.
- `ExtractedRow` (Task 3) is spread into `PreviewRow` (Task 4) with
  exactly `+ suggestedCategory: string, suggestedType:
  'essencial'|'nao-essencial', duplicate: boolean` — matches the
  frontend `ImportPreviewRow` (Task 5) field-for-field, `kind` typed as
  `ImportLineKind` = the same 4 strings as `LineKind`.
- `ConfirmRow` (Task 4) === `ImportConfirmRow` (Task 5): `{ date,
  description, amountCents, category, type }` — the confirm route reads
  exactly these and the frontend sends exactly these.
- `extractStatement(cfg, pdfBase64, deps?)` — Task 3 signature matches
  Task 4's call `extractStatement(aiConfig, dataBase64, { db })` and the
  Task 3 tests.
- `inferType(category: string)` (Task 2) matches Task 4's
  `inferType(suggestedCategory)`.
- `BudgetExceededError` imported from `../ai/analysis.js` in both Task 3
  and Task 4 — it is exported there (2.1), confirmed.
- `monthToDateUsdCents` / `isOverCap` from `../ai/budget.js` (2.2) — used
  in Task 3 (`isOverCap`) and Task 4 (`monthToDateUsdCents` for the 429
  body); both exported there, confirmed.
- `matchRule` / `listRules` from `../categorize/rules.js` (2.2),
  `categorize` from `../categorize/categorize.js` (2.2),
  `createExpense` from `../db/expenses.js` — all already imported in
  `routes/expenses.ts` today except `matchRule` (Task 4 adds it).
