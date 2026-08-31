import { describe, expect, it } from 'vitest';
import { inferType } from './expense-type.js';

describe('inferType', () => {
  it('maps the essential categories to essencial', () => {
    for (const c of ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação']) {
      expect(inferType(c)).toBe('essencial');
    }
  });
  it('maps everything else (including blank) to nao-essencial', () => {
    for (const c of ['Lazer', 'Delivery', 'Assinaturas', 'Outros', '']) {
      expect(inferType(c)).toBe('nao-essencial');
    }
  });
});
