import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils.js';
import { HistoricoDolarPage } from './HistoricoDolarPage.js';
import * as api from '../lib/api.js';

describe('HistoricoDolarPage', () => {
  it('lists existing quotes with the rate and salary-in-BRL', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([
      { month: '2026-06', rate: 5.12, salaryUsdCents: 500_000 },
    ]);

    render(<HistoricoDolarPage />);

    expect(await screen.findByText('5.1200')).toBeInTheDocument();
    // salary in BRL = round(500_000 * 5.12) = 2_560_000 -> R$ 25.600,00
    expect(screen.getByText('R$ 25.600,00')).toBeInTheDocument();
  });

  it('shows the empty state when there are no quotes', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([]);
    render(<HistoricoDolarPage />);
    expect(await screen.findByText('Nenhuma cotação registrada.')).toBeInTheDocument();
  });

  it('submits a quote with the parsed rate and salary', async () => {
    const listSpy = vi
      .spyOn(api, 'listDollarQuotes')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ month: '2026-08', rate: 5.25, salaryUsdCents: 400_000 }]);
    const putSpy = vi.spyOn(api, 'upsertDollarQuote').mockResolvedValue({
      month: '2026-08',
      rate: 5.25,
      salaryUsdCents: 400_000,
    });

    render(<HistoricoDolarPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('Cotação'), { target: { value: '5,25' } });
    fireEvent.change(screen.getByLabelText('Salário no mês (US$)'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cotação' }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('2026-08', { rate: 5.25, salaryUsdCents: 400_000 }),
    );
  });

  it('sends salaryUsdCents null when the salary field is blank', async () => {
    vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([]);
    const putSpy = vi
      .spyOn(api, 'upsertDollarQuote')
      .mockResolvedValue({ month: '2026-08', rate: 5.25, salaryUsdCents: null });

    render(<HistoricoDolarPage />);
    await waitFor(() => expect(api.listDollarQuotes).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('Cotação'), { target: { value: '5.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cotação' }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('2026-08', { rate: 5.25, salaryUsdCents: null }),
    );
  });

  it('deletes a row', async () => {
    vi.spyOn(api, 'listDollarQuotes')
      .mockResolvedValueOnce([{ month: '2026-06', rate: 5.1, salaryUsdCents: null }])
      .mockResolvedValueOnce([]);
    const delSpy = vi.spyOn(api, 'deleteDollarQuote').mockResolvedValue({ ok: true });

    render(<HistoricoDolarPage />);
    expect(
      await screen.findByRole('button', { name: 'Excluir cotação de 2026-06' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir cotação de 2026-06' }));
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('2026-06'));
  });
});
