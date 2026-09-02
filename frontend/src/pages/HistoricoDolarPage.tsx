import { useMemo, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { formatCentsBRL, formatCentsUSD, parseCentsFromInput, parseRate } from '../lib/money.js';
import { quoteStats } from '../lib/dollar.js';
import { useResource } from '../lib/useResource.js';
import { useFormErrors } from '../lib/useFormErrors.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { useToast } from '../context/ToastContext.js';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function HistoricoDolarPage() {
  const r = useResource(() => api.listDollarQuotes(), []);
  const quotes = r.data ?? [];
  const { toast } = useToast();
  const f = useFormErrors();
  const [month, setMonth] = useState(currentMonth());
  const [rateInput, setRateInput] = useState('');
  const [salaryInput, setSalaryInput] = useState('');

  const stats = useMemo(() => quoteStats(quotes), [quotes]);

  const chartPoints = useMemo(() => {
    if (stats.rows.length < 2) return '';
    const rates = stats.rows.map((r) => r.rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const span = max - min || 1;
    const w = 320;
    const h = 80;
    return stats.rows
      .map((r, i) => {
        const x = (i / (stats.rows.length - 1)) * w;
        const y = h - ((r.rate - min) / span) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [stats]);

  function validateRate() {
    const rate = parseRate(rateInput);
    if (Number.isNaN(rate) || rate <= 0) f.setError('rate', 'Cotação inválida');
    else f.clearError('rate');
  }
  function validateSalary() {
    if (salaryInput.trim() === '') {
      f.clearError('salary');
      return;
    }
    const parsed = parseCentsFromInput(salaryInput);
    if (Number.isNaN(parsed) || parsed < 0) f.setError('salary', 'Salário inválido');
    else f.clearError('salary');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    validateRate();
    validateSalary();

    if (!month) {
      toast('error', 'Informe o mês');
      return;
    }
    const rate = parseRate(rateInput);
    if (Number.isNaN(rate) || rate <= 0) return;
    let salaryUsdCents: number | null = null;
    if (salaryInput.trim() !== '') {
      const parsed = parseCentsFromInput(salaryInput);
      if (Number.isNaN(parsed) || parsed < 0) return;
      salaryUsdCents = parsed;
    }

    try {
      await api.upsertDollarQuote(month, { rate, salaryUsdCents });
      setRateInput('');
      setSalaryInput('');
      f.clearAll();
      toast('success', 'Cotação registrada');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(m: string) {
    try {
      await api.deleteDollarQuote(m);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Histórico Dólar"
        subtitle="Como a cotação afeta seu salário em reais."
      />

      <form onSubmit={handleSubmit} className="card form-grid">
        <div className="field">
          <label className="field-label" htmlFor="dol-month">Mês</label>
          <input id="dol-month" type="month" className="field-input" value={month}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dol-rate">Cotação</label>
          <input id="dol-rate" type="text" className="field-input" value={rateInput}
            placeholder="5,12" aria-invalid={!!f.errors.rate}
            aria-describedby={f.errors.rate ? 'dol-rate-error' : undefined}
            onBlur={validateRate}
            onChange={(e) => setRateInput(e.target.value)} />
          {f.errors.rate && (
            <span className="field-error" role="alert" id="dol-rate-error">{f.errors.rate}</span>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dol-salary">Salário no mês (US$)</label>
          <input id="dol-salary" type="text" className="field-input" value={salaryInput}
            aria-invalid={!!f.errors.salary}
            aria-describedby={f.errors.salary ? 'dol-salary-error' : undefined}
            onBlur={validateSalary}
            onChange={(e) => setSalaryInput(e.target.value)} />
          {f.errors.salary && (
            <span className="field-error" role="alert" id="dol-salary-error">{f.errors.salary}</span>
          )}
        </div>
        <button type="submit" className="button-primary">Registrar cotação</button>
      </form>

      {stats.rows.length >= 2 && (
        <div className="card">
          <svg viewBox="0 0 320 80" preserveAspectRatio="none" className="chart-svg">
            <polyline points={chartPoints} fill="none" stroke="var(--cyan)" strokeWidth="2" />
          </svg>
          <div className="subtle" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{stats.rows[0].month}</span>
            <span>{stats.rows[stats.rows.length - 1].month}</span>
          </div>
        </div>
      )}

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
      <div className="card table-scroll">
        {quotes.length === 0 ? (
          <EmptyState message="Nenhuma cotação registrada." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Cotação</th>
                <th>Salário (US$)</th>
                <th>Salário (R$)</th>
                <th>vs média</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td className="mono">{r.rate.toFixed(4)}</td>
                  <td className="mono">
                    {r.salaryUsdCents !== null ? formatCentsUSD(r.salaryUsdCents) : '—'}
                  </td>
                  <td className="mono">
                    {r.salaryBrlCents !== null ? formatCentsBRL(r.salaryBrlCents) : '—'}
                  </td>
                  <td className="mono muted">
                    {r.vsAveragePct >= 0 ? '+' : ''}
                    {r.vsAveragePct.toFixed(2)}%
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.month)}
                      aria-label={`Excluir cotação de ${r.month}`}
                      className="link-btn"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </AsyncBoundary>
    </div>
  );
}
