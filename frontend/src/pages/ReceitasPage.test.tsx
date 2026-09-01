import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils.js';
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
        amountUsdCents: null,
        description: 'Novo lançamento',
        source: null,
      }),
    );
    expect(await screen.findByText('Novo lançamento')).toBeInTheDocument();
  });

  it('passes the optional USD amount and source through to createIncome', async () => {
    vi.spyOn(api, 'listIncome').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createIncome').mockResolvedValue({ id: 3 });

    render(<ReceitasPage />);
    await waitFor(() => expect(api.listIncome).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Valor (US$)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Origem'), { target: { value: 'Salário' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-20',
        amountBrlCents: 500000,
        amountUsdCents: 100000,
        description: null,
        source: 'Salário',
      }),
    );
  });

  it('deletes an entry and refreshes the list', async () => {
    const listSpy = vi
      .spyOn(api, 'listIncome')
      .mockResolvedValueOnce([
        {
          id: 7,
          date: '2026-08-03',
          amountBrlCents: 250000,
          amountUsdCents: null,
          description: 'Lançamento errado',
          source: null,
          exchangeContractId: null,
          notes: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const deleteSpy = vi.spyOn(api, 'deleteIncome').mockResolvedValue({ ok: true });

    render(<ReceitasPage />);
    expect(await screen.findByText('Lançamento errado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir lançamento de 2026-08-03' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(7));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('Lançamento errado')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Nenhum lançamento ainda.')).toBeInTheDocument();
  });

  it('shows an error when the delete request fails', async () => {
    vi.spyOn(api, 'listIncome').mockResolvedValue([
      {
        id: 9,
        date: '2026-08-04',
        amountBrlCents: 1000,
        amountUsdCents: null,
        description: 'Não apaga',
        source: null,
        exchangeContractId: null,
        notes: null,
      },
    ]);
    vi.spyOn(api, 'deleteIncome').mockRejectedValue(new Error('unauthorized'));

    render(<ReceitasPage />);
    expect(await screen.findByText('Não apaga')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir lançamento de 2026-08-04' }));

    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
  });
});
