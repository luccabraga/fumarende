import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { aiUsage } from './usage.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk',
  model: 'm',
  categorizeModel: 'h',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
  webSearch: true,
  webSearchMaxUses: 3,
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
    call(d, '2026-08-05T00:00:00Z', 'import', 12, 'error');
    call(d, '2026-07-30T00:00:00Z', 'analysis:diagnostico', 9);

    const u = aiUsage(d, CFG, NOW);
    expect(u.monthToDateUsdCents).toBe(11); // 6+4+1
    expect(u.byEndpoint[0]).toEqual({
      endpoint: 'analysis:cambio+web',
      calls: 2,
      costUsdCents: 10,
    });
    expect(u.byEndpoint.map((e) => e.endpoint)).not.toContain('import'); // error row excluded
    expect(u.recent.length).toBe(5); // all rows, any status/month
    expect(u.recent[0].endpoint).toBe('analysis:diagnostico'); // newest id
    expect(u.capUsdCents).toBe(400);
  });

  it('falls back to the config USD/BRL rate with no dollar_quotes', () => {
    expect(aiUsage(db(), CFG, NOW).usdBrlRate).toBe(5.4);
  });
});
