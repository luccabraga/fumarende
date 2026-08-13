import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext.js';
import { LoginPage } from './LoginPage.js';
import * as api from '../lib/api.js';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchAuthStatus').mockResolvedValue({ passwordSet: true, authenticated: false });
  });

  it('shows an error message when login fails', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('invalid password'));

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Senha'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('invalid password')).toBeInTheDocument();
  });

  it('calls login with the entered password on submit', async () => {
    const loginSpy = vi.spyOn(api, 'login').mockResolvedValue({ ok: true });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Senha'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(loginSpy).toHaveBeenCalledWith('my-password'));
  });
});
