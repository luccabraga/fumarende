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

    const body = JSON.parse(
      (f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body,
    );
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
    const out = await extractStatement(CFG, 'JVBERi0x', {
      fetchImpl: reply('desculpe, não consegui'),
    });
    expect(out.rows).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('writes an ok ledger row when given a db', async () => {
    const d = db();
    await extractStatement(CFG, 'JVBERi0x', { fetchImpl: reply(GOOD), db: d, now: NOW });
    expect(
      d
        .prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok' AND endpoint='import'")
        .get(),
    ).toEqual({ n: 1 });
  });

  it('writes an error ledger row and rethrows on an upstream failure', async () => {
    const d = db();
    const f = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(extractStatement(CFG, 'JVBERi0x', { fetchImpl: f, db: d })).rejects.toThrow();
    expect(
      d
        .prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error' AND endpoint='import'")
        .get(),
    ).toEqual({ n: 1 });
  });

  it('throws ClaudeNotConfiguredError with no key and no fetch', async () => {
    const f = vi.fn();
    await expect(
      extractStatement({ ...CFG, apiKey: null }, 'JVBERi0x', {
        fetchImpl: f as unknown as typeof fetch,
      }),
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
      extractStatement(CFG, 'JVBERi0x', {
        fetchImpl: f as unknown as typeof fetch,
        db: d,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(f).not.toHaveBeenCalled();
  });
});
