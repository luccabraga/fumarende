import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NavShell } from './NavShell.js';
import { MonthProvider } from '../context/MonthContext.js';
import { AuthProvider } from '../context/AuthContext.js';
import * as api from '../lib/api.js';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({ passwordSet: true, authenticated: true });
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-07', reviewed: false, reviewedAt: null },
    { month: '2026-06', reviewed: false, reviewedAt: null },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderShell() {
  return render(
    <AuthProvider>
      <MonthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<NavShell />}>
              <Route path="/" element={<div>home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MonthProvider>
    </AuthProvider>,
  );
}

describe('NavShell month selector', () => {
  it('renders the Mês select with the fetched months and persists a change', async () => {
    renderShell();
    const select = (await screen.findByLabelText('Mês')) as HTMLSelectElement;
    await waitFor(() =>
      expect(screen.getByRole('option', { name: '2026-06' })).toBeInTheDocument(),
    );

    fireEvent.change(select, { target: { value: '2026-06' } });
    expect(select.value).toBe('2026-06');
    expect(localStorage.getItem('fumarende.month')).toBe('2026-06');
  });
});
