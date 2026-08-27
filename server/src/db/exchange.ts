import type Database from 'better-sqlite3';
import { calcCambio } from '../cambio/math.js';

export interface ExchangeContract {
  id: number;
  date: string;
  institution: string;
  operationType: string;
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate: number | null;
  iofCents: number;
  bankFeeCents: number;
  netBrlCents: number;
  sourcePdfRef: string | null;
  notes: string | null;
}

export interface NewExchangeContract {
  date: string;
  institution: string;
  operationType: string;
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate?: number | null;
  iofCents?: number;
  bankFeeCents?: number;
  sourcePdfRef?: string | null;
  notes?: string | null;
}

interface ExchangeContractRow {
  id: number;
  date: string;
  institution: string;
  operation_type: string;
  amount_usd_cents: number;
  contracted_rate: number;
  ptax_rate: number | null;
  iof_cents: number;
  bank_fee_cents: number;
  net_brl_cents: number;
  source_pdf_ref: string | null;
  notes: string | null;
}

function toContract(row: ExchangeContractRow): ExchangeContract {
  return {
    id: row.id,
    date: row.date,
    institution: row.institution,
    operationType: row.operation_type,
    amountUsdCents: row.amount_usd_cents,
    contractedRate: row.contracted_rate,
    ptaxRate: row.ptax_rate,
    iofCents: row.iof_cents,
    bankFeeCents: row.bank_fee_cents,
    netBrlCents: row.net_brl_cents,
    sourcePdfRef: row.source_pdf_ref,
    notes: row.notes,
  };
}

/**
 * Validates, computes `net_brl_cents` server-side via calcCambio (the stored
 * total is never client-supplied), and inserts. Throws on invalid input.
 */
export function createExchangeContract(db: Database.Database, input: NewExchangeContract): number {
  const institution = input.institution.trim();
  const iofCents = input.iofCents ?? 0;
  const bankFeeCents = input.bankFeeCents ?? 0;
  const ptaxRate = input.ptaxRate ?? null;

  if (institution === '') {
    throw new Error('institution is required');
  }
  if (input.operationType !== 'compra' && input.operationType !== 'venda') {
    throw new Error("operationType must be 'compra' or 'venda'");
  }
  if (!Number.isInteger(input.amountUsdCents) || input.amountUsdCents <= 0) {
    throw new Error('amountUsdCents must be a positive integer');
  }

  const { netBrlCents } = calcCambio({
    amountUsdCents: input.amountUsdCents,
    contractedRate: input.contractedRate,
    ptaxRate,
    iofCents,
    bankFeeCents,
  });

  const result = db
    .prepare(
      `INSERT INTO exchange_contracts
         (date, institution, operation_type, amount_usd_cents, contracted_rate,
          ptax_rate, iof_cents, bank_fee_cents, net_brl_cents, source_pdf_ref, notes)
       VALUES (@date, @institution, @operationType, @amountUsdCents, @contractedRate,
               @ptaxRate, @iofCents, @bankFeeCents, @netBrlCents, @sourcePdfRef, @notes)`,
    )
    .run({
      date: input.date,
      institution,
      operationType: input.operationType,
      amountUsdCents: input.amountUsdCents,
      contractedRate: input.contractedRate,
      ptaxRate,
      iofCents,
      bankFeeCents,
      netBrlCents,
      sourcePdfRef: input.sourcePdfRef ?? null,
      notes: input.notes ?? null,
    });
  return Number(result.lastInsertRowid);
}

export function listExchangeContracts(db: Database.Database): ExchangeContract[] {
  const rows = db
    .prepare(
      `SELECT id, date, institution, operation_type, amount_usd_cents, contracted_rate,
              ptax_rate, iof_cents, bank_fee_cents, net_brl_cents, source_pdf_ref, notes
       FROM exchange_contracts
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as ExchangeContractRow[];
  return rows.map(toContract);
}

export function softDeleteExchangeContract(db: Database.Database, id: number): void {
  db.prepare('UPDATE exchange_contracts SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}
