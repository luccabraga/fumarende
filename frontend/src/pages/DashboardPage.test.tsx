import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DashboardPage } from './DashboardPage.js';
import * as api from '../lib/api.js';

const summary: api.DashboardSummary = {
  month: '2026-08',
  previousMonth: '2026-07',
  income: { currentCents: 500_000, previousCents: 400_000 },
  expenses: {
    currentCents: 300_000,
    previousCents: 400_000,
    essentialCents: 200_000,
    nonEssentialCents: 100_000,
    byCategory: [
      { category: 'Moradia', cents: 200_000 },
      { category: 'Lazer', cents: 100_000 },
    ],
  },
  balanceCents: 200_000,
  reserveBalanceCents: 700_000,
  savingsTarget: { targetCents: 100_000, savedThisMonthCents: 50_000 },
  installments: { nextMonthCommitmentCents: 20_000, activeGroups: 1, earliestEndMonth: '2026-10' },
  recentExpenses: [
    { date: '2026-08-06', description: 'Cinema', category: 'Lazer', amountCents: 5_000 },
  ],
  topGoals: [{ name: 'Viagem', currentCents: 40_000, targetCents: 100_000, progressPct: 40 }],
  evolution: [
    { month: '2026-03', incomeCents: 0, expensesCents: 0 },
    { month: '2026-04', incomeCents: 0, expensesCents: 0 },
    { month: '2026-05', incomeCents: 0, expensesCents: 0 },
    { month: '2026-06', incomeCents: 100_000, expensesCents: 40_000 },
    { month: '2026-07', incomeCents: 400_000, expensesCents: 400_000 },
    { month: '2026-08', incomeCents: 500_000, expensesCents: 300_000 },
  ],
  monthlyClose: { reviewed: false, reviewedAt: null },
  alerts: [{ level: 'warning', message: 'Meta de poupança: R$ 500,00 de R$ 1.000,00 este mês.' }],
};

beforeEach(() => {
  vi.spyOn(api, 'getDashboard').mockResolvedValue(summary);
});

describe('DashboardPage', () => {
  it('renders the stat cards, an expenses delta, and the alert', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('R$ 5.000,00')).toBeInTheDocument(); // income
    expect(screen.getByText('R$ 3.000,00')).toBeInTheDocument(); // expenses
    expect(screen.getByText(/↓ 25% vs 2026-07/)).toBeInTheDocument(); // expenses fell 25%
    expect(screen.getByText(/Meta de poupança/)).toBeInTheDocument();
  });

  it('renders a category bar per byCategory entry and the top goal', async () => {
    render(<DashboardPage />);
    expect(await screen.findByTestId('bar-Moradia')).toBeInTheDocument();
    expect(screen.getByTestId('bar-Lazer')).toBeInTheDocument();
    expect(screen.getByText('Viagem')).toBeInTheDocument();
  });

  it('shows the active-installments card only when activeGroups > 0', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText(/parcelamento\(s\) ativo\(s\)/)).toBeInTheDocument();
  });

  it('toggles the monthly close and re-fetches', async () => {
    const markSpy = vi
      .spyOn(api, 'markMonthReviewed')
      .mockResolvedValue({ month: '2026-08', reviewed: true, reviewedAt: 'now' });

    render(<DashboardPage />);
    fireEvent.click(await screen.findByLabelText('Revisado 2026-08'));

    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('2026-08'));
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalledTimes(2));
  });

  it('shows an error and no stat cards when the fetch fails', async () => {
    vi.spyOn(api, 'getDashboard').mockRejectedValue(new Error('boom'));
    render(<DashboardPage />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('R$ 5.000,00')).not.toBeInTheDocument();
  });
});
