import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatementImportSection } from './StatementImportSection.js';
import * as api from '../lib/api.js';

afterEach(() => vi.restoreAllMocks());

const PREVIEW: { rows: api.ImportPreviewRow[]; warnings: string[] } = {
  rows: [
    {
      date: '2026-08-03',
      description: 'UBER *TRIP',
      amountCents: 3210,
      kind: 'purchase',
      installment: null,
      suggestedCategory: 'Transporte',
      suggestedType: 'essencial',
      duplicate: false,
    },
    {
      date: '2026-08-10',
      description: 'PAGAMENTO FATURA',
      amountCents: 120000,
      kind: 'payment',
      installment: null,
      suggestedCategory: '',
      suggestedType: 'nao-essencial',
      duplicate: false,
    },
    {
      date: '2026-08-05',
      description: 'NETFLIX',
      amountCents: 5590,
      kind: 'purchase',
      installment: null,
      suggestedCategory: 'Assinaturas',
      suggestedType: 'nao-essencial',
      duplicate: true,
    },
  ],
  warnings: ['1 linha(s) não reconhecida(s) foram ignoradas.'],
};

function pickFile() {
  const input = screen.getByLabelText('Arquivo do extrato') as HTMLInputElement;
  const file = new File(['%PDF-1.4'], 'fatura.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('StatementImportSection', () => {
  it('reads a picked PDF and shows a review table', async () => {
    const preview = vi.spyOn(api, 'importPreviewStatement').mockResolvedValue(PREVIEW);
    render(<StatementImportSection onImported={() => {}} />);
    pickFile();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(preview.mock.calls[0][0]).not.toContain('data:');
    expect(await screen.findByDisplayValue('UBER *TRIP')).toBeInTheDocument();
    expect(screen.getByText(/1 linha/)).toBeInTheDocument();
  });

  it('pre-unchecks payments and duplicates, then confirms only checked rows', async () => {
    vi.spyOn(api, 'importPreviewStatement').mockResolvedValue(PREVIEW);
    const confirm = vi.spyOn(api, 'importConfirmExpenses').mockResolvedValue({ created: 1 });
    const onImported = vi.fn();
    render(<StatementImportSection onImported={onImported} />);
    pickFile();
    await screen.findByDisplayValue('UBER *TRIP');

    expect((screen.getByLabelText('Incluir UBER *TRIP') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Incluir PAGAMENTO FATURA') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByLabelText('Incluir NETFLIX') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Importar 1 selecionado/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toEqual([
      expect.objectContaining({ description: 'UBER *TRIP', category: 'Transporte', amountCents: 3210 }),
    ]);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it('shows the limit warning on a 429 preview', async () => {
    vi.spyOn(api, 'importPreviewStatement').mockRejectedValue(
      Object.assign(new Error('Limite mensal de IA atingido'), { status: 429 }),
    );
    render(<StatementImportSection onImported={() => {}} />);
    pickFile();
    expect(await screen.findByText(/Limite mensal de IA atingido/)).toBeInTheDocument();
  });

  it('shows elapsed time and a Cancelar button while reading, and cancels', async () => {
    vi.spyOn(api, 'importPreviewStatement').mockImplementation(
      (_b, _f, signal) =>
        new Promise((_res, rej) => {
          signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    render(<StatementImportSection onImported={() => {}} />);
    pickFile();

    expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByText(/há \d+s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText(/Leitura cancelada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});
