import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils.js';
import { CambioPage } from './CambioPage.js';
import * as api from '../lib/api.js';

const sampleContract: api.ExchangeContract = {
  id: 1,
  date: '2026-08-05',
  institution: 'Banco Inter',
  operationType: 'compra',
  amountUsdCents: 500_000,
  contractedRate: 5.0994,
  ptaxRate: 5.12,
  iofCents: 65_318,
  bankFeeCents: 3_000,
  netBrlCents: 2_481_382,
  sourcePdfRef: null,
  notes: null,
};

describe('CambioPage', () => {
  it('lists existing contracts on load', async () => {
    vi.spyOn(api, 'listExchangeContracts').mockResolvedValue([sampleContract]);

    render(<CambioPage />);

    // 'Banco Inter' also appears as a <select> option, so assert on the
    // list row's unique VET and amount text instead.
    expect(await screen.findByText('VET 4.9628')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00 → R$ 24.813,82')).toBeInTheDocument();
  });

  it('shows a live BRL-líquido preview once amount and rate are entered', async () => {
    vi.spyOn(api, 'listExchangeContracts').mockResolvedValue([]);

    render(<CambioPage />);
    await waitFor(() => expect(api.listExchangeContracts).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Valor (US$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Taxa cambial'), { target: { value: '5.0994' } });
    fireEvent.change(screen.getByLabelText('IOF (R$)'), { target: { value: '653,18' } });
    fireEvent.change(screen.getByLabelText('Tarifa (R$)'), { target: { value: '30' } });

    expect(await screen.findByText('BRL líquido: R$ 24.813,82')).toBeInTheDocument();
  });

  it('submits a new contract with parsed values and refreshes', async () => {
    const listSpy = vi
      .spyOn(api, 'listExchangeContracts')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleContract]);
    const createSpy = vi
      .spyOn(api, 'createExchangeContract')
      .mockResolvedValue({ id: 1 });

    render(<CambioPage />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByLabelText('Valor (US$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Taxa cambial'), { target: { value: '5.0994' } });
    fireEvent.change(screen.getByLabelText('PTAX (opcional)'), { target: { value: '5.12' } });
    fireEvent.change(screen.getByLabelText('IOF (R$)'), { target: { value: '653,18' } });
    fireEvent.change(screen.getByLabelText('Tarifa (R$)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar operação' }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        date: '2026-08-05',
        institution: 'Banco Inter',
        operationType: 'compra',
        amountUsdCents: 500_000,
        contractedRate: 5.0994,
        ptaxRate: 5.12,
        iofCents: 65_318,
        bankFeeCents: 3_000,
        sourcePdfRef: null,
        notes: null,
      }),
    );
    expect(await screen.findByText('VET 4.9628')).toBeInTheDocument();
  });

  it('deletes a contract and refreshes', async () => {
    const listSpy = vi
      .spyOn(api, 'listExchangeContracts')
      .mockResolvedValueOnce([sampleContract])
      .mockResolvedValueOnce([]);
    const deleteSpy = vi
      .spyOn(api, 'deleteExchangeContract')
      .mockResolvedValue({ ok: true });

    render(<CambioPage />);
    expect(await screen.findByText('VET 4.9628')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir operação de 2026-08-05' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('shows an error when create fails', async () => {
    vi.spyOn(api, 'listExchangeContracts').mockResolvedValue([]);
    vi.spyOn(api, 'createExchangeContract').mockRejectedValue(new Error('unauthorized'));

    render(<CambioPage />);
    await waitFor(() => expect(api.listExchangeContracts).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByLabelText('Valor (US$)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Taxa cambial'), { target: { value: '5.0994' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar operação' }));

    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
  });
});
