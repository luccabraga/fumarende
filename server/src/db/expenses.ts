import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { addMonths, splitInstallments } from '../expenses/installments.js';

export interface Expense {
  id: number;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  notes: string | null;
}

export interface NewExpense {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}

interface ExpenseRow {
  id: number;
  date: string;
  description: string;
  amount_cents: number;
  category: string;
  type: string;
  payment_method: string;
  installment_number: number | null;
  installment_total: number | null;
  installment_group_id: string | null;
  notes: string | null;
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    type: row.type,
    paymentMethod: row.payment_method,
    installmentNumber: row.installment_number,
    installmentTotal: row.installment_total,
    installmentGroupId: row.installment_group_id,
    notes: row.notes,
  };
}

function validate(input: NewExpense): void {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  if (input.description.trim() === '') {
    throw new Error('description is required');
  }
  if (input.type !== 'essencial' && input.type !== 'nao-essencial') {
    throw new Error("type must be 'essencial' or 'nao-essencial'");
  }
  if (input.category.trim() === '') {
    throw new Error('category is required');
  }
  if (input.paymentMethod.trim() === '') {
    throw new Error('paymentMethod is required');
  }
}

/**
 * Inserts one expense, or — when `installmentTotal >= 2` — a group of that
 * many dated rows sharing an `installment_group_id`, the amounts split so
 * they sum exactly to `amountCents`. Returns the new row id(s).
 */
export function createExpense(db: Database.Database, input: NewExpense): number[] {
  validate(input);
  const total = input.installmentTotal ?? 1;

  if (total <= 1) {
    const result = db
      .prepare(
        `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method, notes)
         VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod, @notes)`,
      )
      .run({
        date: input.date,
        description: input.description,
        amountCents: input.amountCents,
        category: input.category,
        type: input.type,
        paymentMethod: input.paymentMethod,
        notes: input.notes ?? null,
      });
    return [Number(result.lastInsertRowid)];
  }

  const amounts = splitInstallments(input.amountCents, total);
  const groupId = randomBytes(8).toString('hex');
  const insert = db.prepare(
    `INSERT INTO expenses
       (date, description, amount_cents, category, type, payment_method,
        installment_number, installment_total, installment_group_id, notes)
     VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod,
             @installmentNumber, @installmentTotal, @installmentGroupId, @notes)`,
  );

  const insertAll = db.transaction((): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < total; i += 1) {
      const result = insert.run({
        date: addMonths(input.date, i),
        description: input.description,
        amountCents: amounts[i],
        category: input.category,
        type: input.type,
        paymentMethod: input.paymentMethod,
        installmentNumber: i + 1,
        installmentTotal: total,
        installmentGroupId: groupId,
        notes: input.notes ?? null,
      });
      ids.push(Number(result.lastInsertRowid));
    }
    return ids;
  });

  return insertAll();
}

export function listExpenses(db: Database.Database): Expense[] {
  const rows = db
    .prepare(
      `SELECT id, date, description, amount_cents, category, type, payment_method,
              installment_number, installment_total, installment_group_id, notes
       FROM expenses
       WHERE deleted_at IS NULL
       ORDER BY date DESC, id DESC`,
    )
    .all() as ExpenseRow[];
  return rows.map(toExpense);
}

export function softDeleteExpense(db: Database.Database, id: number): void {
  db.prepare('UPDATE expenses SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

export function softDeleteExpenseGroup(db: Database.Database, groupId: string): void {
  db.prepare(
    'UPDATE expenses SET deleted_at = ? WHERE installment_group_id = ? AND deleted_at IS NULL',
  ).run(new Date().toISOString(), groupId);
}
