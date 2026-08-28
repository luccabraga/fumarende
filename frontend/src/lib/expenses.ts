import type { Expense } from './api.js';

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
];

export const PAYMENT_METHODS = ['Crédito', 'Débito', 'Pix', 'Dinheiro', 'Transferência'];

export interface InstallmentGroup {
  groupId: string;
  description: string;
  installmentTotal: number;
  paidCount: number;
  remainingCents: number;
  totalCents: number;
}

/**
 * Collapses installment rows (those with an `installmentGroupId`) into one
 * entry per purchase. `paidCount` counts rows dated on or before
 * `todayISO`; `remainingCents` sums rows dated after it. Groups are
 * ordered by their earliest row's date, newest first. Rows without a
 * group id are ignored.
 */
export function groupInstallments(expenses: Expense[], todayISO: string): InstallmentGroup[] {
  const byGroup = new Map<string, Expense[]>();
  for (const e of expenses) {
    if (!e.installmentGroupId) continue;
    const rows = byGroup.get(e.installmentGroupId) ?? [];
    rows.push(e);
    byGroup.set(e.installmentGroupId, rows);
  }

  const groups: (InstallmentGroup & { firstDate: string })[] = [];
  for (const [groupId, rows] of byGroup) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    groups.push({
      groupId,
      description: first.description,
      installmentTotal: first.installmentTotal ?? sorted.length,
      paidCount: sorted.filter((r) => r.date <= todayISO).length,
      remainingCents: sorted
        .filter((r) => r.date > todayISO)
        .reduce((s, r) => s + r.amountCents, 0),
      totalCents: sorted.reduce((s, r) => s + r.amountCents, 0),
      firstDate: first.date,
    });
  }

  return groups
    .sort((a, b) => b.firstDate.localeCompare(a.firstDate))
    .map(({ firstDate: _firstDate, ...group }) => group);
}
