import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { listRules, addRule, deleteRule, matchRule } from './rules.js';

function db() {
  const d = new Database(':memory:');
  runMigrations(d);
  return d;
}

describe('rules', () => {
  it('addRule trims + lowercases the keyword and rejects bad input', () => {
    const d = db();
    const r = addRule(d, '  UBER ', 'Transporte');
    expect(r).toMatchObject({ keyword: 'uber', category: 'Transporte' });
    expect(() => addRule(d, '   ', 'Transporte')).toThrow();
    expect(() => addRule(d, 'x', 'Bogus')).toThrow();
  });

  it('addRule dedupes an identical non-deleted (keyword, category)', () => {
    const d = db();
    const a = addRule(d, 'ifood', 'Delivery');
    const b = addRule(d, 'IFOOD', 'Delivery');
    expect(b.id).toBe(a.id);
    expect(listRules(d)).toHaveLength(1);
  });

  it('deleteRule soft-deletes', () => {
    const d = db();
    const r = addRule(d, 'netflix', 'Assinaturas');
    deleteRule(d, r.id);
    expect(listRules(d)).toHaveLength(0);
  });

  it('matchRule returns the first substring hit, case-insensitively', () => {
    const rules = [
      { id: 1, keyword: 'uber', category: 'Transporte' },
      { id: 2, keyword: 'mercado', category: 'Alimentação' },
    ];
    expect(matchRule(rules, 'UBER *TRIP HELP.UBER.CO')?.category).toBe('Transporte');
    expect(matchRule(rules, 'Compra no MERCADO livre')?.category).toBe('Alimentação');
    expect(matchRule(rules, 'Farmácia São João')).toBeNull();
  });
});
