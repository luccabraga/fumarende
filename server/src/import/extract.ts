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
  const warnings =
    dropped > 0 ? [`${dropped} linha(s) não reconhecida(s) foram ignoradas.`] : [];
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
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
    },
    { type: 'text', text: 'Extraia todos os lançamentos desta fatura.' },
  ];

  let res;
  try {
    res = await callClaude(cfg, { system: SYSTEM, user: userBlocks, maxTokens: 4000 }, deps.fetchImpl);
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
