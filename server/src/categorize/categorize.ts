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

/**
 * Resolve a category for an expense description. A keyword rule always
 * wins (instant, free). Only when no rule matches — and the API key is
 * set and the monthly cap is not reached — is the Haiku fallback
 * consulted; a high-confidence answer is applied and learned as a new
 * rule. Never throws: any AI failure yields `{ category: null, source:
 * 'none' }`.
 */
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
        /* duplicate or race — ignore */
      }
    }
    return { category: guess.category, source: 'claude' };
  }
  return { category: null, source: 'none' };
}
