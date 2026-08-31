import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiUsageSection } from './AiUsageSection.js';
import * as api from '../lib/api.js';

afterEach(() => vi.restoreAllMocks());

const USAGE: api.AiUsage = {
  monthToDateUsdCents: 40,
  capUsdCents: 400,
  usdBrlRate: 5,
  byEndpoint: [
    { endpoint: 'analysis:cambio+web', calls: 2, costUsdCents: 10 },
    { endpoint: 'categorize', calls: 8, costUsdCents: 1 },
  ],
  recent: [
    {
      createdAt: '2026-08-15T00:00:00Z',
      endpoint: 'analysis:cambio+web',
      model: 'claude-sonnet-5',
      inputTokens: 2000,
      outputTokens: 600,
      costUsdCents: 5,
      status: 'ok',
    },
  ],
};

describe('AiUsageSection', () => {
  it('shows the month-to-date line and the by-endpoint breakdown', async () => {
    vi.spyOn(api, 'getAiUsage').mockResolvedValue(USAGE);
    render(<AiUsageSection />);
    expect(await screen.findByRole('heading', { name: 'Uso da IA' })).toBeInTheDocument();
    expect(screen.getByText(/Câmbio \+ web/)).toBeInTheDocument();
    expect(screen.getByText(/Categorização/)).toBeInTheDocument();
  });

  it('expands the recent-calls log', async () => {
    vi.spyOn(api, 'getAiUsage').mockResolvedValue(USAGE);
    render(<AiUsageSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Últimas chamadas/ }));
    expect(await screen.findByText(/claude-sonnet-5/)).toBeInTheDocument();
  });

  it('shows a soft error when the fetch fails', async () => {
    vi.spyOn(api, 'getAiUsage').mockRejectedValue(new Error('boom'));
    render(<AiUsageSection />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
