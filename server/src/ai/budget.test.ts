import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { monthToDateUsdCents, isOverCap } from './budget.js';
import type { AiConfig } from '../config.js';

const NOW = new Date(2026, 7, 15);
const CFG: AiConfig = {
  apiKey: 'sk',
  model: 'm',
  categorizeModel: 'h',
  monthlyCapUsdCents: 100,
  usdBrlFallbackRate: 5,
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
    call(d, '2026-07-31T00:00:00Z', 99); // other month
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
