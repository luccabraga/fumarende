import type Database from 'better-sqlite3';

export interface FixedExpense {
  id: number;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

export interface NewFixedExpense {
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

interface FixedExpenseRow {
  id: number;
  description: string;
  amount_cents: number;
  category: string;
  type: string;
  payment_method: string;
}

function toFixedExpense(row: FixedExpenseRow): FixedExpense {
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    type: row.type,
    paymentMethod: row.payment_method,
  };
}

export function createFixedExpense(db: Database.Database, input: NewFixedExpense): number {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  if (input.description.trim() === '') {
    throw new Error('description is required');
  }
  if (input.type !== 'essencial' && input.type !== 'nao-essencial') {
    throw new Error("type must be 'essencial' or 'nao-essencial'");
  }
  if (input.category.trim() === '' || input.paymentMethod.trim() === '') {
    throw new Error('category and paymentMethod are required');
  }

  const result = db
    .prepare(
      `INSERT INTO fixed_expenses (description, amount_cents, category, type, payment_method)
       VALUES (@description, @amountCents, @category, @type, @paymentMethod)`,
    )
    .run({
      description: input.description,
      amountCents: input.amountCents,
      category: input.category,
      type: input.type,
      paymentMethod: input.paymentMethod,
    });
  return Number(result.lastInsertRowid);
}

export function listFixedExpenses(db: Database.Database): FixedExpense[] {
  const rows = db
    .prepare(
      `SELECT id, description, amount_cents, category, type, payment_method
       FROM fixed_expenses
       WHERE deleted_at IS NULL
       ORDER BY description`,
    )
    .all() as FixedExpenseRow[];
  return rows.map(toFixedExpense);
}

export function softDeleteFixedExpense(db: Database.Database, id: number): void {
  db.prepare('UPDATE fixed_expenses SET deleted_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

/**
 * Stamps every active fixed-expense template into `expenses` for `month`
 * (YYYY-MM), dated the 1st, skipping any template that already has a
 * non-deleted expense that month. Returns the number of rows created.
 * Idempotent across repeated calls for the same month.
 */
export function applyFixedExpensesToMonth(db: Database.Database, month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('month must be in YYYY-MM format');
  }

  const templates = listFixedExpenses(db);
  const alreadyApplied = db.prepare(
    `SELECT count(*) AS n FROM expenses
     WHERE description = ? AND date LIKE ? AND deleted_at IS NULL`,
  );
  const insert = db.prepare(
    `INSERT INTO expenses (date, description, amount_cents, category, type, payment_method)
     VALUES (@date, @description, @amountCents, @category, @type, @paymentMethod)`,
  );

  const run = db.transaction((): number => {
    let created = 0;
    for (const t of templates) {
      const { n } = alreadyApplied.get(t.description, `${month}%`) as { n: number };
      if (n > 0) continue;
      insert.run({
        date: `${month}-01`,
        description: t.description,
        amountCents: t.amountCents,
        category: t.category,
        type: t.type,
        paymentMethod: t.paymentMethod,
      });
      created += 1;
    }
    return created;
  });

  return run();
}
