import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NavShell } from './NavShell.js';
import { MonthProvider } from '../context/MonthContext.js';
import { AuthProvider } from '../context/AuthContext.js';
import { ThemeProvider } from '../context/ThemeContext.js';
import * as api from '../lib/api.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({ passwordSet: true, authenticated: true });
  vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([
    { month: '2026-07', reviewed: false, reviewedAt: null },
    { month: '2026-06', reviewed: false, reviewedAt: null },
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

function renderShell() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MonthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<NavShell />}>
                <Route path="/" element={<div>home</div>} />
                <Route path="/receitas" element={<div>receitas</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </MonthProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('NavShell', () => {
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

  it('has a theme control that persists a choice, sets data-theme, and marks the active button', async () => {
    renderShell();
    const escuro = await screen.findByRole('button', { name: 'Escuro' });
    const sistema = screen.getByRole('button', { name: 'Sistema' });
    expect(sistema).toHaveAttribute('aria-pressed', 'true');
    expect(escuro).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(escuro);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('fumarende.theme')).toBe('dark');
    expect(escuro).toHaveAttribute('aria-pressed', 'true');
    expect(sistema).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles the mobile nav panel with the hamburger', async () => {
    renderShell();
    const nav = document.querySelector('.nav') as HTMLElement;
    expect(nav.classList.contains('nav--open')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(nav.classList.contains('nav--open')).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Receitas' }));
    await waitFor(() => expect(nav.classList.contains('nav--open')).toBe(false));
  });
});
