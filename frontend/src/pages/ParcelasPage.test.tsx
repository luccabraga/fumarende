import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParcelasPage } from './ParcelasPage.js';
import * as api from '../lib/api.js';

function row(over: Partial<api.Expense>): api.Expense {
  return {
    id: 0,
    date: '2026-01-15',
    description: 'Tênis',
    amountCents: 21_666,
    category: 'Vestuário',
    type: 'nao-essencial',
    paymentMethod: 'Crédito',
    installmentNumber: 1,
    installmentTotal: 3,
    installmentGroupId: 'g1',
    notes: null,
    ...over,
  };
}

describe('ParcelasPage', () => {
  it('renders one grouped row with paid / remaining text', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([
      row({ id: 1, date: '2020-01-15', installmentNumber: 1, amountCents: 21_668 }),
      row({ id: 2, date: '2020-02-15', installmentNumber: 2 }),
      row({ id: 3, date: '2999-03-15', installmentNumber: 3 }),
    ]);

    render(<ParcelasPage />);

    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();
    expect(screen.getByText(/parcela 2\/3/)).toBeInTheDocument();
    expect(screen.getByText(/restante R\$ 216,66/)).toBeInTheDocument();
  });

  it('deletes the whole group on Excluir', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([row({ id: 1 }), row({ id: 2, installmentNumber: 2 })])
      .mockResolvedValueOnce([]);
    const groupSpy = vi.spyOn(api, 'deleteExpenseGroup').mockResolvedValue({ ok: true });

    render(<ParcelasPage />);
    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir parcelamento Tênis' }));
    await waitFor(() => expect(groupSpy).toHaveBeenCalledWith('g1'));
  });

  it('shows an empty state when there are no installment purchases', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
    render(<ParcelasPage />);
    expect(await screen.findByText('Nenhuma compra parcelada.')).toBeInTheDocument();
  });
});
