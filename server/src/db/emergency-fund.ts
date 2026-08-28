import type Database from 'better-sqlite3';

export interface EmergencyFundEntry {
  id: number;
  date: string;
  amountCents: number;
  notes: string | null;
}

export interface NewEmergencyFundInput {
  date: string;
  amountCents: number;
  notes?: string | null;
}

interface EmergencyFundRow {
  id: number;
  date: string;
  amount_cents: number;
  notes: string | null;
}

function assertPositiveInteger(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
}

function insert(
  db: Database.Database,
  date: string,
  amountCents: number,
  notes: string | null,
): number {
  const result = db
    .prepare('INSERT INTO emergency_fund_entries (date, amount_cents, notes) VALUES (?, ?, ?)')
    .run(date, amountCents, notes);
  return Number(result.lastInsertRowid);
}

/** Records a deposit. `amountCents` must be a positive integer; stored positive. */
export function createDeposit(db: Database.Database, input: NewEmergencyFundInput): number {
  assertPositiveInteger(input.amountCents);
  return insert(db, input.date, input.amountCents, input.notes ?? null);
}

/** Records a withdrawal. `amountCents` is a positive magnitude; stored negated. */
export function createWithdrawal(db: Database.Database, input: NewEmergencyFundInput): number {
  assertPositiveInteger(input.amountCents);
  return insert(db, input.date, -input.amountCents, input.notes ?? null);
}

export function listEmergencyFundEntries(db: Database.Database): EmergencyFundEntry[] {
  const rows = db
    .prepare(
      `SELECT id, date, amount_cents, notes
       FROM emergency_fund_entries
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as EmergencyFundRow[];
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: r.amount_cents,
    notes: r.notes,
  }));
}

export function softDeleteEmergencyFundEntry(db: Database.Database, id: number): void {
  db.prepare('UPDATE emergency_fund_entries SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}
