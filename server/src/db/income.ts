import type Database from 'better-sqlite3';

export interface IncomeEntry {
  id: number;
  date: string;
  amountBrlCents: number;
  amountUsdCents: number | null;
  description: string | null;
  source: string | null;
  exchangeContractId: number | null;
  notes: string | null;
}

export interface NewIncomeEntry {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
  source?: string | null;
  exchangeContractId?: number | null;
  notes?: string | null;
}

interface IncomeRow {
  id: number;
  date: string;
  amount_brl_cents: number;
  amount_usd_cents: number | null;
  description: string | null;
  source: string | null;
  exchange_contract_id: number | null;
  notes: string | null;
}

function toEntry(row: IncomeRow): IncomeEntry {
  return {
    id: row.id,
    date: row.date,
    amountBrlCents: row.amount_brl_cents,
    amountUsdCents: row.amount_usd_cents,
    description: row.description,
    source: row.source,
    exchangeContractId: row.exchange_contract_id,
    notes: row.notes,
  };
}

export function createIncome(db: Database.Database, input: NewIncomeEntry): number {
  const result = db
    .prepare(
      `INSERT INTO income
         (date, amount_brl_cents, amount_usd_cents, description, source, exchange_contract_id, notes)
       VALUES (@date, @amountBrlCents, @amountUsdCents, @description, @source, @exchangeContractId, @notes)`,
    )
    .run({
      date: input.date,
      amountBrlCents: input.amountBrlCents,
      amountUsdCents: input.amountUsdCents ?? null,
      description: input.description ?? null,
      source: input.source ?? null,
      exchangeContractId: input.exchangeContractId ?? null,
      notes: input.notes ?? null,
    });
  return Number(result.lastInsertRowid);
}

export function listIncome(db: Database.Database): IncomeEntry[] {
  const rows = db
    .prepare(
      `SELECT id, date, amount_brl_cents, amount_usd_cents, description, source, exchange_contract_id, notes
       FROM income
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as IncomeRow[];
  return rows.map(toEntry);
}

export function softDeleteIncome(db: Database.Database, id: number): void {
  db.prepare('UPDATE income SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}
