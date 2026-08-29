import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConsultorIA } from './ConsultorIA.js';
import * as api from '../lib/api.js';

const STATUS_ON: api.AiStatus = {
  configured: true,
  model: 'claude-sonnet-5',
  monthToDateUsdCents: 50,
  capUsdCents: 400,
  usdBrlRate: 5,
};

beforeEach(() => {
  vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('ConsultorIA', () => {
  it('disables the buttons and shows a note when not configured', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue({ ...STATUS_ON, configured: false });
    render(<ConsultorIA />);
    const btn = await screen.findByRole('button', { name: 'Diagnóstico geral' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
  });

  it('runs a preset and renders the Markdown response', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    const run = vi.spyOn(api, 'runAiAnalysis').mockResolvedValue({
      id: 1,
      createdAt: '2026-08-15T00:00:00Z',
      kind: 'diagnostico',
      responseMd: '## Diagnóstico\nVocê vai bem.',
      costUsdCents: 1,
      model: 'claude-sonnet-5',
    });
    render(<ConsultorIA />);
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnóstico geral' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('diagnostico'));
    expect(await screen.findByRole('heading', { name: 'Diagnóstico' })).toBeInTheDocument();
  });

  it('shows the limit warning on a 429', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    vi.spyOn(api, 'runAiAnalysis').mockRejectedValue(
      Object.assign(new Error('Limite mensal de IA atingido'), { status: 429 }),
    );
    render(<ConsultorIA />);
    fireEvent.click(await screen.findByRole('button', { name: 'Estou poupando o suficiente?' }));
    expect(await screen.findByText(/Limite mensal de IA atingido/)).toBeInTheDocument();
  });

  it('lists history collapsed and expands an entry', async () => {
    vi.spyOn(api, 'getAiStatus').mockResolvedValue(STATUS_ON);
    vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([
      {
        id: 2,
        createdAt: '2026-08-10T00:00:00Z',
        kind: 'cambio',
        responseMd: '# Câmbio\nEspere.',
        costUsdCents: 1,
        model: 'm',
      },
    ]);
    render(<ConsultorIA />);
    const toggle = await screen.findByRole('button', { name: /Histórico/ });
    fireEvent.click(toggle);
    expect(await screen.findByRole('heading', { name: 'Câmbio' })).toBeInTheDocument();
  });
});
