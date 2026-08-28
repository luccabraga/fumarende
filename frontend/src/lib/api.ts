export interface AuthStatus {
  passwordSet: boolean;
  authenticated: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one. Fastify rejects a
  // request that declares `Content-Type: application/json` with an empty body
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which would break bodyless calls like
  // deleteIncome() and logout().
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
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
  source?: string | null;
}): Promise<{ id: number }> {
  return request('/api/income', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteIncome(id: number): Promise<{ ok: true }> {
  return request(`/api/income/${id}`, { method: 'DELETE' });
}

export interface ExchangeContract {
  id: number;
  date: string;
  institution: string;
  operationType: string;
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate: number | null;
  iofCents: number;
  bankFeeCents: number;
  netBrlCents: number;
  sourcePdfRef: string | null;
  notes: string | null;
}

export function listExchangeContracts(): Promise<ExchangeContract[]> {
  return request('/api/exchange-contracts');
}

export function createExchangeContract(input: {
  date: string;
  institution: string;
  operationType: 'compra' | 'venda';
  amountUsdCents: number;
  contractedRate: number;
  ptaxRate?: number | null;
  iofCents?: number;
  bankFeeCents?: number;
  sourcePdfRef?: string | null;
  notes?: string | null;
}): Promise<{ id: number }> {
  return request('/api/exchange-contracts', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteExchangeContract(id: number): Promise<{ ok: true }> {
  return request(`/api/exchange-contracts/${id}`, { method: 'DELETE' });
}

export interface Expense {
  id: number;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentGroupId: string | null;
  notes: string | null;
}

export function listExpenses(): Promise<Expense[]> {
  return request('/api/expenses');
}

export function createExpense(input: {
  date: string;
  description: string;
  amountCents: number;
  category: string;
  type: 'essencial' | 'nao-essencial';
  paymentMethod: string;
  installmentTotal?: number | null;
  notes?: string | null;
}): Promise<{ ids: number[] }> {
  return request('/api/expenses', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteExpense(id: number): Promise<{ ok: true }> {
  return request(`/api/expenses/${id}`, { method: 'DELETE' });
}

export function deleteExpenseGroup(groupId: string): Promise<{ ok: true }> {
  return request(`/api/expenses/group/${groupId}`, { method: 'DELETE' });
}

export interface FixedExpense {
  id: number;
  description: string;
  amountCents: number;
  category: string;
  type: string;
  paymentMethod: string;
}

export function listFixedExpenses(): Promise<FixedExpense[]> {
  return request('/api/fixed-expenses');
}

export function createFixedExpense(input: {
  description: string;
  amountCents: number;
  category: string;
  type: 'essencial' | 'nao-essencial';
  paymentMethod: string;
}): Promise<{ id: number }> {
  return request('/api/fixed-expenses', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteFixedExpense(id: number): Promise<{ ok: true }> {
  return request(`/api/fixed-expenses/${id}`, { method: 'DELETE' });
}

export function applyFixedExpenses(month: string): Promise<{ created: number }> {
  return request('/api/fixed-expenses/apply', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}
