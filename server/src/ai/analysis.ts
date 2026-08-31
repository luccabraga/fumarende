import type Database from 'better-sqlite3';
import type { AiConfig } from '../config.js';
import { buildSnapshot, type AnalysisSnapshot } from './snapshot.js';
import { callClaude, ClaudeNotConfiguredError, ClaudeUpstreamError } from './client.js';
import { estimateCostUsdCents } from './cost.js';
import { isOverCap, monthToDateUsdCents } from './budget.js';
import { webSearchTool } from './web-search.js';

export type AnalysisKind = 'diagnostico' | 'poupanca' | 'cambio';

export interface AiAnalysisRow {
  id: number;
  createdAt: string;
  kind: AnalysisKind;
  responseMd: string;
  costUsdCents: number;
  model: string;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
  webSearch: boolean;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly monthToDateUsdCents: number,
    readonly capUsdCents: number,
  ) {
    super('AI monthly cap reached');
    this.name = 'BudgetExceededError';
  }
}

const SHARED_GUARDRAIL =
  'Responda em português do Brasil, em Markdown (GitHub-flavored). Baseie cada afirmação ' +
  'estritamente nos dados JSON fornecidos; não invente números. Seja direto, no máximo ~250 palavras.';

export const ANALYSES: Record<
  AnalysisKind,
  {
    label: string;
    system: string;
    userPrompt: (s: AnalysisSnapshot) => string;
    maxTokens: number;
  }
> = {
  diagnostico: {
    label: 'Diagnóstico geral',
    system: `Você é um consultor financeiro pessoal. ${SHARED_GUARDRAIL} Estruture: pontos fortes, riscos, e exatamente 3 ações concretas.`,
    userPrompt: (s) =>
      `Analise minha situação financeira e dê um diagnóstico.\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 1200,
  },
  poupanca: {
    label: 'Estou poupando o suficiente?',
    system: `Você é um consultor financeiro pessoal focado em reserva de emergência e metas. ${SHARED_GUARDRAIL} Compare o que é guardado com as metas 3x/6x e a meta mensal; sugira um valor mensal.`,
    userPrompt: (s) =>
      `Estou poupando o suficiente? Considere reserva, meta mensal e metas.\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 1000,
  },
  cambio: {
    label: 'Converter dólares agora?',
    system: `Você é um consultor de câmbio. ${SHARED_GUARDRAIL} Você NÃO tem dados de mercado ao vivo — raciocine apenas pelo histórico de contratos e cotações informadas pelo usuário (tendência de spread, timing do salário). Deixe claro que não é recomendação de investimento.`,
    userPrompt: (s) =>
      `Devo converter dólares para reais agora, com base no meu histórico?\n\nDADOS:\n${JSON.stringify(s)}`,
    maxTokens: 900,
  },
};

const CAMBIO_WEB_SYSTEM =
  'Você é um consultor de câmbio com acesso a busca na web. Use a ferramenta de busca ' +
  'para verificar a cotação USD/BRL atual, a tendência recente (últimas semanas) e ' +
  'notícias macroeconômicas relevantes (Brasil e EUA). Combine isso com o histórico do ' +
  'usuário (contratos e cotações informadas). Cite as fontes entre parênteses. Deixe ' +
  'claro que não é recomendação de investimento. Responda em português do Brasil, em ' +
  'Markdown, no máximo ~280 palavras.';

export async function runAnalysis(
  db: Database.Database,
  cfg: AiConfig,
  kind: AnalysisKind,
  deps: { now?: Date; fetchImpl?: typeof fetch; webSearch?: boolean } = {},
): Promise<AiAnalysisRow> {
  const now = deps.now ?? new Date();
  const spec = ANALYSES[kind];
  if (!spec) throw new Error(`unknown analysis kind: ${kind}`);

  if (isOverCap(db, cfg, now)) {
    throw new BudgetExceededError(monthToDateUsdCents(db, now), cfg.monthlyCapUsdCents);
  }

  const useWeb = kind === 'cambio' && deps.webSearch === true && cfg.webSearch;
  const endpoint = useWeb ? 'analysis:cambio+web' : `analysis:${kind}`;

  const snapshot = buildSnapshot(db, now);

  let result;
  try {
    result = await callClaude(
      cfg,
      {
        system: useWeb ? CAMBIO_WEB_SYSTEM : spec.system,
        user: spec.userPrompt(snapshot),
        maxTokens: useWeb ? 1400 : spec.maxTokens,
        tools: useWeb ? [webSearchTool(cfg.webSearchMaxUses)] : undefined,
      },
      deps.fetchImpl ?? fetch,
    );
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) throw err; // nothing happened
    if (err instanceof ClaudeUpstreamError) {
      db.prepare(
        `INSERT INTO claude_api_calls (created_at, endpoint, model, status, error_message)
         VALUES (?, ?, ?, 'error', ?)`,
      ).run(now.toISOString(), endpoint, cfg.model, String(err.message).slice(0, 500));
    }
    throw err;
  }

  let cost = 0;
  try {
    cost = estimateCostUsdCents(
      cfg.model,
      result.inputTokens,
      result.outputTokens,
      result.webSearchRequests,
    );
  } catch {
    cost = 0; // unpriced model — tokens known, price not; keep the ledger honest
  }

  const insert = db.transaction((): AiAnalysisRow => {
    const callId = Number(
      db
        .prepare(
          `INSERT INTO claude_api_calls (created_at, endpoint, model, input_tokens, output_tokens, cost_usd_cents, status)
           VALUES (?, ?, ?, ?, ?, ?, 'ok')`,
        )
        .run(
          now.toISOString(),
          endpoint,
          cfg.model,
          result.inputTokens,
          result.outputTokens,
          cost,
        ).lastInsertRowid,
    );
    const analysisId = Number(
      db
        .prepare(
          `INSERT INTO ai_analyses (created_at, kind, snapshot_json, response_md, claude_api_call_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(now.toISOString(), kind, JSON.stringify(snapshot), result.text, callId).lastInsertRowid,
    );
    return {
      id: analysisId,
      createdAt: now.toISOString(),
      kind,
      responseMd: result.text,
      costUsdCents: cost,
      model: cfg.model,
    };
  });
  return insert();
}

export function listAnalyses(db: Database.Database, limit = 20): AiAnalysisRow[] {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  return db
    .prepare(
      `SELECT a.id, a.created_at AS createdAt, a.kind, a.response_md AS responseMd,
              c.cost_usd_cents AS costUsdCents, c.model AS model
       FROM ai_analyses a
       LEFT JOIN claude_api_calls c ON c.id = a.claude_api_call_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(n) as AiAnalysisRow[];
}

/** Latest self-reported USD/BRL quote, else the configured fallback. */
export function latestUsdBrlRate(db: Database.Database, cfg: AiConfig): number {
  const quote = db
    .prepare('SELECT rate FROM dollar_quotes WHERE deleted_at IS NULL ORDER BY month DESC LIMIT 1')
    .get() as { rate: number } | undefined;
  return quote?.rate ?? cfg.usdBrlFallbackRate;
}

export function aiStatus(db: Database.Database, cfg: AiConfig, now: Date = new Date()): AiStatus {
  return {
    configured: cfg.apiKey !== null,
    model: cfg.model,
    monthToDateUsdCents: monthToDateUsdCents(db, now),
    capUsdCents: cfg.monthlyCapUsdCents,
    usdBrlRate: latestUsdBrlRate(db, cfg),
    webSearch: cfg.webSearch,
  };
}
