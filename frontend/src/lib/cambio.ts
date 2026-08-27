export interface CambioInput {
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate: number | null;
  iofCents: number;
  bankFeeCents: number;
}

export interface CambioBreakdown {
  grossBrlCents: number;
  totalFeesCents: number;
  netBrlCents: number;
  /** Net BRL per USD (valor efetivo total). A rate, not cents. Never persisted. */
  vetRate: number;
  spreadBrlCents: number | null;
  spreadPct: number | null;
}

/**
 * Câmbio contract arithmetic. Mirrors `server/src/cambio/math.ts` exactly —
 * keep the two in sync. Ported from the validated `stack-project` prototype.
 */
export function calcCambio(input: CambioInput): CambioBreakdown {
  const grossBrlCents = Math.round(input.amountUsdCents * input.contractedRate);
  const totalFeesCents = input.iofCents + input.bankFeeCents;
  const netBrlCents = grossBrlCents - totalFeesCents;
  const vetRate = input.amountUsdCents > 0 ? netBrlCents / input.amountUsdCents : 0;

  let spreadBrlCents: number | null = null;
  let spreadPct: number | null = null;
  if (input.ptaxRate !== null && input.ptaxRate > 0) {
    spreadBrlCents = Math.round((input.ptaxRate - vetRate) * input.amountUsdCents);
    spreadPct = ((input.ptaxRate - vetRate) / input.ptaxRate) * 100;
  }

  return { grossBrlCents, totalFeesCents, netBrlCents, vetRate, spreadBrlCents, spreadPct };
}
