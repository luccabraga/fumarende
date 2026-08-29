import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MonthProvider, useMonth } from './MonthContext.js';
import * as api from '../lib/api.js';

const THIS_MONTH = new Date().toISOString().slice(0, 7);

function Probe() {
  const { month, setMonth, months } = useMonth();
  return (
    <div>
      <span data-testid="month">{month}</span>
      <span data-testid="months">{months.join(',')}</span>
      <button onClick={() => setMonth('2026-05')}>set</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-07', reviewed: false, reviewedAt: null },
    { month: '2026-06', reviewed: true, reviewedAt: 'x' },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('MonthContext', () => {
  it('defaults to the current calendar month with no stored value', () => {
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    expect(screen.getByTestId('month').textContent).toBe(THIS_MONTH);
  });

  it('uses a valid stored month over the default', () => {
    localStorage.setItem('fumarende.month', '2026-04');
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    expect(screen.getByTestId('month').textContent).toBe('2026-04');
  });

  it('setMonth updates the value and persists it', () => {
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('month').textContent).toBe('2026-05');
    expect(localStorage.getItem('fumarende.month')).toBe('2026-05');
  });

  it('builds months desc, always including this month and the active one', async () => {
    localStorage.setItem('fumarende.month', '2026-04');
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    await waitFor(() => expect(api.listMonthlyClose).toHaveBeenCalled());
    const months = screen.getByTestId('months').textContent!.split(',');
    expect(months).toContain(THIS_MONTH);
    expect(months).toContain('2026-04');
    expect(months).toContain('2026-06');
    expect([...months]).toEqual([...months].sort().reverse()); // desc
  });

  it('falls back to [month] when listMonthlyClose rejects', async () => {
    vi.spyOn(api, 'listMonthlyClose').mockRejectedValue(new Error('boom'));
    render(
      <MonthProvider>
        <Probe />
      </MonthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('months').textContent).toBe(THIS_MONTH),
    );
  });
});
