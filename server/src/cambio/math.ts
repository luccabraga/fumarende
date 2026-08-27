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
 * Câmbio contract arithmetic, ported unchanged from the validated
 * `stack-project` prototype (`app/src/lib/cambio-math.ts`).
 *
 * gross = USD * contracted rate, rounded to cents
 * net   = gross - IOF - bank fee
 * VET   = net BRL / USD  (the effective rate you actually paid)
 * spread vs PTAX is only defined when a positive PTAX is supplied.
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
