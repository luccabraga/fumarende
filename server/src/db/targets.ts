import type Database from 'better-sqlite3';

export type TargetTable = 'goals' | 'special_projects';

const TABLES: Record<TargetTable, true> = { goals: true, special_projects: true };

function assertTable(table: string): asserts table is TargetTable {
  if (!(table in TABLES)) throw new Error(`unknown target table: ${table}`);
}

export interface Target {
  id: number;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  notes: string | null;
  status: string;
}

export interface NewTarget {
  name: string;
  targetCents: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}

export interface TargetPatch {
  name?: string;
  targetCents?: number;
  currentCents?: number;
  targetDate?: string | null;
  notes?: string | null;
}

interface TargetRow {
  id: number;
  name: string;
  target_cents: number;
  current_cents: number;
  target_date: string | null;
  notes: string | null;
  status: string;
}

function validateName(name: unknown): void {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required');
}
function validateTarget(cents: unknown): void {
  if (!Number.isInteger(cents) || (cents as number) <= 0) {
    throw new Error('targetCents must be a positive integer');
  }
}
function validateCurrent(cents: unknown): void {
  if (!Number.isInteger(cents) || (cents as number) < 0) {
    throw new Error('currentCents must be a non-negative integer');
  }
}

export function createTarget(db: Database.Database, table: TargetTable, input: NewTarget): number {
  assertTable(table);
  validateName(input.name);
  validateTarget(input.targetCents);
  const currentCents = input.currentCents ?? 0;
  validateCurrent(currentCents);

  const hasNotes = table === 'special_projects';
  const cols = ['name', 'target_cents', 'current_cents', 'target_date'];
  const vals: unknown[] = [input.name, input.targetCents, currentCents, input.targetDate ?? null];
  if (hasNotes) {
    cols.push('notes');
    vals.push(input.notes ?? null);
  }
  const placeholders = cols.map(() => '?').join(', ');
  const result = db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(...vals);
  return Number(result.lastInsertRowid);
}

export function listTargets(db: Database.Database, table: TargetTable): Target[] {
  assertTable(table);
  const hasNotes = table === 'special_projects';
  const notesSelect = hasNotes ? 'notes' : 'NULL AS notes';
  const rows = db
    .prepare(
      `SELECT id, name, target_cents, current_cents, target_date, ${notesSelect}, status
       FROM ${table}
       WHERE deleted_at IS NULL
       ORDER BY id DESC`,
    )
    .all() as TargetRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    currentCents: r.current_cents,
    targetDate: r.target_date,
    notes: r.notes,
    status: r.status,
  }));
}

export function updateTarget(
  db: Database.Database,
  table: TargetTable,
  id: number,
  patch: TargetPatch,
): void {
  assertTable(table);
  const hasNotes = table === 'special_projects';
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) {
    validateName(patch.name);
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.targetCents !== undefined) {
    validateTarget(patch.targetCents);
    sets.push('target_cents = ?');
    vals.push(patch.targetCents);
  }
  if (patch.currentCents !== undefined) {
    validateCurrent(patch.currentCents);
    sets.push('current_cents = ?');
    vals.push(patch.currentCents);
  }
  if (patch.targetDate !== undefined) {
    sets.push('target_date = ?');
    vals.push(patch.targetDate);
  }
  if (hasNotes && patch.notes !== undefined) {
    sets.push('notes = ?');
    vals.push(patch.notes);
  }

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(
    ...vals,
  );
}

export function addToTarget(
  db: Database.Database,
  table: TargetTable,
  id: number,
  deltaCents: number,
): void {
  assertTable(table);
  if (!Number.isInteger(deltaCents) || deltaCents <= 0) {
    throw new Error('deltaCents must be a positive integer');
  }
  db.prepare(
    `UPDATE ${table} SET current_cents = current_cents + ? WHERE id = ? AND deleted_at IS NULL`,
  ).run(deltaCents, id);
}

export function softDeleteTarget(db: Database.Database, table: TargetTable, id: number): void {
  assertTable(table);
  db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}
