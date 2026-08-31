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
