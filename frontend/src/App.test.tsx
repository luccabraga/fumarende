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
    expect(await screen.findByText('Dashboard — em breve')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receitas' })).toBeInTheDocument();

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

    expect(await screen.findByText('Dashboard — em breve')).toBeInTheDocument();
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
    expect(screen.queryByText('Dashboard — em breve')).not.toBeInTheDocument();
  });
});
