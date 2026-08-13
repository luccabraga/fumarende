export interface AuthStatus {
  passwordSet: boolean;
  authenticated: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return request('/api/auth/status');
}

export function setupPassword(password: string): Promise<{ ok: true }> {
  return request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
}

export function login(password: string): Promise<{ ok: true }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export interface IncomeEntry {
  id: number;
  date: string;
  amountBrlCents: number;
  amountUsdCents: number | null;
  description: string | null;
  source: string | null;
  exchangeContractId: number | null;
  notes: string | null;
}

export function listIncome(): Promise<IncomeEntry[]> {
  return request('/api/income');
}

export function createIncome(input: {
  date: string;
  amountBrlCents: number;
  amountUsdCents?: number | null;
  description?: string | null;
}): Promise<{ id: number }> {
  return request('/api/income', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteIncome(id: number): Promise<{ ok: true }> {
  return request(`/api/income/${id}`, { method: 'DELETE' });
}
