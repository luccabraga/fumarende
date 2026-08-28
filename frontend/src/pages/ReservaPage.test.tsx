import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservaPage } from './ReservaPage.js';
import * as api from '../lib/api.js';

const target: api.MonthlyTarget = {
  month: '2026-08',
  pctOrFixed: 'pct',
  pctValue: 20,
  fixedValueCents: null,
  targetCents: 200_000,
  rolloverCents: 0,
};

beforeEach(() => {
  vi.spyOn(api, 'listExpenses').mockResolvedValue([]);
  vi.spyOn(api, 'getMonthlyTarget').mockResolvedValue(target);
});

describe('ReservaPage', () => {
  it('renders the status card from the ledger balance', async () => {
    vi.spyOn(api, 'listEmergencyFund').mockResolvedValue([
      { id: 1, date: '2026-06-01', amountCents: 700_000, notes: 'Saldo inicial' },
      { id: 2, date: '2026-06-10', amountCents: -200_000, notes: 'Conserto' },
    ]);

    render(<ReservaPage />);

    expect(await screen.findByText('Já guardado: R$ 5.000,00')).toBeInTheDocument();
  });

  it('submits a deposit with kind "deposit" and parsed cents', async () => {
    const listSpy = vi
      .spyOn(api, 'listEmergencyFund')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, date: '2026-08-10', amountCents: 50_000, notes: null }]);
    const createSpy = vi.spyOn(api, 'createEmergencyFundEntry').mockResolvedValue({ id: 1 });

    render(<ReservaPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data do depósito'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Valor do depósito (R$)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Depositar na reserva' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        kind: 'deposit',
        date: '2026-08-10',
        amountCents: 50_000,
        notes: null,
      }),
    );
  });

  it('submits a withdrawal with kind "withdrawal" and warns when it exceeds the balance', async () => {
    vi.spyOn(api, 'listEmergencyFund').mockResolvedValue([
      { id: 1, date: '2026-06-01', amountCents: 10_000, notes: null },
    ]);
    const createSpy = vi.spyOn(api, 'createEmergencyFundEntry').mockResolvedValue({ id: 2 });

    render(<ReservaPage />);
    await waitFor(() => expect(api.listEmergencyFund).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Data da retirada'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('Valor da retirada (R$)'), { target: { value: '500' } });

    expect(await screen.findByText(/maior que o saldo atual/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '− Retirar da reserva' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'withdrawal', amountCents: 50_000 }),
      ),
    );
  });

  it('saves the Meta Mensal config via updateMonthlyTarget', async () => {
    vi.spyOn(api, 'listEmergencyFund').mockResolvedValue([]);
    const updateSpy = vi.spyOn(api, 'updateMonthlyTarget').mockResolvedValue(target);

    render(<ReservaPage />);
    await waitFor(() => expect(api.getMonthlyTarget).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Percentual da meta'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar meta do mês' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}$/),
        expect.objectContaining({ pctOrFixed: 'pct', pctValue: 25 }),
      ),
    );
  });

  it('deletes a ledger entry', async () => {
    vi.spyOn(api, 'listEmergencyFund')
      .mockResolvedValueOnce([{ id: 7, date: '2026-06-01', amountCents: 100_000, notes: 'x' }])
      .mockResolvedValueOnce([]);
    const delSpy = vi.spyOn(api, 'deleteEmergencyFundEntry').mockResolvedValue({ ok: true });

    render(<ReservaPage />);
    expect(
      await screen.findByRole('button', { name: 'Excluir lançamento de 2026-06-01' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir lançamento de 2026-06-01' }));
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith(7));
  });
});
