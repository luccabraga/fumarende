export const MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** USD cents, rounded half-up. Throws on an unpriced model. */
export function estimateCostUsdCents(model: string, inTok: number, outTok: number): number {
  const rate = MODEL_RATES_USD_PER_MTOK[model];
  if (!rate) throw new Error(`unknown model rate: ${model}`);
  const usd = (inTok / 1_000_000) * rate.input + (outTok / 1_000_000) * rate.output;
  return Math.round(usd * 100);
}
