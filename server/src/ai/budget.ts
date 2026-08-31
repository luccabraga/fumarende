import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Sum of `cost_usd_cents` for successful Claude calls in `now`'s month. */
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
