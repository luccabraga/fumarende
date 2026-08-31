import type { AiConfig } from '../config.js';
import { callClaude } from '../ai/client.js';
import { CATEGORIES, isCategory, type Category } from './categories.js';

export interface ClaudeCategoryGuess {
  category: Category | null;
  confidence: 'high' | 'low';
  keyword: string | null;
}

export interface ClaudeCategorizeOutcome {
  guess: ClaudeCategoryGuess;
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM =
  `Você classifica a descrição de um gasto de cartão brasileiro em exatamente uma destas categorias: ` +
  `${CATEGORIES.join(', ')}. ` +
  `Responda APENAS com JSON minificado: {"category": <uma da lista ou null>, "confidence": "high"|"low", ` +
  `"keyword": <token curto do estabelecimento em minúsculas ou null>}. ` +
  `Use null + "low" quando a descrição for vaga demais.`;

const FALLBACK: ClaudeCategoryGuess = { category: null, confidence: 'low', keyword: null };

function parseGuess(text: string): ClaudeCategoryGuess {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  if (fence) s = fence[1].trim();

  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return FALLBACK;
  }
  if (typeof obj !== 'object' || obj === null) return FALLBACK;

  const o = obj as Record<string, unknown>;
  const category = isCategory(o.category) ? (o.category as Category) : null;
  const confidence = o.confidence === 'high' ? 'high' : 'low';
  const keyword =
    typeof o.keyword === 'string' && o.keyword.trim() !== ''
      ? o.keyword.trim().toLowerCase()
      : null;
  return { category, confidence, keyword };
}

export async function claudeCategorize(
  cfg: AiConfig,
  description: string,
  fetchImpl?: typeof fetch,
): Promise<ClaudeCategorizeOutcome> {
  const res = await callClaude(
    { ...cfg, model: cfg.categorizeModel },
    { system: SYSTEM, user: description, maxTokens: 120 },
    fetchImpl,
  );
  return {
    guess: parseGuess(res.text),
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}
