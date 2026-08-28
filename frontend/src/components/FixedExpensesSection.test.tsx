import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FixedExpensesSection } from './FixedExpensesSection.js';
import * as api from '../lib/api.js';

const aluguel: api.FixedExpense = {
  id: 1,
  description: 'Aluguel',
  amountCents: 280_000,
  category: 'Moradia',
  type: 'essencial',
  paymentMethod: 'Pix',
};

describe('FixedExpensesSection', () => {
  it('lists existing templates', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([aluguel]);
    render(<FixedExpensesSection />);
    expect(await screen.findByText(/Aluguel/)).toBeInTheDocument();
  });

  it('adds a template via createFixedExpense', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createFixedExpense').mockResolvedValue({ id: 2 });

    render(<FixedExpensesSection />);
    await waitFor(() => expect(api.listFixedExpenses).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Descrição do gasto fixo'), {
      target: { value: 'Internet' },
    });
    fireEvent.change(screen.getByLabelText('Valor do gasto fixo (R$)'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar fixo' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Internet', amountCents: 12_000 }),
      ),
    );
  });

  it('applies templates to the current month and calls onApplied', async () => {
    vi.spyOn(api, 'listFixedExpenses').mockResolvedValue([aluguel]);
    const applySpy = vi.spyOn(api, 'applyFixedExpenses').mockResolvedValue({ created: 2 });
    const onApplied = vi.fn();

    render(<FixedExpensesSection onApplied={onApplied} />);
    await waitFor(() => expect(api.listFixedExpenses).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar ao mês atual' }));

    await waitFor(() =>
      expect(applySpy).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/)),
    );
    expect(await screen.findByText(/2 gasto\(s\) aplicado\(s\)/)).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
  });
});
