import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceitasPage } from './ReceitasPage.js';
import * as api from '../lib/api.js';

describe('ReceitasPage', () => {
  it('lists existing income entries on load', async () => {
    vi.spyOn(api, 'listIncome').mockResolvedValue([
      {
        id: 1,
        date: '2026-08-01',
        amountBrlCents: 500000,
        amountUsdCents: null,
        description: 'Salário',
        source: null,
        exchangeContractId: null,
        notes: null,
      },
    ]);

    render(<ReceitasPage />);

    expect(await screen.findByText('Salário')).toBeInTheDocument();
    expect(screen.getByText('R$ 5.000,00')).toBeInTheDocument();
  });

  it('submits a new entry and refreshes the list', async () => {
    const listSpy = vi
      .spyOn(api, 'listIncome')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 2,
          date: '2026-08-12',
          amountBrlCents: 100000,
          amountUsdCents: null,
          description: 'Novo lançamento',
          source: null,
          exchangeContractId: null,
          notes: null,
        },
      ]);
    const createSpy = vi.spyOn(api, 'createIncome').mockResolvedValue({ id: 2 });

    render(<ReceitasPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Descrição'), {
      target: { value: 'Novo lançamento' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-12',
        amountBrlCents: 100000,
        description: 'Novo lançamento',
      }),
    );
    expect(await screen.findByText('Novo lançamento')).toBeInTheDocument();
  });
});
