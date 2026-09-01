import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils.js';
import { BackupDadosPage } from './BackupDadosPage.js';
import * as api from '../lib/api.js';

const diag: api.Diagnostics = {
  rowCounts: { income: 3, expenses: 12, goals: 2 },
  dbSizeBytes: 40960,
  migrations: ['001_initial_schema', '002_dollar_quotes'],
  lastBackup: null,
  backupCount: 0,
};

beforeEach(() => {
  vi.spyOn(api, 'getDiagnostics').mockResolvedValue(diag);
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-08', reviewed: false, reviewedAt: null },
    { month: '2026-07', reviewed: true, reviewedAt: '2026-08-01T12:00:00Z' },
  ]);
});

describe('BackupDadosPage', () => {
  it('renders diagnostics', async () => {
    render(<BackupDadosPage />);
    expect(await screen.findByText(/income: 3/)).toBeInTheDocument();
    expect(screen.getByText(/001_initial_schema, 002_dollar_quotes/)).toBeInTheDocument();
  });

  it('gates the danger-zone buttons behind the confirmation phrase', async () => {
    const wipeSpy = vi.spyOn(api, 'wipeData').mockResolvedValue({ backupPath: null, deleted: {} });
    const seedSpy = vi
      .spyOn(api, 'seedTestData')
      .mockResolvedValue({ backupPath: null, seeded: true });

    render(<BackupDadosPage />);
    await waitFor(() => expect(api.getDiagnostics).toHaveBeenCalled());

    const wipeBtn = screen.getByRole('button', { name: 'Apagar todos os dados' });
    const seedBtn = screen.getByRole('button', { name: 'Carregar dados de teste' });
    expect(wipeBtn).toBeDisabled();
    expect(seedBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Frase de confirmação'), {
      target: { value: 'APAGAR TUDO' },
    });
    expect(wipeBtn).toBeEnabled();

    fireEvent.click(wipeBtn);
    await waitFor(() => expect(wipeSpy).toHaveBeenCalledWith('APAGAR TUDO'));

    fireEvent.change(screen.getByLabelText('Frase de confirmação'), {
      target: { value: 'APAGAR TUDO' },
    });
    fireEvent.click(seedBtn);
    await waitFor(() => expect(seedSpy).toHaveBeenCalledWith('APAGAR TUDO'));
  });

  it('imports a parsed file only after the checkbox is ticked', async () => {
    const importSpy = vi
      .spyOn(api, 'importData')
      .mockResolvedValue({ backupPath: null, imported: {} });

    render(<BackupDadosPage />);
    await waitFor(() => expect(api.getDiagnostics).toHaveBeenCalled());

    const importBtn = screen.getByRole('button', { name: 'Importar' });
    expect(importBtn).toBeDisabled();

    const file = new File(['{"version":1,"tables":{}}'], 'snap.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('Arquivo de importação'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByLabelText(/substitui todos os dados/));
    await waitFor(() => expect(importBtn).toBeEnabled());

    fireEvent.click(importBtn);
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith({ version: 1, tables: {} }));
  });

  it('toggles a month reviewed', async () => {
    const markSpy = vi
      .spyOn(api, 'markMonthReviewed')
      .mockResolvedValue({ month: '2026-08', reviewed: true, reviewedAt: 'now' });
    const unmarkSpy = vi.spyOn(api, 'unmarkMonthReviewed').mockResolvedValue({ ok: true });

    render(<BackupDadosPage />);

    fireEvent.click(await screen.findByLabelText('Revisado 2026-08'));
    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('2026-08'));

    fireEvent.click(screen.getByLabelText('Revisado 2026-07'));
    await waitFor(() => expect(unmarkSpy).toHaveBeenCalledWith('2026-07'));
  });
});
