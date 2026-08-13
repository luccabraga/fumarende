import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from '../lib/api.js';

interface AuthContextValue {
  passwordSet: boolean | null;
  authenticated: boolean;
  setup: (password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  const refreshStatus = useCallback(async () => {
    const status = await api.fetchAuthStatus();
    setPasswordSet(status.passwordSet);
    setAuthenticated(status.authenticated);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const setup = useCallback(
    async (password: string) => {
      await api.setupPassword(password);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const login = useCallback(
    async (password: string) => {
      await api.login(password);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const logout = useCallback(async () => {
    await api.logout();
    await refreshStatus();
  }, [refreshStatus]);

  return (
    <AuthContext.Provider value={{ passwordSet, authenticated, setup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
