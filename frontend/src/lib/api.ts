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
    const err = new Error(body.error ?? 'Request failed') as Error & { status?: number };
    err.status = response.status;
    throw err;
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

export interface EmergencyFundEntry {
  id: number;
  date: string;
  amountCents: number;
  notes: string | null;
}

export function listEmergencyFund(): Promise<EmergencyFundEntry[]> {
  return request('/api/emergency-fund');
}

export function createEmergencyFundEntry(input: {
  kind: 'deposit' | 'withdrawal';
  date: string;
  amountCents: number;
  notes?: string | null;
}): Promise<{ id: number }> {
  return request('/api/emergency-fund', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteEmergencyFundEntry(id: number): Promise<{ ok: true }> {
  return request(`/api/emergency-fund/${id}`, { method: 'DELETE' });
}

export interface MonthlyTarget {
  month: string;
  pctOrFixed: string;
  pctValue: number | null;
  fixedValueCents: number | null;
  targetCents: number;
  rolloverCents: number;
}

export function getMonthlyTarget(month: string): Promise<MonthlyTarget> {
  return request(`/api/savings-target/${month}`);
}

export function updateMonthlyTarget(
  month: string,
  cfg: { pctOrFixed: 'pct' | 'fixed'; pctValue?: number | null; fixedValueCents?: number | null },
): Promise<MonthlyTarget> {
  return request(`/api/savings-target/${month}`, { method: 'PUT', body: JSON.stringify(cfg) });
}

export interface Target {
  id: number;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  notes: string | null;
  status: string;
}

export interface TargetsClient {
  list(): Promise<Target[]>;
  create(input: {
    name: string;
    targetCents: number;
    currentCents?: number;
    targetDate?: string | null;
    notes?: string | null;
  }): Promise<{ id: number }>;
  update(
    id: number,
    patch: {
      name?: string;
      targetCents?: number;
      currentCents?: number;
      targetDate?: string | null;
      notes?: string | null;
    },
  ): Promise<{ ok: true }>;
  addTo(id: number, deltaCents: number): Promise<{ ok: true }>;
  remove(id: number): Promise<{ ok: true }>;
}

export function targetsClient(basePath: string): TargetsClient {
  return {
    list: () => request(basePath),
    create: (input) => request(basePath, { method: 'POST', body: JSON.stringify(input) }),
    update: (id, patch) =>
      request(`${basePath}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    addTo: (id, deltaCents) =>
      request(`${basePath}/${id}/add`, { method: 'POST', body: JSON.stringify({ deltaCents }) }),
    remove: (id) => request(`${basePath}/${id}`, { method: 'DELETE' }),
  };
}

export const goalsApi = targetsClient('/api/goals');
export const projectsApi = targetsClient('/api/special-projects');

export interface DollarQuote {
  month: string;
  rate: number;
  salaryUsdCents: number | null;
}

export function listDollarQuotes(): Promise<DollarQuote[]> {
  return request('/api/dollar-quotes');
}

export function upsertDollarQuote(
  month: string,
  input: { rate: number; salaryUsdCents?: number | null },
): Promise<DollarQuote> {
  return request(`/api/dollar-quotes/${month}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteDollarQuote(month: string): Promise<{ ok: true }> {
  return request(`/api/dollar-quotes/${month}`, { method: 'DELETE' });
}

export interface Diagnostics {
  rowCounts: Record<string, number>;
  dbSizeBytes: number;
  migrations: string[];
  lastBackup: string | null;
  backupCount: number;
}

export interface MonthCloseRow {
  month: string;
  reviewed: boolean;
  reviewedAt: string | null;
}

export const EXPORT_URL = '/api/data/export';

export function getDiagnostics(): Promise<Diagnostics> {
  return request('/api/data/diagnostics');
}

export function importData(
  payload: unknown,
): Promise<{ backupPath: string | null; imported: Record<string, number> }> {
  return request('/api/data/import', { method: 'POST', body: JSON.stringify(payload) });
}

export function wipeData(
  confirm: string,
): Promise<{ backupPath: string | null; deleted: Record<string, number> }> {
  return request('/api/data/wipe', { method: 'POST', body: JSON.stringify({ confirm }) });
}

export function seedTestData(
  confirm: string,
): Promise<{ backupPath: string | null; seeded: true }> {
  return request('/api/data/seed-test', { method: 'POST', body: JSON.stringify({ confirm }) });
}

export function listMonthlyClose(): Promise<MonthCloseRow[]> {
  return request('/api/monthly-close');
}

export function markMonthReviewed(month: string): Promise<MonthCloseRow> {
  return request(`/api/monthly-close/${month}`, { method: 'PUT' });
}

export function unmarkMonthReviewed(month: string): Promise<{ ok: true }> {
  return request(`/api/monthly-close/${month}`, { method: 'DELETE' });
}

export interface DashboardSummary {
  month: string;
  previousMonth: string;
  income: { currentCents: number; previousCents: number };
  expenses: {
    currentCents: number;
    previousCents: number;
    essentialCents: number;
    nonEssentialCents: number;
    byCategory: { category: string; cents: number }[];
  };
  balanceCents: number;
  reserveBalanceCents: number;
  savingsTarget: { targetCents: number; savedThisMonthCents: number } | null;
  installments: {
    nextMonthCommitmentCents: number;
    activeGroups: number;
    earliestEndMonth: string | null;
  };
  recentExpenses: { date: string; description: string; category: string; amountCents: number }[];
  topGoals: { name: string; currentCents: number; targetCents: number; progressPct: number }[];
  evolution: { month: string; incomeCents: number; expensesCents: number }[];
  monthlyClose: { reviewed: boolean; reviewedAt: string | null };
  alerts: { level: 'info' | 'warning' | 'danger'; message: string }[];
}

export function getDashboard(month?: string): Promise<DashboardSummary> {
  return request(`/api/dashboard${month ? `?month=${month}` : ''}`);
}

export interface AiStatus {
  configured: boolean;
  model: string;
  monthToDateUsdCents: number;
  capUsdCents: number;
  usdBrlRate: number;
}
export interface AiAnalysis {
  id: number;
  createdAt: string;
  kind: 'diagnostico' | 'poupanca' | 'cambio';
  responseMd: string;
  costUsdCents: number;
  model: string;
}
export function getAiStatus(): Promise<AiStatus> {
  return request('/api/ai/status');
}
export function listAiAnalyses(limit?: number): Promise<AiAnalysis[]> {
  return request(`/api/ai/analyses${limit ? `?limit=${limit}` : ''}`);
}
export function runAiAnalysis(kind: AiAnalysis['kind']): Promise<AiAnalysis> {
  return request('/api/ai/analyses', { method: 'POST', body: JSON.stringify({ kind }) });
}
