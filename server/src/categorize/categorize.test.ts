import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { addRule, listRules } from './rules.js';
import { categorize } from './categorize.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const KEY: AiConfig = {
  apiKey: 'sk',
  model: 'claude-sonnet-5',
  categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
};
const NOKEY: AiConfig = { ...KEY, apiKey: null };

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}
function fetchGuess(json: string) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: json }],
          usage: { input_tokens: 30, output_tokens: 10 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
}

describe('categorize', () => {
  it('returns a rule hit without calling Claude or writing a ledger row', async () => {
    const d = db();
    addRule(d, 'uber', 'Transporte');
    const f = vi.fn() as unknown as typeof fetch;
    const r = await categorize(d, KEY, { description: 'UBER *TRIP' }, { now: NOW, fetchImpl: f });
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
    expect(
      d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok' AND endpoint='categorize'").get(),
    ).toEqual({ n: 1 });
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
    const f = vi.fn() as unknown as typeof fetch;
    const r = await categorize(d, KEY, { description: 'loja xyz' }, { now: NOW, fetchImpl: f });
    expect(r).toEqual({ category: null, source: 'none' });
    expect(f).not.toHaveBeenCalled();
  });

  it('on an upstream error: writes an error row and returns none (no throw)', async () => {
    const d = db();
    const f = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r = await categorize(d, KEY, { description: 'loja xyz' }, { now: NOW, fetchImpl: f });
    expect(r).toEqual({ category: null, source: 'none' });
    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error'").get()).toEqual({
      n: 1,
    });
  });
});
