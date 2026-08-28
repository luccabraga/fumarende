export interface QuoteInput {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export interface QuoteRow extends QuoteInput {
  salaryBrlCents: number | null;
  vsAveragePct: number;
}

export interface QuoteStats {
  averageRate: number;
  rows: QuoteRow[];
}

/**
 * Derives the average rate, each month's USD salary converted to BRL at
 * that month's rate, and each rate's percentage distance from the
 * average. Rows keep the input order (callers pass them ascending by
 * month).
 */
export function quoteStats(quotes: QuoteInput[]): QuoteStats {
  if (quotes.length === 0) return { averageRate: 0, rows: [] };

  const averageRate = quotes.reduce((s, q) => s + q.rate, 0) / quotes.length;

  const rows = quotes.map((q) => ({
    ...q,
    salaryBrlCents: q.salaryUsdCents !== null ? Math.round(q.salaryUsdCents * q.rate) : null,
    vsAveragePct: averageRate > 0 ? ((q.rate - averageRate) / averageRate) * 100 : 0,
  }));

  return { averageRate, rows };
}
