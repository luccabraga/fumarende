import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App.js';
import * as api from './lib/api.js';

/**
 * These tests render the real router (not a page in isolation), because the
 * bug they guard against — being stranded on /login after a successful
 * login — only exists at the router boundary.
 */
describe('App routing', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/login');
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      month: '2026-08',
      previousMonth: '2026-07',
      income: { currentCents: 0, previousCents: 0 },
      expenses: {
        currentCents: 0,
        previousCents: 0,
        essentialCents: 0,
        nonEssentialCents: 0,
        byCategory: [],
      },
      balanceCents: 0,
      reserveBalanceCents: 0,
      savingsTarget: null,
      installments: { nextMonthCommitmentCents: 0, activeGroups: 0, earliestEndMonth: null },
      recentExpenses: [],
      topGoals: [],
      evolution: Array.from({ length: 6 }, (_, i) => ({
        month: `2026-0${3 + i}`,
        incomeCents: 0,
        expensesCents: 0,
      })),
      monthlyClose: { reviewed: false, reviewedAt: null },
      alerts: [],
    });
    vi.spyOn(api, 'listMonthlyClose').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('leaves /login for the app shell once login succeeds', async () => {
    vi.spyOn(api, 'fetchAuthStatus')
      .mockResolvedValueOnce({ passwordSet: true, authenticated: false })
      .mockResolvedValue({ passwordSet: true, authenticated: true });
    vi.spyOn(api, 'login').mockResolvedValue({ ok: true });

    render(<App />);

    fireEvent.change(await screen.findByLabelText('Senha'), {
      target: { value: 'my-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    // The app shell (nav + dashboard) is what the user should land on.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receitas' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mês')).toBeInTheDocument();

    // ...and the login form is gone.
    await waitFor(() => expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('leaves /login for the app shell once first-run setup succeeds', async () => {
    vi.spyOn(api, 'fetchAuthStatus')
      .mockResolvedValueOnce({ passwordSet: false, authenticated: false })
      .mockResolvedValue({ passwordSet: true, authenticated: true });
    vi.spyOn(api, 'setupPassword').mockResolvedValue({ ok: true });

    render(<App />);

    fireEvent.change(await screen.findByLabelText('Senha'), {
      target: { value: 'first-run-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
  });

  it('keeps showing the login form while unauthenticated', async () => {
    vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({
      passwordSet: true,
      authenticated: false,
    });

    render(<App />);

    expect(await screen.findByLabelText('Senha')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
});
