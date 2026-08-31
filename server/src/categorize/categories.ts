// Kept in sync by hand with the frontend copy in
// `frontend/src/lib/expenses.ts` (`CATEGORIES`). A unit test on each
// side asserts the list.
export const CATEGORIES = [
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
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}
