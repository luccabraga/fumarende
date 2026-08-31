export const ESSENTIAL_CATEGORIES = new Set([
  'Moradia',
  'Alimentação',
  'Transporte',
  'Saúde',
  'Educação',
]);

/** Seed value for an imported row's Tipo select; the user can change it. */
export function inferType(category: string): 'essencial' | 'nao-essencial' {
  return ESSENTIAL_CATEGORIES.has(category) ? 'essencial' : 'nao-essencial';
}
