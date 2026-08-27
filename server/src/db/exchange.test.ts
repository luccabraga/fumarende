import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createExchangeContract,
  listExchangeContracts,
  softDeleteExchangeContract,
} from './exchange.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function sampleInput() {
  return {
    date: '2026-08-05',
    institution: 'Banco Inter',
    operationType: 'compra',
    amountUsdCents: 500_000,
    contractedRate: 5.0994,
    ptaxRate: 5.12,
    iofCents: 65_318,
    bankFeeCents: 3_000,
  };
}

describe('exchange-contract data layer', () => {
  it('creates a contract and computes net_brl_cents on write', () => {
    const db = freshDb();
    const id = createExchangeContract(db, sampleInput());

    const all = listExchangeContracts(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      institution: 'Banco Inter',
      operationType: 'compra',
      amountUsdCents: 500_000,
      // gross 2_549_700 - iof 65_318 - fee 3_000
      netBrlCents: 2_481_382,
    });
  });

  it('defaults iof/bankFee to 0 and ptax to null when omitted', () => {
    const db = freshDb();
    createExchangeContract(db, {
      date: '2026-08-05',
      institution: 'Wise',
      operationType: 'compra',
      amountUsdCents: 100_000,
      contractedRate: 5.0,
    });
    const [c] = listExchangeContracts(db);
    expect(c).toMatchObject({ iofCents: 0, bankFeeCents: 0, ptaxRate: null, netBrlCents: 500_000 });
  });

  it('rejects a non-positive amountUsdCents', () => {
    const db = freshDb();
    expect(() => createExchangeContract(db, { ...sampleInput(), amountUsdCents: 0 })).toThrow();
    expect(() => createExchangeContract(db, { ...sampleInput(), amountUsdCents: -1 })).toThrow();
  });

  it('rejects a blank institution', () => {
    const db = freshDb();
    expect(() => createExchangeContract(db, { ...sampleInput(), institution: '   ' })).toThrow();
  });

  it('rejects an operationType other than compra/venda', () => {
    const db = freshDb();
    expect(() => createExchangeContract(db, { ...sampleInput(), operationType: 'invalid' })).toThrow();
  });

  it('excludes soft-deleted contracts from the list', () => {
    const db = freshDb();
    const id = createExchangeContract(db, sampleInput());
    softDeleteExchangeContract(db, id);
    expect(listExchangeContracts(db)).toHaveLength(0);
  });

  it('orders contracts by date descending', () => {
    const db = freshDb();
    createExchangeContract(db, { ...sampleInput(), date: '2026-08-01' });
    createExchangeContract(db, { ...sampleInput(), date: '2026-08-20' });
    expect(listExchangeContracts(db).map((c) => c.date)).toEqual(['2026-08-20', '2026-08-01']);
  });
});
