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

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YY, DD.MM, YYYY/MM/DD, … → YYYY-MM-DD. */
function normalizeDate(v: unknown, now: Date): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  const dmy = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    let y: number;
    if (dmy[3] === undefined) {
      // no year on the line — assume this statement year, roll back if it lands in the future
      y = now.getFullYear();
      const guess = new Date(`${y}-${m}-${d}T00:00:00Z`);
      if (guess.getTime() - now.getTime() > 40 * 86_400_000) y -= 1;
    } else {
      y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    }
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Accepts a positive int (cents), a float (reais), or a BR/US money string → cents. */
function toCents(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return Number.isInteger(v) ? v : Math.round(v * 100);
  }
  if (typeof v === 'string') {
    let s = v.replace(/[^\d.,-]/g, '').trim();
    if (s === '') return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }
  return null;
}

type Coerced = { ok: ExtractedRow } | { drop: string };

function coerceRow(raw: unknown, now: Date): Coerced {
  if (typeof raw !== 'object' || raw === null) return { drop: 'não é um objeto' };
  const o = raw as Record<string, unknown>;

  const date = normalizeDate(o.date, now);
  if (date === null) return { drop: `data "${String(o.date)}" não reconhecida` };

  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (description === '') return { drop: 'sem descrição' };

  const amountCents = toCents(o.amountCents);
  if (amountCents === null) return { drop: `valor "${String(o.amountCents)}" não reconhecido` };

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
  return { ok: { date, description, amountCents, kind, installment } };
}

function parseRows(text: string, now: Date): { rows: ExtractedRow[]; warnings: string[] } {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  if (fence) s = fence[1].trim();
  // tolerate leading prose before a JSON array
  if (!s.startsWith('[')) {
    const b = s.indexOf('[');
    if (b !== -1) s = s.slice(b);
  }

  let arr: unknown;
  try {
    arr = JSON.parse(s);
  } catch {
    return { rows: [], warnings: ['A resposta da IA não pôde ser lida como JSON.'] };
  }
  if (!Array.isArray(arr)) {
    return { rows: [], warnings: ['A resposta da IA não veio como uma lista de lançamentos.'] };
  }

  const rows: ExtractedRow[] = [];
  const reasons: string[] = [];
  for (const el of arr) {
    const c = coerceRow(el, now);
    if ('ok' in c) rows.push(c.ok);
    else if (reasons.length < 3) reasons.push(c.drop);
  }
  const droppedCount = arr.length - rows.length;
  const warnings: string[] = [];
  if (droppedCount > 0) {
    warnings.push(
      `${droppedCount} de ${arr.length} linha(s) ignoradas (ex.: ${reasons.join('; ')}).`,
    );
  }
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

  const { rows, warnings } = parseRows(res.text, now);

  if (deps.db) {
    // eslint-disable-next-line no-console
    console.log(
      `[import] response ${res.text.length} chars, ${rows.length} rows kept` +
        (warnings.length ? ` — ${warnings.join(' ')}` : '') +
        (rows.length === 0 ? ` — head: ${res.text.slice(0, 400).replace(/\s+/g, ' ')}` : ''),
    );
  }

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
