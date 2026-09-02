import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils.js';
import { AnalisePage } from './AnalisePage.js';
import { MonthProvider } from '../context/MonthContext.js';
import * as api from '../lib/api.js';

function renderPage() {
  return render(
    <MonthProvider>
      <AnalisePage />
    </MonthProvider>,
  );
}

const target: api.MonthlyTarget = {
  month: '2026-08',
  pctOrFixed: 'pct',
  pctValue: 20,
  fixedValueCents: null,
  targetCents: 100_000,
  rolloverCents: 0,
};

beforeEach(() => {
  vi.spyOn(api, 'listIncome').mockResolvedValue([
    {
      id: 1,
      date: '2026-08-01',
      amountBrlCents: 500_000,
      amountUsdCents: null,
      description: null,
      source: null,
      exchangeContractId: null,
      notes: null,
    },
  ]);
  vi.spyOn(api, 'listExpenses').mockResolvedValue([
    {
      id: 1,
      date: '2026-08-02',
      description: 'iFood',
      amountCents: 20_000,
      category: 'Delivery',
      type: 'nao-essencial',
      paymentMethod: 'Crédito',
      installmentNumber: null,
      installmentTotal: null,
      installmentGroupId: null,
      notes: null,
    },
  ]);
  vi.spyOn(api, 'listEmergencyFund').mockResolvedValue([
    { id: 1, date: '2026-07-01', amountCents: 300_000, notes: null },
  ]);
  vi.spyOn(api, 'getMonthlyTarget').mockResolvedValue(target);
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);
  vi.spyOn(api.goalsApi, 'list').mockResolvedValue([]);
  vi.spyOn(api.projectsApi, 'list').mockResolvedValue([]);
  vi.spyOn(api, 'getAiStatus').mockResolvedValue({
    configured: false,
    model: 'claude-sonnet-5',
    monthToDateUsdCents: 0,
    capUsdCents: 400,
    usdBrlRate: 5,
    webSearch: false,
  });
  vi.spyOn(api, 'listAiAnalyses').mockResolvedValue([]);
  vi.spyOn(api, 'getAiUsage').mockResolvedValue({
    monthToDateUsdCents: 0,
    capUsdCents: 400,
    usdBrlRate: 5,
    byEndpoint: [],
    recent: [],
  });
});

describe('AnalisePage', () => {
  it('renders the four sections and the income total', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Resumo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gastos por categoria' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projeção 12 meses' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cenários' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Consultor IA' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Uso da IA' })).toBeInTheDocument();
    expect(screen.getByText(/R\$ 5\.000,00/)).toBeInTheDocument();
  });

  it('updates the cut total when a scenario slider moves', async () => {
    renderPage();
    const slider = await screen.findByLabelText('Corte de Delivery');
    fireEvent.change(slider, { target: { value: '100' } });
    await waitFor(() =>
      expect(screen.getByText(/Corte total: R\$ 200,00\/mês/)).toBeInTheDocument(),
    );
  });

  it('shows the meta-mensal note when the target is zero', async () => {
    vi.spyOn(api, 'getMonthlyTarget').mockResolvedValue({ ...target, targetCents: 0 });
    renderPage();
    expect(await screen.findByText(/Configure sua meta mensal em Reserva/)).toBeInTheDocument();
  });

  it('lays the analysis cards out in a grid', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Resumo' });
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid?.querySelector('h2')?.textContent).toBe('Resumo');
  });
});
