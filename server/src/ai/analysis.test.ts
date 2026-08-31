import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { seedTestData } from '../data/seed.js';
import { runAnalysis, listAnalyses, aiStatus, BudgetExceededError } from './analysis.js';
import { ClaudeUpstreamError } from './client.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk-test',
  model: 'claude-sonnet-5',
  categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
  webSearch: true,
  webSearchMaxUses: 3,
};

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  seedTestData(d, NOW);
  return d;
}
function fakeFetch(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), { status: 200 }),
    ) as unknown as typeof fetch;
}

describe('runAnalysis', () => {
  it('writes one ok call row + one analysis row and returns the joined shape', async () => {
    const d = db();
    const row = await runAnalysis(d, CFG, 'diagnostico', {
      now: NOW,
      fetchImpl: fakeFetch('# Resultado\nOk'),
    });

    expect(row).toMatchObject({
      kind: 'diagnostico',
      responseMd: '# Resultado\nOk',
      model: 'claude-sonnet-5',
    });
    // 1000in*3/M + 500out*15/M = 0.3c + 0.75c = 1.05c -> 1
    expect(row.costUsdCents).toBe(1);
    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='ok'").get()).toEqual({
      n: 1,
    });
    expect(d.prepare('SELECT COUNT(*) n FROM ai_analyses').get()).toEqual({ n: 1 });
  });

  it('records an error row and re-throws on an upstream failure', async () => {
    const d = db();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(
      runAnalysis(d, CFG, 'poupanca', { now: NOW, fetchImpl }),
    ).rejects.toBeInstanceOf(ClaudeUpstreamError);

    expect(d.prepare("SELECT COUNT(*) n FROM claude_api_calls WHERE status='error'").get()).toEqual({
      n: 1,
    });
    expect(d.prepare('SELECT COUNT(*) n FROM ai_analyses').get()).toEqual({ n: 0 });
  });

  it('throws BudgetExceededError and makes no call once month-to-date >= cap', async () => {
    const d = db();
    d.prepare(
      `INSERT INTO claude_api_calls (created_at, endpoint, model, cost_usd_cents, status)
       VALUES (?, 'x', 'claude-sonnet-5', 400, 'ok')`,
    ).run(NOW.toISOString());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      runAnalysis(d, CFG, 'diagnostico', { now: NOW, fetchImpl }),
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
