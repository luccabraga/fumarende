import type Database from 'better-sqlite3';
import { wipeData } from './wipe.js';
import { createIncome } from '../db/income.js';
import { createExpense } from '../db/expenses.js';
import { createExchangeContract } from '../db/exchange.js';
import { createDeposit, createWithdrawal } from '../db/emergency-fund.js';
import { updateMonthlyTargetConfig } from '../db/savings-target.js';
import { createTarget } from '../db/targets.js';
import { upsertQuote } from '../db/dollar-quotes.js';

export interface SeedResult {
  seeded: true;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function dayIn(d: Date, day: number): string {
  return `${monthKey(d)}-${String(day).padStart(2, '0')}`;
}

/**
 * Wipes all data, then inserts a small deterministic fixture spanning
 * `now`'s month and the two before it. `now` is a parameter only so
 * tests are deterministic.
 */
export function seedTestData(db: Database.Database, now: Date = new Date()): SeedResult {
  wipeData(db);

  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const months = [m2, m1, m0];
  const rates = [5.05, 5.12, 5.2];

  months.forEach((m, i) => {
    createIncome(db, {
      date: dayIn(m, 5),
      amountBrlCents: 1_800_000 + i * 20_000,
      amountUsdCents: 350_000,
      source: 'Salário',
    });

    createExpense(db, {
      date: dayIn(m, 6),
      description: 'Aluguel',
      amountCents: 280_000,
      category: 'Moradia',
      type: 'essencial',
      paymentMethod: 'Pix',
    });
    createExpense(db, {
      date: dayIn(m, 10),
      description: 'Mercado',
      amountCents: 120_000,
      category: 'Alimentação',
      type: 'essencial',
      paymentMethod: 'Débito',
    });
    createExpense(db, {
      date: dayIn(m, 12),
      description: 'Transporte',
      amountCents: 40_000,
      category: 'Transporte',
      type: 'essencial',
      paymentMethod: 'Débito',
    });
    createExpense(db, {
      date: dayIn(m, 15),
      description: 'iFood',
      amountCents: 35_000,
      category: 'Delivery',
      type: 'nao-essencial',
      paymentMethod: 'Crédito',
    });
    createExpense(db, {
      date: dayIn(m, 20),
      description: 'Cinema',
      amountCents: 50_000,
      category: 'Lazer',
      type: 'nao-essencial',
      paymentMethod: 'Crédito',
    });

    createExchangeContract(db, {
      date: dayIn(m, 7),
      institution: 'Banco Inter',
      operationType: 'compra',
      amountUsdCents: 350_000,
      contractedRate: rates[i],
      ptaxRate: rates[i] + 0.05,
      iofCents: 45_000,
      bankFeeCents: 3_000,
    });

    upsertQuote(db, { month: monthKey(m), rate: rates[i], salaryUsdCents: 350_000 });
  });

  // one 3x installment starting in the earliest month
  createExpense(db, {
    date: dayIn(m2, 8),
    description: 'Notebook',
    amountCents: 600_000,
    category: 'Outros',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentTotal: 3,
  });

  createDeposit(db, { date: dayIn(m2, 3), amountCents: 700_000, notes: 'Saldo inicial' });
  createDeposit(db, { date: dayIn(m1, 10), amountCents: 150_000, notes: 'Aporte' });
  createWithdrawal(db, { date: dayIn(m0, 18), amountCents: 100_000, notes: 'Emergência' });

  updateMonthlyTargetConfig(db, monthKey(m0), 'pct', 20, null);

  const targetDate = new Date(now.getFullYear(), now.getMonth() + 8, 15)
    .toISOString()
    .slice(0, 10);
  createTarget(db, 'goals', {
    name: 'Viagem Japão',
    targetCents: 1_500_000,
    currentCents: 400_000,
    targetDate,
  });
  createTarget(db, 'goals', {
    name: 'Notebook novo',
    targetCents: 800_000,
    currentCents: 800_000,
  });
  createTarget(db, 'special_projects', {
    name: 'Entrada apartamento',
    targetCents: 8_000_000,
    currentCents: 1_200_000,
    notes: 'Liberdade e patrimônio',
  });

  return { seeded: true };
}
