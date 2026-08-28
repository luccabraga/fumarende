import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GastosPage } from './GastosPage.js';
import * as api from '../lib/api.js';

function expense(over: Partial<api.Expense>): api.Expense {
  return {
    id: 1,
    date: '2026-08-01',
    description: 'Mercado',
    amountCents: 10_000,
    category: 'Alimentação',
    type: 'essencial',
    paymentMethod: 'Débito',
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    notes: null,
    ...over,
  };
}

describe('GastosPage', () => {
  it('lists expenses and shows essencial / não-essencial totals', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([
      expense({ id: 1, amountCents: 10_000, type: 'essencial' }),
      expense({ id: 2, description: 'Cinema', amountCents: 4_000, type: 'nao-essencial' }),
    ]);

    render(<GastosPage />);

    expect(await screen.findByText(/Mercado/)).toBeInTheDocument();
    expect(screen.getByText('Total: R$ 140,00')).toBeInTheDocument();
    expect(screen.getByText('Essencial: R$ 100,00')).toBeInTheDocument();
    expect(screen.getByText('Não-essencial: R$ 40,00')).toBeInTheDocument();
  });

  it('submits a new expense with parsed cents and no installments', async () => {
    const listSpy = vi
      .spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([expense({ id: 5, description: 'Livro', amountCents: 6_000 })]);
    const createSpy = vi.spyOn(api, 'createExpense').mockResolvedValue({ ids: [5] });

    render(<GastosPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Livro' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Educação' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'nao-essencial' } });
    fireEvent.change(screen.getByLabelText('Forma de pagamento'), { target: { value: 'Pix' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar gasto' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-10',
        description: 'Livro',
        amountCents: 6_000,
        category: 'Educação',
        type: 'nao-essencial',
        paymentMethod: 'Pix',
        installmentTotal: null,
        notes: null,
      }),
    );
  });

  it('sends installmentTotal when the parcelas field is set', async () => {
    vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createExpense').mockResolvedValue({ ids: [1, 2, 3] });

    render(<GastosPage />);
    await waitFor(() => expect(api.listExpenses).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Tênis' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '650' } });
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar gasto' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ installmentTotal: 3 })),
    );
  });

  it('deletes a one-off row via deleteExpense', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([expense({ id: 9 })])
      .mockResolvedValueOnce([]);
    const deleteSpy = vi.spyOn(api, 'deleteExpense').mockResolvedValue({ ok: true });

    render(<GastosPage />);
    expect(await screen.findByText(/Mercado/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir gasto de 2026-08-01' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(9));
  });

  it('deletes an installment row via deleteExpenseGroup', async () => {
    vi.spyOn(api, 'listExpenses')
      .mockResolvedValueOnce([
        expense({
          id: 3,
          description: 'Tênis',
          installmentNumber: 1,
          installmentTotal: 3,
          installmentGroupId: 'grp',
        }),
      ])
      .mockResolvedValueOnce([]);
    const groupSpy = vi.spyOn(api, 'deleteExpenseGroup').mockResolvedValue({ ok: true });

    render(<GastosPage />);
    expect(await screen.findByText(/Tênis/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir gasto de 2026-08-01' }));
    await waitFor(() => expect(groupSpy).toHaveBeenCalledWith('grp'));
  });
});
