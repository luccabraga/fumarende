import { describe, expect, it } from 'vitest';
import { CATEGORIES, isCategory } from './categories.js';

describe('categories', () => {
  it('is the agreed 11-item list', () => {
    expect([...CATEGORIES]).toEqual([
      'Moradia',
      'Alimentação',
      'Delivery',
      'Transporte',
      'Saúde',
      'Educação',
      'Lazer',
      'Viagem',
      'Assinaturas',
      'Vestuário',
      'Outros',
    ]);
  });

  it('isCategory guards membership', () => {
    expect(isCategory('Transporte')).toBe(true);
    expect(isCategory('Nope')).toBe(false);
    expect(isCategory(null)).toBe(false);
  });
});
