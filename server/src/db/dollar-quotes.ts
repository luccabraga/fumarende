import type Database from 'better-sqlite3';

export interface DollarQuote {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export interface NewDollarQuote {
  month: string;
  rate: number;
  salaryUsdCents?: number | null;
}

interface DollarQuoteRow {
  month: string;
  rate: number;
  salary_usd_cents: number | null;
}

function validate(input: NewDollarQuote): void {
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    throw new Error('month must be in YYYY-MM format');
  }
  if (typeof input.rate !== 'number' || !Number.isFinite(input.rate) || input.rate <= 0) {
    throw new Error('rate must be a positive number');
  }
  const s = input.salaryUsdCents;
  if (s !== undefined && s !== null && (!Number.isInteger(s) || s < 0)) {
    throw new Error('salaryUsdCents must be a non-negative integer');
  }
}

export function upsertQuote(db: Database.Database, input: NewDollarQuote): DollarQuote {
  validate(input);
  db.prepare(
    `INSERT INTO dollar_quotes (month, rate, salary_usd_cents, deleted_at)
     VALUES (@month, @rate, @salaryUsdCents, NULL)
     ON CONFLICT(month) DO UPDATE SET
       rate = excluded.rate,
       salary_usd_cents = excluded.salary_usd_cents,
       deleted_at = NULL`,
  ).run({
    month: input.month,
    rate: input.rate,
    salaryUsdCents: input.salaryUsdCents ?? null,
  });

  const row = db
    .prepare('SELECT month, rate, salary_usd_cents FROM dollar_quotes WHERE month = ?')
    .get(input.month) as DollarQuoteRow;
  return { month: row.month, rate: row.rate, salaryUsdCents: row.salary_usd_cents };
}

export function listQuotes(db: Database.Database): DollarQuote[] {
  const rows = db
    .prepare(
      `SELECT month, rate, salary_usd_cents
       FROM dollar_quotes
       WHERE deleted_at IS NULL
       ORDER BY month ASC`,
    )
    .all() as DollarQuoteRow[];
  return rows.map((r) => ({ month: r.month, rate: r.rate, salaryUsdCents: r.salary_usd_cents }));
}

export function deleteQuote(db: Database.Database, month: string): void {
  db.prepare('UPDATE dollar_quotes SET deleted_at = ? WHERE month = ?').run(
    new Date().toISOString(),
    month,
  );
}
